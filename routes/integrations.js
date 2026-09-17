/*
 * T9A - generic integration foundation (backend).
 *
 * Provider-agnostic CRUD for integration connections, endpoints and field
 * mappings, plus a filterable API log and a generic Test Connection /
 * Test Endpoint service that performs a real authenticated request using the
 * stored credentials. No provider (Xero/QuickBooks/Shopify/...) logic lives
 * here - that arrives in later tasks. No Sales/Purchases data is sent
 * anywhere by this module.
 *
 * Table note: "integrations" is already used by the Online Orders platform
 * configuration, so the generic tables are named integration_connections /
 * integration_endpoints / integration_field_mappings / integration_api_logs.
 *
 * Credentials are AES-256-GCM encrypted at rest and are never returned to
 * any client - responses expose only authType + hasCredentials, and log rows
 * carry redacted request/response payloads.
 */
import express from "express";
import crypto from "crypto";
import {
  encryptCredentials,
  decryptCredentials,
  redactHeadersForLog,
  redactBodyForLog,
  toPublicIntegration,
} from "../services/integrationCredentials.js";
import { buildPayload } from "../services/integrationFieldResolver.js";
import { getIntegrationDispatchStatus } from "../services/integrationDispatcher.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUTH_TYPES = ["none", "api_key", "bearer", "basic"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const ENTITY_TYPES = ["sale", "purchase", "product", "customer", "custom"];
const MAPPING_TYPES = ["direct", "constant", "template"];
const LOG_BODY_LIMIT = 20000; // characters stored per log body field

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Block SSRF-style targets: only http(s) to a real host, no localhost/metadata. */
function isAllowedTarget(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      /^169\.254\./.test(host) || // cloud metadata range
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function redactRequestConfig({ method, url, headers, body, authType, authHeader }) {
  const outboundHeaders = { ...headers };
  if (authHeader) outboundHeaders.Authorization = authHeader;
  return {
    method,
    url,
    headers: redactHeadersForLog(outboundHeaders),
    body: redactBodyForLog(body),
    authType,
  };
}

export default function createIntegrationsRouter({ authenticate, authorize, db, pool, writeAudit }) {
  const router = express.Router();

  /* ------------------------------------------------------------------ *
   * Shared loaders (company-scoped)                                    *
   * ------------------------------------------------------------------ */

  async function loadIntegration(id, companyId) {
    const result = await db(
      `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return result.rows[0] || null;
  }

  async function loadEndpoint(endpointId, companyId) {
    const result = await db(
      `SELECT e.* FROM integration_endpoints e
       JOIN integration_connections c ON c.id = e.integration_id
       WHERE e.id = $1 AND c.company_id = $2`,
      [endpointId, companyId]
    );
    return result.rows[0] || null;
  }

  /* ------------------------------------------------------------------ *
   * Integration connections                                            *
   * ------------------------------------------------------------------ */

  // List integrations (company-scoped; optional storeId filter).
  router.get(
    "/integrations",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const params = [req.user.companyId];
        let sql = `SELECT * FROM integration_connections WHERE company_id = $1`;
        if (req.query.storeId) {
          sql += ` AND (store_id = $2 OR store_id IS NULL)`;
          params.push(req.query.storeId);
        }
        sql += ` ORDER BY created_at DESC`;
        const result = await db(sql, params);
        res.json({
          success: true,
          data: result.rows.map(toPublicIntegration),
        });
      } catch (error) {
        console.error("List integrations error:", error);
        res.status(500).json({ success: false, message: "Unable to list integrations" });
      }
    }
  );

  // Dispatch status for the Integration management UI (T9M, read-only).
  // One row per configured endpoint: connection, event, last attempt /
  // success / failure, HTTP status, error message and trace (correlation)
  // ID. Credentials never appear. Registered before "/integrations/:id"
  // so the literal "dispatch-status" segment is not captured as an id.
  router.get(
    "/integrations/dispatch-status",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const rows = await getIntegrationDispatchStatus({
          deps: { db },
          companyId: req.user.companyId,
          storeId: req.user.storeId ?? null,
        });
        res.json({ success: true, data: rows });
      } catch (error) {
        console.error("Integration dispatch status error:", error);
        res.status(500).json({ success: false, message: "Unable to load dispatch status" });
      }
    }
  );

  // Get a single integration (company-scoped).
  router.get(
    "/integrations/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        res.json({ success: true, data: toPublicIntegration(integration) });
      } catch (error) {
        console.error("Get integration error:", error);
        res.status(500).json({ success: false, message: "Unable to load integration" });
      }
    }
  );

  // Create integration.
  router.post(
    "/integrations",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const {
          name,
          providerName,
          provider_name,
          integrationType,
          integration_type,
          baseUrl,
          base_url,
          authType,
          auth_type,
          credentials,
          storeId,
          store_id,
          enabled,
        } = req.body || {};

        if (!name || typeof name !== "string" || !name.trim()) {
          return res
            .status(400)
            .json({ success: false, message: "Name is required" });
        }
        const auth = authType || auth_type || "none";
        if (!AUTH_TYPES.includes(auth)) {
          return res
            .status(400)
            .json({ success: false, message: `authType must be one of: ${AUTH_TYPES.join(", ")}` });
        }
        const url = baseUrl ?? base_url ?? null;
        if (url && !isHttpsUrl(url)) {
          return res.status(400).json({ success: false, message: "baseUrl must be a valid http(s) URL" });
        }
        if (url && !isAllowedTarget(url)) {
          return res.status(400).json({ success: false, message: "baseUrl host is not allowed" });
        }
        const storeIdValue = storeId ?? store_id ?? null;
        if (storeIdValue && !isUuid(storeIdValue)) {
          return res.status(400).json({ success: false, message: "storeId must be a UUID" });
        }
        if (storeIdValue && storeIdValue !== req.user.storeId) {
          // Store scoping: an integration belongs to the caller's store (or is company-wide).
          return res
            .status(403)
            .json({ success: false, message: "You can only create integrations for your own store" });
        }

        const result = await db(
          `INSERT INTO integration_connections
             (company_id, store_id, name, provider_name, integration_type, base_url, auth_type, credentials_encrypted, enabled, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            req.user.companyId,
            storeIdValue,
            name.trim(),
            providerName ?? provider_name ?? null,
            integrationType ?? integration_type ?? "generic",
            url,
            auth,
            encryptCredentials(credentials ?? null),
            enabled !== false,
            req.user.id,
          ]
        );
        const row = result.rows[0];
        await writeAudit(req.user.companyId, req.user.id, "integration_created", "integration_connection", row.id, {
          name: row.name,
          authType: row.auth_type,
        });
        res.status(201).json({ success: true, data: toPublicIntegration(row) });
      } catch (error) {
        console.error("Create integration error:", error);
        res.status(500).json({ success: false, message: "Unable to create integration" });
      }
    }
  );

  // Update integration (fields + optional credential replacement).
  router.put(
    "/integrations/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const existing = await loadIntegration(req.params.id, req.user.companyId);
        if (!existing) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }

        const {
          name,
          providerName,
          provider_name,
          integrationType,
          integration_type,
          baseUrl,
          base_url,
          authType,
          auth_type,
          credentials,
          enabled,
        } = req.body || {};

        const updates = [];
        const params = [];
        const set = (column, value) => {
          params.push(value);
          updates.push(`${column} = $${params.length}`);
        };

        if (name !== undefined) {
          if (!String(name).trim()) {
            return res.status(400).json({ success: false, message: "Name cannot be empty" });
          }
          set("name", String(name).trim());
        }
        if (providerName ?? provider_name) set("provider_name", providerName ?? provider_name);
        if (integrationType ?? integration_type) {
          set("integration_type", integrationType ?? integration_type);
        }
        if (baseUrl ?? base_url) {
          const url = baseUrl ?? base_url;
          if (!isHttpsUrl(url)) {
            return res.status(400).json({ success: false, message: "baseUrl must be a valid http(s) URL" });
          }
          if (!isAllowedTarget(url)) {
            return res.status(400).json({ success: false, message: "baseUrl host is not allowed" });
          }
          set("base_url", url);
        }
        if (authType ?? auth_type) {
          const auth = authType ?? auth_type;
          if (!AUTH_TYPES.includes(auth)) {
            return res
              .status(400)
              .json({ success: false, message: `authType must be one of: ${AUTH_TYPES.join(", ")}` });
          }
          set("auth_type", auth);
        }
        if (credentials !== undefined) {
          set("credentials_encrypted", encryptCredentials(credentials ?? null));
        }
        if (enabled !== undefined) set("enabled", Boolean(enabled));

        if (updates.length === 0) {
          return res.json({ success: true, data: toPublicIntegration(existing) });
        }

        updates.push(`updated_at = NOW()`);
        params.push(existing.id);
        const result = await db(
          `UPDATE integration_connections SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params
        );
        await writeAudit(req.user.companyId, req.user.id, "integration_updated", "integration_connection", existing.id, {
          fields: updates.filter((u) => !u.startsWith("credentials")).map((u) => u.split(" ")[0]),
          credentialsReplaced: credentials !== undefined,
        });
        res.json({ success: true, data: toPublicIntegration(result.rows[0]) });
      } catch (error) {
        console.error("Update integration error:", error);
        res.status(500).json({ success: false, message: "Unable to update integration" });
      }
    }
  );

  // Enable / disable integration.
  router.patch(
    "/integrations/:id/enabled",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const { enabled } = req.body || {};
        if (typeof enabled !== "boolean") {
          return res.status(400).json({ success: false, message: "enabled must be a boolean" });
        }
        const result = await db(
          `UPDATE integration_connections SET enabled = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3 RETURNING *`,
          [enabled, req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        await writeAudit(req.user.companyId, req.user.id, "integration_enabled_changed", "integration_connection", req.params.id, { enabled });
        res.json({ success: true, data: toPublicIntegration(result.rows[0]) });
      } catch (error) {
        console.error("Toggle integration error:", error);
        res.status(500).json({ success: false, message: "Unable to update integration" });
      }
    }
  );

  // Delete integration (cascades endpoints, mappings, logs).
  router.delete(
    "/integrations/:id",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const result = await db(
          `DELETE FROM integration_connections WHERE id = $1 AND company_id = $2 RETURNING id`,
          [req.params.id, req.user.companyId]
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        await writeAudit(req.user.companyId, req.user.id, "integration_deleted", "integration_connection", req.params.id, {});
        res.json({ success: true, message: "Integration deleted" });
      } catch (error) {
        console.error("Delete integration error:", error);
        res.status(500).json({ success: false, message: "Unable to delete integration" });
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * Endpoints                                                          *
   * ------------------------------------------------------------------ */

  // List endpoints for an integration.
  router.get(
    "/integrations/:id/endpoints",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const result = await db(
          `SELECT id, integration_id, name, method, path, entity_type, enabled, created_at, updated_at
           FROM integration_endpoints WHERE integration_id = $1 ORDER BY created_at ASC`,
          [integration.id]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("List endpoints error:", error);
        res.status(500).json({ success: false, message: "Unable to list endpoints" });
      }
    }
  );

  // Add endpoint.
  router.post(
    "/integrations/:id/endpoints",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const { name, method = "POST", path, entityType, entity_type, enabled } = req.body || {};
        if (!name || !String(name).trim() || !path || !String(path).trim()) {
          return res.status(400).json({ success: false, message: "name and path are required" });
        }
        if (!HTTP_METHODS.includes(String(method).toUpperCase())) {
          return res.status(400).json({ success: false, message: `method must be one of: ${HTTP_METHODS.join(", ")}` });
        }
        const entity = entityType ?? entity_type ?? "sale";
        if (!ENTITY_TYPES.includes(entity)) {
          return res.status(400).json({ success: false, message: `entityType must be one of: ${ENTITY_TYPES.join(", ")}` });
        }
        const result = await db(
          `INSERT INTO integration_endpoints (integration_id, name, method, path, entity_type, enabled)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [integration.id, String(name).trim(), String(method).toUpperCase(), String(path).trim(), entity, enabled !== false]
        );
        await writeAudit(req.user.companyId, req.user.id, "integration_endpoint_created", "integration_endpoint", result.rows[0].id, {
          integrationId: integration.id,
          name: result.rows[0].name,
        });
        res.status(201).json({ success: true, data: result.rows[0] });
      } catch (error) {
        console.error("Create endpoint error:", error);
        res.status(500).json({ success: false, message: "Unable to create endpoint" });
      }
    }
  );

  // Update endpoint.
  router.put(
    "/integrations/:id/endpoints/:endpointId",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const endpoint = await loadEndpoint(req.params.endpointId, req.user.companyId);
        if (!endpoint || endpoint.integration_id !== integration.id) {
          return res.status(404).json({ success: false, message: "Endpoint not found" });
        }
        const { name, method, path, entityType, entity_type, enabled } = req.body || {};
        const updates = [];
        const params = [];
        const set = (column, value) => {
          params.push(value);
          updates.push(`${column} = $${params.length}`);
        };
        if (name !== undefined) {
          if (!String(name).trim()) return res.status(400).json({ success: false, message: "name cannot be empty" });
          set("name", String(name).trim());
        }
        if (method !== undefined) {
          if (!HTTP_METHODS.includes(String(method).toUpperCase())) {
            return res.status(400).json({ success: false, message: `method must be one of: ${HTTP_METHODS.join(", ")}` });
          }
          set("method", String(method).toUpperCase());
        }
        if (path !== undefined) {
          if (!String(path).trim()) return res.status(400).json({ success: false, message: "path cannot be empty" });
          set("path", String(path).trim());
        }
        if (entityType ?? entity_type) {
          const entity = entityType ?? entity_type;
          if (!ENTITY_TYPES.includes(entity)) {
            return res.status(400).json({ success: false, message: `entityType must be one of: ${ENTITY_TYPES.join(", ")}` });
          }
          set("entity_type", entity);
        }
        if (enabled !== undefined) set("enabled", Boolean(enabled));
        if (updates.length === 0) {
          return res.json({ success: true, data: endpoint });
        }
        updates.push(`updated_at = NOW()`);
        params.push(endpoint.id);
        const result = await db(
          `UPDATE integration_endpoints SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`,
          params
        );
        res.json({ success: true, data: result.rows[0] });
      } catch (error) {
        console.error("Update endpoint error:", error);
        res.status(500).json({ success: false, message: "Unable to update endpoint" });
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * Field mappings                                                     *
   * ------------------------------------------------------------------ */

  // List mappings for an endpoint (ordered).
  router.get(
    "/integrations/:id/endpoints/:endpointId/mappings",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const endpoint = await loadEndpoint(req.params.endpointId, req.user.companyId);
        if (!endpoint || endpoint.integration_id !== req.params.id) {
          return res.status(404).json({ success: false, message: "Endpoint not found" });
        }
        const result = await db(
          `SELECT id, endpoint_id, partner_field_path, onepos_source_path, mapping_type, static_value, display_order, created_at, updated_at
           FROM integration_field_mappings WHERE endpoint_id = $1 ORDER BY display_order ASC, created_at ASC`,
          [endpoint.id]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("List mappings error:", error);
        res.status(500).json({ success: false, message: "Unable to list field mappings" });
      }
    }
  );

  // Replace the full mapping set for an endpoint (simple upsert semantics).
  router.put(
    "/integrations/:id/endpoints/:endpointId/mappings",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const endpoint = await loadEndpoint(req.params.endpointId, req.user.companyId);
        if (!endpoint || endpoint.integration_id !== req.params.id) {
          return res.status(404).json({ success: false, message: "Endpoint not found" });
        }
        const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : null;
        if (!mappings) {
          return res.status(400).json({ success: false, message: "mappings array is required" });
        }
        for (const [index, mapping] of mappings.entries()) {
          const partnerField = mapping.partnerFieldPath ?? mapping.partner_field_path;
          const type = mapping.mappingType ?? mapping.mapping_type ?? "direct";
          if (!partnerField || !String(partnerField).trim()) {
            return res.status(400).json({ success: false, message: `mappings[${index}].partnerFieldPath is required` });
          }
          if (!MAPPING_TYPES.includes(type)) {
            return res.status(400).json({ success: false, message: `mappings[${index}].mappingType must be one of: ${MAPPING_TYPES.join(", ")}` });
          }
          if (type === "direct" && !(mapping.oneposSourcePath ?? mapping.onepos_source_path)) {
            return res.status(400).json({ success: false, message: `mappings[${index}] requires oneposSourcePath for direct mappings` });
          }
          if (type !== "direct" && mapping.staticValue === undefined && mapping.static_value === undefined) {
            return res.status(400).json({ success: false, message: `mappings[${index}] requires staticValue for ${type} mappings` });
          }
        }

        // Atomic replace inside a transaction when a pool is available.
        const client = pool ? await pool.connect() : null;
        if (!client) {
          // Fallback: delete-then-insert without transaction (non-fatal ordering).
          await db(`DELETE FROM integration_field_mappings WHERE endpoint_id = $1`, [endpoint.id]);
          for (const [index, mapping] of mappings.entries()) {
            await db(
              `INSERT INTO integration_field_mappings
                 (endpoint_id, partner_field_path, onepos_source_path, mapping_type, static_value, display_order)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                endpoint.id,
                mapping.partnerFieldPath ?? mapping.partner_field_path,
                mapping.oneposSourcePath ?? mapping.onepos_source_path ?? null,
                mapping.mappingType ?? mapping.mapping_type ?? "direct",
                mapping.staticValue ?? mapping.static_value ?? null,
                mapping.displayOrder ?? mapping.display_order ?? index,
              ]
            );
          }
          const result = await db(
            `SELECT id, endpoint_id, partner_field_path, onepos_source_path, mapping_type, static_value, display_order, created_at, updated_at
             FROM integration_field_mappings WHERE endpoint_id = $1 ORDER BY display_order ASC, created_at ASC`,
            [endpoint.id]
          );
          return res.json({ success: true, data: result.rows });
        }

        try {
          await client.query("BEGIN");
          await client.query(`DELETE FROM integration_field_mappings WHERE endpoint_id = $1`, [endpoint.id]);
          for (const [index, mapping] of mappings.entries()) {
            await client.query(
              `INSERT INTO integration_field_mappings
                 (endpoint_id, partner_field_path, onepos_source_path, mapping_type, static_value, display_order)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [
                endpoint.id,
                mapping.partnerFieldPath ?? mapping.partner_field_path,
                mapping.oneposSourcePath ?? mapping.onepos_source_path ?? null,
                mapping.mappingType ?? mapping.mapping_type ?? "direct",
                mapping.staticValue ?? mapping.static_value ?? null,
                mapping.displayOrder ?? mapping.display_order ?? index,
              ]
            );
          }
          await client.query("COMMIT");
        } catch (txError) {
          await client.query("ROLLBACK").catch(() => {});
          throw txError;
        } finally {
          client.release();
        }
        const result = await db(
          `SELECT id, endpoint_id, partner_field_path, onepos_source_path, mapping_type, static_value, display_order, created_at, updated_at
           FROM integration_field_mappings WHERE endpoint_id = $1 ORDER BY display_order ASC, created_at ASC`,
          [endpoint.id]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Replace mappings error:", error);
        res.status(500).json({ success: false, message: "Unable to save field mappings" });
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * API logs                                                           *
   * ------------------------------------------------------------------ */

  // List / filter API logs (company-scoped, integration/endpoint/date/status filters).
  router.get(
    "/integrations/:id/logs",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const params = [integration.id, req.user.companyId];
        let sql = `SELECT * FROM integration_api_logs WHERE integration_id = $1 AND company_id = $2`;
        if (req.query.endpointId) {
          params.push(req.query.endpointId);
          sql += ` AND endpoint_id = $${params.length}`;
        }
        if (req.query.success === "true" || req.query.success === "false") {
          params.push(req.query.success === "true");
          sql += ` AND success = $${params.length}`;
        }
        if (req.query.entityType) {
          params.push(req.query.entityType);
          sql += ` AND entity_type = $${params.length}`;
        }
        if (req.query.since) {
          params.push(req.query.since);
          sql += ` AND created_at >= $${params.length}`;
        }
        if (req.query.until) {
          params.push(req.query.until);
          sql += ` AND created_at <= $${params.length}`;
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const result = await db(sql, params);
        res.json({ success: true, data: result.rows, limit, offset });
      } catch (error) {
        console.error("List integration logs error:", error);
        res.status(500).json({ success: false, message: "Unable to list integration logs" });
      }
    }
  );

  /* ------------------------------------------------------------------ *
   * Generic Test Connection / Test Endpoint                            *
   * ------------------------------------------------------------------ */

  async function performTestRequest({ integration, endpoint, sampleData, correlationId }) {
    const startedAt = Date.now();
    const baseUrl = (endpoint?.path?.startsWith("http") ? endpoint.path : integration.base_url) || "";
    const fullPath = endpoint?.path?.startsWith("http") ? "" : endpoint?.path || "";
    const url = endpoint ? `${baseUrl.replace(/\/+$/, "")}${fullPath}` : baseUrl;

    if (!url) {
      return { ok: false, status: 0, error: "No base URL configured", logId: null };
    }
    if (!isAllowedTarget(url)) {
      return { ok: false, status: 0, error: "Target host is not allowed", logId: null };
    }

    // Build auth material from the decrypted credentials.
    let credentials = null;
    try {
      credentials = decryptCredentials(integration.credentials_encrypted);
    } catch {
      credentials = null;
    }
    const headers = { Accept: "application/json" };
    let authHeader = null;
    const authType = integration.auth_type;
    /* authHeader is merged into `headers` for the outbound request below;
       logs always receive the redacted copy. */

    if (authType === "bearer" && credentials?.token) {
      authHeader = `Bearer ${credentials.token}`;
    } else if (authType === "api_key") {
      const key = credentials?.apiKey ?? credentials?.api_key ?? credentials?.key;
      if (key) {
        const headerName = credentials?.headerName || credentials?.header_name || "X-API-Key";
        headers[headerName] = key;
      }
      if (credentials?.username && credentials?.password) {
        authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
      }
    } else if (authType === "basic" && credentials?.username && credentials?.password) {
      authHeader = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
    }
    if (authHeader) headers.Authorization = authHeader;

    // For endpoint tests, build a payload from field mappings when sample data is supplied.
    let body = null;
    if (endpoint && sampleData && ["POST", "PUT", "PATCH"].includes(String(endpoint.method || "GET").toUpperCase())) {
      const mappingsResult = await db(
        `SELECT partner_field_path, onepos_source_path, mapping_type, static_value
         FROM integration_field_mappings WHERE endpoint_id = $1 ORDER BY display_order ASC`,
        [endpoint.id]
      );
      const { payload } = buildPayload(mappingsResult.rows, sampleData);
      body = JSON.stringify(payload);
      headers["Content-Type"] = "application/json";
    } else if (endpoint && ["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      body = JSON.stringify(sampleData ?? {});
      headers["Content-Type"] = "application/json";
    }

    const requestLog = redactRequestConfig({
      method: endpoint?.method || "GET",
      url,
      headers,
      body,
      authType,
    });

    let responseStatus = null;
    let responseHeaders = null;
    let responseBody = null;
    let success = false;
    let errorMessage = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, {
        method: endpoint?.method || "GET",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      responseStatus = response.status;
      responseHeaders = redactHeadersForLog(Object.fromEntries(response.headers.entries()));
      const text = await response.text();
      responseBody = redactBodyForLog(text.slice(0, LOG_BODY_LIMIT));
      success = response.status >= 200 && response.status < 300;
      if (!success) {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (error) {
      errorMessage = error?.name === "AbortError" ? "Request timed out (15s)" : error?.message || "Request failed";
    }

    const durationMs = Date.now() - startedAt;

    // Persist the log row (redacted) - always, success or failure.
    let logId = null;
    try {
      const logResult = await db(
        `INSERT INTO integration_api_logs
           (integration_id, endpoint_id, company_id, store_id, entity_type, entity_id,
            correlation_id, method, url, request_headers, request_body,
            response_status, response_headers, response_body, duration_ms, success, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [
          integration.id,
          endpoint?.id ?? null,
          integration.company_id,
          integration.store_id,
          endpoint?.entity_type ?? "custom",
          null,
          correlationId,
          requestLog.method,
          requestLog.url,
          JSON.stringify(requestLog.headers),
          requestLog.body,
          responseStatus,
          responseHeaders ? JSON.stringify(responseHeaders) : null,
          responseBody,
          durationMs,
          success,
          errorMessage,
        ]
      );
      logId = logResult.rows[0].id;
    } catch (logError) {
      console.error("Integration log write failed:", logError.message);
    }

    return { ok: success, status: responseStatus, error: errorMessage, logId, durationMs };
  }

  // Test Connection: authenticated GET (or configured probe) against base_url.
  router.post(
    "/integrations/:id/test-connection",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const correlationId = crypto.randomUUID();
        const result = await performTestRequest({ integration, endpoint: null, correlationId });
        await writeAudit(req.user.companyId, req.user.id, "integration_test_connection", "integration_connection", integration.id, {
          success: result.ok,
          status: result.status,
          correlationId,
        });
        res.json({
          success: true,
          data: {
            ok: result.ok,
            status: result.status,
            error: result.error,
            durationMs: result.durationMs,
            logId: result.logId,
            correlationId,
          },
        });
      } catch (error) {
        console.error("Test connection error:", error);
        res.status(500).json({ success: false, message: "Unable to run connection test" });
      }
    }
  );

  // Test Endpoint: builds a payload from mappings (sample data supplied by caller) and performs the request.
  router.post(
    "/integrations/:id/endpoints/:endpointId/test",
    authenticate,
    authorize("integration.manage"),
    async (req, res) => {
      try {
        const integration = await loadIntegration(req.params.id, req.user.companyId);
        if (!integration) {
          return res.status(404).json({ success: false, message: "Integration not found" });
        }
        const endpoint = await loadEndpoint(req.params.endpointId, req.user.companyId);
        if (!endpoint || endpoint.integration_id !== integration.id) {
          return res.status(404).json({ success: false, message: "Endpoint not found" });
        }
        const correlationId = crypto.randomUUID();
        const result = await performTestRequest({
          integration,
          endpoint,
          sampleData: req.body?.sampleData ?? null,
          correlationId,
        });
        await writeAudit(req.user.companyId, req.user.id, "integration_test_endpoint", "integration_endpoint", endpoint.id, {
          success: result.ok,
          status: result.status,
          correlationId,
        });
        res.json({
          success: true,
          data: {
            ok: result.ok,
            status: result.status,
            error: result.error,
            durationMs: result.durationMs,
            logId: result.logId,
            correlationId,
          },
        });
      } catch (error) {
        console.error("Test endpoint error:", error);
        res.status(500).json({ success: false, message: "Unable to run endpoint test" });
      }
    }
  );

  return router;
}
