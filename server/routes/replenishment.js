import express from "express";
import { replenishmentRow } from "../services/replenishment.js";

export default function createReplenishmentRouter({ authenticate, authorize, db }) {
  const router = express.Router();

  /*
   * GET /api/inventory/replenishment
   *
   * T10H — read-only automatic replenishment suggestions.
   *
   * Reads the SAME products.stock_quantity / low_stock_level /
   * track_stock columns as the existing low-stock endpoint; rows carry a
   * transparent suggestion: suggested = (2 x threshold) - stock. No
   * inventory movements, purchases, adjustments or any other writes are
   * made here — this is a planning/suggestion layer only.
   *
   * Company isolation: WHERE p.company_id = req.user.companyId, matching
   * the existing product/inventory routes. The products table has no
   * store_id column, so no store claim is applied (identical scoping to
   * GET /api/products and GET /api/inventory/low-stock).
   *
   * Optional query params (all AND-combined):
   *   search   – substring match on name / sku / barcode
   *   status   – low | out (filter by low-stock status)
   *   category – category id (exact) or substring match on category name
   */
  router.get(
    "/inventory/replenishment",
    authenticate,
    authorize("inventory.replenishment.view", "inventory.view", "reports.low_stock.view"),
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
            c.name AS category_name,
            preferred_supplier.supplier_id,
            preferred_supplier.supplier_name,
            preferred_supplier.supplier_sku,
            preferred_supplier.cost_price AS supplier_cost
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          LEFT JOIN LATERAL (
            SELECT sp.supplier_id, s.name AS supplier_name, sp.supplier_sku, sp.cost_price
              FROM supplier_products sp
              INNER JOIN suppliers s ON s.id = sp.supplier_id
             WHERE sp.company_id = p.company_id
               AND sp.product_id = p.id
               AND sp.active = true
               AND s.active = true
             ORDER BY sp.preferred DESC, sp.effective_from DESC, sp.cost_price ASC
             LIMIT 1
          ) preferred_supplier ON true
          WHERE p.company_id = $1
            AND p.active = true
          `,
          [req.user.companyId]
        );

        const search = String(req.query.search || "").trim().toLowerCase();
        const status = String(req.query.status || "").trim().toLowerCase();
        const category = String(req.query.category || "").trim().toLowerCase();
        const brand = String(req.query.brand || "").trim().toLowerCase();

        let rows = (result.rows || []).map((row) => replenishmentRow({
          ...row,
          category: row.category_name,
        }));

        if (brand) {
          // Product Master has no brand column in v1: a brand filter cannot
          // match anything, so return an empty list rather than invent data.
          rows = [];
        }

        if (search) {
          rows = rows.filter((row) =>
            [row.name, row.sku, row.barcode].some((value) =>
              String(value || "").toLowerCase().includes(search)
            )
          );
        }

        if (category) {
          rows = rows.filter(
            (row) =>
              String(row.categoryId || "").toLowerCase() === category ||
              String(row.category || "").toLowerCase().includes(category)
          );
        }

        // Only products meeting the existing low-stock condition appear;
        // normal-stock products never appear on this list.
        rows = rows.filter((row) => row.status === "Low stock" || row.status === "Out of stock");

        if (status === "low") {
          rows = rows.filter((row) => row.status === "Low stock");
        } else if (status === "out") {
          rows = rows.filter((row) => row.status === "Out of stock");
        }

        res.json({ success: true, data: rows });
      } catch (error) {
        console.error("Load replenishment suggestions error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to load replenishment suggestions",
        });
      }
    }
  );

  return router;
}
