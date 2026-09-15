import express from "express";

export default function createCustomersRouter({
  authenticate,
  authorize,
  db,
  pool,
  canViewCompanyCustomers,
  associateCustomerWithStore,
}) {
  const router = express.Router();

  /*
   * GET /api/customers
   */
  router.get("/customers", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const companyScope =
        req.query.scope === "company" && (await canViewCompanyCustomers(req.user));
      const params = [req.user.companyId];
      const filters = ["c.company_id = $1"];

      if (!companyScope) {
        params.push(req.user.storeId);
        filters.push(`cs.store_id = $${params.length}`);
        filters.push("cs.active = true");
      }

      if (req.query.active !== undefined) {
        params.push(req.query.active !== "false");
        filters.push(`c.active = $${params.length}`);
      }

      if (req.query.search) {
        params.push(`%${String(req.query.search).trim()}%`);
        filters.push(
          `(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`
        );
      }

      const result = await db(
        `
        SELECT c.id, c.company_id, c.name, c.phone, c.email, c.address, c.postcode,
          c.loyalty_number, c.notes, c.active, c.created_at, c.updated_at,
          MAX(cs.last_purchase_at) AS last_purchase_at,
          STRING_AGG(DISTINCT st.name, ', ' ORDER BY st.name) AS store_names
        FROM customers c
        ${
          companyScope
            ? "LEFT JOIN customer_stores cs ON cs.customer_id = c.id"
            : "INNER JOIN customer_stores cs ON cs.customer_id = c.id"
        }
        LEFT JOIN stores st ON st.id = cs.store_id
        WHERE ${filters.join(" AND ")}
        GROUP BY c.id
        ORDER BY c.name
        `,
        params
      );

      res.json({
        success: true,
        data: result.rows,
        scope: companyScope ? "company" : "store",
      });
    } catch (error) {
      console.error("Load customers error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to load customers" });
    }
  });

  /*
   * GET /api/customer-lookup
   */
  router.get("/customer-lookup", authenticate, authorize("customer.view"), async (req, res) => {
    const query = String(req.query.search || "").trim();
    if (!query) return res.json({ success: true, data: [] });

    try {
      const result = await db(
        `
        SELECT c.id, c.name, c.phone, c.email, c.active,
          EXISTS (
            SELECT 1 FROM customer_stores cs
            WHERE cs.customer_id = c.id AND cs.store_id = $2 AND cs.active = true
          ) AS associated
        FROM customers c
        WHERE c.company_id = $1
          AND c.active = true
          AND (c.name ILIKE $3 OR c.phone ILIKE $3 OR c.email ILIKE $3)
        ORDER BY c.name
        LIMIT 25
        `,
        [req.user.companyId, req.user.storeId, `%${query}%`]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Customer lookup error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to search customers" });
    }
  });

  /*
   * GET /api/customers/:id
   */
  router.get("/customers/:id", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const companyAdmin = await canViewCompanyCustomers(req.user);
      const result = await db(
        `
        SELECT c.id, c.company_id, c.name, c.phone, c.email, c.address, c.postcode,
          c.loyalty_number, c.notes, c.active, c.created_at, c.updated_at,
          COALESCE(json_agg(json_build_object(
            'storeId', cs.store_id,
            'storeName', st.name,
            'active', cs.active,
            'lastPurchaseAt', cs.last_purchase_at
          ) ORDER BY cs.store_id) FILTER (WHERE cs.id IS NOT NULL), '[]') AS stores
        FROM customers c
        LEFT JOIN customer_stores cs ON cs.customer_id = c.id
        LEFT JOIN stores st ON st.id = cs.store_id
        WHERE c.id = $1 AND c.company_id = $2
        GROUP BY c.id
        `,
        [req.params.id, req.user.companyId]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });

      if (!companyAdmin) {
        const visible = await db(
          `SELECT 1 FROM customer_stores WHERE customer_id = $1 AND store_id = $2 AND active = true`,
          [req.params.id, req.user.storeId]
        );
        if (!visible.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Customer not found" });
      }
      const sales = await db(
        `
        SELECT s.id, s.receipt_number, s.store_id, st.name AS store_name,
          s.total, s.status, s.created_at
        FROM sales s
        LEFT JOIN stores st ON st.id = s.store_id
        WHERE s.customer_id = $1 AND s.company_id = $2
        ORDER BY s.created_at DESC
        LIMIT 100
        `,
        [req.params.id, req.user.companyId]
      );

      res.json({
        success: true,
        data: { ...result.rows[0], sales: sales.rows },
      });
    } catch (error) {
      console.error("Get customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to load customer" });
    }
  });

  /*
   * POST /api/customers
   */
  router.post("/customers", authenticate, authorize("customer.create"), async (req, res) => {
    const { name, phone = null, email = null, address = null, postcode = null, notes = null, storeId = null } = req.body;
    const companyAdmin = await canViewCompanyCustomers(req.user);
    const targetStoreId = companyAdmin && storeId ? storeId : req.user.storeId;
    if (!name || !String(name).trim())
      return res
        .status(400)
        .json({ success: false, message: "Customer name is required" });
    if (!pool)
      return res
        .status(500)
        .json({ success: false, message: "DATABASE_URL is not configured" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const identifiers = [phone, email].filter(
        (value) => value && String(value).trim()
      );
      const matches = identifiers.length
        ? await client.query(
            `SELECT id, name, phone, email FROM customers WHERE company_id = $1 AND (phone = ANY($2::text[]) OR LOWER(email) = ANY($3::text[])) AND active = true`,
            [
              req.user.companyId,
              identifiers.map((value) => String(value).trim()),
              identifiers.map((value) => String(value).trim().toLowerCase()),
            ]
          )
        : { rows: [] };

      const ids = [...new Set(matches.rows.map((customer) => customer.id))];
      if (ids.length > 1) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Customer identifiers match multiple customers; no merge was performed",
          });
      }

      let customer;
      if (ids.length === 1) {
        customer = matches.rows[0];
      } else {
        const created = await client.query(
          `INSERT INTO customers (company_id, name, phone, email, address, postcode, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, phone, email, address, postcode, notes, active, created_at, updated_at`,
          [
            req.user.companyId,
            String(name).trim(),
            phone || null,
            email || null,
            address || null,
            postcode || null,
            notes || null,
          ]
        );
        customer = created.rows[0];
      }

      const association = await associateCustomerWithStore(
        client,
        customer.id,
        targetStoreId,
        req.user.companyId
      );
      await client.query("COMMIT");
      res
        .status(ids.length ? 200 : 201)
        .json({
          success: true,
          message: ids.length
            ? "Customer associated with store"
            : "Customer created",
          data: { customer, association },
        });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Create customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to create customer" });
    } finally {
      client.release();
    }
  });

  /*
   * POST /api/customers/:id/associate
   */
  router.post("/customers/:id/associate", authenticate, authorize("customer.edit"), async (req, res) => {
    const companyAdmin = await canViewCompanyCustomers(req.user);
    const targetStoreId =
      companyAdmin && req.body.storeId ? req.body.storeId : req.user.storeId;
    if (!pool)
      return res
        .status(500)
        .json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const association = await associateCustomerWithStore(
        client,
        req.params.id,
        targetStoreId,
        req.user.companyId
      );
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Customer associated with store",
        data: association,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      res
        .status(
          error.message === "Customer not found" ||
            error.message === "Store not found"
            ? 404
            : 400
        )
        .json({ success: false, message: error.message });
    } finally {
      client.release();
    }
  });

  /*
   * PUT /api/customers/:id
   */
  router.put("/customers/:id", authenticate, authorize("customer.edit"), async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user)))
      return res
        .status(403)
        .json({ success: false, message: "Customer administration permission required" });
    const { name, phone = null, email = null, address = null, postcode = null, notes = null } = req.body;
    if (!name || !String(name).trim())
      return res
        .status(400)
        .json({ success: false, message: "Customer name is required" });

    try {
      const result = await db(
        `
        UPDATE customers
        SET name=$1, phone=$2, email=$3, address=$4, postcode=$5, notes=$6, updated_at=NOW()
        WHERE id=$7 AND company_id=$8
        RETURNING id, company_id, name, phone, email, address, postcode, notes, active, created_at, updated_at
        `,
        [
          String(name).trim(),
          phone || null,
          email || null,
          address || null,
          postcode || null,
          notes || null,
          req.params.id,
          req.user.companyId,
        ]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      res.json({ success: true, message: "Customer updated", data: result.rows[0] });
    } catch (error) {
      console.error("Update customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to update customer" });
    }
  });

  /*
   * PATCH /api/customers/:id/status
   */
  router.patch("/customers/:id/status", authenticate, authorize("customer.edit"), async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user)))
      return res
        .status(403)
        .json({ success: false, message: "Customer administration permission required" });
    if (typeof req.body.active !== "boolean")
      return res
        .status(400)
        .json({ success: false, message: "Customer active status is required" });
    try {
      const result = await db(
        `UPDATE customers SET active=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING id, name, active`,
        [req.body.active, req.params.id, req.user.companyId]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      res.json({
        success: true,
        message: req.body.active ? "Customer activated" : "Customer deactivated",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Customer status error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to update customer status" });
    }
  });

  return router;
}
