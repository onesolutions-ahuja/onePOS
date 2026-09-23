import express from "express";
import bcrypt from "bcryptjs";
import { mergeEntitlements, normaliseEntitlements } from "../services/licensing.js";
import {
  DUPLICATE_EMAIL_MESSAGE,
  findNormalizedEmailConflict,
  isValidEmail,
  listDuplicateNormalizedEmails,
  normalizeEmail,
} from "../services/userIdentity.js";
import {
  encryptDatabaseSecret,
  initializeTenantSchema,
  TENANT_SCHEMA_STATES,
  tenantDatabaseDiagnostic,
  validateTenantSchema,
} from "../services/tenantDatabase.js";

export default function createSuperadminRouter({ authenticate, db, pool, tenantDatabaseRouter, env = process.env }) {
  const router = express.Router();
  const requireSuperadmin = async (req, res, next) => {
    try {
      const result = await db("SELECT is_superadmin FROM users WHERE id=$1 AND active=true", [req.user?.id]);
      if (result.rows[0]?.is_superadmin !== true) return res.status(403).json({ success: false, message: "Superadmin access required" });
      return next();
    } catch (error) {
      console.error("Superadmin authorization error:", error);
      return res.status(500).json({ success: false, message: "Unable to verify platform access" });
    }
  };

  router.use("/superadmin", authenticate, requireSuperadmin);

  router.get("/superadmin/licences", async (req, res) => {
    const result = await db(`SELECT l.*, COUNT(c.id)::int AS company_count
      FROM licences l LEFT JOIN companies c ON c.licence_id=l.id
      GROUP BY l.id ORDER BY l.name`);
    res.json({ success: true, data: result.rows });
  });

  router.post("/superadmin/licences", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Licence name is required" });
    try {
      const result = await db(`INSERT INTO licences (name,description,active,starts_at,expires_at)
        VALUES ($1,$2,COALESCE($3,true),$4,$5) RETURNING *`,
        [name, req.body.description || null, req.body.active, req.body.startsAt || null, req.body.expiresAt || null]);
      const licence = result.rows[0];
      for (const [key, enabled] of Object.entries(normaliseEntitlements(req.body.entitlements))) {
        await db("INSERT INTO licence_entitlements (licence_id,entitlement_key,enabled) VALUES ($1,$2,$3)", [licence.id, key, enabled]);
      }
      res.status(201).json({ success: true, data: { ...licence, entitlements: mergeEntitlements(req.body.entitlements) } });
    } catch (error) {
      res.status(error.code === "23505" ? 409 : 400).json({ success: false, message: error.code === "23505" ? "Licence name already exists" : error.message });
    }
  });

  router.put("/superadmin/licences/:id", async (req, res) => {
    const result = await db(`UPDATE licences SET name=COALESCE($1,name), description=COALESCE($2,description),
      active=COALESCE($3,active), starts_at=$4, expires_at=$5, updated_at=NOW() WHERE id=$6 RETURNING *`,
      [req.body?.name?.trim() || null, req.body?.description, req.body?.active, req.body?.startsAt || null, req.body?.expiresAt || null, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Licence not found" });
    if (req.body?.entitlements) {
      await db("DELETE FROM licence_entitlements WHERE licence_id=$1", [req.params.id]);
      for (const [key, enabled] of Object.entries(normaliseEntitlements(req.body.entitlements))) {
        await db("INSERT INTO licence_entitlements (licence_id,entitlement_key,enabled) VALUES ($1,$2,$3)", [req.params.id, key, enabled]);
      }
    }
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/superadmin/companies", async (req, res) => {
    const result = await db(`SELECT c.id,c.name,c.active,c.licence_id,l.name AS licence_name,l.active AS licence_active
      FROM companies c LEFT JOIN licences l ON l.id=c.licence_id ORDER BY c.name`);
    res.json({ success: true, data: result.rows });
  });

  router.put("/superadmin/companies/:id/licence", async (req, res) => {
    const result = await db(`UPDATE companies SET licence_id=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,licence_id`,
      [req.body?.licenceId || null, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Company not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/superadmin/companies/:id/entitlements", async (req, res) => {
    const result = await db(`SELECT c.id,c.name,l.id AS licence_id,l.name AS licence_name,l.active,l.starts_at,l.expires_at,
      COALESCE(jsonb_object_agg(le.entitlement_key,le.enabled) FILTER (WHERE le.entitlement_key IS NOT NULL),'{}'::jsonb) AS entitlements
      FROM companies c LEFT JOIN licences l ON l.id=c.licence_id LEFT JOIN licence_entitlements le ON le.licence_id=l.id
      WHERE c.id=$1 GROUP BY c.id,l.id`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Company not found" });
    res.json({ success: true, data: { ...result.rows[0], entitlements: mergeEntitlements(result.rows[0].entitlements) } });
  });

  router.get("/superadmin/companies/:id/database", async (req, res) => {
    const config = await tenantDatabaseRouter?.loadConfig(req.params.id);
    if (!config) return res.status(404).json({ success: false, message: "Database configuration not found" });
    res.json({
      success: true,
      data: {
        companyId: config.company_id,
        databaseMode: config.database_mode,
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        sslMode: config.ssl_mode,
        active: config.active,
        schemaState: config.schema_state || TENANT_SCHEMA_STATES.UNINITIALIZED,
        credentialsConfigured: Boolean(config.password_ciphertext),
        initialAdminEmail: (await db(
          `SELECT email FROM users
             WHERE company_id=$1
               AND is_superadmin=false
               AND role_id IN (SELECT id FROM roles WHERE company_id=$1 AND LOWER(name) IN ('administrator','admin','owner'))
             ORDER BY created_at
             LIMIT 1`,
          [req.params.id]
        )).rows[0]?.email || null,
      },
    });
  });

  router.get("/superadmin/companies/:id/users", async (req, res) => {
    try {
      const result = await db(
        `SELECT u.id,u.full_name,u.email,u.username,u.active,r.name AS role_name
           FROM users u LEFT JOIN roles r ON r.id=u.role_id AND r.company_id=u.company_id
          WHERE u.company_id=$1 AND u.is_superadmin=false
          ORDER BY u.full_name,u.email`,
        [req.params.id]
      );
      res.json({ success: true, data: result.rows });
    } catch {
      res.status(500).json({ success: false, message: "Unable to load company users" });
    }
  });

  router.get("/superadmin/users/email-conflicts", async (req, res) => {
    const conflicts = await listDuplicateNormalizedEmails(db);
    res.json({
      success: true,
      data: conflicts,
      migration: conflicts.length
        ? "Review each duplicate, assign a unique normalized email, then rerun initialization to create the unique index. Do not delete or merge accounts automatically."
        : "No normalized email conflicts found.",
    });
  });

  router.post("/superadmin/companies/:id/provision-admin", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "A valid client admin email is required" });
    }
    const client = await pool.connect();
    try {
      const companyResult = await client.query("SELECT id,name FROM companies WHERE id=$1", [req.params.id]);
      if (!companyResult.rows.length) return res.status(404).json({ success: false, message: "Company not found" });

      const existingAdmin = await client.query(
        `SELECT u.id,u.email
           FROM users u
           JOIN roles r ON r.id=u.role_id
          WHERE u.company_id=$1 AND u.is_superadmin=false
            AND LOWER(r.name) IN ('administrator','admin','owner')
          ORDER BY u.created_at
          LIMIT 1`,
        [req.params.id]
      );
      if (existingAdmin.rows.length) {
        return res.status(409).json({
          success: false,
          code: "COMPANY_ADMIN_EXISTS",
          message: "This company already has an initial Company Admin.",
          data: { emailConfigured: Boolean(existingAdmin.rows[0].email) },
        });
      }

      const conflict = await findNormalizedEmailConflict(
        (query, params) => client.query(query, params),
        email
      );
      if (conflict) return res.status(409).json({ success: false, code: "EMAIL_ALREADY_REGISTERED", message: DUPLICATE_EMAIL_MESSAGE });

      await client.query("BEGIN");
      const roleResult = await client.query(
        `INSERT INTO roles (company_id,name,description,is_system_role)
         VALUES ($1,'Administrator','Company-level administrative access',TRUE)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [req.params.id]
      );
      let roleId = roleResult.rows[0]?.id;
      if (!roleId) {
        const existingRole = await client.query(
          "SELECT id FROM roles WHERE company_id=$1 AND LOWER(name)='administrator' ORDER BY created_at LIMIT 1",
          [req.params.id]
        );
        roleId = existingRole.rows[0]?.id;
      }
      if (!roleId) throw new Error("Unable to create Company Admin role");

      await client.query(
        `INSERT INTO role_permissions (role_id,permission_id)
         SELECT $1,id FROM permissions
         ON CONFLICT DO NOTHING`,
        [roleId]
      );
      const passwordHash = await bcrypt.hash("marvel", 12);
      const userResult = await client.query(
        `INSERT INTO users
          (company_id,role_id,username,email,password_hash,full_name,must_change_password,is_superadmin)
         VALUES ($1,$2,$3,$4,$5,'Company Administrator',FALSE,FALSE)
         RETURNING id,company_id,username,email,full_name,must_change_password,is_superadmin`,
        [req.params.id, roleId, email, email, passwordHash]
      );
      await client.query("COMMIT");
      return res.status(201).json({
        success: true,
        data: {
          ...userResult.rows[0],
          temporaryPasswordIssued: true,
          password: undefined,
        },
        message: "Initial Company Admin provisioned. The password can be changed from the account menu.",
      });
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error.code === "23505") {
        return res.status(409).json({ success: false, code: "EMAIL_ALREADY_REGISTERED", message: DUPLICATE_EMAIL_MESSAGE });
      }
      console.error("Company Admin provisioning error:", { companyId: req.params.id, code: error.code || "UNKNOWN" });
      return res.status(500).json({ success: false, message: "Unable to provision initial Company Admin" });
    } finally {
      client.release();
    }
  });

  router.put("/superadmin/companies/:id/database", async (req, res) => {
    const mode = String(req.body?.databaseMode || "ONEPOS_MANAGED").toUpperCase();
    if (!["ONEPOS_MANAGED", "CUSTOMER_MANAGED"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Invalid database mode" });
    }
    if (mode === "CUSTOMER_MANAGED" && (!req.body?.host || !req.body?.database || !req.body?.username)) {
      return res.status(400).json({ success: false, message: "Customer database host, database and username are required" });
    }
    const existing = await tenantDatabaseRouter.loadConfig(req.params.id);
    const incomingPort = Number(req.body?.port) || 5432;
    const routingChanged = existing.database_mode !== mode
      || (existing.host || null) !== (req.body.host || null)
      || Number(existing.port || 5432) !== incomingPort
      || (existing.database || null) !== (req.body.database || null)
      || (existing.username || null) !== (req.body.username || null)
      || (existing.ssl_mode || "require") !== (req.body.sslMode || "require")
      || Boolean(req.body?.password);
    const encryptedPassword = req.body?.password
      ? encryptDatabaseSecret(req.body.password, env)
      : existing.password_ciphertext || null;
    const nextActive = routingChanged ? false : existing.active === true;
    const nextSchemaState = routingChanged
      ? (mode === "ONEPOS_MANAGED" ? TENANT_SCHEMA_STATES.COMPATIBLE : TENANT_SCHEMA_STATES.UNINITIALIZED)
      : (existing.schema_state || (mode === "ONEPOS_MANAGED" ? TENANT_SCHEMA_STATES.COMPATIBLE : TENANT_SCHEMA_STATES.UNINITIALIZED));
    await db(
      `INSERT INTO tenant_database_configs
       (company_id,database_mode,host,port,database_name,username,password_ciphertext,ssl_mode,active,schema_state,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         database_mode=EXCLUDED.database_mode,host=EXCLUDED.host,port=EXCLUDED.port,
         database_name=EXCLUDED.database_name,username=EXCLUDED.username,
         password_ciphertext=COALESCE(EXCLUDED.password_ciphertext,tenant_database_configs.password_ciphertext),
         ssl_mode=EXCLUDED.ssl_mode,active=EXCLUDED.active,schema_state=EXCLUDED.schema_state,
         updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [
        req.params.id,
        mode,
        req.body.host || null,
        incomingPort,
        req.body.database || null,
        req.body.username || null,
        encryptedPassword,
        req.body.sslMode || "require",
        nextActive,
        nextSchemaState,
        req.user.id,
      ]
    );
    res.json({
      success: true,
      data: {
        databaseMode: mode,
        credentialsConfigured: Boolean(encryptedPassword),
        active: nextActive,
        schemaState: nextSchemaState,
      },
    });
  });

  router.post("/superadmin/companies/:id/database/test", async (req, res) => {
    try {
      const config = await tenantDatabaseRouter.loadConfig(req.params.id);
      if (config.database_mode !== "CUSTOMER_MANAGED") return res.json({ success: true, data: { status: "SKIPPED", message: "Company uses onePOS Managed storage" } });
      await tenantDatabaseRouter.testExternalConfig(config);
      return res.json({ success: true, data: { status: "CONNECTED" } });
    } catch (error) {
      console.error("Tenant database operation failed", {
        operation: "test_connection",
        companyId: req.params.id,
        ...tenantDatabaseDiagnostic(error),
      });
      return res.status(503).json({ success: false, code: "TENANT_DATABASE_UNAVAILABLE", message: "Unable to connect to customer database" });
    }
  });

  router.post("/superadmin/companies/:id/database/validate-schema", async (req, res) => {
    try {
      const config = await tenantDatabaseRouter.loadConfig(req.params.id);
      const pool = await tenantDatabaseRouter.getPoolForConfig(config);
      const schemaState = await validateTenantSchema(pool);
      await db("UPDATE tenant_database_configs SET schema_state=$1 WHERE company_id=$2", [schemaState, req.params.id]);
      res.json({ success: true, data: { schemaState } });
    } catch (error) {
      console.error("Tenant database operation failed", {
        operation: "validate_schema",
        companyId: req.params.id,
        ...tenantDatabaseDiagnostic(error),
      });
      res.status(503).json({ success: false, code: "TENANT_DATABASE_UNAVAILABLE", message: "Unable to validate customer database schema" });
    }
  });

  router.post("/superadmin/companies/:id/database/initialize", async (req, res) => {
    try {
      const config = await tenantDatabaseRouter.loadConfig(req.params.id);
      const pool = await tenantDatabaseRouter.getPoolForConfig(config);
      const schemaState = await initializeTenantSchema(pool);
      await db("UPDATE tenant_database_configs SET schema_state=$1 WHERE company_id=$2", [schemaState, req.params.id]);
      res.json({ success: true, data: { schemaState } });
    } catch (error) {
      console.error("Tenant database operation failed", {
        operation: "initialize_schema",
        companyId: req.params.id,
        ...tenantDatabaseDiagnostic(error),
      });
      res.status(503).json({ success: false, code: "TENANT_DATABASE_UNAVAILABLE", message: "Unable to initialize customer database" });
    }
  });

  router.post("/superadmin/companies/:id/database/activate", async (req, res) => {
    const config = await tenantDatabaseRouter.loadConfig(req.params.id);
    if (config.database_mode === "CUSTOMER_MANAGED" && config.schema_state !== TENANT_SCHEMA_STATES.COMPATIBLE) {
      return res.status(409).json({ success: false, message: "Customer database schema must be compatible before activation" });
    }
    await db("UPDATE tenant_database_configs SET active=true,updated_at=NOW(),updated_by=$1 WHERE company_id=$2", [req.user.id, req.params.id]);
    res.json({ success: true, data: { active: true } });
  });

  return router;
}
