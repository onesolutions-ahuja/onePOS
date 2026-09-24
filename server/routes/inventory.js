import express from "express";
import { lowStockRow, resolveStockStore, allocateBatchConsumption, upsertBatchRow, rebuildInventoryBalances, reconcileInventoryBalances } from "../services/inventory.js";
import { resolveBatchEntry, normaliseBatchPolicy } from "../services/batchPolicy.js";
import { resolveAdjustmentReason } from "../services/adjustmentReasons.js";

export default function createInventoryRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  inventoryMovementTypes,
  canAccessStore,
  canViewCompanyCustomers,
}) {
  const router = express.Router();

  router.get("/inventory/balances", authenticate, authorize("inventory.view"), async (req, res) => {
    try {
      const params = [req.user.companyId];
      const filters = ["r.company_id=$1"];
      if (req.query.storeId) { params.push(req.query.storeId); filters.push(`r.store_id=$${params.length}`); }
      if (req.query.productId) { params.push(req.query.productId); filters.push(`r.product_id=$${params.length}`); }
      const result = await db(`SELECT r.*, p.name AS product_name, s.name AS store_name
        FROM inventory_balance_rollups r JOIN products p ON p.id=r.product_id
        JOIN stores s ON s.id=r.store_id WHERE ${filters.join(" AND ")}
        ORDER BY s.name,p.name`, params);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load inventory balances error:", error);
      res.status(500).json({ success: false, message: "Unable to load inventory balances" });
    }
  });

  router.post("/inventory/balances/reconcile", authenticate, authorize("inventory.view"), async (req, res) => {
    try {
      const rows = await reconcileInventoryBalances({ query: db }, {
        companyId: req.user.companyId, storeId: req.body?.storeId || req.query.storeId, productId: req.body?.productId || req.query.productId,
      });
      res.json({ success: true, data: { rows, discrepancies: rows.filter((row) => Number(row.discrepancy) !== 0) } });
    } catch (error) {
      console.error("Reconcile inventory balances error:", error);
      res.status(500).json({ success: false, message: "Unable to reconcile inventory balances" });
    }
  });

  router.post("/inventory/balances/rebuild", authenticate, authorize("inventory.adjust"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await rebuildInventoryBalances(client, {
        companyId: req.user.companyId, storeId: req.body?.storeId, productId: req.body?.productId,
      });
      await client.query("COMMIT");
      res.json({ success: true, data: rows });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Rebuild inventory balances error:", error);
      res.status(500).json({ success: false, message: "Unable to rebuild inventory balances" });
    } finally { client.release(); }
  });

  /*
   * GET /api/inventory/movements
   *
   * T10R filters (all optional, backward compatible): reason (Wastage /
   * Breakage / Other, matched case-insensitively against the stored reason
   * text), dateFrom / dateTo (YYYY-MM-DD), productId already supported.
   * Same ledger, same company scoping, same 500-row cap.
   */
  router.get(
    "/inventory/movements",
    authenticate,
    authorize("inventory.movements.view", "inventory.view"),
    async (req, res) => {
      try {
        const params = [req.user.companyId];
        const filters = ["m.company_id = $1"];

        if (req.query.storeId) {
          params.push(req.query.storeId);
          filters.push(`m.store_id = $${params.length}`);
        }

        if (req.query.productId) {
          params.push(req.query.productId);
          filters.push(`m.product_id = $${params.length}`);
        }

        if (req.query.movementType) {
          if (!inventoryMovementTypes.has(req.query.movementType)) {
            return res.status(400).json({
              success: false,
              message: "Invalid movement type",
            });
          }

          params.push(req.query.movementType);
          filters.push(`m.movement_type = $${params.length}`);
        }

        if (req.query.reason) {
          const wanted = String(req.query.reason).trim().toLowerCase();
          if (!["wastage", "breakage", "other"].includes(wanted)) {
            return res.status(400).json({
              success: false,
              message: "Invalid reason filter: use Wastage, Breakage or Other",
            });
          }
          if (wanted === "other") {
            filters.push(`(m.reason IS NULL OR NOT (LOWER(m.reason) IN ('wastage','wasted','waste','breakage','broken','damage','damaged')))`);
          } else if (wanted === "wastage") {
            filters.push(`(LOWER(m.reason) IN ('wastage','wasted','waste'))`);
          } else {
            filters.push(`(LOWER(m.reason) IN ('breakage','broken','damage','damaged'))`);
          }
        }

        if (req.query.dateFrom) {
          params.push(req.query.dateFrom);
          filters.push(`(m.created_at)::date >= $${params.length}::date`);
        }

        if (req.query.dateTo) {
          params.push(req.query.dateTo);
          filters.push(`(m.created_at)::date <= $${params.length}::date`);
        }

        const result = await db(
          `
          SELECT
            m.id,
            m.product_id,
            p.name AS product_name,
            p.sku,
            m.store_id,
            s.name AS store_name,
            m.movement_type,
            m.quantity_change,
            m.balance_after,
            m.reference_type,
            m.reference_id,
            m.batch_id,
            m.transaction_id,
            m.reason,
            m.notes,
            m.created_by,
            u.username AS created_by_username,
            m.created_at,
            p.cost_price,
            p.category_id,
            cat.name AS category_name
          FROM inventory_movements m
          INNER JOIN products p ON p.id = m.product_id
          LEFT JOIN categories cat ON cat.id = p.category_id
          LEFT JOIN stores s ON s.id = m.store_id
          LEFT JOIN users u ON u.id = m.created_by
          WHERE ${filters.join(" AND ")}
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 500
          `,
          params
        );

        res.json({
          success: true,
          data: result.rows.map((row) => ({
            ...row,
            quantity: row.quantity_change !== null ? Number(row.quantity_change) : null,
            value:
              row.quantity_change !== null && row.cost_price !== null
                ? Number(row.quantity_change) * Number(row.cost_price)
                : null,
          })),
        });
      } catch (error) {
        console.error("Load inventory movements error:", error);

        res.status(500).json({
          success: false,
          message: "Unable to load inventory movements",
        });
      }
    }
  );

  /*
   * POST /api/inventory/adjustments
   */
  router.post(
    "/inventory/adjustments",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { productId, adjustmentQuantity, reason = null, notes = null } =
        req.body;
      const quantity = Number(adjustmentQuantity);

      if (!productId || !Number.isFinite(quantity) || quantity === 0) {
        return res.status(400).json({
          success: false,
          message: "Product and a non-zero adjustment quantity are required",
        });
      }

      /*
       * T10R - decreases require a canonical reason (Wastage / Breakage /
       * Other). Increases keep the existing free-text/optional behaviour.
       * The SAME movement row is written below; only the stored reason label
       * is canonicalised for decreases, with any free-text detail preserved
       * in notes (appended, never overwriting the caller's notes).
       */
      let storedReason = reason;
      let storedNotes = notes;
      if (quantity < 0) {
        const resolved = resolveAdjustmentReason(quantity, reason);
        if (resolved && resolved.error) {
          return res.status(400).json({ success: false, message: resolved.error });
        }
        storedReason = resolved && resolved.reason ? resolved.reason : reason;
        if (resolved && resolved.detail) {
          storedNotes = storedNotes && String(storedNotes).trim()
            ? `${String(storedNotes).trim()} (${resolved.detail})`
            : resolved.detail;
        }
      }

      if (!pool) {
        return res.status(500).json({
          success: false,
          message: "DATABASE_URL is not configured",
        });
      }

      const client = await pool.connect();
      let transactionStarted = false;

      try {
        await client.query("BEGIN");
        transactionStarted = true;

        /* The store being adjusted: the operator's own store by default; an
         * explicit storeId only via the EXISTING access model. */
        let adjustStoreId;
        try {
          adjustStoreId = await resolveStockStore({
            user: req.user,
            requestedStoreId: req.body.storeId || null,
            canAccessStore: async (user, storeId) => canAccessStore(user, storeId),
          });
        } catch (scopeError) {
          return res
            .status(scopeError.statusCode || 403)
            .json({ success: false, message: scopeError.message });
        }

        const productResult = await client.query(
          "SELECT batch_tracking FROM products WHERE id=$1 AND company_id=$2",
          [productId, req.user.companyId]
        );
        const policyResult = await client.query(
          "SELECT batch_inventory_mode, batch_default_mfg_rule, batch_default_expiry_rule, batch_default_expiry_days FROM company_settings WHERE company_id=$1",
          [req.user.companyId]
        );
        const batch = resolveBatchEntry(normaliseBatchPolicy(policyResult.rows[0]), {
          productBatchTracking: productResult.rows[0]?.batch_tracking === true,
          batchNumber: req.body.batchNumber,
          manufacturingDate: req.body.manufacturingDate,
          expiryDate: req.body.expiryDate,
        });
        if (quantity < 0 && batch.batchNumber) {
          await allocateBatchConsumption(client, {
            companyId: req.user.companyId,
            storeId: adjustStoreId,
            productId,
            quantity: Math.abs(quantity),
            mode: req.body.batchId ? "explicit" : "fefo",
            batchId: req.body.batchId || null,
          });
        }
        const result = await createInventoryMovement(client, {
          companyId: req.user.companyId,
          productId,
          storeId: adjustStoreId,
          movementType: quantity > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantityChange: quantity,
          reason: storedReason,
          notes: storedNotes,
          createdBy: req.user.id,
        });
        if (quantity > 0 && batch.batchNumber) {
          await upsertBatchRow(client, {
            companyId: req.user.companyId,
            storeId: adjustStoreId,
            productId,
            ...batch,
            quantity,
          });
        }

        await client.query("COMMIT");

        res.status(201).json({
          success: true,
          message: "Inventory adjustment created",
          data: {
            movement: result.movement,
            balance: result.balance,
          },
        });
      } catch (error) {
        if (transactionStarted) {
          await client.query("ROLLBACK");
        }

        console.error("Inventory adjustment error:", error);

        res
          .status(error.message === "Product not found" ? 404 : 400)
          .json({
            success: false,
            message: error.message || "Unable to adjust inventory",
          });
      } finally {
        client.release();
      }
    }
  );

  /*
   * GET /api/inventory/reconciliation
   */
  router.get(
    "/inventory/reconciliation",
    authenticate,
    authorize("reports.inventory.view", "inventory.view"),
    async (req, res) => {
      try {
        const result = await db(
          "SELECT p.id, p.name, p.stock_quantity current_stock, COALESCE(SUM(m.quantity_change),0) ledger_balance FROM products p LEFT JOIN inventory_movements m ON m.product_id=p.id AND m.company_id=$1 WHERE p.id=$2 AND p.company_id=$1 GROUP BY p.id",
          [req.user.companyId, req.query.productId]
        );
        if (!result.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Product not found" });
        const row = result.rows[0];
        const movements = await db(
          "SELECT m.created_at, m.movement_type, m.quantity_change, m.balance_after, m.reference_type, m.reference_id, u.username, m.reason FROM inventory_movements m LEFT JOIN users u ON u.id=m.created_by WHERE m.product_id=$1 AND m.company_id=$2 AND m.store_id=$3 ORDER BY m.created_at, m.id",
          [req.query.productId, req.user.companyId, req.user.storeId]
        );
        res.json({
          success: true,
          data: {
            product: row.name,
            currentStock: Number(row.current_stock),
            ledgerBalance: Number(row.ledger_balance),
            mismatch:
              Math.abs(Number(row.current_stock) - Number(row.ledger_balance)) >
              0.001,
            movements: movements.rows,
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: "Unable to load reconciliation",
        });
      }
    }
  );

  /*
   * GET /api/inventory/low-stock
   *
   * Live low-stock list derived from the SAME product columns the rest of the
   * app already uses (stock_quantity + low_stock_level + track_stock). Products
   * whose track_stock is OFF are never flagged by this endpoint.
   */
  router.get(
    "/inventory/low-stock",
    authenticate,
    authorize("reports.low_stock.view", "inventory.view"),
    async (req, res) => {
      try {
        const result = await db(
          `
          SELECT
            p.id,
            p.name,
            p.sku,
            p.barcode,
            p.stock_quantity,
            p.low_stock_level,
            p.track_stock,
            p.category_id,
            c.name AS category_name
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.company_id = $1
            AND p.active = true
          `,
          [req.user.companyId]
        );

        const data = result.rows
          .map((row) => lowStockRow({ ...row, category: row.category_name }))
          .filter((row) => row.isLow);

        res.json({
          success: true,
          data,
        });
      } catch (error) {
        console.error("Load low-stock list error:", error);

        res.status(500).json({
          success: false,
          message: "Unable to load low-stock list",
        });
      }
    }
  );
  /*
   * STOCK BY STORE — read foundation.
   *
   * GET /api/inventory/stock            → current store only (own-store scope)
   * GET /api/inventory/stock?allStores=true
   *                                     → every assigned store (or all company
   *                                       stores for admins) when the existing
   *                                       access model allows it; 403 otherwise.
   * GET /api/inventory/stock/:productId → one product across accessible stores.
   *
   * The authoritative per-store quantity is product_store_stock. Products
   * with no store rows (created before store stock existed) fall back to the
   * company-level products.stock_quantity on their operator's store so the
   * view is never silently empty. A company-wide total is never returned as
   * the primary value — only an explicitly labelled total.
   */
  router.get(
    "/inventory/stock",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const wantAll = String(req.query.allStores || "") === "true";

        if (wantAll) {
          const isAdmin = await canViewCompanyCustomers(req.user);
          const assigned = Array.isArray(req.user.assignedStoreIds)
            ? req.user.assignedStoreIds.filter(Boolean)
            : [];
          if (!isAdmin && assigned.length <= 1) {
            return res
              .status(403)
              .json({ success: false, message: "You do not have access to other stores" });
          }
          const result = await db(
            `
            SELECT pss.product_id, pss.store_id, pss.quantity, s.name AS store_name
            FROM product_store_stock pss
            INNER JOIN stores s ON s.id = pss.store_id
            WHERE pss.company_id = $1
              AND ($2::uuid[] IS NULL OR pss.store_id = ANY($2::uuid[]))
            ORDER BY s.name, pss.product_id
            `,
            [req.user.companyId, isAdmin ? null : assigned]
          );
          return res.json({ success: true, data: result.rows.map((r) => ({ ...r, quantity: Number(r.quantity) })) });
        }

        /* Single-store read: own store only — a requested storeId can never
         * widen the scope past the operator's access. */
        const requestedStoreId = req.query.storeId ? String(req.query.storeId) : req.user.storeId;
        const allowed = requestedStoreId === req.user.storeId || (await canAccessStore(req.user, requestedStoreId));
        if (!allowed) {
          return res
            .status(403)
            .json({ success: false, message: "You do not have access to this store" });
        }
        const result = await db(
          `
          SELECT p.id AS product_id, p.name, p.sku,
                 COALESCE(pss.quantity, p.stock_quantity) AS quantity,
                 (pss.id IS NULL) AS is_company_fallback
          FROM products p
          LEFT JOIN product_store_stock pss
            ON pss.product_id = p.id
           AND pss.company_id = p.company_id
           AND pss.store_id = $2
          WHERE p.company_id = $1 AND p.active = true
          ORDER BY p.name
          `,
          [req.user.companyId, requestedStoreId]
        );
        res.json({
          success: true,
          data: result.rows.map((r) => ({
            productId: r.product_id,
            name: r.name,
            sku: r.sku,
            storeId: requestedStoreId,
            quantity: Number(r.quantity) || 0,
            isCompanyFallback: r.is_company_fallback,
          })),
        });
      } catch (error) {
        console.error("Load store stock error:", error);
        res.status(500).json({ success: false, message: "Unable to load store stock" });
      }
    }
  );

  /*
   * GET /api/inventory/stock/:productId — one product's stock across the
   * stores the operator may access. Includes an explicitly labelled total;
   * single-store users see just their store.
   */
  router.get(
    "/inventory/stock/:productId",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const isAdmin = await canViewCompanyCustomers(req.user);
        const storeFilter = isAdmin
          ? null
          : (req.user.assignedStoreIds || []).filter(Boolean);
        const result = await db(
          `
          SELECT pss.store_id, pss.quantity, s.name AS store_name
          FROM product_store_stock pss
          INNER JOIN stores s ON s.id = pss.store_id
          WHERE pss.company_id = $1 AND pss.product_id = $2
            AND ($3::uuid[] IS NULL OR pss.store_id = ANY($3::uuid[]))
          ORDER BY s.name
          `,
          [req.user.companyId, req.params.productId, storeFilter]
        );
        const stores = result.rows.map((r) => ({
          storeId: r.store_id,
          storeName: r.store_name,
          quantity: Number(r.quantity) || 0,
        }));
        res.json({
          success: true,
          data: {
            productId: req.params.productId,
            stores,
            total: stores.reduce((sum, s) => sum + s.quantity, 0),
          },
        });
      } catch (error) {
        console.error("Load product store stock error:", error);
        res.status(500).json({ success: false, message: "Unable to load product stock by store" });
      }
    }
  );

  /*
   * STOCK TRANSFERS — move stock between a company's own stores.
   *
   * Uses the EXISTING store-access model (canAccessStore) for both sides and
   * the EXISTING movement primitive for execution: each line writes a
   * TRANSFER_OUT at the source and a TRANSFER_IN at the destination inside
   * ONE transaction referencing the transfer row, so partial transfers are
   * impossible and the established negative-stock rules apply unchanged
   * (a transfer, like any non-SALE movement, cannot drive the source
   * negative).
   */
  const accessibleStoreIds = async (user) => {
    if (await canViewCompanyCustomers(user)) return null; // admin/owner: all company stores
    return Array.isArray(user.assignedStoreIds) ? user.assignedStoreIds.filter(Boolean) : [];
  };

  const nextTransferNumber = async (client, companyId) => {
    const row = await client.query(
      `SELECT COALESCE(MAX(NULLIF(SUBSTRING(transfer_number FROM '[0-9]+$'), '')::int), 0) + 1 AS next_number
       FROM stock_transfers WHERE company_id = $1 AND transfer_number IS NOT NULL`,
      [companyId]
    );
    const candidate = Number(row.rows[0].next_number) || 1;
    /* Defensive loop: transfer_number is UNIQUE (mirrors the RET- pattern). */
    for (let i = 0; i < 20; i += 1) {
      const attempt = `TRF-${String(candidate + i).padStart(4, "0")}`;
      const clash = await client.query("SELECT 1 FROM stock_transfers WHERE transfer_number = $1 LIMIT 1", [attempt]);
      if (!clash.rows.length) return attempt;
    }
    throw new Error("Unable to allocate a transfer number");
  };

  router.post(
    "/inventory/transfers",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { fromStoreId, toStoreId, notes = null, items } = req.body || {};

      if (!fromStoreId || !toStoreId) {
        return res.status(400).json({ success: false, message: "Source and destination stores are required" });
      }
      if (String(fromStoreId) === String(toStoreId)) {
        return res.status(400).json({ success: false, message: "Source and destination stores must be different" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: "At least one product line is required" });
      }

      /* Normalise + validate lines up-front (multi-product capable). */
      const lines = [];
      const seenProducts = new Set();
      for (const item of items) {
        const productId = String(item?.productId || "");
        const quantity = Number(item?.quantity);
        if (!productId) {
          return res.status(400).json({ success: false, message: "Every line needs a product" });
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return res.status(400).json({ success: false, message: "Transfer quantities must be greater than zero" });
        }
        if (seenProducts.has(productId)) {
          return res.status(400).json({ success: false, message: "Duplicate product lines are not allowed" });
        }
        seenProducts.add(productId);
        lines.push({ productId, quantity });
      }

      /* Company isolation first: both stores must belong to the caller's
       * company (canAccessStore's admin bypass is role-based, not
       * company-based — this closes that gap explicitly). */
      const companyStores = await db(
        "SELECT id FROM stores WHERE company_id = $1 AND (id = $2 OR id = $3)",
        [req.user.companyId, fromStoreId, toStoreId]
      );
      if (companyStores.rows.length < 2) {
        return res
          .status(403)
          .json({ success: false, message: "Both locations must belong to your company" });
      }

      /* Both stores must be within the operator's existing access. */
      try {
        await resolveStockStore({ user: req.user, requestedStoreId: fromStoreId, canAccessStore });
        await resolveStockStore({ user: req.user, requestedStoreId: toStoreId, canAccessStore });
      } catch (scopeError) {
        return res
          .status(scopeError.statusCode || 403)
          .json({ success: false, message: scopeError.message });
      }

      if (!pool) {
        return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
      }

      const client = await pool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;

        const transferNumber = await nextTransferNumber(client, req.user.companyId);
        const header = await client.query(
          `INSERT INTO stock_transfers (company_id, transfer_number, from_store_id, to_store_id, status, notes, created_by)
           VALUES ($1, $2, $3, $4, 'COMPLETED', $5, $6)
           RETURNING id, transfer_number, created_at`,
          [req.user.companyId, transferNumber, fromStoreId, toStoreId, notes || null, req.user.id]
        );
        const transferId = header.rows[0].id;

        const executedLines = [];
        for (const line of lines) {
          await client.query(
            "INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, $3)",
            [transferId, line.productId, line.quantity]
          );
          const btCheck = await client.query(
            "SELECT batch_tracking FROM products WHERE id = $1 AND company_id = $2",
            [line.productId, req.user.companyId]
          );
          const batchTracked = btCheck.rows[0] ? btCheck.rows[0].batch_tracking : false;
          /* Source side: guarded like every non-SALE movement. */
          const out = await createInventoryMovement(client, {
            companyId: req.user.companyId,
            productId: line.productId,
            storeId: fromStoreId,
            movementType: "TRANSFER_OUT",
            quantityChange: -line.quantity,
            referenceType: "STOCK_TRANSFER",
            referenceId: transferId,
            reason: notes || null,
            createdBy: req.user.id,
          });
          /* Batch bookkeeping (source): debit this store's batch rows FEFO
           * in step with the TRANSFER_OUT movement — the movement is the
           * authoritative stock change; this keeps the batch rows
           * consistent inside the same transaction. */
          let sourceBatchAllocation = null;
          if (batchTracked) {
            sourceBatchAllocation = await allocateBatchConsumption(client, {
              companyId: req.user.companyId,
              storeId: fromStoreId,
              productId: line.productId,
              quantity: line.quantity,
              mode: "fefo",
            });
          }
          /* Destination side. If THIS fails, the whole transaction (including
           * the source deduction) rolls back — atomicity. */
          const inn = await createInventoryMovement(client, {
            companyId: req.user.companyId,
            productId: line.productId,
            storeId: toStoreId,
            movementType: "TRANSFER_IN",
            quantityChange: line.quantity,
            referenceType: "STOCK_TRANSFER",
            referenceId: transferId,
            reason: notes || null,
            createdBy: req.user.id,
          });
          /* Batch bookkeeping (destination): goods arrive with their batch
           * numbers — mirror the source allocation into the destination
           * store's batch rows (accumulating into an existing batch of the
           * same number is correct). Source stock that was never batched
           * lands in a per-transfer row so nothing is silently untracked. */
          if (batchTracked) {
            const inbound = ((sourceBatchAllocation && sourceBatchAllocation.consumed) || []).filter(
              (c) => c.batchNumber && !c.unbatched
            );
            if (inbound.length) {
              for (const c of inbound) {
                await upsertBatchRow(client, {
                  companyId: req.user.companyId,
                  storeId: toStoreId,
                  productId: line.productId,
                  batchNumber: c.batchNumber,
                  expiryDate: c.expiryDate || null,
                  quantity: c.quantity,
                });
              }
            } else {
              await upsertBatchRow(client, {
                companyId: req.user.companyId,
                storeId: toStoreId,
                productId: line.productId,
                batchNumber: `TRANSFER-${transferId.slice(0, 8).toUpperCase()}`,
                expiryDate: null,
                quantity: line.quantity,
              });
            }
          }
          executedLines.push({
            productId: line.productId,
            productName: out.product.name,
            quantity: line.quantity,
            sourceBalanceAfter: out.storeBalance,
            destinationBalanceAfter: inn.storeBalance,
          });
        }

        await client.query("COMMIT");
        res.status(201).json({
          success: true,
          message: "Stock transfer completed",
          data: {
            id: transferId,
            transferNumber: header.rows[0].transfer_number,
            fromStoreId,
            toStoreId,
            status: "COMPLETED",
            notes: notes || null,
            createdAt: header.rows[0].created_at,
            items: executedLines,
          },
        });
      } catch (error) {
        if (transactionStarted) {
          await client.query("ROLLBACK");
        }
        console.error("Stock transfer error:", error);
        const status = error.message === "Product not found" ? 404 : /Insufficient stock/.test(error.message || "") ? 400 : 400;
        res.status(status).json({ success: false, message: error.message || "Unable to complete stock transfer" });
      } finally {
        client.release();
      }
    }
  );

  /*
   * GET /api/inventory/transfers — history. Non-admins see transfers that
   * involve at least one of their assigned stores; admins see the company's.
   */
  router.get(
    "/inventory/transfers",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const storeFilter = await accessibleStoreIds(req.user);
        const result = await db(
          `
          SELECT t.id, t.transfer_number, t.from_store_id, t.to_store_id,
                 fs.name AS from_store_name, ts.name AS to_store_name,
                 t.status, t.notes, u.username AS created_by_name, t.created_at,
                 COUNT(ti.id)::int AS item_count,
                 COALESCE(SUM(ti.quantity), 0) AS total_quantity
          FROM stock_transfers t
          INNER JOIN stores fs ON fs.id = t.from_store_id
          INNER JOIN stores ts ON ts.id = t.to_store_id
          LEFT JOIN users u ON u.id = t.created_by
          LEFT JOIN stock_transfer_items ti ON ti.transfer_id = t.id
          WHERE t.company_id = $1
            AND ($2::uuid[] IS NULL OR t.from_store_id = ANY($2::uuid[]) OR t.to_store_id = ANY($2::uuid[]))
          GROUP BY t.id, fs.name, ts.name, u.username
          ORDER BY t.created_at DESC
          LIMIT 100
          `,
          [req.user.companyId, storeFilter]
        );
        res.json({
          success: true,
          data: result.rows.map((r) => ({
            ...r,
            total_quantity: Number(r.total_quantity) || 0,
          })),
        });
      } catch (error) {
        console.error("Load stock transfers error:", error);
        res.status(500).json({ success: false, message: "Unable to load stock transfers" });
      }
    }
  );

  /*
   * GET /api/inventory/transfer-stores — the stores THIS user may transfer
   * between (admin/owner: all active company stores; others: their assigned
   * stores). Keeps the picker inside the existing access model without
   * granting store.view.
   */
  router.get(
    "/inventory/transfer-stores",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const storeFilter = await accessibleStoreIds(req.user);
        const result = await db(
          `
          SELECT s.id, s.name, s.code
          FROM stores s
          WHERE s.company_id = $1 AND s.active = true
            AND ($2::uuid[] IS NULL OR s.id = ANY($2::uuid[]))
          ORDER BY s.name
          `,
          [req.user.companyId, storeFilter]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load transfer stores error:", error);
        res.status(500).json({ success: false, message: "Unable to load stores" });
      }
    }
  );

  /*
   * GET /api/inventory/transfers/:id — detail: header + lines + the
   * TRANSFER_OUT/TRANSFER_IN movements (the audit trail).
   */
  router.get(
    "/inventory/transfers/:id",
    authenticate,
    authorize("inventory.view", "product.view"),
    async (req, res) => {
      try {
        const storeFilter = await accessibleStoreIds(req.user);
        const header = await db(
          `
          SELECT t.id, t.transfer_number, t.from_store_id, t.to_store_id,
                 fs.name AS from_store_name, ts.name AS to_store_name,
                 t.status, t.notes, u.username AS created_by_name, t.created_at
          FROM stock_transfers t
          INNER JOIN stores fs ON fs.id = t.from_store_id
          INNER JOIN stores ts ON ts.id = t.to_store_id
          LEFT JOIN users u ON u.id = t.created_by
          WHERE t.id = $2 AND t.company_id = $1
            AND ($3::uuid[] IS NULL OR t.from_store_id = ANY($3::uuid[]) OR t.to_store_id = ANY($3::uuid[]))
          `,
          [req.user.companyId, req.params.id, storeFilter]
        );
        if (!header.rows.length) {
          return res.status(404).json({ success: false, message: "Stock transfer not found" });
        }
        const items = await db(
          `
          SELECT ti.product_id, p.name AS product_name, p.sku, ti.quantity
          FROM stock_transfer_items ti
          INNER JOIN products p ON p.id = ti.product_id
          WHERE ti.transfer_id = $1
          ORDER BY ti.id
          `,
          [req.params.id]
        );
        const movements = await db(
          `
          SELECT m.movement_type, m.store_id, s.name AS store_name,
                 m.quantity_change, m.balance_after, m.created_at, u.username
          FROM inventory_movements m
          LEFT JOIN stores s ON s.id = m.store_id
          LEFT JOIN users u ON u.id = m.created_by
          WHERE m.reference_type = 'STOCK_TRANSFER' AND m.reference_id = $1
          ORDER BY m.created_at, m.id
          `,
          [req.params.id]
        );
        res.json({
          success: true,
          data: {
            transfer: header.rows[0],
            items: items.rows.map((r) => ({ ...r, quantity: Number(r.quantity) })),
            movements: movements.rows.map((r) => ({ ...r, quantity_change: Number(r.quantity_change), balance_after: Number(r.balance_after) })),
          },
        });
      } catch (error) {
        console.error("Load stock transfer detail error:", error);
        res.status(500).json({ success: false, message: "Unable to load stock transfer" });
      }
    }
  );

  return router;
}
