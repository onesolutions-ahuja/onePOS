import express from "express";
import { encryptCredentials } from "../services/integrationCredentials.js";
import {
  isAllowedConnectorTarget,
  toPublicCredential,
} from "../services/connectorFramework.js";

function jsonValue(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicDefinition(row) {
  const schema = jsonValue(row.credentials_schema, []);
  const schemaFields = Array.isArray(schema)
    ? schema
    : Object.entries(schema || {}).map(([key, value]) => ({ key, ...(value || {}) }));
  const publicSchema = schemaFields.map((field) => ({
    key: field.key || field.name,
    name: field.name,
    type: field.type,
    required: Boolean(field.required),
    label: field.label,
    description: field.description,
  }));
  const operations = jsonValue(row.operations, []);
  return {
    id: row.id,
    connectorKey: row.connector_key,
    name: row.name,
    description: row.description,
    publisher: row.publisher,
    authType: row.auth_type,
    baseUrl: row.base_url,
    credentialsSchema: publicSchema,
    operations: (Array.isArray(operations)
      ? operations
      : Object.entries(operations || {}).map(([key, value]) => ({
          key,
          ...value,
        }))
    ).map((operation) => ({
      key: operation.key || operation.name,
      name: operation.name,
      description: operation.description,
      method: operation.method || "GET",
      path: String(operation.path || "").split("?")[0],
    })),
    timeoutMs: row.timeout_ms,
    retryPolicy: jsonValue(row.retry_policy, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadConnector(db, connectorId) {
  const result = await db(
    `SELECT id, connector_key, name, auth_type, credentials_schema, status
     FROM platform_connector_definitions WHERE id = $1`,
    [connectorId]
  );
  return result.rows[0] || null;
}

function validateSecrets(schema, secrets) {
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    return "secrets must be an object";
  }
  const fields = Array.isArray(schema) ? schema : Object.values(schema || {});
  const allowed = new Set(fields.map((field) => field?.key || field?.name).filter(Boolean));
  if (allowed.size && Object.keys(secrets).some((key) => !allowed.has(key))) {
    return "secrets contains fields not declared by this connector";
  }
  for (const field of fields) {
    const key = field?.key || field?.name;
    if (!key) continue;
    const value = secrets[key];
    if (field.required && (value === undefined || value === null || value === "")) {
      return `${key} is required`;
    }
    if (value !== undefined && field.type === "number" && !Number.isFinite(Number(value))) {
      return `${key} must be a number`;
    }
    if (value !== undefined && field.type === "boolean" && typeof value !== "boolean") {
      return `${key} must be a boolean`;
    }
    if (value !== undefined && field.type === "string" && typeof value !== "string") {
      return `${key} must be a string`;
    }
  }
  return null;
}

function publicPlatformCredential(row) {
  const result = toPublicCredential(row);
  return result
    ? { ...result, companyId: null, platformLevel: true }
    : null;
}

async function validateDefinition(body = {}) {
  const authType = String(body.authType || body.auth_type || "none").toLowerCase();
  const baseUrl = body.baseUrl || body.base_url;
  const operations = body.operations;
  const timeoutMs = Number(body.timeoutMs ?? body.timeout_ms ?? 15000);
  const retryPolicy = body.retryPolicy ?? body.retry_policy ?? {
    maxAttempts: 3,
    backoffMs: 1000,
  };
  if (!["none", "api_key", "bearer", "basic"].includes(authType)) {
    return { error: "Unsupported authType" };
  }
  if (!(await isAllowedConnectorTarget(baseUrl))) {
    return { error: "baseUrl must be a safe HTTP(S) target" };
  }
  const parsedBase = new URL(baseUrl);
  if (parsedBase.search || parsedBase.hash) {
    return { error: "baseUrl cannot include a query string or fragment" };
  }
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 120000
  ) {
    return { error: "timeoutMs must be between 100 and 120000" };
  }
  if (!Array.isArray(operations) || operations.length > 100) {
    return { error: "operations must be an array of at most 100 operations" };
  }
  const credentialsSchema = body.credentialsSchema ?? body.credentials_schema ?? [];
  if (
    !Array.isArray(credentialsSchema) &&
    (!credentialsSchema || typeof credentialsSchema !== "object")
  ) {
    return { error: "credentialsSchema must be an array or object" };
  }
  if (Object.keys(credentialsSchema).length > 100) {
    return { error: "credentialsSchema may contain at most 100 fields" };
  }
  const keys = new Set();
  for (const operation of operations) {
    const key = String(operation?.key || operation?.name || "");
    const method = String(operation?.method || "GET").toUpperCase();
    const path = String(operation?.path || "");
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(key) || keys.has(key)) {
      return { error: "Each operation needs a unique key or name" };
    }
    keys.add(key);
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return { error: `Unsupported HTTP method for operation ${key}` };
    }
    if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
      return { error: `Operation ${key} path must be a relative path` };
    }
    for (const field of ["headers", "params", "request", "requestMapping", "response", "responseMapping"]) {
      if (
        operation[field] !== undefined &&
        (!operation[field] || typeof operation[field] !== "object" || Array.isArray(operation[field]))
      ) {
        return { error: `Operation ${key} ${field} must be an object` };
      }
    }
    const operationTimeout = Number(operation.timeoutMs ?? operation.timeout ?? timeoutMs);
    if (!Number.isInteger(operationTimeout) || operationTimeout < 100 || operationTimeout > 120000) {
      return { error: `Operation ${key} timeout must be between 100 and 120000` };
    }
  }
  const retries =
    typeof retryPolicy === "number"
      ? { maxAttempts: retryPolicy }
      : retryPolicy;
  if (
    !retries ||
    !Number.isInteger(Number(retries.maxAttempts ?? 3)) ||
    Number(retries.maxAttempts ?? 3) < 1 ||
    Number(retries.maxAttempts ?? 3) > 5 ||
    !Number.isInteger(Number(retries.backoffMs ?? 1000)) ||
    Number(retries.backoffMs ?? 1000) < 0 ||
    Number(retries.backoffMs ?? 1000) > 30000
  ) {
    return { error: "retryPolicy maxAttempts/backoffMs is out of range" };
  }
  return {
    value: {
      authType,
      baseUrl,
      operations,
      timeoutMs,
      retryPolicy: retries,
      credentialsSchema,
    },
  };
}

/**
 * Router constructor for generic connector definitions and encrypted
 * credentials. Mount under the API prefix chosen by the parent server.
 */
export default function createConnectorsRouter({
  authenticate,
  authorize,
  db,
  writeAudit,
}) {
  if (typeof db !== "function") throw new Error("db query function is required");
  const router = express.Router();

  async function requireSuperadmin(req, res) {
    const userId = req.user?.id;
    if (!userId) {
      res.status(403).json({ success: false, message: "Superadmin access required" });
      return false;
    }
    const result = await db(
      "SELECT is_superadmin FROM users WHERE id = $1 AND active = TRUE",
      [userId]
    );
    if (result.rows[0]?.is_superadmin !== true) {
      res.status(403).json({ success: false, message: "Superadmin access required" });
      return false;
    }
    return true;
  }

  async function loadTenantCredential(id, companyId) {
    const result = await db(
      `SELECT id, company_id, connector_id, credential_key, name, metadata,
              active, rotated_at, created_at, updated_at
       FROM platform_credentials WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return result.rows[0] || null;
  }

  async function validateConnectionBinding({
    req,
    res,
    connectorId,
    credentialId,
    storeId,
  }) {
    const connector = await loadConnector(db, connectorId);
    if (!connector || connector.status !== "ACTIVE") {
      res.status(404).json({ success: false, message: "Connector not found" });
      return false;
    }
    if (credentialId) {
      const tenantCredential = await db(
        `SELECT id FROM platform_credentials
         WHERE id = $1 AND company_id = $2 AND connector_id = $3 AND active = TRUE`,
        [credentialId, req.user.companyId, connectorId]
      );
      if (!tenantCredential.rows[0]) {
        if (!(await requireSuperadmin(req, res))) return false;
        const platformCredential = await db(
          `SELECT id FROM platform_credentials
           WHERE id = $1 AND company_id IS NULL AND connector_id = $2 AND active = TRUE`,
          [credentialId, connectorId]
        );
        if (!platformCredential.rows[0]) {
          res.status(400).json({
            success: false,
            message: "Credential is unavailable for this connector",
          });
          return false;
        }
      }
    }
    if (storeId) {
      const store = await db(
        "SELECT id FROM stores WHERE id = $1 AND company_id = $2",
        [storeId, req.user.companyId]
      );
      if (!store.rows[0]) {
        res.status(400).json({ success: false, message: "Store is not available" });
        return false;
      }
    }
    return true;
  }

  function connectionPolicy(body, existing = {}) {
    const timeoutMs = Number(body.timeoutMs ?? existing.timeout_ms ?? 15000);
    const retryPolicy = body.retryPolicy ?? existing.retry_policy ?? {
      maxAttempts: 3,
      backoffMs: 1000,
    };
    const policy =
      typeof retryPolicy === "number"
        ? { maxAttempts: retryPolicy }
        : retryPolicy;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) {
      return { error: "timeoutMs must be between 100 and 120000" };
    }
    if (
      !policy ||
      !Number.isInteger(Number(policy.maxAttempts ?? 3)) ||
      Number(policy.maxAttempts ?? 3) < 1 ||
      Number(policy.maxAttempts ?? 3) > 5 ||
      !Number.isInteger(Number(policy.backoffMs ?? 1000)) ||
      Number(policy.backoffMs ?? 1000) < 0 ||
      Number(policy.backoffMs ?? 1000) > 30000
    ) {
      return { error: "retryPolicy maxAttempts/backoffMs is out of range" };
    }
    return { timeoutMs, retryPolicy: policy };
  }

  router.get(
    "/connections",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const result = await db(
          `SELECT c.id, c.company_id, c.store_id, c.name, c.enabled,
                  c.connector_definition_id, c.credential_id, c.timeout_ms,
                  c.retry_policy, c.created_at, c.updated_at,
                  d.connector_key, d.name AS connector_name,
                  p.name AS credential_name, p.credential_key,
                  p.active AS credential_active,
                  (p.id IS NOT NULL) AS has_credential
           FROM integration_connections c
           LEFT JOIN platform_connector_definitions d
             ON d.id = c.connector_definition_id
           LEFT JOIN platform_credentials p ON p.id = c.credential_id
           WHERE c.company_id = $1 AND c.connector_definition_id IS NOT NULL
           ORDER BY c.created_at DESC`,
          [req.user.companyId]
        );
        res.json({
          success: true,
          data: result.rows.map((row) => ({
            id: row.id,
            companyId: row.company_id,
            storeId: row.store_id,
            name: row.name,
            enabled: row.enabled,
            connectorId: row.connector_definition_id,
            connectorKey: row.connector_key,
            connectorName: row.connector_name,
            credentialId: row.credential_id,
            credentialName: row.credential_name || null,
            credentialKey: row.credential_key || null,
            hasCredential: row.has_credential && row.credential_active,
            timeoutMs: row.timeout_ms,
            retryPolicy: jsonValue(row.retry_policy, {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          })),
        });
      } catch (error) {
        console.error("List connector connections error:", error);
        res.status(500).json({ success: false, message: "Unable to list connections" });
      }
    }
  );

  router.post(
    "/connections",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const body = req.body || {};
        const connectorId = body.connectorId;
        const credentialId = body.credentialId || null;
        const storeId = body.storeId || null;
        const name = String(body.name || "").trim();
        if (!connectorId || !name || name.length > 200) {
          return res.status(400).json({
            success: false,
            message: "connectorId and name are required",
          });
        }
        if (!(await validateConnectionBinding({
          req,
          res,
          connectorId,
          credentialId,
          storeId,
        }))) return;
        const policy = connectionPolicy(body);
        if (policy.error) {
          return res.status(400).json({ success: false, message: policy.error });
        }
        const connector = await loadConnector(db, connectorId);
        const result = await db(
          `INSERT INTO integration_connections
             (company_id, store_id, name, provider_name, integration_type, auth_type,
              enabled, created_by, connector_definition_id, credential_id,
              retry_policy, timeout_ms)
           VALUES ($1,$2,$3,$4,'generic',$5,TRUE,$6,$7,$8,$9::jsonb,$10)
           RETURNING id, company_id, store_id, name, enabled,
                     connector_definition_id, credential_id, retry_policy,
                     timeout_ms, created_at, updated_at`,
          [
            req.user.companyId,
            storeId,
            name,
            connector.connector_key,
            connector.auth_type,
            req.user.id || null,
            connectorId,
            credentialId,
            JSON.stringify(policy.retryPolicy),
            policy.timeoutMs,
          ]
        );
        const row = result.rows[0];
        res.status(201).json({
          success: true,
          data: {
            id: row.id,
            companyId: row.company_id,
            storeId: row.store_id,
            name: row.name,
            enabled: row.enabled,
            connectorId: row.connector_definition_id,
            credentialId: row.credential_id,
            hasCredential: Boolean(row.credential_id),
            retryPolicy: jsonValue(row.retry_policy, {}),
            timeoutMs: row.timeout_ms,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } catch (error) {
        console.error("Create connector connection error:", error);
        res.status(500).json({ success: false, message: "Unable to create connection" });
      }
    }
  );

  router.patch(
    "/connections/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const loaded = await db(
          `SELECT id, company_id, store_id, name, connector_definition_id,
                  credential_id, retry_policy, timeout_ms
           FROM integration_connections
           WHERE id = $1 AND company_id = $2 AND connector_definition_id IS NOT NULL`,
          [req.params.id, req.user.companyId]
        );
        const current = loaded.rows[0];
        if (!current) {
          return res.status(404).json({ success: false, message: "Connection not found" });
        }
        const connectorId = req.body?.connectorId || current.connector_definition_id;
        const credentialId =
          req.body?.credentialId === undefined
            ? current.credential_id
            : req.body.credentialId || null;
        const storeId =
          req.body?.storeId === undefined
            ? current.store_id
            : req.body.storeId || null;
        if (!(await validateConnectionBinding({
          req,
          res,
          connectorId,
          credentialId,
          storeId,
        }))) return;
        const policy = connectionPolicy(req.body || {}, current);
        if (policy.error) {
          return res.status(400).json({ success: false, message: policy.error });
        }
        const name = String(req.body?.name ?? current.name).trim();
        if (!name) {
          return res.status(400).json({ success: false, message: "name cannot be empty" });
        }
        const connector = await loadConnector(db, connectorId);
        const result = await db(
          `UPDATE integration_connections
           SET name = $1, store_id = $2, provider_name = $3, auth_type = $4,
               connector_definition_id = $5, credential_id = $6,
               retry_policy = $7::jsonb, timeout_ms = $8,
               enabled = COALESCE($9, enabled), updated_at = NOW()
           WHERE id = $10 AND company_id = $11
           RETURNING id, company_id, store_id, name, enabled,
                     connector_definition_id, credential_id, retry_policy,
                     timeout_ms, created_at, updated_at`,
          [
            name,
            storeId,
            connector.connector_key,
            connector.auth_type,
            connectorId,
            credentialId,
            JSON.stringify(policy.retryPolicy),
            policy.timeoutMs,
            typeof req.body?.enabled === "boolean" ? req.body.enabled : null,
            req.params.id,
            req.user.companyId,
          ]
        );
        const row = result.rows[0];
        res.json({
          success: true,
          data: {
            id: row.id,
            companyId: row.company_id,
            storeId: row.store_id,
            name: row.name,
            enabled: row.enabled,
            connectorId: row.connector_definition_id,
            credentialId: row.credential_id,
            hasCredential: Boolean(row.credential_id),
            retryPolicy: jsonValue(row.retry_policy, {}),
            timeoutMs: row.timeout_ms,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        });
      } catch (error) {
        console.error("Update connector connection error:", error);
        res.status(500).json({ success: false, message: "Unable to update connection" });
      }
    }
  );

  router.post(
    "/platform/connectors",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const body = req.body || {};
        const connectorKey = String(body.connectorKey || body.connector_key || "");
        const name = String(body.name || "").trim();
        const status = body.status || "ACTIVE";
        if (
          !/^[a-zA-Z0-9_.-]{1,100}$/.test(connectorKey) ||
          !name ||
          name.length > 200 ||
          !["ACTIVE", "INACTIVE", "DEPRECATED"].includes(status)
        ) {
          return res.status(400).json({
            success: false,
            message: "A valid connectorKey and name are required",
          });
        }
        const validation = await validateDefinition(body);
        if (validation.error) {
          return res.status(400).json({ success: false, message: validation.error });
        }
        const { value } = validation;
        const result = await db(
          `INSERT INTO platform_connector_definitions
             (connector_key, name, description, publisher, auth_type, base_url,
              credentials_schema, operations, timeout_ms, retry_policy, status,
              source_package_id, source_package_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11,$12,$13)
           RETURNING id, connector_key, name, description, publisher, auth_type,
                     base_url, credentials_schema, operations, timeout_ms,
                     retry_policy, status, created_at, updated_at`,
          [
            connectorKey,
            name,
            body.description || null,
            body.publisher || null,
            value.authType,
            value.baseUrl,
            JSON.stringify(value.credentialsSchema),
            JSON.stringify(value.operations),
            value.timeoutMs,
            JSON.stringify(value.retryPolicy),
            status,
            body.sourcePackageId || null,
            body.sourcePackageVersion || null,
          ]
        );
        res.status(201).json({ success: true, data: publicDefinition(result.rows[0]) });
      } catch (error) {
        if (error?.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "Connector key already exists",
          });
        }
        console.error("Create connector definition error:", error);
        res.status(500).json({ success: false, message: "Unable to save connector" });
      }
    }
  );

  router.put(
    "/platform/connectors/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const body = req.body || {};
        const connectorKey = String(body.connectorKey || body.connector_key || "");
        const name = String(body.name || "").trim();
        const status = body.status || "ACTIVE";
        if (
          !/^[a-zA-Z0-9_.-]{1,100}$/.test(connectorKey) ||
          !name ||
          name.length > 200 ||
          !["ACTIVE", "INACTIVE", "DEPRECATED"].includes(status)
        ) {
          return res.status(400).json({
            success: false,
            message: "A valid connectorKey, name, and status are required",
          });
        }
        const validation = await validateDefinition(body);
        if (validation.error) {
          return res.status(400).json({ success: false, message: validation.error });
        }
        const { value } = validation;
        const result = await db(
          `UPDATE platform_connector_definitions
           SET connector_key = $1, name = $2, description = $3, publisher = $4,
               auth_type = $5, base_url = $6, credentials_schema = $7::jsonb,
               operations = $8::jsonb, timeout_ms = $9, retry_policy = $10::jsonb,
               status = $11, updated_at = NOW()
           WHERE id = $12
           RETURNING id, connector_key, name, description, publisher, auth_type,
                     base_url, credentials_schema, operations, timeout_ms,
                     retry_policy, status, created_at, updated_at`,
          [
            connectorKey,
            name,
            body.description || null,
            body.publisher || null,
            value.authType,
            value.baseUrl,
            JSON.stringify(value.credentialsSchema),
            JSON.stringify(value.operations),
            value.timeoutMs,
            JSON.stringify(value.retryPolicy),
            status,
            req.params.id,
          ]
        );
        if (!result.rows[0]) {
          return res.status(404).json({ success: false, message: "Connector not found" });
        }
        res.json({ success: true, data: publicDefinition(result.rows[0]) });
      } catch (error) {
        console.error("Update connector definition error:", error);
        res.status(500).json({ success: false, message: "Unable to update connector" });
      }
    }
  );

  router.get(
    "/connectors",
    authenticate,
    authorize("integration.manage"),
    async (_req, res) => {
      try {
        const result = await db(
          `SELECT id, connector_key, name, description, publisher, auth_type,
                  base_url, credentials_schema, operations, timeout_ms,
                  retry_policy, status, created_at, updated_at
           FROM platform_connector_definitions
           WHERE status = 'ACTIVE' ORDER BY name`
        );
        res.json({ success: true, data: result.rows.map(publicDefinition) });
      } catch (error) {
        console.error("List connector definitions error:", error);
        res.status(500).json({ success: false, message: "Unable to list connectors" });
      }
    }
  );

  router.get(
    "/credentials",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const params = [req.user.companyId];
        let query =
          `SELECT id, company_id, connector_id, credential_key, name, metadata,
                  active, rotated_at, created_at, updated_at
           FROM platform_credentials WHERE company_id = $1`;
        if (req.query.connectorId) {
          params.push(req.query.connectorId);
          query += ` AND connector_id = $2`;
        }
        query += " ORDER BY updated_at DESC";
        const result = await db(query, params);
        res.json({ success: true, data: result.rows.map(toPublicCredential) });
      } catch (error) {
        console.error("List connector credentials error:", error);
        res.status(500).json({ success: false, message: "Unable to list credentials" });
      }
    }
  );

  router.post(
    "/credentials",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const { connectorId, credentialKey, name, secrets } = req.body || {};
        if (
          !connectorId ||
          !/^[a-zA-Z0-9_.-]{1,100}$/.test(String(credentialKey || "")) ||
          !String(name || "").trim()
        ) {
          return res.status(400).json({
            success: false,
            message: "connectorId, credentialKey, and name are required",
          });
        }
        const connector = await loadConnector(db, connectorId);
        if (!connector || connector.status !== "ACTIVE") {
          return res.status(404).json({ success: false, message: "Connector not found" });
        }
        const validationError = validateSecrets(
          jsonValue(connector.credentials_schema, []),
          secrets
        );
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
        const result = await db(
          `INSERT INTO platform_credentials
             (company_id, connector_id, credential_key, name, ciphertext, metadata, created_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           RETURNING id, company_id, connector_id, credential_key, name, metadata,
                     active, rotated_at, created_at, updated_at`,
          [
            req.user.companyId,
            connectorId,
            credentialKey,
            String(name).trim(),
            encryptCredentials(secrets),
            JSON.stringify({ fieldNames: Object.keys(secrets) }),
            req.user.id || null,
          ]
        );
        const credential = toPublicCredential(result.rows[0]);
        if (writeAudit) {
          await writeAudit(
            req.user.companyId,
            req.user.id,
            "connector_credential_created",
            "platform_credential",
            credential.id,
            { connectorId, credentialKey }
          );
        }
        res.status(201).json({ success: true, data: credential });
      } catch (error) {
        if (error?.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "A credential with this key already exists",
          });
        }
        console.error("Create connector credential error:", error);
        res.status(500).json({ success: false, message: "Unable to save credential" });
      }
    }
  );

  router.put(
    "/credentials/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const existing = await loadTenantCredential(req.params.id, req.user.companyId);
        if (!existing) {
          return res.status(404).json({ success: false, message: "Credential not found" });
        }
        const connector = await loadConnector(db, existing.connector_id);
        const secrets = req.body?.secrets;
        const validationError = validateSecrets(
          jsonValue(connector?.credentials_schema, []),
          secrets
        );
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
        const name = String(req.body?.name || existing.name).trim();
        const result = await db(
          `UPDATE platform_credentials
           SET name = $1, ciphertext = $2, metadata = $3::jsonb, active = TRUE,
               rotated_at = NOW(), updated_at = NOW()
           WHERE id = $4 AND company_id = $5
           RETURNING id, company_id, connector_id, credential_key, name, metadata,
                     active, rotated_at, created_at, updated_at`,
          [
            name,
            encryptCredentials(secrets),
            JSON.stringify({ fieldNames: Object.keys(secrets) }),
            req.params.id,
            req.user.companyId,
          ]
        );
        res.json({ success: true, data: toPublicCredential(result.rows[0]) });
      } catch (error) {
        console.error("Rotate connector credential error:", error);
        res.status(500).json({ success: false, message: "Unable to update credential" });
      }
    }
  );

  router.delete(
    "/credentials/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const result = await db(
          `UPDATE platform_credentials SET active = FALSE, updated_at = NOW()
           WHERE id = $1 AND company_id = $2
           RETURNING id`,
          [req.params.id, req.user.companyId]
        );
        if (!result.rows[0]) {
          return res.status(404).json({ success: false, message: "Credential not found" });
        }
        res.json({ success: true, data: { id: result.rows[0].id, active: false } });
      } catch (error) {
        console.error("Delete connector credential error:", error);
        res.status(500).json({ success: false, message: "Unable to delete credential" });
      }
    }
  );

  router.get(
    "/platform/credentials",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const result = await db(
          `SELECT id, company_id, connector_id, credential_key, name, metadata,
                  active, rotated_at, created_at, updated_at
           FROM platform_credentials WHERE company_id IS NULL
           ORDER BY updated_at DESC`
        );
        res.json({
          success: true,
          data: result.rows.map(publicPlatformCredential),
        });
      } catch (error) {
        console.error("List platform credentials error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to list platform credentials",
        });
      }
    }
  );

  router.post(
    "/platform/credentials",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const { connectorId, credentialKey, name, secrets } = req.body || {};
        if (
          !connectorId ||
          !/^[a-zA-Z0-9_.-]{1,100}$/.test(String(credentialKey || "")) ||
          !String(name || "").trim()
        ) {
          return res.status(400).json({
            success: false,
            message: "connectorId, credentialKey, and name are required",
          });
        }
        const connector = await loadConnector(db, connectorId);
        if (!connector || connector.status !== "ACTIVE") {
          return res.status(404).json({ success: false, message: "Connector not found" });
        }
        const validationError = validateSecrets(
          jsonValue(connector.credentials_schema, []),
          secrets
        );
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
        const result = await db(
          `INSERT INTO platform_credentials
             (company_id, connector_id, credential_key, name, ciphertext, metadata, created_by)
           VALUES (NULL,$1,$2,$3,$4,$5::jsonb,$6)
           RETURNING id, company_id, connector_id, credential_key, name, metadata,
                     active, rotated_at, created_at, updated_at`,
          [
            connectorId,
            credentialKey,
            String(name).trim(),
            encryptCredentials(secrets),
            JSON.stringify({ fieldNames: Object.keys(secrets) }),
            req.user.id || null,
          ]
        );
        res.status(201).json({
          success: true,
          data: publicPlatformCredential(result.rows[0]),
        });
      } catch (error) {
        if (error?.code === "23505") {
          return res.status(409).json({
            success: false,
            message: "A platform credential with this key already exists",
          });
        }
        console.error("Create platform credential error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to save platform credential",
        });
      }
    }
  );

  router.put(
    "/platform/credentials/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const existing = await db(
          `SELECT id, connector_id, name FROM platform_credentials
           WHERE id = $1 AND company_id IS NULL`,
          [req.params.id]
        );
        if (!existing.rows[0]) {
          return res.status(404).json({
            success: false,
            message: "Platform credential not found",
          });
        }
        const connector = await loadConnector(db, existing.rows[0].connector_id);
        const secrets = req.body?.secrets;
        const validationError = validateSecrets(
          jsonValue(connector?.credentials_schema, []),
          secrets
        );
        if (validationError) {
          return res.status(400).json({ success: false, message: validationError });
        }
        const name = String(req.body?.name || existing.rows[0].name).trim();
        const result = await db(
          `UPDATE platform_credentials
           SET name = $1, ciphertext = $2, metadata = $3::jsonb, active = TRUE,
               rotated_at = NOW(), updated_at = NOW()
           WHERE id = $4 AND company_id IS NULL
           RETURNING id, company_id, connector_id, credential_key, name, metadata,
                     active, rotated_at, created_at, updated_at`,
          [
            name,
            encryptCredentials(secrets),
            JSON.stringify({ fieldNames: Object.keys(secrets) }),
            req.params.id,
          ]
        );
        res.json({
          success: true,
          data: publicPlatformCredential(result.rows[0]),
        });
      } catch (error) {
        console.error("Rotate platform credential error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to update platform credential",
        });
      }
    }
  );

  router.delete(
    "/platform/credentials/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        if (!(await requireSuperadmin(req, res))) return;
        const result = await db(
          `UPDATE platform_credentials SET active = FALSE, updated_at = NOW()
           WHERE id = $1 AND company_id IS NULL RETURNING id`,
          [req.params.id]
        );
        if (!result.rows[0]) {
          return res.status(404).json({
            success: false,
            message: "Platform credential not found",
          });
        }
        res.json({ success: true, data: { id: result.rows[0].id, active: false } });
      } catch (error) {
        console.error("Delete platform credential error:", error);
        res.status(500).json({
          success: false,
          message: "Unable to delete platform credential",
        });
      }
    }
  );

  return router;
}
