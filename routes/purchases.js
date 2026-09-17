import express from "express";
import { dispatchIntegrationEvent } from "../services/integrationDispatcher.js";

export default function createPurchasesRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
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
      };
    });
  }

  async function insertPurchaseLines(client, purchaseId, items) {
    for (const item of items) {
      await client.query(
        `
        INSERT INTO purchase_items (
          purchase_id, product_id, quantity, unit_cost, line_total
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          purchaseId,
          item.productId,
          item.quantity,
          item.unitCost,
          item.lineTotal,
        ]
      );
    }
  }

  async function receivePurchase(client, purchaseId, companyId, userId, storeId) {
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
    SELECT product_id, quantity
    FROM purchase_items
    WHERE purchase_id = $1
    ORDER BY id
    `,
      [purchaseId]
    );

    if (!lines.rows.length) {
      throw new Error("Purchase has no product lines");
    }

    for (const line of lines.rows) {
      await createInventoryMovement(client, {
        companyId,
        productId: line.product_id,
        storeId: purchase.store_id || storeId,
        movementType: "PURCHASE",
        quantityChange: Number(line.quantity),
        referenceType: "PURCHASE",
        referenceId: purchaseId,
        createdBy: userId,
      });
    }

    /*
     * Final status check and update must be atomic: the WHERE clause is
     * re-evaluated at UPDATE time inside this transaction, so a concurrent
     * receive (or the receiveNow path) can never push stock twice. If the
     * row was already received after our FOR UPDATE snapshot read, zero
     * rows update and we reject with ALREADY_RECEIVED.
     */
    const receiveUpdate = await client.query(
      `
    UPDATE purchases
    SET status = 'RECEIVED', received_by = $1, received_at = NOW(), updated_at = NOW()
    WHERE id = $2 AND company_id = $3 AND status = 'DRAFT'
    `,
      [userId, purchaseId, companyId]
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
    authorize("inventory.view"),
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
    authorize("inventory.view"),
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
          SELECT pi.*, p.name AS product_name, p.sku, p.barcode
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

        res.json({
          success: true,
          data: { ...purchase.rows[0], items: items.rows, movements: movements.rows },
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
    authorize("inventory.adjust"),
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
        await insertPurchaseLines(client, purchaseId, purchaseItems);

        if (receiveNow) {
          await receivePurchase(
            client,
            purchaseId,
            req.user.companyId,
            req.user.id,
            req.user.storeId
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
    authorize("inventory.adjust"),
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
          req.user.storeId
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
