import { withDomainSave } from "../services/platformDomainRecords.js";
import express from "express";

export default function createSuppliersRouter({ authenticate, authorize, db, pool, savePlatformRecord = null }) {
  const router = express.Router();

  /*
   * GET /api/suppliers
   */
  router.get(
    "/suppliers",
    authenticate,
    authorize("inventory.view"),
    async (req, res) => {
      try {
        const result = await db(
          `
          SELECT
            s.id,
            s.name,
            s.contact_name,
            s.phone,
            s.email,
            s.address,
            s.notes,
            s.active,
            COUNT(p.id)::int AS purchase_count,
            COALESCE(SUM(p.total), 0) AS total_purchase_value,
            s.created_at,
            s.updated_at
          FROM suppliers s
          LEFT JOIN purchases p
            ON p.supplier_id = s.id AND p.company_id = s.company_id
          WHERE s.company_id = $1
          GROUP BY s.id
          ORDER BY s.name
          `,
          [req.user.companyId]
        );

        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load suppliers error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load suppliers" });
      }
    }
  );

  /*
   * GET /api/suppliers/:id
   */
  router.get(
    "/suppliers/:id",
    authenticate,
    authorize("inventory.view"),
    async (req, res) => {
      try {
        const supplier = await db(
          `
          SELECT
            s.id, s.name, s.contact_name, s.phone, s.email, s.address, s.notes, s.active,
            COUNT(p.id)::int AS purchase_count,
            COALESCE(SUM(p.total), 0) AS total_purchase_value,
            s.created_at, s.updated_at
          FROM suppliers s
          LEFT JOIN purchases p ON p.supplier_id = s.id AND p.company_id = s.company_id
          WHERE s.id = $1 AND s.company_id = $2
          GROUP BY s.id
          `,
          [req.params.id, req.user.companyId]
        );

        if (!supplier.rows.length) {
          return res
            .status(404)
            .json({ success: false, message: "Supplier not found" });
        }

        const purchases = await db(
          `
          SELECT p.id, p.reference_number, p.purchase_date, p.status,
            p.total, s.name AS store_name
          FROM purchases p
          LEFT JOIN stores s ON s.id = p.store_id
          WHERE p.supplier_id = $1 AND p.company_id = $2
          ORDER BY p.purchase_date DESC, p.created_at DESC
          `,
          [req.params.id, req.user.companyId]
        );
        const products = await db(
          `SELECT sp.id, sp.product_id, p.name AS product_name, p.sku, p.barcode,
             sp.supplier_sku, sp.supplier_description, sp.cost_price,
             sp.effective_from, sp.effective_to, sp.preferred, sp.active
             FROM supplier_products sp INNER JOIN products p ON p.id=sp.product_id
            WHERE sp.supplier_id=$1 AND sp.company_id=$2 ORDER BY p.name, sp.effective_from DESC`,
          [req.params.id, req.user.companyId]
        );

        res.json({
          success: true,
          data: { ...supplier.rows[0], purchases: purchases.rows, products: products.rows },
        });
      } catch (error) {
        console.error("Get supplier error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load supplier" });
      }
    }
  );

  router.post("/suppliers/:id/products", authenticate, authorize("inventory.adjust"), async (req, res) => {
    try {
      const cost = Number(req.body?.costPrice);
      if (!req.body?.productId || !Number.isFinite(cost) || cost < 0) {
        return res.status(400).json({ success: false, message: "Product and a valid non-negative cost are required" });
      }
      const result = await db(
        `INSERT INTO supplier_products
          (company_id, supplier_id, product_id, supplier_sku, supplier_description,
           cost_price, effective_from, effective_to, preferred, active)
         SELECT $1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE),$8,$9,$10
          WHERE EXISTS (SELECT 1 FROM suppliers WHERE id=$2 AND company_id=$1)
            AND EXISTS (SELECT 1 FROM products WHERE id=$3 AND company_id=$1)
         ON CONFLICT (company_id, supplier_id, product_id, effective_from)
         DO UPDATE SET supplier_sku=EXCLUDED.supplier_sku,
           supplier_description=EXCLUDED.supplier_description, cost_price=EXCLUDED.cost_price,
           effective_to=EXCLUDED.effective_to, preferred=EXCLUDED.preferred,
           active=EXCLUDED.active, updated_at=NOW()
         RETURNING *`,
        [req.user.companyId, req.params.id, req.body?.productId,
          req.body?.supplierSku || null, req.body?.supplierDescription || null,
          cost, req.body?.effectiveFrom || null,
          req.body?.effectiveTo || null, req.body?.preferred === true, req.body?.active !== false]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Supplier or product not found" });
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Set supplier product error:", error);
      res.status(400).json({ success: false, message: error.message || "Unable to save supplier product" });
    }
  });

  router.get("/products/:productId/suppliers", authenticate, authorize("inventory.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT sp.id, sp.supplier_id, s.name AS supplier_name, s.active AS supplier_active,
           sp.supplier_sku, sp.supplier_description, sp.cost_price,
           sp.effective_from, sp.effective_to, sp.preferred, sp.active
           FROM supplier_products sp
           INNER JOIN suppliers s ON s.id=sp.supplier_id AND s.company_id=sp.company_id
          WHERE sp.product_id=$1 AND sp.company_id=$2
          ORDER BY sp.preferred DESC, sp.active DESC, sp.cost_price ASC, s.name`,
        [req.params.productId, req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load product suppliers error:", error);
      res.status(500).json({ success: false, message: "Unable to load product suppliers" });
    }
  });

  /*
   * POST /api/suppliers
   */
  router.post(
    "/suppliers",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { name, phone = null, email = null, address = null, notes = null } =
        req.body;

      if (!name || !String(name).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Supplier name is required" });
      }

      try {
        const result = await withDomainSave({ pool, db, savePlatformRecord, key: "supplier", req, write: (db) => db(
          `
          INSERT INTO suppliers (company_id, name, phone, email, address, notes, contact_name)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING id, name, contact_name, phone, email, address, notes, active, created_at, updated_at
          `,
          [
            req.user.companyId,
            String(name).trim(),
            phone || null,
            email || null,
            address || null,
            notes || null,
            req.body.contactName == null ? null : String(req.body.contactName).trim() || null,
          ]
        ) });

        res
          .status(201)
          .json({ success: true, message: "Supplier created", data: result.rows[0] });
      } catch (error) {
        if (error.code === "PLATFORM_RECORD_INVALID") return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        console.error("Create supplier error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to create supplier" });
      }
    }
  );

  /*
   * PUT /api/suppliers/:id
   */
  router.put(
    "/suppliers/:id",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const { name, phone = null, email = null, address = null, notes = null } =
        req.body;

      if (!name || !String(name).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Supplier name is required" });
      }

      try {
        const result = await withDomainSave({ pool, db, savePlatformRecord, key: "supplier", req, id: req.params.id, write: (db) => db(
          `
          UPDATE suppliers
          SET name = $1, phone = $2, email = $3, address = $4, notes = $5,
            contact_name = CASE WHEN $8::boolean THEN $9::varchar ELSE contact_name END,
            updated_at = NOW()
          WHERE id = $6 AND company_id = $7
          RETURNING id, name, contact_name, phone, email, address, notes, active, created_at, updated_at
          `,
          [
            String(name).trim(),
            phone || null,
            email || null,
            address || null,
            notes || null,
            req.params.id,
            req.user.companyId,
            Object.prototype.hasOwnProperty.call(req.body, "contactName"),
            req.body.contactName == null ? null : String(req.body.contactName).trim() || null,
          ]
        ) });

        if (!result.rows.length) {
          return res
            .status(404)
            .json({ success: false, message: "Supplier not found" });
        }

        res.json({
          success: true,
          message: "Supplier updated",
          data: result.rows[0],
        });
      } catch (error) {
        if (error.code === "PLATFORM_RECORD_INVALID") return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        console.error("Update supplier error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to update supplier" });
      }
    }
  );

  /*
   * PATCH /api/suppliers/:id/status
   */
  router.patch(
    "/suppliers/:id/status",
    authenticate,
    authorize("inventory.adjust"),
    async (req, res) => {
      const active = req.body.active;

      if (typeof active !== "boolean") {
        return res
          .status(400)
          .json({ success: false, message: "Supplier active status is required" });
      }

      try {
        const result = await withDomainSave({
          pool,
          db,
          savePlatformRecord,
          key: "supplier",
          req: { ...req, body: { ...req.body, platform: req.body.platform || {} } },
          id: req.params.id,
          write: (query) => query(
            `
            UPDATE suppliers
            SET active = $1, updated_at = NOW()
            WHERE id = $2 AND company_id = $3
            RETURNING id, name, contact_name, phone, email, address, notes, active, created_at, updated_at
            `,
            [active, req.params.id, req.user.companyId]
          ),
        });

        if (!result.rows.length) {
          return res
            .status(404)
            .json({ success: false, message: "Supplier not found" });
        }

        res.json({
          success: true,
          message: active ? "Supplier activated" : "Supplier deactivated",
          data: result.rows[0],
        });
      } catch (error) {
        if (error.code === "PLATFORM_RECORD_INVALID") return res.status(error.status).json({ success: false, code: error.code, message: error.message });
        console.error("Supplier status error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to update supplier status" });
      }
    }
  );

  return router;
}
