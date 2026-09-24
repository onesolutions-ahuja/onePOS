import express from "express";
import { normaliseVariantAttributes, validateBundleComponents } from "../services/productFeatures.js";

export default function createProductFeaturesRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();
  const productScope = (id, companyId) => db(
    "SELECT id, name, price, vat_rate, vat_applicable, track_stock, active FROM products WHERE id=$1 AND company_id=$2 AND active=true",
    [id, companyId]
  );

  router.get("/products/:id/variants", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT id, parent_product_id, name, sku, barcode, price, vat_rate, vat_applicable,
                stock_quantity, track_stock, variant_attributes
           FROM products
          WHERE company_id=$1 AND (id=$2 OR parent_product_id=$2) AND active=true
          ORDER BY id`,
        [req.user.companyId, req.params.id]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load product variants error:", error);
      res.status(500).json({ success: false, message: "Unable to load product variants" });
    }
  });

  router.post("/products/:id/variants", authenticate, authorize("product.edit"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const parent = await productScope(req.params.id, req.user.companyId);
    if (!parent.rows.length) return res.status(404).json({ success: false, message: "Parent product not found" });
    const attributes = normaliseVariantAttributes(req.body?.attributes);
    if (!Object.keys(attributes).length) return res.status(400).json({ success: false, message: "Variant attributes are required" });
    const name = String(req.body?.name || `${parent.rows[0].name} (${Object.values(attributes).join(" / ")})`).trim();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const duplicate = await client.query(
        "SELECT id FROM products WHERE company_id=$1 AND parent_product_id=$2 AND variant_attributes=$3::jsonb AND active=true",
        [req.user.companyId, req.params.id, JSON.stringify(attributes)]
      );
      if (duplicate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Variant already exists" });
      }
      if (req.body?.sku) {
        const sku = await client.query(
          "SELECT id FROM products WHERE company_id=$1 AND LOWER(sku)=LOWER($2) AND active=true LIMIT 1",
          [req.user.companyId, String(req.body.sku).trim()]
        );
        if (sku.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, message: "A product with this SKU already exists" });
        }
      }
      if (req.body?.barcode) {
        const barcode = await client.query(
          "SELECT id FROM products WHERE company_id=$1 AND barcode=$2 AND active=true LIMIT 1",
          [req.user.companyId, String(req.body.barcode).trim()]
        );
        if (barcode.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ success: false, message: "A product with this barcode already exists" });
        }
      }
      const created = await client.query(
        `INSERT INTO products
          (company_id, category_id, parent_product_id, product_kind, variant_attributes,
           name, sku, barcode, price, cost_price, vat_rate, vat_applicable,
           track_stock, active)
         SELECT company_id, category_id, id, 'variant', $3::jsonb, $4, $5, $6,
                COALESCE($7, price), cost_price, vat_rate, vat_applicable,
                COALESCE($8, track_stock), true
           FROM products
          WHERE id=$2 AND company_id=$1
         RETURNING *`,
        [req.user.companyId, req.params.id, JSON.stringify(attributes), name,
          req.body?.sku || null, req.body?.barcode || null,
          req.body?.price == null ? null : Number(req.body.price),
          req.body?.trackStock == null ? null : req.body.trackStock === true]
      );
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: created.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Create product variant error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to create variant" });
    } finally {
      client.release();
    }
  });

  router.get("/products/:id/modifiers", authenticate, authorize("product.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT g.id AS group_id, g.name AS group_name, g.required, g.max_selections,
                o.id, o.name, o.price, o.track_stock, o.inventory_product_id
           FROM product_modifier_groups g
           LEFT JOIN product_modifier_options o ON o.group_id=g.id
          WHERE g.company_id=$1 AND g.product_id=$2 AND g.active=true
          ORDER BY g.display_order, o.display_order, o.name`,
        [req.user.companyId, req.params.id]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load product modifiers error:", error);
      res.status(500).json({ success: false, message: "Unable to load product modifiers" });
    }
  });

  router.post("/products/:id/modifiers", authenticate, authorize("product.edit"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const parent = await productScope(req.params.id, req.user.companyId);
    if (!parent.rows.length) return res.status(404).json({ success: false, message: "Product not found" });
    const name = String(req.body?.name || "").trim();
    const options = Array.isArray(req.body?.options) ? req.body.options : [];
    if (!name || !options.length) return res.status(400).json({ success: false, message: "Modifier name and options are required" });
    if (options.some((option) =>
      !String(option?.name || "").trim() ||
      !Number.isFinite(Number(option.price)) ||
      Number(option.price) < 0 ||
      (option.trackStock === true && !option.inventoryProductId)
    )) {
      return res.status(400).json({ success: false, message: "Modifier options require a name and non-negative price" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const group = await client.query(
        `INSERT INTO product_modifier_groups
          (company_id, product_id, name, required, max_selections, display_order)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [req.user.companyId, req.params.id, name, req.body.required === true,
          Math.max(1, Number(req.body.maxSelections) || 1), Number(req.body.displayOrder) || 0]
      );
      for (const [index, option] of options.entries()) {
        await client.query(
          `INSERT INTO product_modifier_options
            (group_id, name, price, track_stock, inventory_product_id, display_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [group.rows[0].id, String(option.name).trim(), Number(option.price),
            option.trackStock === true, option.inventoryProductId || null, index]
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: { id: group.rows[0].id, name, options } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Create product modifiers error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to create modifiers" });
    } finally {
      client.release();
    }
  });

  router.post("/products/:id/bundle-components", authenticate, authorize("product.edit"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const validation = validateBundleComponents(req.params.id, req.body?.components);
    if (!validation.valid) return res.status(400).json({ success: false, message: validation.errors[0], errors: validation.errors });
    const bundle = await productScope(req.params.id, req.user.companyId);
    if (!bundle.rows.length) return res.status(404).json({ success: false, message: "Bundle product not found" });
    const ids = req.body.components.map((component) => component.productId);
    const referenced = await db(
      "SELECT id FROM products WHERE company_id=$1 AND id=ANY($2::uuid[]) AND active=true",
      [req.user.companyId, ids]
    );
    if (referenced.rows.length !== new Set(ids.map(String)).size) {
      return res.status(400).json({ success: false, message: "Every bundle component must belong to this company" });
    }
    const cycle = await db(
      `WITH RECURSIVE descendants(id) AS (
         SELECT component_product_id FROM product_bundle_components WHERE bundle_product_id = ANY($1::uuid[])
         UNION
         SELECT c.component_product_id
           FROM product_bundle_components c
           INNER JOIN descendants d ON d.id = c.bundle_product_id
       )
       SELECT 1 FROM descendants WHERE id=$2 LIMIT 1`,
      [ids, req.params.id]
    );
    if (cycle.rows.length) return res.status(400).json({ success: false, message: "Circular bundle definitions are not allowed" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE products SET product_kind='bundle' WHERE id=$1 AND company_id=$2", [req.params.id, req.user.companyId]);
      await client.query("DELETE FROM product_bundle_components WHERE bundle_product_id=$1", [req.params.id]);
      for (const component of req.body.components) {
        await client.query(
          "INSERT INTO product_bundle_components (bundle_product_id, component_product_id, quantity) VALUES ($1,$2,$3)",
          [req.params.id, component.productId, Number(component.quantity)]
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: req.body.components });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Save bundle components error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to save bundle components" });
    } finally {
      client.release();
    }
  });

  return router;
}
