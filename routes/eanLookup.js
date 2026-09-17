import express from "express";

export default function createEanLookupRouter({ authenticate, db }) {
  const router = express.Router();

  // Shared reference lookup only: never reads or writes customer products.
  router.get("/ean-lookup/:ean", authenticate, async (req, res) => {
    const ean = String(req.params.ean || "").trim();
    if (!/^([0-9]{8}|[0-9]{12,14})$/.test(ean)) {
      return res.status(400).json({
        success: false,
        message: "EAN must contain 8, 12, 13 or 14 digits",
      });
    }

    try {
      const result = await db(
        `SELECT id, ean, product_name, brand, category, subcategory,
                unit_description, created_at, updated_at
         FROM ean_product_master
         WHERE ean = $1`,
        [ean]
      );

      // Record valid attempts using the existing authenticated session context.
      await db(
        `INSERT INTO ean_lookup_usage (user_id, company_id, store_id, ean, lookup_result)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.user.id, req.user.companyId, req.user.storeId || null, ean,
          result.rows.length ? "FOUND" : "NOT_FOUND"]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          data: null,
          message: "EAN not found in product master",
        });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("EAN lookup error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to look up EAN",
      });
    }
  });

  return router;
}
