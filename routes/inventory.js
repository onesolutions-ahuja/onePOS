import express from "express";
import { lowStockRow } from "../services/inventory.js";

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
   */
  router.get(
    "/inventory/movements",
    authenticate,
    authorize("inventory.movements.view", "inventory.view"),
    async (req, res) => {
      try {
        const params = [req.user.companyId];
        const filters = ["m.company_id = $1"];

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
            m.created_at
          FROM inventory_movements m
          INNER JOIN products p ON p.id = m.product_id
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
          data: result.rows,
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
          reason,
          notes,
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

