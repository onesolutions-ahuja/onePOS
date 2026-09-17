import express from "express";

export default function createSuppliersRouter({ authenticate, authorize, db }) {
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

        res.json({
          success: true,
          data: { ...supplier.rows[0], purchases: purchases.rows },
        });
      } catch (error) {
        console.error("Get supplier error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load supplier" });
      }
    }
  );

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
        const result = await db(
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
        );

        res
          .status(201)
          .json({ success: true, message: "Supplier created", data: result.rows[0] });
      } catch (error) {
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
        const result = await db(
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
        );

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
        const result = await db(
          `
          UPDATE suppliers
          SET active = $1, updated_at = NOW()
          WHERE id = $2 AND company_id = $3
          RETURNING id, name, contact_name, phone, email, address, notes, active, created_at, updated_at
          `,
          [active, req.params.id, req.user.companyId]
        );

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
        console.error("Supplier status error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to update supplier status" });
      }
    }
  );

  return router;
}
