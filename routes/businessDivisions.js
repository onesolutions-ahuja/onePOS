import express from "express";

export default function createBusinessDivisionsRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();

  router.get("/business-divisions", authenticate, authorize("business_division.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT d.*, COUNT(s.id)::int AS store_count
           FROM business_divisions d LEFT JOIN stores s ON s.business_division_id=d.id
          WHERE d.company_id=$1
          GROUP BY d.id ORDER BY d.code`,
        [req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load business divisions error:", error);
      res.status(500).json({ success: false, message: "Unable to load business divisions" });
    }
  });

  router.get("/business-divisions/:id", authenticate, authorize("business_division.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT d.*, COALESCE(json_agg(json_build_object('id',s.id,'name',s.name,'code',s.code,'active',s.active) ORDER BY s.name) FILTER (WHERE s.id IS NOT NULL),'[]') AS stores
           FROM business_divisions d LEFT JOIN stores s ON s.business_division_id=d.id
          WHERE d.id=$1 AND d.company_id=$2 GROUP BY d.id`,
        [req.params.id, req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Business division not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Get business division error:", error);
      res.status(500).json({ success: false, message: "Unable to load business division" });
    }
  });

  router.post("/business-divisions", authenticate, authorize("business_division.manage"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    if (!req.body.name?.trim()) return res.status(400).json({ success: false, message: "Division name is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(req.user.companyId)]);
      const next = await client.query(
        `SELECT COALESCE(MAX(NULLIF(regexp_replace(code,'[^0-9]','','g'),'')::int),0)+1 AS number
           FROM business_divisions WHERE company_id=$1`,
        [req.user.companyId]
      );
      const number = Number(next.rows[0].number);
      const code = `B${String(number).padStart(2, "0")}`;
      const result = await client.query(
        `INSERT INTO business_divisions (company_id,code,name,description,active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.companyId, code, req.body.name.trim(), req.body.description?.trim() || null, req.body.active !== false]
      );
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Create business division error:", error);
      res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Business division already exists" : "Unable to create business division" });
    } finally { client.release(); }
  });

  router.put("/business-divisions/:id", authenticate, authorize("business_division.manage"), async (req, res) => {
    try {
      const result = await db(
        `UPDATE business_divisions SET name=COALESCE($3,name), description=COALESCE($4,description), active=COALESCE($5,active), updated_at=NOW()
          WHERE id=$1 AND company_id=$2 RETURNING *`,
        [req.params.id, req.user.companyId, req.body.name?.trim() || null, req.body.description === undefined ? null : req.body.description?.trim() || null, typeof req.body.active === "boolean" ? req.body.active : null]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Business division not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Update business division error:", error);
      res.status(error.code === "23505" ? 409 : 500).json({ success: false, message: error.code === "23505" ? "Business division name already exists" : "Unable to update business division" });
    }
  });

  router.patch("/business-divisions/:id/status", authenticate, authorize("business_division.manage"), async (req, res) => {
    try {
      const result = await db("UPDATE business_divisions SET active=$3, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.id, req.user.companyId, req.body.active === true]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Business division not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Business division status error:", error); res.status(500).json({ success: false, message: "Unable to update business division status" }); }
  });

  router.put("/stores/:id/business-division", authenticate, authorize("store.edit", "business_division.manage"), async (req, res) => {
    try {
      const result = await db(
        `UPDATE stores s SET business_division_id=$3, updated_at=NOW()
          WHERE s.id=$1 AND s.company_id=$2
            AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM business_divisions d WHERE d.id=$3 AND d.company_id=$2))
          RETURNING s.id,s.name,s.code,s.business_division_id`,
        [req.params.id, req.user.companyId, req.body.businessDivisionId || null]
      );
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Store or business division not found in this company" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Assign store division error:", error); res.status(500).json({ success: false, message: "Unable to assign store business division" }); }
  });

  router.get("/business-divisions/context", authenticate, async (req, res) => {
    try {
      const result = await db(
        `SELECT d.id,d.code,d.name
           FROM business_divisions d
          WHERE d.company_id=$2 AND d.active=true
            AND (
              EXISTS (
                SELECT 1
                FROM users cu
                INNER JOIN roles cr ON cr.id=cu.role_id
                WHERE cu.id=$1
                  AND (cu.is_superadmin=true OR LOWER(cr.name) IN ('administrator','admin','owner'))
              )
              OR EXISTS (SELECT 1 FROM user_business_divisions ud WHERE ud.user_id=$1 AND ud.business_division_id=d.id AND ud.active=true)
            )
          ORDER BY d.code`,
        [req.user.id, req.user.companyId]
      );
      res.json({ success: true, data: { divisions: result.rows, defaultDivision: result.rows.length === 1 ? result.rows[0] : null } });
    } catch (error) { console.error("Division context error:", error); res.status(500).json({ success: false, message: "Unable to load business division context" }); }
  });

  router.get("/users/:id/business-divisions", authenticate, authorize("user.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT d.id,d.code,d.name FROM user_business_divisions ud
           JOIN business_divisions d ON d.id=ud.business_division_id
           JOIN users u ON u.id=ud.user_id
          WHERE ud.user_id=$1 AND u.company_id=$2 AND d.company_id=$2
          ORDER BY d.code`,
        [req.params.id, req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) { console.error("Load user divisions error:", error); res.status(500).json({ success: false, message: "Unable to load user business divisions" }); }
  });

  router.put("/users/:id/business-divisions", authenticate, authorize("user.edit"), async (req, res) => {
    const divisionIds = Array.isArray(req.body.divisionIds) ? [...new Set(req.body.divisionIds)] : null;
    if (!divisionIds) return res.status(400).json({ success: false, message: "divisionIds must be an array" });
    try {
      const valid = await db("SELECT id FROM business_divisions WHERE company_id=$1 AND id = ANY($2::uuid[])", [req.user.companyId, divisionIds]);
      if (valid.rows.length !== divisionIds.length) return res.status(400).json({ success: false, message: "All divisions must belong to this company" });
      await db("DELETE FROM user_business_divisions WHERE user_id=$1 AND EXISTS (SELECT 1 FROM users WHERE id=$1 AND company_id=$2)", [req.params.id, req.user.companyId]);
      for (const id of divisionIds) await db("INSERT INTO user_business_divisions (user_id,business_division_id) SELECT $1,$2 WHERE EXISTS (SELECT 1 FROM users WHERE id=$1 AND company_id=$3) ON CONFLICT DO NOTHING", [req.params.id, id, req.user.companyId]);
      res.json({ success: true, data: { divisionIds } });
    } catch (error) { console.error("Assign user divisions error:", error); res.status(500).json({ success: false, message: "Unable to assign business divisions" }); }
  });

  return router;
}
