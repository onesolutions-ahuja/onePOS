import express from "express";

export default function createPricingRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();
  router.get("/pricing/quote/:productId", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const quantity = Math.max(1, Number(req.query.quantity) || 1);
      const result = await db(
        `SELECT p.price AS base_price, p.vat_rate, p.vat_applicable,
                spp.price AS scheduled_price, spp.starts_at, spp.ends_at
           FROM products p
           LEFT JOIN LATERAL (
             SELECT price, starts_at, ends_at FROM scheduled_product_prices
              WHERE product_id=p.id AND company_id=p.company_id AND active=true
                AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
              ORDER BY starts_at DESC LIMIT 1
           ) spp ON true
          WHERE p.id=$1 AND p.company_id=$2 AND p.active=true`,
        [req.params.productId, req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Product not found" });
      res.json({ success: true, data: { ...result.rows[0], quantity } });
    } catch (error) {
      console.error("Pricing quote error:", error);
      res.status(500).json({ success: false, message: "Unable to calculate price" });
    }
  });

  router.post("/price-lists", authenticate, authorize("product.edit"), async (req, res) => {
    try {
      const result = await db(
        `INSERT INTO price_lists (company_id, name, channel, active)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [req.user.companyId, String(req.body?.name || "").trim(), req.body?.channel || "retail", req.body?.active !== false]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Create price list error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to create price list" });
    }
  });

  router.post("/price-lists/:id/prices", authenticate, authorize("product.edit"), async (req, res) => {
    try {
      const result = await db(
        `INSERT INTO price_list_prices (price_list_id, product_id, price)
         SELECT $1, $2, $3 WHERE EXISTS
          (SELECT 1 FROM price_lists WHERE id=$1 AND company_id=$4)
         ON CONFLICT (price_list_id, product_id) DO UPDATE SET price=EXCLUDED.price
         RETURNING *`,
        [req.params.id, req.body?.productId, Number(req.body?.price), req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Price list or product not found" });
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Set price list price error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to set price" });
    }
  });

  router.post("/customer-groups", authenticate, authorize("customer.edit"), async (req, res) => {
    try {
      const result = await db(
        `INSERT INTO customer_groups (company_id, name) VALUES ($1,$2) RETURNING *`,
        [req.user.companyId, String(req.body?.name || "").trim()]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Create customer group error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to create customer group" });
    }
  });

  router.post("/scheduled-prices", authenticate, authorize("product.edit"), async (req, res) => {
    try {
      const result = await db(
        `INSERT INTO scheduled_product_prices
          (company_id, product_id, price, starts_at, ends_at, active)
         SELECT $1,$2,$3,$4,$5,$6
          WHERE EXISTS (SELECT 1 FROM products WHERE id=$2 AND company_id=$1)
         RETURNING *`,
        [req.user.companyId, req.body?.productId, Number(req.body?.price),
          req.body?.startsAt, req.body?.endsAt || null, req.body?.active !== false]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Product not found" });
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Create scheduled price error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to schedule price" });
    }
  });

  router.post("/promotions", authenticate, authorize("product.edit"), async (req, res) => {
    try {
      const result = await db(
        `INSERT INTO promotions
          (company_id, name, discount_type, discount_value, starts_at, ends_at, active,
           buy_quantity, get_quantity, offer_type, set_price, discount_percent, product_id, category_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [req.user.companyId, String(req.body?.name || "").trim(), req.body?.discountType || "percent",
          Number(req.body?.discountValue || 0), req.body?.startsAt || null, req.body?.endsAt || null,
          req.body?.active !== false, Number(req.body?.buyQuantity || 0) || null,
          Number(req.body?.getQuantity || 0) || null, req.body?.offerType || null,
          req.body?.setPrice == null ? null : Number(req.body.setPrice),
          req.body?.discountPercent == null ? null : Number(req.body.discountPercent),
          req.body?.productId || null, req.body?.categoryId || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Create promotion error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to create promotion" });
    }
  });

  return router;
}
