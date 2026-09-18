import express from "express";

export default function createAdminRouter({
  authenticate,
  authorize,
  db,
  pool,
  canViewCompanyCustomers,
  bcrypt,
}) {
  const router = express.Router();

  /*
   * GET /api/admin/users
   */
  router.get("/admin/users", authenticate, authorize("user.manage"), async (req, res) => {
    try {
      const result = await db("SELECT u.id, u.username, u.full_name, u.email, u.active, u.store_id, s.name AS store_name, u.role_id, r.name AS role_name FROM users u LEFT JOIN stores s ON s.id=u.store_id LEFT JOIN roles r ON r.id=u.role_id WHERE u.company_id=$1 ORDER BY u.full_name", [req.user.companyId]);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to load users" });
    }
  });

  /*
   * GET /api/admin/roles
   */
  router.get("/admin/roles", authenticate, authorize("role.manage"), async (req, res) => {
    try {
      const result = await db("SELECT id, name, description FROM roles WHERE company_id=$1 ORDER BY name", [req.user.companyId]);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to load roles" });
    }
  });

  /*
   * GET /api/admin/permissions
   */
  router.get("/admin/permissions", authenticate, authorize("role.manage"), async (req, res) => {
    try {
      const result = await db("SELECT code, name, description FROM permissions ORDER BY code");
      res.json({ success: true, data: result.rows });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to load permissions" });
    }
  });

  /*
   * GET /api/admin/roles/:roleId/permissions
   * Returns the set of permission codes currently assigned to a role.
   * Company-scoped: the role must belong to the authenticated user's company.
   */
  router.get("/admin/roles/:roleId/permissions", authenticate, authorize("role.manage"), async (req, res) => {
    try {
      const roleCheck = await db("SELECT 1 FROM roles WHERE id=$1 AND company_id=$2", [req.params.roleId, req.user.companyId]);
      if (!roleCheck.rows.length) return res.status(404).json({ success: false, message: "Role not found" });
      const result = await db("SELECT p.code FROM permissions p INNER JOIN role_permissions rp ON rp.permission_id=p.id INNER JOIN roles r ON r.id=rp.role_id WHERE r.id=$1", [req.params.roleId]);
      res.json({ success: true, data: result.rows.map((row) => row.code) });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to load role permissions" });
    }
  });

  /*
   * PUT /api/admin/roles/:roleId/permissions
   * Replaces the full permission set for a role.
   * Company-scoped: the role must belong to the authenticated user's company.
   */
  router.put("/admin/roles/:roleId/permissions", authenticate, authorize("role.manage"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    if (!Array.isArray(req.body.permissions)) return res.status(400).json({ success: false, message: "permissions must be an array" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const roleCheck = await client.query("SELECT 1 FROM roles WHERE id=$1 AND company_id=$2", [req.params.roleId, req.user.companyId]);
      if (!roleCheck.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Role not found" }); }
      await client.query("DELETE FROM role_permissions WHERE role_id=$1", [req.params.roleId]);
      const codes = req.body.permissions;
      for (const code of codes) {
        const perm = await client.query("SELECT id FROM permissions WHERE code=$1", [code]);
        if (perm.rows.length) {
          await client.query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.roleId, perm.rows[0].id]);
        }
      }
      await client.query("COMMIT");
      const result = await db("SELECT p.code FROM permissions p INNER JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=$1 ORDER BY p.code", [req.params.roleId]);
      res.json({ success: true, data: result.rows.map((row) => row.code) });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update role permissions error:", error);
      res.status(500).json({ success: false, message: "Unable to save role permissions" });
    } finally {
      client.release();
    }
  });

  /*
   * GET /api/admin/stores
   */
  router.get("/admin/stores", authenticate, async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: "Administrator permission required" });
    try { const result = await db("SELECT s.id, s.name, s.code, s.address_line1, s.city, s.postcode, s.phone, s.active, COALESCE(json_agg(json_build_object('id',t.id,'name',t.name,'terminalNumber',t.terminal_number,'active',t.active) ORDER BY t.created_at) FILTER (WHERE t.id IS NOT NULL),'[]') AS tills FROM stores s LEFT JOIN terminals t ON t.store_id=s.id WHERE s.company_id=$1 GROUP BY s.id ORDER BY s.name", [req.user.companyId]); res.json({ success: true, data: result.rows }); } catch (error) { res.status(500).json({ success: false, message: "Unable to load stores" }); }
  });

  /*
   * PUT /api/admin/stores/:id
   */
  router.put("/admin/stores/:id", authenticate, async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: "Administrator permission required" });
    try { const result = await db("UPDATE stores SET name=$1, code=$2, address_line1=$3, city=$4, postcode=$5, phone=$6, active=$7, updated_at=NOW() WHERE id=$8 AND company_id=$9 RETURNING id,name,code,address_line1,city,postcode,phone,active", [req.body.name, req.body.code || null, req.body.addressLine1 || null, req.body.city || null, req.body.postcode || null, req.body.phone || null, req.body.active !== false, req.params.id, req.user.companyId]); if (!result.rows.length) return res.status(404).json({ success: false, message: "Store not found" }); res.json({ success: true, data: result.rows[0] }); } catch (error) { res.status(500).json({ success: false, message: "Unable to update store" }); }
  });

  /*
   * PUT /api/admin/tills/:id
   */
  router.put("/admin/tills/:id", authenticate, async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: "Administrator permission required" });
    try { const result = await db("UPDATE terminals t SET name=$1, terminal_number=$2, device_identifier=$3, active=$4 FROM stores s WHERE t.id=$5 AND t.store_id=s.id AND s.company_id=$6 RETURNING t.id,t.name,t.terminal_number,t.device_identifier,t.active", [req.body.name, req.body.terminalNumber || null, req.body.deviceIdentifier || null, req.body.active !== false, req.params.id, req.user.companyId]); if (!result.rows.length) return res.status(404).json({ success: false, message: "Till not found" }); res.json({ success: true, data: result.rows[0] }); } catch (error) { res.status(500).json({ success: false, message: "Unable to update till" }); }
  });

  /*
   * POST /api/admin/users
   */
  router.post("/admin/users", authenticate, authorize("user.manage"), async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: "Administrator permission required" });
    const { username, fullName, email = null, password, roleId = null, storeId = null } = req.body;
    if (!username || !fullName || !password) return res.status(400).json({ success: false, message: "Username, full name and password are required" });
    try {
      const assignment = await db(
        `
        SELECT
          ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM roles WHERE id = $1 AND company_id = $3)) AS valid_role,
          ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM stores WHERE id = $2 AND company_id = $3)) AS valid_store
        `,
        [roleId || null, storeId || null, req.user.companyId]
      );
      if (!assignment.rows[0].valid_role || !assignment.rows[0].valid_store) return res.status(400).json({ success: false, message: "Role or store does not belong to this company" });
      const hash = await bcrypt.hash(password, 12);
      const result = await db("INSERT INTO users (company_id,store_id,role_id,username,password_hash,full_name,email) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,full_name,email,active,store_id,role_id", [req.user.companyId, storeId || null, roleId || null, String(username).trim().toLowerCase(), hash, String(fullName).trim(), email || null]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Username already exists" : "Unable to create user" }); }
  });

  /*
   * PUT /api/admin/users/:id
   */
  router.put("/admin/users/:id", authenticate, authorize("user.manage"), async (req, res) => {
    try {
      const assignment = await db(
        `
        SELECT
          ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM roles WHERE id = $1 AND company_id = $3)) AS valid_role,
          ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM stores WHERE id = $2 AND company_id = $3)) AS valid_store
        `,
        [req.body.roleId || null, req.body.storeId || null, req.user.companyId]
      );
      if (!assignment.rows[0].valid_role || !assignment.rows[0].valid_store) return res.status(400).json({ success: false, message: "Role or store does not belong to this company" });
      const passwordClause = req.body.password ? ", password_hash = $8" : "";
      const params = [req.body.fullName, req.body.email || null, req.body.roleId || null, req.body.storeId || null, req.body.active !== false, req.params.id, req.user.companyId];
      if (req.body.password) params.push(await bcrypt.hash(req.body.password, 12));
      const result = await db(`UPDATE users SET full_name=$1,email=$2,role_id=$3,store_id=$4,active=$5,updated_at=NOW()${passwordClause} WHERE id=$6 AND company_id=$7 RETURNING id,username,full_name,email,active,store_id,role_id`, params);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to update user" });
    }
  });

  /*
   * POST /api/admin/users/:id/reset-password
   * Admin reset of ANOTHER user's password. No current-password check (the
   * admin does not know it); requires user.manage permission + company scope.
   * Body: { newPassword, confirmPassword }. Keeps bcrypt hashing (cost 12).
   */
  router.post("/admin/users/:id/reset-password", authenticate, authorize("user.manage"), async (req, res) => {
    try {
      const { newPassword, confirmPassword } = req.body || {};
      if (!newPassword || !confirmPassword) return res.status(400).json({ success: false, message: "New password and confirmation are required" });
      if (newPassword !== confirmPassword) return res.status(400).json({ success: false, message: "New password and confirmation do not match" });
      if (String(newPassword).length < 8) return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
      if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ success: false, message: "Use change-password for your own account" });
      const hash = await bcrypt.hash(String(newPassword), 12);
      const result = await db("UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING id, username", [hash, req.params.id, req.user.companyId]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
      res.json({ success: true, message: "Password reset successfully", data: result.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: "Unable to reset password" });
    }
  });


  /* POST /api/admin/stores
   */
  router.post('/admin/stores', authenticate, async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: 'Administrator permission required' });
    const { name, code, addressLine1, city, postcode, phone } = req.body || {};
    if (!name) return res.status(400).json({ success: false, message: 'Store name is required' });
    try {
      const result = await db(
        `INSERT INTO stores (company_id, name, code, address_line1, city, postcode, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, code, address_line1, city, postcode, phone, active, created_at`,
        [req.user.companyId, name, code || null, addressLine1 || null, city || null, postcode || null, phone || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to create store' });
    }
  });

  /* GET /api/admin/stores/:id/stats
   * Returns today's sales, transaction count and low-stock item count for a store.
   */
  router.get('/admin/stores/:id/stats', authenticate, async (req, res) => {
    if (!(await canViewCompanyCustomers(req.user))) return res.status(403).json({ success: false, message: 'Administrator permission required' });
    try {
      const storeCheck = await db('SELECT 1 FROM stores WHERE id=$1 AND company_id=$2', [req.params.id, req.user.companyId]);
      if (!storeCheck.rows.length) return res.status(404).json({ success: false, message: 'Store not found' });
      const result = await db(
        `
        WITH business_day AS (
          SELECT (CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date AS today
          FROM companies c
          WHERE c.id = $1
        )
        SELECT
          COALESCE((SELECT SUM(s.total) FROM sales s
            INNER JOIN companies c ON c.id = s.company_id
            CROSS JOIN business_day d
            WHERE s.company_id = $1 AND s.store_id = $2
            AND s.status = 'completed'
            AND (s.created_at AT TIME ZONE c.timezone)::date = d.today), 0) AS today_sales,
          (SELECT COUNT(*) FROM sales s
            INNER JOIN companies c ON c.id = s.company_id
            CROSS JOIN business_day d
            WHERE s.company_id = $1 AND s.store_id = $2
            AND s.status = 'completed'
            AND (s.created_at AT TIME ZONE c.timezone)::date = d.today) AS today_transactions,
          (SELECT COUNT(*) FROM products p
            WHERE p.company_id = $1 AND p.store_id = $2
            AND p.active = true AND p.track_stock = true
            AND p.stock_quantity <= p.low_stock_level AND p.low_stock_level > 0) AS low_stock_count
        `,
        [req.user.companyId, req.params.id]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Unable to load store statistics' });
    }
  });
  return router;
}
