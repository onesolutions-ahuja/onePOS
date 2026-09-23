import express from "express";
import {
  resolveStockStore,
  createInventoryMovement,
  receiveInventoryBatch,
  consumeInventoryBatch,
  expiryStatus,
  BATCH_LIMITS,
} from "../services/inventory.js";
import { resolveAdjustmentReason } from "../services/adjustmentReasons.js";

/*
|--------------------------------------------------------------------------
| Batch / Expiry Tracking — store-level batch API
|--------------------------------------------------------------------------
|
| Batches live in inventory_batches keyed by (company, store, product,
| batch_number) — the same manufacturer batch number is legitimate in two
| stores and NEVER combined. Every quantity change goes through the shared
| movement primitive (createInventoryMovement) so products.stock_quantity,
| product_store_stock and the movement ledger stay authoritative; the batch
| row is kept consistent inside the SAME transaction.
|
| Scope rule for every endpoint: company = JWT identity only; store = the
| operator's own store by default, an explicit storeId honoured only via
| resolveStockStore (the EXISTING access model). Expired batches are never
| deleted or silently reduced — expiry_status is computed and returned.
|
| All routes are mounted by server.js under /api.
*/

export default function createInventoryBatchesRouter({
  authenticate,
  authorize,
  db,
  pool,
  canAccessStore,
}) {
  const router = express.Router();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /*
   * Resolve the store a batch operation targets: the operator's own store by
   * default; an explicit storeId only through the existing access model.
   * Returns a response-ready { storeId } or { error }.
   */
  async function resolveStore(user, requestedStoreId) {
    if (!requestedStoreId) {
      if (!user.storeId) {
        return { error: { statusCode: 400, message: "No store context for batch operations" } };
      }
      return { storeId: user.storeId };
    }
    try {
      const storeId = await resolveStockStore({
        user,
        requestedStoreId,
        canAccessStore: (u, sid) => canAccessStore(u, sid),
      });
      return { storeId };
    } catch (scopeError) {
      return { error: { statusCode: scopeError.statusCode || 403, message: scopeError.message } };
    }
  }

  function validateExpiry(expiryDate) {
    if (expiryDate == null || expiryDate === "") return null;
    if (!DATE_RE.test(String(expiryDate))) {
      return { statusCode: 400, message: "Expiry date must be YYYY-MM-DD" };
    }
    /* Strict calendar check: JS Date rolls over (2026-02-30 → 2026-03-02),
     * so verify the components round-trip instead of trusting the parse. */
    const [y, m, d] = String(expiryDate).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return { statusCode: 400, message: "Expiry date is not a valid calendar date" };
    }
    return String(expiryDate);
  }

  function serialise(row, now, expiringSoonDays) {
    return {
      ...row,
      quantity: Number(row.quantity),
      expiry_status: expiryStatus(row.expiry_date, { now, expiringSoonDays }),
    };
  }

  /*
   * GET /api/inventory/batches
   * Filters: storeId (access-checked), productId, expiryStatus
   * (expired|expiring|valid), expiringSoonDays (default 7), asOf (YYYY-MM-DD,
   * for deterministic reporting/tests). Batches whose quantity is 0 are
   * listed unless ?includeEmpty=false — history stays visible.
   */
  router.get(
    "/inventory/batches",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const scope = await resolveStore(req.user, req.query.storeId || null);
        if (scope.error) {
          return res.status(scope.error.statusCode).json({ success: false, message: scope.error.message });
        }

        const params = [req.user.companyId, scope.storeId];
        const filters = ["b.company_id = $1", "b.store_id = $2"];

        if (req.query.productId) {
          params.push(req.query.productId);
          filters.push(`b.product_id = $${params.length}`);
        }

        const asOf = req.query.asOf && DATE_RE.test(String(req.query.asOf))
          ? String(req.query.asOf)
          : new Date().toISOString().slice(0, 10);
        const days = Number.isFinite(Number(req.query.expiringSoonDays))
          ? Number(req.query.expiringSoonDays)
          : 7;

        const status = String(req.query.expiryStatus || "");
        if (status && !["expired", "expiring", "valid"].includes(status)) {
          return res.status(400).json({ success: false, message: "Invalid expiryStatus filter" });
        }

        if (String(req.query.includeEmpty || "") === "false") {
          filters.push("b.quantity > 0");
        }

        const result = await db(
          `
          SELECT b.id, b.company_id, b.store_id, b.product_id,
                 b.batch_number, b.expiry_date, b.quantity,
                 b.created_at, b.updated_at,
                 p.name AS product_name, p.sku,
                 p.batch_tracking AS product_batch_tracking
          FROM inventory_batches b
          INNER JOIN products p ON p.id = b.product_id
          WHERE ${filters.join(" AND ")}
          ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC
          `,
          params
        );

        /* Expiry status (and its filter) is computed in JS from the stored
         * DATE via the ONE shared expiryStatus implementation — the same
         * function the batch rows, reports and FEFO consumers use. */
        const now = req.query.asOf ? new Date(`${asOf}T00:00:00Z`) : new Date();
        const rows = result.rows
          .map((row) => serialise(row, now, days))
          .filter((row) => !status || row.expiry_status === status);

        res.json({
          success: true,
          data: rows,
        });
      } catch (error) {
        console.error("List inventory batches error:", error);
        res.status(500).json({ success: false, message: "Unable to list batches" });
      }
    }
  );

  /*
   * POST /api/inventory/batches — receive stock into a batch.
   *
   *   { productId, batchNumber?, expiryDate?, quantity, storeId?,
   *     operation?: "receive"|"set", referenceType?, referenceId?, reason?, notes? }
   *
   *   receive (default): accumulate into (company, store, product, batch_number).
   *     A batch_number that doesn't exist yet is CREATED — a new delivery never
   *     overwrites an existing batch. Writes an ADJUSTMENT_IN (or OPENING when
   *     referenceType === "OPENING") movement through the shared primitive.
   *   set: the batch must already exist; the counted quantity REPLACES the
   *     stored quantity (stocktake/manual set). Removing stock goes through
   *     the shared primitive as ADJUSTMENT_OUT — same rule as a manual
   *     adjustment, so the existing negative-stock guard applies.
   */
  router.post(
    "/inventory/batches",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const {
        productId,
        batchNumber = null,
        expiryDate = null,
        quantity,
        storeId: requestedStoreId,
        operation = "receive",
        referenceType = null,
        referenceId = null,
        reason = null,
        notes = null,
      } = req.body || {};

      const scope = await resolveStore(req.user, requestedStoreId || null);
      if (scope.error) {
        return res.status(scope.error.statusCode).json({ success: false, message: scope.error.message });
      }

      const qty = Number(quantity);
      if (!productId || !Number.isFinite(qty)) {
        return res.status(400).json({ success: false, message: "Product and a finite quantity are required" });
      }
      if (qty <= 0) {
        return res.status(400).json({ success: false, message: "Batch quantity must be greater than zero" });
      }
      if (operation !== "receive" && operation !== "set") {
        return res.status(400).json({ success: false, message: "Invalid operation" });
      }
      const number = batchNumber != null && String(batchNumber).trim() !== "" ? String(batchNumber).trim() : null;
      if (number && number.length > BATCH_LIMITS.maxBatchNumberLength) {
        return res.status(400).json({ success: false, message: "Batch number too long" });
      }
      let expiry = null;
      try {
        expiry = validateExpiry(expiryDate);
        if (expiry && expiry.statusCode) throw Object.assign(new Error(expiry.message), { statusCode: expiry.statusCode });
      } catch (error) {
        return res.status(error.statusCode || 400).json({ success: false, message: error.message });
      }
      if (!pool) {
        return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
      }

      const client = await pool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;

        /* Product exists, belongs to the caller's company, is active. */
        const productCheck = await client.query(
          `SELECT id FROM products WHERE id = $1 AND company_id = $2 AND active = true FOR UPDATE`,
          [productId, req.user.companyId]
        );
        if (!productCheck.rows.length) {
          return res.status(404).json({ success: false, message: "Product not found" });
        }

        let batch;
        if (operation === "receive") {
          const result = await receiveInventoryBatch(client, {
            companyId: req.user.companyId,
            storeId: scope.storeId,
            productId,
            batchNumber: number,
            expiryDate: expiry,
            quantity: qty,
            referenceType,
            referenceId,
            reason,
            notes,
            createdBy: req.user.id,
          });
          batch = result.batch;
        } else {
          /* operation === "set" */
          if (!number) {
            return res.status(400).json({ success: false, message: "A batch number is required to set a counted quantity" });
          }
          const existing = await client.query(
            `SELECT id, quantity FROM inventory_batches
             WHERE company_id = $1 AND store_id = $2 AND product_id = $3 AND batch_number = $4
             FOR UPDATE`,
            [req.user.companyId, scope.storeId, productId, number]
          );
          if (!existing.rows.length) {
            return res.status(404).json({ success: false, message: "Batch not found in this store" });
          }
          const current = Number(existing.rows[0].quantity);
          const delta = Math.round((qty - current) * 1000) / 1000;
          if (delta < 0) {
            /* Removing stock: consumeInventoryBatch debits the batch row AND
             * writes the ADJUSTMENT_OUT movement through the shared
             * primitive — nothing else to apply afterwards. */
            await consumeInventoryBatch(client, {
              companyId: req.user.companyId,
              storeId: scope.storeId,
              productId,
              quantity: Math.abs(delta),
              mode: "explicit",
              batchId: existing.rows[0].id,
              movementType: "ADJUSTMENT_OUT",
              reason: reason || "Batch quantity set (stocktake)",
              notes,
              createdBy: req.user.id,
            });
          } else if (delta > 0) {
            /* Adding stock: movement via the shared primitive, then
             * accumulate the (already existing) batch row. */
            await createInventoryMovement(client, {
              companyId: req.user.companyId,
              productId,
              storeId: scope.storeId,
              movementType: "ADJUSTMENT_IN",
              quantityChange: delta,
              reason: reason || "Batch quantity set (stocktake)",
              notes,
              createdBy: req.user.id,
            });
            await client.query(
              `UPDATE inventory_batches SET quantity = quantity + $1, expiry_date = COALESCE($3, expiry_date), updated_at = NOW()
               WHERE id = $2`,
              [delta, existing.rows[0].id, expiry]
            );
          } else if (expiry) {
            await client.query(
              `UPDATE inventory_batches SET expiry_date = $3, updated_at = NOW() WHERE id = $2 AND company_id = $1`,
              [req.user.companyId, existing.rows[0].id, expiry]
            );
          }
          const refreshed = await client.query(
            `SELECT id, batch_number, expiry_date, quantity FROM inventory_batches WHERE id = $1`,
            [existing.rows[0].id]
          );
          batch = refreshed.rows[0];
        }

        await client.query("COMMIT");
        const now = new Date();
        res.status(201).json({
          success: true,
          message: "Batch saved",
          data: serialise({ ...batch, product_id: productId, store_id: scope.storeId, company_id: req.user.companyId }, now, 7),
        });
      } catch (error) {
        if (transactionStarted) {
          await client.query("ROLLBACK");
        }
        console.error("Save inventory batch error:", error);
        const status = error.message === "Product not found" ? 404 : error.statusCode || 400;
        res.status(status).json({ success: false, message: error.message || "Unable to save batch" });
      } finally {
        client.release();
      }
    }
  );

  /*
   * GET /api/inventory/batches/:id — one batch. Company+store scoped: a batch
   * from another store or company is indistinguishable from a missing one.
   */
  router.get(
    "/inventory/batches/:id",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const scope = await resolveStore(req.user, req.query.storeId || null);
        if (scope.error) {
          return res.status(scope.error.statusCode).json({ success: false, message: scope.error.message });
        }
        const result = await db(
          `
          SELECT b.id, b.company_id, b.store_id, b.product_id,
                 b.batch_number, b.expiry_date, b.quantity,
                 b.created_at, b.updated_at,
                 p.name AS product_name, p.sku,
                 p.batch_tracking AS product_batch_tracking
          FROM inventory_batches b
          INNER JOIN products p ON p.id = b.product_id
          WHERE b.id = $1 AND b.company_id = $2 AND b.store_id = $3
          `,
          [req.params.id, req.user.companyId, scope.storeId]
        );
        if (!result.rows.length) {
          return res.status(404).json({ success: false, message: "Batch not found" });
        }
        res.json({ success: true, data: serialise(result.rows[0], new Date(), 7) });
      } catch (error) {
        console.error("Load inventory batch error:", error);
        res.status(500).json({ success: false, message: "Unable to load batch" });
      }
    }
  );

  /*
   * PUT /api/inventory/batches/:id — edit batch INFORMATION (expiry date /
   * batch number), scoped to the operator's store via resolveStore. Quantity
   * is NOT editable here on purpose: quantities change through movements
   * (POST receive/set, sales, wastage, transfers) so the ledger and the
   * batch rows can never disagree.
   */
  router.put(
    "/inventory/batches/:id",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { expiryDate, batchNumber } = req.body || {};
      const scope = await resolveStore(req.user, (req.body && req.body.storeId) || null);
      if (scope.error) {
        return res.status(scope.error.statusCode).json({ success: false, message: scope.error.message });
      }

      let expiry;
      let expiryProvided = false;
      try {
        if (expiryDate !== undefined) {
          expiryProvided = true;
          expiry = validateExpiry(expiryDate);
          if (expiry && expiry.statusCode) throw Object.assign(new Error(expiry.message), { statusCode: expiry.statusCode });
        }
      } catch (error) {
        return res.status(error.statusCode || 400).json({ success: false, message: error.message });
      }
      const number = batchNumber != null && String(batchNumber).trim() !== "" ? String(batchNumber).trim() : undefined;
      if (number !== undefined && number !== null && number.length > BATCH_LIMITS.maxBatchNumberLength) {
        return res.status(400).json({ success: false, message: "Batch number too long" });
      }

      const client = await pool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const existing = await client.query(
          `SELECT id, product_id, batch_number FROM inventory_batches
           WHERE id = $1 AND company_id = $2 AND store_id = $3 FOR UPDATE`,
          [req.params.id, req.user.companyId, scope.storeId]
        );
        if (!existing.rows.length) {
          return res.status(404).json({ success: false, message: "Batch not found" });
        }

        if (number !== undefined && number !== null && number !== existing.rows[0].batch_number) {
          /* Renaming to an existing batch number in the same store+product
           * would silently merge two batches — block it. */
          const clash = await client.query(
            `SELECT id FROM inventory_batches
             WHERE company_id = $1 AND store_id = $2 AND product_id = $3 AND batch_number = $4 AND id <> $5`,
            [req.user.companyId, scope.storeId, existing.rows[0].product_id, number, req.params.id]
          );
          if (clash.rows.length) {
            return res.status(409).json({ success: false, message: "A batch with that number already exists in this store" });
          }
        }

        const updates = [];
        const params = [req.params.id];
        if (expiryProvided) {
          params.push(expiry);
          updates.push(`expiry_date = $${params.length}`);
        }
        if (number !== undefined) {
          params.push(number);
          updates.push(`batch_number = $${params.length}`);
        }
        if (updates.length) {
          await client.query(
            `UPDATE inventory_batches SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1`,
            params
          );
        }

        const refreshed = await db(
          `
          SELECT b.id, b.company_id, b.store_id, b.product_id,
                 b.batch_number, b.expiry_date, b.quantity,
                 b.created_at, b.updated_at,
                 p.name AS product_name, p.sku,
                 p.batch_tracking AS product_batch_tracking
          FROM inventory_batches b
          INNER JOIN products p ON p.id = b.product_id
          WHERE b.id = $1
          `,
          [req.params.id]
        );

        await client.query("COMMIT");
        res.json({ success: true, message: "Batch updated", data: serialise(refreshed.rows[0], new Date(), 7) });
      } catch (error) {
        if (transactionStarted) {
          await client.query("ROLLBACK");
        }
        console.error("Update inventory batch error:", error);
        res.status(500).json({ success: false, message: "Unable to update batch" });
      } finally {
        client.release();
      }
    }
  );

  /*
   * POST /api/inventory/batches/:id/consume — batch-aware stock removal
   * (wastage, breakage, damage, supplier return of a specific batch).
   *
   * Decreases REQUIRE a canonical reason (Wastage / Breakage / Other) via
   * the EXISTING resolveAdjustmentReason rules, then write an
   * ADJUSTMENT_OUT movement through the shared primitive and debit the
   * named batch — one transaction, one consistent story. Expired stock is
   * NEVER auto-deleted: wastage of expired stock is an explicit, auditable
   * action against the batch.
   */
  router.post(
    "/inventory/batches/:id/consume",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { quantity, reason, notes = null, storeId: requestedStoreId } = req.body || {};

      const scope = await resolveStore(req.user, requestedStoreId || null);
      if (scope.error) {
        return res.status(scope.error.statusCode).json({ success: false, message: scope.error.message });
      }

      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: "Quantity must be greater than zero" });
      }

      const resolved = resolveAdjustmentReason(-qty, reason);
      if (resolved && resolved.error) {
        return res.status(400).json({ success: false, message: resolved.error });
      }
      let storedReason = resolved && resolved.reason ? resolved.reason : reason;
      let storedNotes = notes;
      if (resolved && resolved.detail) {
        storedNotes = storedNotes && String(storedNotes).trim()
          ? `${String(storedNotes).trim()} (${resolved.detail})`
          : resolved.detail;
      }

      if (!pool) {
        return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
      }

      const client = await pool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const existing = await client.query(
          `SELECT id, product_id, batch_number, expiry_date, quantity FROM inventory_batches
           WHERE id = $1 AND company_id = $2 AND store_id = $3 FOR UPDATE`,
          [req.params.id, req.user.companyId, scope.storeId]
        );
        if (!existing.rows.length) {
          return res.status(404).json({ success: false, message: "Batch not found in this store" });
        }
        if (Number(existing.rows[0].quantity) < qty) {
          return res.status(400).json({
            success: false,
            message: `Insufficient batch quantity (available ${Number(existing.rows[0].quantity)})`,
          });
        }

        const result = await consumeInventoryBatch(client, {
          companyId: req.user.companyId,
          storeId: scope.storeId,
          productId: existing.rows[0].product_id,
          quantity: qty,
          mode: "explicit",
          batchId: existing.rows[0].id,
          movementType: "ADJUSTMENT_OUT",
          reason: storedReason,
          notes: storedNotes,
          createdBy: req.user.id,
        });

        await client.query("COMMIT");
        res.status(200).json({
          success: true,
          message: "Batch stock consumed",
          data: {
            batchId: existing.rows[0].id,
            batchNumber: existing.rows[0].batch_number,
            consumed: qty,
            reason: storedReason,
            movement: result.movement,
            balance: result.balance,
          },
        });
      } catch (error) {
        if (transactionStarted) {
          await client.query("ROLLBACK");
        }
        console.error("Consume inventory batch error:", error);
        const status = error.message === "Product not found" ? 404 : 400;
        res.status(status).json({ success: false, message: error.message || "Unable to consume batch" });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
