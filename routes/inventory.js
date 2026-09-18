import express from "express";
import { lowStockRow } from "../services/inventory.js";
import { resolveAdjustmentReason } from "../services/adjustmentReasons.js";

export default function createInventoryRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  inventoryMovementTypes,
}) {
  const router = express.Router();

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

        const result = await createInventoryMovement(client, {
          companyId: req.user.companyId,
          productId,
          storeId: req.user.storeId,
          movementType: quantity > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantityChange: quantity,
          reason: storedReason,
          notes: storedNotes,
          createdBy: req.user.id,
        });

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
  return router;
}

