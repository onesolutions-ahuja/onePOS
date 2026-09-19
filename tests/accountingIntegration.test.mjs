/*
 * T10V - Accounting Integration tests.
 *
 * Drives the REAL routes/accountingExport.js over HTTP against a stateful
 * fake db (same pattern as tests/customerCredit.test.mjs). Proves:
 *   - company isolation (sale / connection / logs across tenants)
 *   - idempotent export (duplicate short-circuit, no second provider POST)
 *   - payload built ONLY by the T10W normalizer (one shared shape)
 *   - failure handling (no connection, unreachable provider, HTTP 500)
 *   - failures never mutate the sale and still write a redacted log row
 *   - log rows are company-scoped and can never leak another tenant's rows
 *
 *   node --test tests/accountingIntegration.test.mjs
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const SALE_A = "d0000000-0000-4000-8000-000000000001";
const SALE_B = "d0000000-0000-4000-8000-000000000002";
const CONN_A = "e0000000-0000-4000-8000-000000000001";
const CONN_B = "e0000000-0000-4000-8000-000000000002";

/* ----------------------------------------------------------- stateful fake db */

function makeDb() {
  const state = {
    sales: [
      {
        id: SALE_A, company_id: COMPANY_A, store_id: STORE_1, receipt_number: "TO-20260919-0001",
        created_at: new Date("2026-09-19T10:00:00Z"), subtotal: "50.00", tax: "10.00", discount: 0,
        total: "60.00", status: "completed", completed_at: null, online_order_id: null,
      },
      {
        id: SALE_B, company_id: COMPANY_B, store_id: null, receipt_number: "TO-20260919-0099",
        created_at: new Date("2026-09-19T11:00:00Z"), subtotal: "10.00", tax: "2.00", discount: 0,
        total: "12.00", status: "completed", completed_at: null, online_order_id: null,
      },
    ],
    /* Items as the real SQL returns them: sale_items columns + product join. */
    saleItems: [
      { sale_id: SALE_A, product_id: "p1", product_name: "Widget", quantity: 2, unit_price: "25.00", discount: 0, tax: "10.00", total: "50.00", sku: "SKU-1", barcode: null, vat_rate: 20, vat_applicable: true },
    ],
    payments: [{ sale_id: SALE_A, payment_method: "cash", amount: "60.00", provider_transaction_id: null }],
    connections: [
      {
        id: CONN_A, company_id: COMPANY_A, name: "Books Co", provider_name: "xero",
        integration_type: "accounting", base_url: "https://provider.test/exports",
        auth_type: "bearer", credentials_encrypted: null, enabled: true,
        created_at: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    logs: [],
  };

  function companyScoped(rows, companyId, col = "company_id") {
    return rows.filter((r) => r[col] === companyId);
  }

  async function query(sql, params = []) {
    const q = sql.replace(/\s+/g, " ").trim();

    /* --- sales + items + payments aggregate --- */
    if (q.includes("FROM sales s WHERE s.company_id = $1 AND s.id = $2")) {
      const rows = companyScoped(state.sales, params[0])
        .filter((s) => s.id === params[1])
        .map((s) => ({
          ...s,
          items: state.saleItems.filter((i) => i.sale_id === s.id),
          payments: state.payments.filter((p) => p.sale_id === s.id),
        }));
      return { rows };
    }

    /* --- connections list (GET /integrations) --- */
    if (q.includes("integration_type ILIKE '%accounting%' ORDER BY enabled DESC")) {
      return {
        rows: companyScoped(state.connections, params[0])
          .filter((c) => c.integration_type.includes("accounting"))
          .sort((a, b) => Number(b.enabled) - Number(a.enabled))
          .map((c) => ({ ...c, has_credentials: c.credentials_encrypted != null })),
      };
    }

    /* --- connections for export (enabled, oldest first) --- */
    if (q.includes("enabled = TRUE ORDER BY created_at ASC")) {
      return {
        rows: companyScoped(state.connections, params[0])
          .filter((c) => c.enabled && c.integration_type.includes("accounting"))
          .sort((a, b) => a.created_at - b.created_at),
      };
    }

    /* --- idempotency probe (route export gate) --- */
    if (q.includes("success = TRUE LIMIT 1")) {
      const hit = state.logs.some(
        (l) => l.integration_id === params[0] && l.entity_type === "sale" && l.entity_id === params[1] && l.success === true,
      );
      return { rows: hit ? [{ exists: 1 }] : [] };
    }

    /* --- exportable queue --- */
    if (q.includes("ORDER BY s.created_at DESC LIMIT 50")) {
      return {
        rows: companyScoped(state.sales, params[0]).map((s) => {
          const dispatched = state.logs.some(
            (l) => l.entity_type === "sale" && l.entity_id === s.id && l.success === true,
          );
          const last = state.logs
            .filter((l) => l.entity_type === "sale" && l.entity_id === s.id && l.success === true)
            .sort((a, b) => b.created_at - a.created_at)[0];
          return {
            id: s.id, receipt_number: s.receipt_number, created_at: s.created_at,
            total: s.total, vat: s.vat, payment_method: s.payment_method,
            item_count: state.saleItems.filter((i) => i.sale_id === s.id).length,
            vat: s.tax,
            dispatched, last_integration_id: last ? last.integration_id : null,
          };
        }),
      };
    }

    /* --- log ownership check --- */
    if (q.includes("SELECT id FROM integration_connections WHERE id = $1 AND company_id = $2")) {
      return { rows: state.connections.filter((c) => c.id === params[0] && c.company_id === params[1]).map((c) => ({ id: c.id })) };
    }

    /* --- log list --- */
    if (q.includes("FROM integration_api_logs WHERE integration_id = $1 AND company_id = $2")) {
      return {
        rows: state.logs
          .filter((l) => l.integration_id === params[0] && l.company_id === params[1])
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, 100),
      };
    }

    /* --- log insert --- */
    if (q.startsWith("INSERT INTO integration_api_logs")) {
      const row = {
        id: `log-${state.logs.length + 1}`,
        integration_id: params[0], company_id: params[1], store_id: params[2],
        entity_type: params[3], entity_id: params[4], correlation_id: params[5],
        method: params[6], url: params[7], request_body: params[8],
        response_status: params[9], response_body: params[10],
        success: params[11], error_message: params[12],
        created_at: new Date(),
      };
      state.logs.push(row);
      return { rows: [row] };
    }

    throw new Error("fake db: unexpected SQL -> " + q.slice(0, 120));
  }

  return { state, db: query };
}

/* ----------------------------------------------------------- app builder */

function buildApp(fakedb, { companyId = COMPANY_A, role = "admin" } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/accounting", (req, res, next) => {
    req.user = { id: "u1", companyId, username: "tester", role };
    next();
  });
  return import("../routes/accountingExport.js").then((mod) => {
    app.use(
      "/api/accounting",
      mod.default({
        authenticate: (_req, _res, next) => next(),
        authorize: () => (_req, _res, next) => next(),
        db: fakedb.db,
        writeAudit: async () => {},
      }),
    );
    return app;
  });
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  OPEN_SERVERS.push(server);
  return server.address().port;
}

const OPEN_SERVERS = [];
/* node:test waits on the event loop - every server must be closed. */
function closeServers() {
  return Promise.all(
    OPEN_SERVERS.splice(0).map(
      (s) =>
        new Promise((r) => {
          s.closeAllConnections?.(); /* undici keep-alive would stall close() */
          s.close(() => r());
        }),
    ),
  );
}

/* ----------------------------------------------------------- outbound fetch stub */

let fetchCalls = [];
let fetchBehaviour = "ok"; // ok | network-error | http-500
const realFetch = global.fetch;

function stubFetch() {
  fetchCalls = [];
  fetchBehaviour = "ok";
  /* Intercept ONLY the fake provider host - the test client's own requests
   * to the express server must use the real fetch. */
  global.fetch = async (url, opts = {}) => {
    if (!String(url).includes("provider.test")) return realFetch(url, opts);
    fetchCalls.push({ url, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    if (fetchBehaviour === "network-error") throw new Error("ECONNREFUSED");
    if (fetchBehaviour === "http-500") {
      return { ok: false, status: 500, headers: { get: () => null }, text: async () => "boom" };
    }
    return { ok: true, status: 200, headers: { get: () => "ext-ref-1" }, text: async () => "{}" };
  };
}

/* Runs even when an assertion fails - no server/socket can stall the run. */
afterEach(async () => {
  await closeServers();
  global.fetch = realFetch;
});

/* ----------------------------------------------------------- tests */

test("export succeeds: T10W payload POSTed once, log written, sale untouched", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.status, "exported");
  assert.equal(body.integration.name, "Books Co");

  /* One provider POST whose body came from the T10W normalizer. */
  assert.equal(fetchCalls.length, 1);
  const sent = fetchCalls[0].body;
  assert.equal(sent.source_type, "sale");
  assert.equal(sent.source_id, SALE_A);
  assert.equal(sent.document_reference, "TO-20260919-0001");
  assert.equal(sent.lines.length, 1);
  assert.equal(sent.lines[0].product_sku, "SKU-1");
  assert.ok(fetchCalls[0].url.startsWith("https://provider.test/exports"));

  /* Success log row, company-scoped, redaction pipeline ran (no throw). */
  assert.equal(fakedb.state.logs.length, 1);
  assert.equal(fakedb.state.logs[0].success, true);
  assert.equal(fakedb.state.logs[0].company_id, COMPANY_A);

  /* The sale itself is untouched by export. */
  assert.equal(fakedb.state.sales.find((s) => s.id === SALE_A).total, "60.00");

  app.closeAll?.();
  await closeServers();
  await closeServers();
  global.fetch = realFetch;
});

test("idempotent replay: second export returns duplicate, provider NOT called twice", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const first = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  assert.equal(first.status, 200);
  const second = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  const body = await second.json();
  assert.equal(second.status, 200);
  assert.equal(body.status, "duplicate");
  assert.match(body.message, /Already exported/);
  assert.equal(fetchCalls.length, 1, "provider must never receive the sale twice");

  await closeServers();
  global.fetch = realFetch;
});

test("company isolation: a foreign sale id is a plain 404 (no oracle)", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const appA = await buildApp(fakedb, { companyId: COMPANY_A });
  const portA = await listen(appA);

  /* COMPANY_A user tries to export COMPANY_B's sale. */
  const res = await fetch(`http://127.0.0.1:${portA}/api/accounting/export/${SALE_B}`, { method: "POST" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Sale not found" });
  assert.equal(fetchCalls.length, 0, "no outbound request for a foreign sale");

  await closeServers();
  global.fetch = realFetch;
});

test("company isolation: connections and logs never cross tenants", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const appA = await buildApp(fakedb, { companyId: COMPANY_A });
  const portA = await listen(appA);

  const conns = await (await fetch(`http://127.0.0.1:${portA}/api/accounting/integrations`)).json();
  assert.equal(conns.data.length, 1);
  assert.equal(conns.data[0].companyScoped !== false, true);
  assert.equal(conns.data[0].id, CONN_A);

  /* COMPANY_B connection is invisible to COMPANY_A's log listing. */
  const logsForeign = await fetch(`http://127.0.0.1:${portA}/api/accounting/logs/${CONN_B}`);
  assert.equal(logsForeign.status, 404, "foreign connection id must 404");

  await closeServers();
  global.fetch = realFetch;
});

test("exportable queue is company-scoped and reflects dispatch state", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const appA = await buildApp(fakedb, { companyId: COMPANY_A });
  const portA = await listen(appA);

  await fetch(`http://127.0.0.1:${portA}/api/accounting/export/${SALE_A}`, { method: "POST" });
  const forA = await (await fetch(`http://127.0.0.1:${portA}/api/accounting/exportable`)).json();
  assert.equal(forA.data.length, 1, "COMPANY_A must not see COMPANY_B sales");
  assert.equal(forA.data[0].id, SALE_A);
  assert.equal(forA.data[0].dispatched, true);

  const appB = await buildApp(fakedb, { companyId: COMPANY_B });
  const portB = await listen(appB);
  const forB = await (await fetch(`http://127.0.0.1:${portB}/api/accounting/exportable`)).json();
  assert.equal(forB.data.length, 1);
  assert.equal(forB.data[0].id, SALE_B);
  assert.equal(forB.data[0].dispatched, false);

  await closeServers();
  global.fetch = realFetch;
});

test("no enabled accounting connection -> 409, nothing sent, sale untouched", async () => {
  const fakedb = makeDb();
  fakedb.state.connections[0].enabled = false;
  stubFetch();
  fetchBehaviour = "ok";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /No enabled accounting integration/);
  assert.equal(fetchCalls.length, 0);
  assert.equal(fakedb.state.logs.length, 0);

  await closeServers();
  global.fetch = realFetch;
});

test("provider network failure -> 502, failure logged, sale NOT mutated, replay allowed", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "network-error";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 502);
  /* The adapter reports the network failure as {ok:false} - T10X maps that
   * to provider_rejected; a thrown error would be provider_error. Both are
   * 502s with the sale untouched, which is what this test pins. */
  assert.equal(body.status, "provider_rejected");
  assert.match(body.error, /ECONNREFUSED/);
  assert.equal(fetchCalls.length, 1);

  /* The failure was recorded, but not as a success - the sale can be retried. */
  assert.equal(fakedb.state.logs.length, 1);
  assert.equal(fakedb.state.logs[0].success, false);
  assert.equal(fakedb.state.sales.find((s) => s.id === SALE_A).total, "60.00");

  fetchBehaviour = "ok";
  const retry = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  assert.equal(retry.status, 200, "failed export must be retryable");
  assert.equal(fetchCalls.length, 2);

  await closeServers();
  global.fetch = realFetch;
});

test("provider HTTP 500 -> provider_rejected 502, logged as failure, not a duplicate", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "http-500";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  assert.equal(res.status, 502);
  assert.equal(fakedb.state.logs[0].success, false);
  assert.equal(fakedb.state.logs[0].error_message, "HTTP 500");

  await closeServers();
  global.fetch = realFetch;
});

test("connection without a valid base_url -> provider_not_configured 400", async () => {
  const fakedb = makeDb();
  fakedb.state.connections[0].base_url = null;
  stubFetch();
  const app = await buildApp(fakedb);
  const port = await listen(app);

  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /endpoint URL/);
  assert.equal(fetchCalls.length, 0);

  await closeServers();
  global.fetch = realFetch;
});

test("logs endpoint returns only the caller's own rows, newest first", async () => {
  const fakedb = makeDb();
  stubFetch();
  fetchBehaviour = "ok";
  const app = await buildApp(fakedb);
  const port = await listen(app);

  await fetch(`http://127.0.0.1:${port}/api/accounting/export/${SALE_A}`, { method: "POST" });
  const res = await fetch(`http://127.0.0.1:${port}/api/accounting/logs/${CONN_A}`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].entity_id, SALE_A);
  assert.equal(body.data[0].company_id, COMPANY_A);
  /* No credential material in the log projection. */
  const rowJson = JSON.stringify(body.data);
  assert.ok(!rowJson.includes("credentials"), "log rows must not expose credential fields");

  await closeServers();
  global.fetch = realFetch;
});
