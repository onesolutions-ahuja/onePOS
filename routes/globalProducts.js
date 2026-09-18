import express from "express";

export default function createGlobalProductsRouter({ authenticate, authorize, db }) {
  const router = express.Router();

  /*
   * GET /api/global-products
   *
   * Reads the shared, reference-only ean_product_master table (the EXISTING
   * global catalogue populated via services/globalProductMasterImport.js).
   *
   * Query parameters (all optional, combined with AND):
   *   search   – substring match on product_name (case-insensitive)
   *   ean      – exact or leading-prefix match on ean
   *   brand    – substring match on brand (case-insensitive)
   *   category – substring match on category (case-insensitive)
   *   page     – 1-based page number, default 1
   *   limit    – rows per page, default 50, max 200
   *
   * Each row also carries an "existsInMaster" boolean computed from the
   * CURRENT COMPANY'S products.barcode, scoped strictly to req.user.companyId.
   *
   * Authenticated only. Requires product.view so only staff that can browse
   * the Product Master see the global catalogue too.
   */
  router.get(
    "/global-products",
    authenticate,
    authorize("product.view"),
    async (req, res) => {
      try {
        const search = String(req.query.search || "").trim();
        const ean = String(req.query.ean || "").trim();
        const brand = String(req.query.brand || "").trim();
        const category = String(req.query.category || "").trim();

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const rawLimit = parseInt(req.query.limit, 10) || 50;
        const limit = Math.min(200, Math.max(1, rawLimit));
        const offset = (page - 1) * limit;

        const conditions = [];
        const params = [];

        if (search) {
          params.push(`%${search}%`);
          conditions.push(`LOWER(gpm.product_name) LIKE LOWER($${params.length})`);
        }
        if (ean) {
          params.push(`${ean}%`);
          conditions.push(`gpm.ean LIKE $${params.length}`);
        }
        if (brand) {
          params.push(`%${brand}%`);
          conditions.push(`LOWER(gpm.brand) LIKE LOWER($${params.length})`);
        }
        if (category) {
          params.push(`%${category}%`);
          conditions.push(`LOWER(gpm.category) LIKE LOWER($${params.length})`);
        }

        const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

        const countSql = `
          SELECT COUNT(*)::int AS total
          FROM ean_product_master gpm
          ${whereSql}
        `;

        const listSql = `
          SELECT
            gpm.id,
            gpm.ean,
            gpm.product_name AS name,
            gpm.brand,
            gpm.category,
            gpm.subcategory,
            gpm.unit_description,
            gpm.image_url,
            gpm.source,
            EXISTS (
              SELECT 1
              FROM products p
              WHERE p.company_id = $${params.length + 1}
                AND p.active = true
                AND (
                  p.barcode = gpm.ean
                  OR lpad(p.barcode, 14, '0') = lpad(gpm.ean, 14, '0')
                )
            ) AS "existsInMaster"
          FROM ean_product_master gpm
          ${whereSql}
          ORDER BY
            gpm.brand NULLS LAST,
            gpm.product_name
          LIMIT $${params.length + 2} OFFSET $${params.length + 3}
        `;

        const queryParams = [...params, req.user.companyId, limit, offset];

        const [countRes, listRes] = await Promise.all([
          db(countSql, params),
          db(listSql, queryParams),
        ]);

        const total = Number(countRes.rows[0]?.total || 0);

        res.json({
          success: true,
          data: listRes.rows.map((row) => ({
            ...row,
            existsInMaster: row.existsInMaster === true,
          })),
          meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        });
      } catch (error) {
        console.error("Global products error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to load global products",
        });
      }
    }
  );

  /*
   * GET /api/global-products/brands
   *
   * Distinct brand list with product counts from the global catalogue for
   * the Brand filter dropdown. No company scoping – the catalogue is shared.
   */
  router.get(
    "/global-products/brands",
    authenticate,
    authorize("product.view"),
    async (req, res) => {
      try {
        const result = await db(`
          SELECT
            brand AS name,
            COUNT(*)::int AS product_count
          FROM ean_product_master
          WHERE brand IS NOT NULL AND brand <> ''
          GROUP BY brand
          ORDER BY brand
        `);
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Global brands error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to load global brands",
        });
      }
    }
  );

  /*
   * GET /api/global-products/categories
   *
   * Distinct category list from the global catalogue.
   */
  router.get(
    "/global-products/categories",
    authenticate,
    authorize("product.view"),
    async (req, res) => {
      try {
        const result = await db(`
          SELECT
            category AS name,
            COUNT(*)::int AS product_count
          FROM ean_product_master
          WHERE category IS NOT NULL AND category <> ''
          GROUP BY category
          ORDER BY category
        `);
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Global categories error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to load global categories",
        });
      }
    }
  );

  return router;
}
