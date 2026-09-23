import express from "express";
import { upsertBatchRow } from "../services/inventory.js";
import { dispatchIntegrationEvent } from "../services/integrationDispatcher.js";
import { planReceipt } from "../services/purchasing.js";
import { resolveBatchEntry, normaliseBatchPolicy } from "../services/batchPolicy.js";

export default function createPurchasesRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  savePlatformRecord = null,
}) {
  const router = express.Router();

  function validatePurchaseItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("At least one purchase product is required");
    }

    return items.map((item) => {
      const quantity = Number(item.quantity);
      const unitCost = Number(item.unitCost);

      if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Each purchase line needs a valid product and quantity");
      }

      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Each purchase line needs a valid unit cost");
      }

      return {
        productId: item.productId,
        quantity,
        unitCost,
        lineTotal: quantity * unitCost,
        batchNumber: item.batchNumber || null,
        manufacturingDate: item.manufacturingDate || null,
        expiryDate: item.expiryDate || null,
      };
    });
  }

  async function insertPurchaseLines(client, purchaseId, items) {
    for (const item of items) {
      await client.query(
        `
        INSERT INTO purchase_items (
          purchase_id, product_id, quantity, unit_cost, line_total,
          batch_number, manufacturing_date, expiry_date
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `,
        [
          purchaseId,
          item.productId,
          item.quantity,
          item.unitCost,
          item.lineTotal,
          item.batchNumber ? String(item.batchNumber).trim().slice(0, 100) : null,
          item.manufacturingDate && /^\d{4}-\d{2}-\d{2}$/.test(String(item.manufacturingDate)) ? String(item.manufacturingDate) : null,
          item.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(String(item.expiryDate)) ? String(item.expiryDate) : null,
        ]
      );
    }
  }

  async function receivePurchase(client, purchaseId, companyId, userId, storeId, requestedItems = null, receiptMeta = {}) {
    const purchaseResult = await client.query(
      `
    SELECT id, store_id, status
    FROM purchases
    WHERE id = $1 AND company_id = $2
    FOR UPDATE
    `,
      [purchaseId, companyId]
    );

    if (!purchaseResult.rows.length) {
      throw new Error("Purchase not found");
    }

    const purchase = purchaseResult.rows[0];

    if (purchase.status === "RECEIVED") {
      const duplicateError = new Error("Purchase has already been received");
      duplicateError.code = "ALREADY_RECEIVED";
      throw duplicateError;
    }

    if (purchase.status === "CANCELLED") {
      throw new Error("Cancelled purchases cannot be received");
    }

    const lines = await client.query(
      `
    SELECT pi.id AS purchase_item_id, pi.product_id, pi.quantity, pi.received_quantity, pi.unit_cost,
           p.batch_tracking,
           pi.batch_number, pi.manufacturing_date, pi.expiry_date
    FROM purchase_items pi
    INNER JOIN products p ON p.id = pi.product_id
    WHERE pi.purchase_id = $1
    ORDER BY pi.id
    `,
      [purchaseId]
    );

    if (!lines.rows.length) {
      throw new Error("Purchase has no product lines");
    }

    const receiptLines = [];
    const policyResult = await client.query(
      "SELECT batch_inventory_mode, batch_default_mfg_rule, batch_default_expiry_rule, batch_default_expiry_days FROM company_settings WHERE company_id=$1",
      [companyId]
    );
    const policy = normaliseBatchPolicy(policyResult.rows[0]);
    for (const line of planReceipt(lines.rows, requestedItems)) {
      const requested = line.quantity;
      const batch = resolveBatchEntry(policy, {
        productBatchTracking: line.batch_tracking,
        batchNumber: line.batch_number,
        manufacturingDate: line.manufacturing_date,
        expiryDate: line.expiry_date,
      });
      await createInventoryMovement(client, {
        companyId,
        productId: line.product_id,
        storeId: purchase.store_id || storeId,
        movementType: "PURCHASE",
        quantityChange: requested,
        referenceType: "PURCHASE",
        referenceId: purchaseId,
        createdBy: userId,
      });

      /*
       * Batch / expiry tracking: batch-tracked goods land in a batch row at
       * the receiving store (batch number/expiry come from the purchase line
       * where provided). Same transaction — a failed receive rolls both
       * back. Non-batch-tracked products are untouched.
       */
      if (line.batch_tracking) {
        await upsertBatchRow(client, {
          companyId,
          storeId: purchase.store_id || storeId,
          productId: line.product_id,
          batchNumber: batch.batchNumber,
          manufacturingDate: batch.manufacturingDate,
          manufacturingDateSource: batch.manufacturingDateSource,
          expiryDate: batch.expiryDate,
          expiryDateSource: batch.expiryDateSource,
          quantity: requested,
        });
      }
      receiptLines.push({ ...line, quantity: requested });
    }

    if (!receiptLines.length) throw new Error("No remaining quantity to receive");
    const receipt = await client.query(
      `INSERT INTO purchase_receipts
        (company_id, purchase_id, store_id, received_by, reference_number, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, received_at`,
      [companyId, purchaseId, purchase.store_id || storeId, userId, receiptMeta.referenceNumber || null, receiptMeta.notes || null]
    );
    for (const line of receiptLines) {
      await client.query(
        `INSERT INTO purchase_receipt_items
          (receipt_id, purchase_item_id, product_id, quantity, unit_cost, batch_number, manufacturing_date, expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [receipt.rows[0].id, line.purchase_item_id, line.product_id, line.quantity, line.unit_cost, line.batch_number || null, line.manufacturing_date || null, line.expiry_date || null]
      );
      await client.query(
        `UPDATE purchase_items SET received_quantity = received_quantity + $1
         WHERE id=$2 AND purchase_id=$3`,
        [line.quantity, line.purchase_item_id, purchaseId]
      );
    }
    const remaining = await client.query(
      `SELECT COUNT(*)::int AS open_lines
         FROM purchase_items
        WHERE purchase_id=$1 AND received_quantity < quantity`,
      [purchaseId]
    );
    const nextStatus = Number(remaining.rows[0].open_lines) === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED";
    const receiveUpdate = await client.query(
      `
    UPDATE purchases
    SET status = $1, received_by = $2, received_at = CASE WHEN $1 = 'RECEIVED' THEN NOW() ELSE received_at END, updated_at = NOW()
    WHERE id = $3 AND company_id = $4 AND status IN ('DRAFT','PARTIALLY_RECEIVED')
    `,
      [nextStatus, userId, purchaseId, companyId]
    );

    if (receiveUpdate.rowCount !== 1) {
      const duplicateError = new Error("Purchase has already been received");
      duplicateError.code = "ALREADY_RECEIVED";
      throw duplicateError;
    }
  }

  /*
   * GET /api/purchases
   */
  router.get(
    "/purchases",
    authenticate,
    authorize("purchase.view", "reports.purchases.view", "inventory.view"),
    async (req, res) => {
      try {
        const result = await db(
          `
          SELECT
            p.id,
            p.reference_number,
            p.supplier_id,
            p.supplier_name,
            p.store_id,
            s.name AS store_name,
            p.purchase_date,
            p.status,
            p.total,
            p.created_by,
            u.username AS created_by_username,
            p.created_at
          FROM purchases p
          LEFT JOIN stores s ON s.id = p.store_id
          LEFT JOIN users u ON u.id = p.created_by
          WHERE p.company_id = $1
          ORDER BY p.purchase_date DESC, p.created_at DESC
          `,
          [req.user.companyId]
        );

        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load purchases error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load purchases" });
      }
    }
  );

  /*
   * GET /api/purchases/:id
   */
  router.get(
    "/purchases/:id",
    authenticate,
    authorize("purchase.view", "inventory.view"),
    async (req, res) => {
      try {
        const purchase = await db(
          `
          SELECT p.*, s.name AS store_name, u.username AS created_by_username,
            r.username AS received_by_username
          FROM purchases p
          LEFT JOIN stores s ON s.id = p.store_id
          LEFT JOIN users u ON u.id = p.created_by
          LEFT JOIN users r ON r.id = p.received_by
          WHERE p.id = $1 AND p.company_id = $2
          `,
          [req.params.id, req.user.companyId]
        );

        if (!purchase.rows.length) {
          return res
            .status(404)
            .json({ success: false, message: "Purchase not found" });
        }

        const items = await db(
          `
          SELECT pi.*, p.name AS product_name, p.sku, p.barcode,
            (pi.quantity - pi.received_quantity) AS remaining_quantity
          FROM purchase_items pi
          INNER JOIN products p ON p.id = pi.product_id
          WHERE pi.purchase_id = $1
          ORDER BY pi.id
          `,
          [req.params.id]
        );

        const movements = await db(
          `
          SELECT id, product_id, movement_type, quantity_change, balance_after,
            reason, reference_type, reference_id, created_by, created_at
          FROM inventory_movements
          WHERE reference_type = 'PURCHASE' AND reference_id = $1
          ORDER BY created_at, id
          `,
          [req.params.id]
        );
        const receipts = await db(
          `SELECT pr.id, pr.received_at, pr.reference_number, pr.notes, u.username AS received_by_username
             FROM purchase_receipts pr LEFT JOIN users u ON u.id=pr.received_by
            WHERE pr.purchase_id=$1 AND pr.company_id=$2 ORDER BY pr.received_at`,
          [req.params.id, req.user.companyId]
        );

        res.json({
          success: true,
          data: { ...purchase.rows[0], items: items.rows, movements: movements.rows, receipts: receipts.rows },
        });
      } catch (error) {
        console.error("Get purchase error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load purchase" });
      }
    }
  );

  /*
   * POST /api/purchases
   */
  router.post(
    "/purchases",
    authenticate,
    authorize("purchase.create", "inventory.adjust"),
    async (req, res) => {
      if (!pool) {
        return res
          .status(500)
          .json({ success: false, message: "DATABASE_URL is not configured" });
      }

      const {
        supplierId = null,
        supplierName = null,
        storeId = null,
        referenceNumber = null,
        purchaseDate = null,
        notes = null,
        items,
        receiveNow = false,
        receiveItems = null,
        receivingReference = null,
        receivingNotes = null,
      } = req.body;

      let purchaseItems;
      try {
        purchaseItems = validatePurchaseItems(items);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }

      const total = purchaseItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        let resolvedSupplierId = supplierId;
        let trimmedSupplierName = supplierName && String(supplierName).trim()
          ? String(supplierName).trim()
          : null;

        if (resolvedSupplierId) {
          const existingSupplier = await client.query(
            `
          SELECT id, name
          FROM suppliers
          WHERE id = $1 AND company_id = $2 AND active = true
          `,
            [resolvedSupplierId, req.user.companyId]
          );

          if (!existingSupplier.rows.length) {
            throw new Error("Supplier not found or inactive");
          }

          resolvedSupplierId = existingSupplier.rows[0].id;
          trimmedSupplierName = existingSupplier.rows[0].name;
        } else if (trimmedSupplierName) {
          const existingSupplier = await client.query(
            `
          SELECT id
          FROM suppliers
          WHERE company_id = $1 AND LOWER(name) = LOWER($2)
          LIMIT 1
          `,
            [req.user.companyId, trimmedSupplierName]
          );

          if (existingSupplier.rows.length) {
            resolvedSupplierId = existingSupplier.rows[0].id;
          } else {
            const newSupplier = await client.query(
              `
          INSERT INTO suppliers (company_id, name)
          VALUES ($1, $2)
          RETURNING id
          `,
              [req.user.companyId, trimmedSupplierName]
            );
            resolvedSupplierId = newSupplier.rows[0].id;
          }
        }

        const purchaseResult = await client.query(
          `
          INSERT INTO purchases (
            company_id, store_id, supplier_id, supplier_name, reference_number, purchase_date,
            notes, status, subtotal, total, created_by
          )
          VALUES ($1,$2,$3,$4,$5,COALESCE($6::date, CURRENT_DATE),$7,$8,$9,$9,$10)
          RETURNING id
          `,
          [
            req.user.companyId,
            storeId || req.user.storeId,
            resolvedSupplierId,
            trimmedSupplierName,
            referenceNumber && String(referenceNumber).trim() ? String(referenceNumber).trim() : null,
            purchaseDate || null,
            notes && String(notes).trim() ? String(notes).trim() : null,
            "DRAFT",
            total,
            req.user.id,
          ]
        );

        const purchaseId = purchaseResult.rows[0].id;
        if (savePlatformRecord) {
          await savePlatformRecord({
            db: client.query.bind(client),
            key: "purchase",
            req,
            record: {
              id: purchaseId,
              company_id: req.user.companyId,
              store_id: storeId || req.user.storeId,
              supplier_id: resolvedSupplierId,
              supplier_name: trimmedSupplierName,
              reference_number: referenceNumber && String(referenceNumber).trim() ? String(referenceNumber).trim() : null,
              purchase_date: purchaseDate,
              notes: notes && String(notes).trim() ? String(notes).trim() : null,
              status: "DRAFT",
              total,
            },
          });
        }
        await insertPurchaseLines(client, purchaseId, purchaseItems);

        if (receiveNow) {
          await receivePurchase(
            client,
            purchaseId,
            req.user.companyId,
            req.user.id,
            req.user.storeId,
            receiveItems,
            { referenceNumber: receivingReference, notes: receivingNotes }
          );
        }

        await client.query("COMMIT");

        /*
         * T9G: fire-and-forget integration dispatch (never blocks/throws).
         * A create-and-receive fires both events, matching the lifecycle.
         */
        dispatchIntegrationEvent({
          event: "PURCHASE_CREATED",
          deps: { db },
          context: { companyId: req.user.companyId, storeId: storeId || req.user.storeId },
          entityId: purchaseId,
        }).catch(() => {});
        if (receiveNow) {
          dispatchIntegrationEvent({
            event: "PURCHASE_RECEIVED",
            deps: { db },
            context: { companyId: req.user.companyId, storeId: storeId || req.user.storeId },
            entityId: purchaseId,
          }).catch(() => {});
        }

        res
          .status(201)
          .json({
            success: true,
            message: receiveNow ? "Stock received" : "Purchase created",
            data: { id: purchaseId },
          });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Create purchase error:", error);
        res
          .status(error.code === "23505" ? 409 : 400)
          .json({
            success: false,
            message:
              error.code === "23505"
                ? "A purchase with this reference already exists"
                : error.message,
          });
      } finally {
        client.release();
      }
    }
  );

  /*
   * POST /api/purchases/:id/receive
   */
  router.post(
    "/purchases/:id/receive",
    authenticate,
    authorize("purchase.edit", "inventory.adjust"),
    async (req, res) => {
      if (!pool) {
        return res
          .status(500)
          .json({ success: false, message: "DATABASE_URL is not configured" });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await receivePurchase(
          client,
          req.params.id,
          req.user.companyId,
          req.user.id,
          req.user.storeId,
          Array.isArray(req.body.receiveItems) ? req.body.receiveItems : null,
          { referenceNumber: req.body.receivingReference, notes: req.body.receivingNotes }
        );
        await client.query("COMMIT");

        /* T9G: fire-and-forget integration dispatch (never blocks/throws). */
        dispatchIntegrationEvent({
          event: "PURCHASE_RECEIVED",
          deps: { db },
          context: { companyId: req.user.companyId, storeId: req.user.storeId },
          entityId: req.params.id,
        }).catch(() => {});

        res.json({
          success: true,
          message: "Stock received",
          data: { id: req.params.id },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        console.error("Receive purchase error:", error);
        res
          .status(
            error.code === "ALREADY_RECEIVED"
              ? 409
              : error.message === "Purchase not found"
                ? 404
                : 400
          )
          .json({ success: false, message: error.message });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
