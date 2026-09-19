/*
 * T10V - Accounting Integration export routes.
 *
 * Completes the roadmap task by WIRING the existing, completed foundations
 * together (no second system created):
 *
 *   T10W  services/accountingExport.js         - provider-neutral normalizers
 *   T10X  services/accountingExportDispatch.js - idempotent dispatcher
 *   T9A   integration_connections              - connections + encrypted creds
 *
 * Endpoints (all company-scoped, all `accounting.export` gated):
 *
 *   GET  /api/accounting/integrations  - accounting connections for the company
 *   GET  /api/accounting/exportable    - recent sales with their export state
 *   POST /api/accounting/export/:id    - export ONE sale (idempotent, replayable)
 *   GET  /api/accounting/logs/:id      - the T9A API log for a connection
 *
 * Security guarantees:
 *   - companyId always comes from the AUTHENTICATED user, never the request;
 *     every query filters on it, so cross-company reads/exports are impossible;
 *   - the payload is built ONLY by the T10W normalizer (one shared shape);
 *   - the sale row is fetched company-scoped inside the export handler, so a
 *     guessed foreign sale id returns 404 like any other unknown sale;
 *   - export failures never mutate the sale - they only write a log row;
 *   - log rows pass through redactBodyForLog - no secrets in logs;
 *   - decrypted credentials never leave the process (only used for the
 *     outbound Authorization header, never returned or logged).
 */
import express from "express";
import { decryptCredentials, redactBodyForLog } from "../services/integrationCredentials.js";
import { idempotencyKey, createAccountingDispatcher } from "../services/accountingExportDispatch.js";
import { normalizeSale } from "../services/accountingExport.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* One round-trip: sale header + items (VAT identity joined from the product
 * master, the authoritative source) + payments. Shaped exactly for the T10W
 * normalizer - no second mapping layer. */
const SALE_COLUMNS = `
    s.id, s.company_id, s.store_id, s.receipt_number, s.created_at,
    s.subtotal, s.tax, s.discount, s.total, s.status, s.completed_at,
    s.online_order_id,
    COALESCE((SELECT json_agg(json_build_object(
                  'product_id', si.product_id, 'product_name', si.product_name,
                  'quantity', si.quantity, 'unit_price', si.unit_price,
                  'discount', si.discount, 'tax', si.tax, 'total', si.total,
                  'sku', p.sku, 'barcode', p.barcode,
                  'vat_rate', p.vat_rate, 'vat_applicable', p.vat_applicable)
                  ORDER BY si.id)
                FROM sale_items si
                LEFT JOIN products p ON p.id = si.product_id
               WHERE si.sale_id = s.id), '[]'::json) AS items,
    COALESCE((SELECT json_agg(json_build_object(
                  'payment_method', pm.payment_method, 'amount', pm.amount,
                  'provider_transaction_id', pm.provider_transaction_id)
                  ORDER BY pm.created_at)
                FROM payments pm
               WHERE pm.sale_id = s.id), '[]'::json) AS payments`;

export default function createAccountingExportRouter({
  authenticate,
  authorize,
  db,
  writeAudit,
}) {
  const router = express.Router();
  const guard = authorize("accounting.export");

  router.get(
    "/integrations",
    authenticate,
    guard,
    async (req, res) => {
      try {
        const { rows } = await db(
          `SELECT id, name, provider_name, integration_type, base_url,
                  auth_type, credentials_encrypted IS NOT NULL AS has_credentials,
                  enabled, created_at, updated_at
             FROM integration_connections
            WHERE company_id = $1
              AND integration_type ILIKE '%accounting%'
            ORDER BY enabled DESC, created_at ASC`,
          [req.user.companyId],
        );
        return res.json({
          data: rows.map((r) => ({
            id: r.id,
            name: r.name,
            provider: r.provider_name,
            integrationType: r.integration_type,
            baseUrl: r.base_url,
            authType: r.auth_type,
            hasCredentials: r.has_credentials,
            enabled: r.enabled,
          })),
        });
      } catch (err) {
        console.error("[T10V] list integrations failed:", err?.message);
        return res.status(500).json({ error: "Unable to load accounting integrations" });
      }
    },
  );

  router.get("/exportable", authenticate, guard, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
      const { rows } = await db(
        `SELECT s.id, s.receipt_number, s.created_at, s.total, s.vat,
                s.payment_method,
                (SELECT count(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count,
                EXISTS (SELECT 1 FROM integration_api_logs l
                         WHERE l.entity_type = 'sale' AND l.entity_id = s.id
                           AND l.success = TRUE) AS dispatched,
                (SELECT l.integration_id FROM integration_api_logs l
                  WHERE l.entity_type = 'sale' AND l.entity_id = s.id
                    AND l.success = TRUE
                  ORDER BY l.created_at DESC LIMIT 1) AS last_integration_id
           FROM sales s
          WHERE s.company_id = $1
            AND s.created_at >= NOW() - ($2 || ' days')::interval
          ORDER BY s.created_at DESC
          LIMIT 50`,
        [req.user.companyId, String(days)],
      );
      return res.json({
        data: rows.map((r) => ({
          id: r.id,
          receiptNumber: r.receipt_number,
          createdAt: r.created_at,
          total: Number(r.total),
          vat: Number(r.vat),
          paymentMethod: r.payment_method,
          itemCount: Number(r.item_count),
          dispatched: r.dispatched === true,
          lastIntegrationId: r.last_integration_id ?? null,
        })),
      });
    } catch (err) {
      console.error("[T10V] exportable list failed:", err?.message);
      return res.status(500).json({ error: "Unable to load exportable sales" });
    }
  });

  router.get("/logs/:integrationId", authenticate, guard, async (req, res) => {
    const integrationId = req.params.integrationId;
    if (!UUID_RE.test(integrationId)) {
      return res.status(400).json({ error: "Invalid integration id" });
    }
    try {
      /* Ownership check first: a foreign integration id is a plain 404. */
      const { rows: owned } = await db(
        `SELECT id FROM integration_connections
          WHERE id = $1 AND company_id = $2`,
        [integrationId, req.user.companyId],
      );
      if (owned.length === 0) {
        return res.status(404).json({ error: "Integration not found" });
      }
      const { rows: logRows } = await db(
        `SELECT id, entity_type, entity_id, method, url, response_status,
                duration_ms, success, error_message, created_at
           FROM integration_api_logs
          WHERE integration_id = $1 AND company_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [integrationId, req.user.companyId],
      );
      return res.json({ data: logRows });
    } catch (err) {
      console.error("[T10V] log fetch failed:", err?.message);
      return res.status(500).json({ error: "Unable to load export logs" });
    }
  });

  router.post("/export/:id", authenticate, guard, async (req, res) => {
    const saleId = req.params.id;
    const companyId = req.user.companyId;

    try {
      if (!UUID_RE.test(saleId)) {
        return res.status(404).json({ error: "Sale not found" });
      }

      /* Company-scoped fetch: a foreign sale id is indistinguishable from a
       * non-existent one (both 404) - no existence oracle across tenants. */
      const { rows: companySales } = await db(
        `SELECT ${SALE_COLUMNS} FROM sales s WHERE s.company_id = $1 AND s.id = $2`,
        [companyId, saleId],
      );
      if (companySales.length === 0) {
        return res.status(404).json({ error: "Sale not found" });
      }
      const sale = companySales[0];

      /* Re-check the connection at export time (it may have been disabled or
       * removed since the list was loaded). Only the caller's company. */
      const { rows: connectionRows } = await db(
        `SELECT id, name, provider_name, integration_type, base_url,
                auth_type, credentials_encrypted
           FROM integration_connections
          WHERE company_id = $1
            AND integration_type ILIKE '%accounting%'
            AND enabled = TRUE
          ORDER BY created_at ASC`,
        [companyId],
      );
      const connection = connectionRows[0];
      if (!connection) {
        return res.status(409).json({
          error:
            "No enabled accounting integration found. Add and enable one on the Integrations page first.",
        });
      }

      /* Idempotency (route level, DB-backed): an already-successful export of
       * this sale through THIS connection short-circuits to `duplicate` - the
       * provider never receives a second copy and nothing else is written. */
      const { rows: already } = await db(
        `SELECT 1 FROM integration_api_logs
          WHERE integration_id = $1 AND entity_type = 'sale'
            AND entity_id = $2 AND success = TRUE
          LIMIT 1`,
        [connection.id, saleId],
      );
      if (already.length > 0) {
        return res.json({
          status: "duplicate",
          integration: { id: connection.id, name: connection.name },
          message: "Already exported - no duplicate was created.",
        });
      }

      let credentials = null;
      if (connection.credentials_encrypted) {
        try {
          credentials = decryptCredentials(connection.credentials_encrypted);
        } catch {
          return res.status(500).json({ error: "Stored credentials are not readable" });
        }
      }

      /* T10W normalizer - the ONLY payload builder used by T10V. */
      const payload = normalizeSale(sale, sale.items ?? [], sale.payments ?? []);

      /* T10X dispatcher - adapter contract + structured, never-throw results.
       * The adapter returns {ok, error, externalReference} per T10X semantics. */
      const dispatcher = createAccountingDispatcher(
        {
          validateConfig: (conn) =>
            Boolean(conn && typeof conn.base_url === "string" && /^https?:\/\//i.test(conn.base_url)),
          exportSale: async () => postPayload(connection, credentials, payload),
        },
        connection,
      );

      const dispatchResult = dispatcher.dispatchSale(
        { source_type: "sale", source_id: saleId, ...payload },
        companyId,
        sale.store_id,
      );
      /* Async adapters come back as {status:'dispatched_async', promise} -
       * resolve it so the caller always sees the settled outcome. */
      const result = dispatchResult.promise
        ? await dispatchResult.promise
        : dispatchResult;

      /* The log row is awaited BEFORE responding - it backs the idempotency
       * gate, so it must never race the reply (a replay arriving a millisecond
       * later must already see the success row). */
      await writeExportLog(db, writeAudit, {
        connection,
        companyId,
        storeId: sale.store_id,
        saleId,
        userId: req.user.id,
        payload,
        result,
      });

      if (result.status === "dispatched") {
        return res.json({
          status: "exported",
          integration: { id: connection.id, name: connection.name },
          idempotencyKey: result.idempotencyKey,
          payloadSent: payload,
        });
      }
      if (result.status === "provider_not_configured") {
        return res.status(400).json({
          error:
            "The accounting connection has no valid endpoint URL configured.",
          integration: { id: connection.id, name: connection.name },
        });
      }
      /* provider_rejected | provider_error | invalid_record - downstream
       * failures: sale untouched, failure recorded in the log. */
      return res.status(502).json({
        status: result.status,
        error: result.error || "Accounting export failed",
        integration: { id: connection.id, name: connection.name },
      });
    } catch (err) {
      console.error("[T10V] export failed:", err?.message);
      return res.status(500).json({ error: "Accounting export failed" });
    }
  });

  return router;
}

/* Outbound POST of the T10W payload using the connection's stored auth
 * (same header semantics as the T9A test-connection service). Never throws. */
async function postPayload(connection, credentials, payload) {
  const headers = { "Content-Type": "application/json" };
  if (credentials) {
    if (credentials.token) headers.Authorization = `Bearer ${credentials.token}`;
    else if (credentials.apiKey) headers["X-API-Key"] = credentials.apiKey;
    else if (credentials.username && credentials.password)
      headers.Authorization = `Basic ${Buffer.from(
        `${credentials.username}:${credentials.password}`,
      ).toString("base64")}`;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(connection.base_url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const bodyText = await resp.text().catch(() => null);
    return {
      ok: resp.ok,
      externalReference: resp.headers.get("location") || null,
      httpStatus: resp.status,
      error: resp.ok ? null : `HTTP ${resp.status}`,
      responseBody: bodyText?.slice(0, 2000) ?? null,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error" };
  }
}

/* Persist one dispatch outcome as a T9A api-log row (redacted) + audit event. */
async function writeExportLog(
  db,
  writeAudit,
  { connection, companyId, storeId, saleId, userId, payload, result },
) {
  const ok = result.status === "dispatched";
  try {
    await db(
      `INSERT INTO integration_api_logs
         (integration_id, company_id, store_id, entity_type, entity_id,
          correlation_id, method, url, request_body, response_status,
          response_body, success, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        connection.id,
        companyId,
        storeId ?? null,
        "sale",
        saleId,
        idempotencyKey(companyId, storeId, "sale", saleId, connection.provider_name || "accounting"),
        "POST",
        connection.base_url || "accounting-export",
        redactBodyForLog(payload),
        ok ? result.httpStatus ?? 200 : 0,
        ok ? redactBodyForLog(result.responseBody ?? null) : null,
        ok,
        ok ? null : result.error || result.status,
      ],
    );
  } catch (logErr) {
    /* A log write must never fail the request; the dispatch outcome stands. */
    console.error("[T10V] log write failed:", logErr?.message);
  }
  if (typeof writeAudit === "function") {
    try {
      await writeAudit(
        companyId,
        userId,
        ok ? "accounting_exported" : "accounting_export_failed",
        "sale",
        saleId,
        { integration: connection.name, dispatchStatus: result.status },
      );
    } catch {
      /* audit is best-effort */
    }
  }
}
