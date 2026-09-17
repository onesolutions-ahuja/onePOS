/*
 * T9G - generic integration dispatcher (backend).
 *
 * Bridges onePOS business events (sale created, purchase created/received,
 * returns) to configured integration endpoints WITHOUT coupling business
 * routes to any provider:
 *
 *   business transaction commits
 *     -> dispatchIntegrationEvent(event, ...)
 *       -> find enabled integrations + endpoints for the event
 *       -> load the onePOS entity (company/store scoped)
 *       -> build the partner payload (existing resolver/builder + catalogue paths)
 *       -> POST with stored (decrypted) credentials
 *       -> redacted row in integration_api_logs
 *
 * Guarantees:
 *  - never throws: the business operation (sale/purchase/return) must succeed
 *    even if every partner API is down; delivery is fire-and-forget async
 *  - never exposes credentials: log rows + status contract carry redacted data
 *  - never crosses tenants: every query is company-scoped (store when provided)
 *  - no provider names anywhere: pure generic endpoint + mapping config
 *
 * Frontend-ready status contract (getIntegrationDispatchStatus):
 *   [{ integrationId, integrationName, providerName, connected, authType,
 *      endpointId, endpointName, event, entityType, enabled, lastAttemptAt,
 *      lastSuccessAt, lastFailureAt, lastHttpStatus, lastErrorMessage,
 *      lastCorrelationId, totalAttempts, successCount, failureCount }]
 */
import crypto from "crypto";
import {
  decryptCredentials,
  redactHeadersForLog,
  redactBodyForLog,
} from "./integrationCredentials.js";
import { buildPayload } from "./integrationFieldResolver.js";

export const INTEGRATION_EVENTS = {
  SALE_CREATED: "SALE_CREATED",
  PURCHASE_CREATED: "PURCHASE_CREATED",
  PURCHASE_RECEIVED: "PURCHASE_RECEIVED",
  SALES_RETURN_CREATED: "SALES_RETURN_CREATED",
};

const EVENT_ENDPOINT_TYPES = {
  SALE_CREATED: ["sale"],
  PURCHASE_CREATED: ["purchase"],
  PURCHASE_RECEIVED: ["purchase"],
  /* Returns must be configured as dedicated "custom" endpoints - a 1:1
     event->endpoint-type mapping prevents surprise duplicate deliveries to
     sale endpoints. */
  SALES_RETURN_CREATED: ["custom"],
};

const LOG_BODY_LIMIT = 20000;
const FETCH_TIMEOUT_MS = 12000;

/* ------------------------------------------------------------------ */
/* Entity loading (company/store scoped)                               */
/* ------------------------------------------------------------------ */

async function loadSaleEntity(db, { companyId, storeId, entityId }) {
  const params = [entityId, companyId];
  let storeClause = "";
  if (storeId) {
    params.push(storeId);
    storeClause = `AND s.store_id = $${params.length}`;
  }
  const sale = await db(
    `SELECT s.id, s.company_id, s.store_id, s.customer_id, s.receipt_number, s.subtotal, s.tax,
            s.discount, s.total, s.status, s.created_at, s.completed_at,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
            c.address AS customer_address, c.postcode AS customer_postcode
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = $1 AND s.company_id = $2 ${storeClause}`,
    params
  );
  if (!sale.rows.length) return null;
  const row = sale.rows[0];
  const items = await db(
    `SELECT si.product_id, si.product_name, si.quantity, si.unit_price, si.discount, si.tax, si.total,
            p.sku, p.barcode
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id ASC`,
    [entityId]
  );
  /*
   * Shape matches the T9E field catalogue exactly:
   * sales.sale_id, sales.customer.name, sales.customer.address.postcode,
   * sales.items[].product.ean, ...
   */
  return {
    sales: {
      sale_id: row.id,
      store_id: row.store_id,
      receipt_number: row.receipt_number,
      subtotal: Number(row.subtotal),
      tax: Number(row.tax),
      discount: Number(row.discount),
      total: Number(row.total),
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      customer: row.customer_name
        ? {
            id: row.customer_id ?? null,
            name: row.customer_name,
            email: row.customer_email,
            phone: row.customer_phone,
            address: { postcode: row.customer_postcode, line1: row.customer_address },
            postcode: row.customer_postcode,
          }
        : null,
      items: items.rows.map((item) => ({
        product_id: item.product_id,
        name: item.product_name,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount: Number(item.discount),
        tax: Number(item.tax),
        total: Number(item.total),
        product: { sku: item.sku, ean: item.barcode, barcode: item.barcode },
      })),
    },
  };
}

async function loadPurchaseEntity(db, { companyId, storeId, entityId }) {
  const params = [entityId, companyId];
  let storeClause = "";
  if (storeId) {
    params.push(storeId);
    storeClause = `AND p.store_id = $${params.length}`;
  }
  const purchase = await db(
    `SELECT p.id, p.company_id, p.store_id, p.supplier_id, p.reference_number, p.purchase_date,
            p.status, p.subtotal, p.total, p.supplier_name, p.created_at,
            sup.name AS supplier_contact_name
     FROM purchases p
     LEFT JOIN suppliers sup ON sup.id = p.supplier_id
     WHERE p.id = $1 AND p.company_id = $2 ${storeClause}`,
    params
  );
  if (!purchase.rows.length) return null;
  const row = purchase.rows[0];
  const items = await db(
    `SELECT pi.quantity, pi.unit_cost, pi.line_total,
            pr.id AS product_id, pr.name, pr.sku, pr.barcode
     FROM purchase_items pi
     INNER JOIN products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = $1
     ORDER BY pr.name ASC`,
    [entityId]
  );
  /* Shape matches the catalogue: purchase.reference_number, purchase.supplier.name,
   * purchase.items[].product.ean, ... */
  return {
    purchase: {
      purchase_id: row.id,
      store_id: row.store_id,
      reference_number: row.reference_number,
      purchase_date: row.purchase_date,
      status: row.status,
      subtotal: Number(row.subtotal),
      total: Number(row.total),
      created_at: row.created_at,
      supplier: {
        id: row.supplier_id,
        name: row.supplier_name || null,
      },
      items: items.rows.map((item) => ({
        quantity: Number(item.quantity),
        unit_cost: Number(item.unit_cost),
        total: Number(item.line_total),
        product: {
          id: item.product_id,
          name: item.name,
          sku: item.sku,
          ean: item.barcode,
          barcode: item.barcode,
        },
      })),
    },
  };
}

async function loadReturnEntity(db, { companyId, storeId, entityId }) {
  const params = [entityId, companyId];
  let storeClause = "";
  if (storeId) {
    params.push(storeId);
    storeClause = `AND sr.store_id = $${params.length}`;
  }
  const ret = await db(
    `SELECT sr.id, sr.company_id, sr.store_id, sr.return_type, sr.sale_id, sr.purchase_id,
            sr.reason, sr.created_at,
            s.receipt_number AS sale_receipt_number, s.total AS sale_total,
            p.reference_number AS purchase_reference, p.supplier_name,
            COALESCE(refund.total, 0) AS refund_total
     FROM stock_returns sr
     LEFT JOIN sales s ON s.id = sr.sale_id
     LEFT JOIN purchases p ON p.id = sr.purchase_id
     LEFT JOIN (
       SELECT sale_id, SUM(amount) AS total FROM refunds GROUP BY sale_id
     ) refund ON refund.sale_id = sr.sale_id
     WHERE sr.id = $1 AND sr.company_id = $2 ${storeClause}`,
    params
  );
  if (!ret.rows.length) return null;
  const row = ret.rows[0];
  const items = await db(
    `SELECT sri.quantity, sri.reason,
            pr.id AS product_id, pr.name, pr.sku, pr.barcode
     FROM stock_return_items sri
     INNER JOIN products pr ON pr.id = sri.product_id
     WHERE sri.return_id = $1`,
    [entityId]
  );
  /* Shape matches the catalogue: return.receipt_number, return.items[].product.ean, ... */
  return {
    return: {
      return_id: row.id,
      return_type: row.return_type,
      sale_id: row.sale_id,
      purchase_id: row.purchase_id,
      receipt_number: row.sale_receipt_number,
      purchase_reference: row.purchase_reference,
      supplier_name: row.supplier_name,
      reason: row.reason,
      refund_total: Number(row.refund_total) || 0,
      created_at: row.created_at,
      items: items.rows.map((item) => ({
        quantity: Number(item.quantity),
        reason: item.reason,
        product: {
          id: item.product_id,
          name: item.name,
          sku: item.sku,
          ean: item.barcode,
          barcode: item.barcode,
        },
      })),
    },
  };
}

const ENTITY_LOADERS = {
  SALE_CREATED: (db, ctx) => loadSaleEntity(db, ctx),
  PURCHASE_CREATED: (db, ctx) => loadPurchaseEntity(db, ctx),
  PURCHASE_RECEIVED: (db, ctx) => loadPurchaseEntity(db, ctx),
  SALES_RETURN_CREATED: (db, ctx) => loadReturnEntity(db, ctx),
};

const ENTITY_TYPE_BY_EVENT = {
  SALE_CREATED: "sale",
  PURCHASE_CREATED: "purchase",
  PURCHASE_RECEIVED: "purchase",
  SALES_RETURN_CREATED: "sale",
};

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

function buildAuth({ authType, credentials, headers }) {
  let authHeader = null;
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
  return authHeader;
}

async function writeDispatchLog(db, entry) {
  try {
    const result = await db(
      `INSERT INTO integration_api_logs
         (integration_id, endpoint_id, company_id, store_id, entity_type, entity_id,
          correlation_id, method, url, request_headers, request_body,
          response_status, response_headers, response_body, duration_ms, success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        entry.integrationId, entry.endpointId ?? null, entry.companyId, entry.storeId ?? null,
        entry.entityType, entry.entityId, entry.correlationId, entry.method, entry.url,
        entry.requestHeaders, entry.requestBody, entry.responseStatus ?? null,
        entry.responseHeaders ?? null, entry.responseBody ?? null, entry.durationMs ?? null,
        entry.success, entry.errorMessage ?? null,
      ]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error("Integration dispatch log write failed:", error.message);
    return null;
  }
}

async function deliverToEndpoint(db, { integration, endpoint, mappings, entityData, context }) {
  const startedAt = Date.now();
  const correlationId = crypto.randomUUID();
  const entityType = ENTITY_TYPE_BY_EVENT[context.event] || "custom";

  const url = `${String(integration.base_url || "").replace(/\/+$/, "")}${endpoint.path}`;
  const method = String(endpoint.method || "POST").toUpperCase();
  const headers = { Accept: "application/json", "Content-Type": "application/json" };

  // Resolve payload; a mapping failure must never crash the dispatch.
  let payload;
  let buildError = null;
  try {
    payload = buildPayload(mappings, entityData).payload;
  } catch (error) {
    buildError = `Payload build failed: ${error.message}`;
    payload = null;
  }

  // Credentials are decrypted only here and never logged.
  let credentials = null;
  try {
    credentials = decryptCredentials(integration.credentials_encrypted);
  } catch {
    credentials = null;
  }
  const authHeader = buildAuth({ authType: integration.auth_type, credentials, headers });
  // The outbound request itself must carry the auth header (not just the log).
  if (authHeader) headers.Authorization = authHeader;

  const redactedRequestHeaders = redactHeadersForLog(headers);
  const requestBody = payload !== null ? JSON.stringify(payload) : null;

  let responseStatus = null;
  let responseHeaders = null;
  let responseBody = null;
  let success = false;
  let errorMessage = buildError;

  if (!errorMessage) {
    if (!integration.base_url || !/^(https?):\/\//i.test(url)) {
      errorMessage = "Integration has no valid base URL";
    } else {
      try {
        /*
         * Watchdog race: a wedged socket must never leave a dispatch without
         * a log row. The fetch's own AbortController is the primary timeout;
         * the watchdog guarantees resolution shortly after it.
         */
        const attempt = (async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          try {
            const response = await fetch(url, {
              method,
              headers,
              body: method === "GET" || method === "DELETE" ? undefined : requestBody,
              signal: controller.signal,
            });
            const text = await response.text();
            return { response, text };
          } finally {
            clearTimeout(timeout);
          }
        })();
        const watchdog = new Promise((resolve) =>
          setTimeout(() => resolve(null), FETCH_TIMEOUT_MS + 5000)
        );
        const outcome = await Promise.race([attempt, watchdog]);
        if (!outcome) {
          errorMessage = "Delivery did not complete (watchdog)";
        } else {
          const { response, text } = outcome;
          responseStatus = response.status;
          responseHeaders = redactHeadersForLog(Object.fromEntries(response.headers.entries()));
          responseBody = redactBodyForLog(text.slice(0, LOG_BODY_LIMIT));
          success = response.status >= 200 && response.status < 300;
          if (!success) errorMessage = `HTTP ${response.status}`;
        }
      } catch (error) {
        errorMessage =
          error?.name === "AbortError"
            ? `Request timed out (${Math.round(FETCH_TIMEOUT_MS / 1000)}s)`
            : error?.message || "Request failed";
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  const logId = await writeDispatchLog(db, {
    integrationId: integration.id,
    endpointId: endpoint.id,
    companyId: context.companyId,
    storeId: context.storeId ?? integration.store_id ?? null,
    entityType,
    entityId: context.entityId,
    correlationId,
    method,
    url,
    requestHeaders: JSON.stringify(redactedRequestHeaders),
    requestBody,
    responseStatus,
    responseHeaders: responseHeaders ? JSON.stringify(responseHeaders) : null,
    responseBody,
    durationMs,
    success,
    errorMessage,
  });

  return { success, status: responseStatus, error: errorMessage, correlationId, logId, durationMs };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fire-and-forget event dispatch. NEVER throws and NEVER blocks the caller:
 * the business route calls this after its transaction has committed.
 *
 * @param {object} args
 * @param {string} args.event one of INTEGRATION_EVENTS
 * @param {{db: function}} args.deps injected { db }
 * @param {{companyId: string, storeId?: string|null}} args.context tenant context
 * @param {string} args.entityId the sale/purchase/return id
 * @returns {Promise<{dispatched: number}>} count of dispatches started
 */
export async function dispatchIntegrationEvent({ event, deps, context, entityId }) {
  const { db } = deps || {};
  if (!db || !event || !context?.companyId || !entityId) return { dispatched: 0 };
  if (!ENTITY_LOADERS[event]) return { dispatched: 0 };

  // Resolve outside the async chain so route handlers get a cheap synchronous
  // answer; actual delivery continues in the background either way.
  try {
    const allowedTypes = EVENT_ENDPOINT_TYPES[event];
    const typePlaceholders = allowedTypes.map((_, i) => `$${i + 2}`).join(", ");
    const params = [context.companyId, ...allowedTypes];
    let storeClause = "";
    if (context.storeId) {
      params.push(context.storeId);
      storeClause = `AND (c.store_id IS NULL OR c.store_id = $${params.length})`;
    }
    const result = await db(
      `SELECT c.id, c.store_id, c.name, c.provider_name, c.base_url, c.auth_type,
              c.credentials_encrypted,
              e.id AS endpoint_id, e.name AS endpoint_name, e.method, e.path, e.entity_type
       FROM integration_connections c
       INNER JOIN integration_endpoints e ON e.integration_id = c.id AND e.enabled = TRUE
       WHERE c.company_id = $1
         AND c.enabled = TRUE
         AND e.entity_type IN (${typePlaceholders})
         ${storeClause}`,
      params
    );
    if (!result.rows.length) return { dispatched: 0 };

    const entityData = await ENTITY_LOADERS[event](db, {
      companyId: context.companyId,
      storeId: context.storeId ?? null,
      entityId,
    });
    if (!entityData) return { dispatched: 0 };

    const rows = result.rows;
    let dispatched = 0;
    const deliveries = [];
    for (const row of rows) {
      // Delivered concurrently (one hanging partner must never delay another)
      // but still fire-and-forget from the caller's perspective.
      deliveries.push(
        (async () => {
          try {
            const mappingsResult = await db(
              `SELECT partner_field_path, onepos_source_path, mapping_type, static_value
               FROM integration_field_mappings
               WHERE endpoint_id = $1
               ORDER BY display_order ASC, created_at ASC`,
              [row.endpoint_id]
            );
            if (!mappingsResult.rows.length) return; // endpoint not configured yet
            await deliverToEndpoint(db, {
              integration: row,
              endpoint: { id: row.endpoint_id, name: row.endpoint_name, method: row.method, path: row.path },
              mappings: mappingsResult.rows,
              entityData,
              context: { event, companyId: context.companyId, storeId: context.storeId ?? null, entityId },
            });
          } catch (error) {
            console.error("Integration dispatch error:", error.message);
          }
        })()
      );
      dispatched += 1;
    }
    // Await inside the detached chain: the caller never waits, but unhandled
    // rejection is impossible and concurrent deliveries are all attempted.
    if (deliveries.length) await Promise.allSettled(deliveries).catch(() => {});
    return { dispatched };
  } catch (error) {
    // Absolute guarantee: dispatch problems never reach the business route.
    console.error("Integration dispatch setup error:", error.message);
    return { dispatched: 0 };
  }
}

/**
 * Status contract for the (future) frontend dispatch monitor.
 * One row per enabled event endpoint: connection, event, last attempt /
 * success / failure, HTTP status, error message and the trace (correlation)
 * ID of the most recent attempt. Credentials never appear.
 */
export async function getIntegrationDispatchStatus({ deps, companyId, storeId = null }) {
  const { db } = deps || {};
  if (!db || !companyId) return [];
  try {
    const params = [companyId];
    let storeClause = "";
    if (storeId) {
      params.push(storeId);
      storeClause = `AND (c.store_id IS NULL OR c.store_id = $${params.length})`;
    }
    const result = await db(
      `SELECT c.id AS integration_id, c.name AS integration_name, c.provider_name,
              c.auth_type, c.enabled AS integration_enabled, c.base_url,
              e.id AS endpoint_id, e.name AS endpoint_name, e.entity_type, e.enabled AS endpoint_enabled,
              last_log.created_at AS last_attempt_at,
              CASE WHEN last_log.success THEN last_log.created_at END AS last_success_at,
              CASE WHEN NOT last_log.success THEN last_log.created_at END AS last_failure_at,
              last_log.response_status AS last_http_status,
              last_log.error_message AS last_error_message,
              last_log.correlation_id AS last_correlation_id,
              agg.total_attempts, agg.success_count, agg.failure_count
       FROM integration_connections c
       INNER JOIN integration_endpoints e ON e.integration_id = c.id
       LEFT JOIN LATERAL (
         SELECT l.created_at, l.success, l.response_status, l.error_message, l.correlation_id
         FROM integration_api_logs l
         WHERE l.endpoint_id = e.id
         ORDER BY l.created_at DESC
         LIMIT 1
       ) last_log ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total_attempts,
                COUNT(*) FILTER (WHERE success)::int AS success_count,
                COUNT(*) FILTER (WHERE NOT success)::int AS failure_count
         FROM integration_api_logs l
         WHERE l.endpoint_id = e.id
       ) agg ON TRUE
       WHERE c.company_id = $1 ${storeClause}
       ORDER BY c.name ASC, e.name ASC`,
      params
    );
    return result.rows.map((row) => ({
      integrationId: row.integration_id,
      integrationName: row.integration_name,
      providerName: row.provider_name,
      connected: Boolean(row.base_url),
      authType: row.auth_type,
      endpointId: row.endpoint_id,
      endpointName: row.endpoint_name,
      event: Object.entries(EVENT_ENDPOINT_TYPES).find(([, types]) => types.includes(row.entity_type))?.[0] || null,
      entityType: row.entity_type,
      enabled: row.integration_enabled && row.endpoint_enabled,
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      lastHttpStatus: row.last_http_status,
      lastErrorMessage: row.last_error_message,
      lastCorrelationId: row.last_correlation_id,
      totalAttempts: row.total_attempts ?? 0,
      successCount: row.success_count ?? 0,
      failureCount: row.failure_count ?? 0,
    }));
  } catch (error) {
    console.error("Integration dispatch status error:", error.message);
    return [];
  }
}
