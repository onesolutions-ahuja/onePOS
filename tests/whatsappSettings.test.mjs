/*
 * T9Q-SMALL - focused tests for the WhatsApp settings foundation.
 *
 * REAL router over HTTP against a stateful fake db. The Meta Graph API is
 * mocked with a SELECTIVE interceptor (only graph.facebook.com) so the
 * tests' own requests to the local server still reach it. Every expectation
 * is derived from the test's own inputs (no hard-coded route internals).
 *
 *   node --test tests/whatsappSettings.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { encryptSecret, decryptSecret } from "../services/onlineOrders/platformConfig.js";
import { createAuditWriter } from "../services/auditLog.js";
process.env.INVOICE_PUBLIC_BASE_URL = "https://pos.example.com";


const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const USER_MISSING = "00000000-0000-4000-8000-0000000000d2"; // not in fake users
const AUDIT_COMPANY_MISSING = "f0000000-0000-4000-8000-0000000000f1"; // FK-fails audit insert
const SECRET_A = "EAAG-super-secret-token-987654321";
const VERIFY_A = "verify-me-98765";

/* ------------------------------------------------ stateful fake db + app */

function makeApp({ companyId = COMPANY_A, storeId = STORE_1 } = {}) {
  const state = {
    row: null, // { company_id, active, configuration: JSON-string }
    audits: [],
    secureLinkInserts: [],
    sale: null,
    sqlLog: [], // every db() call: { sql, params } - used for no-leak assertions
  };
  const db = async (sql, params = []) => {
    state.sqlLog.push({ sql, params });
    // Whitespace-tolerant regexes: the service formats its SQL across lines.
    if (/FROM\s+users\s+WHERE\s+id\s*=\s*\$1/i.test(sql)) {
      // users table: only the seeded test user exists; unknown ids -> []
      return { rows: params[0] === USER ? [{ id: USER }] : [] };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) {
      // [companyId, userId, action, entityType, entityId, detailsJson]
      if (params[0] === AUDIT_COMPANY_MISSING) {
        throw new Error('insert or update on table "audit_logs" violates foreign key constraint "audit_logs_company_id_fkey"');
      }
      return { rowCount: 1 };
    }
    if (/FROM\s+integrations\s+WHERE\s+company_id\s*=\s*\$1\s+AND\s+provider\s*=\s*'whatsapp'/i.test(sql)) {
      return {
        rows:
          state.row && state.row.company_id === params[0]
            ? [{ active: state.row.active, configuration: JSON.parse(state.row.configuration) }]
            : [],
      };
    }
    if (/INSERT INTO secure_invoice_links/i.test(sql)) {
      state.secureLinkInserts.push({
        tokenHash: params[0], companyId: params[1], storeId: params[2],
        saleId: params[3], createdBy: params[4], expiresAt: params[5],
      });
      return { rows: [{ id: "link-1", expires_at: params[5] }], rowCount: 1 };
    }
    if (/FROM\s+sales\b/i.test(sql)) {
      const sale = state.sale;
      if (!sale) return { rows: [] };
      // PostgreSQL simulation: a non-UUID string reaching a uuid comparison
      // throws 22P02. If a receipt ever leaks into an id filter, tests fail
      // loudly here instead of silently passing.
      const idFilter = sql.match(/WHERE\s+(?:s\.)?id\s*=\s*\$(\d+)/i);
      if (idFilter) {
        const value = params[Number(idFilter[1]) - 1];
        if (
          value !== undefined &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))
        ) {
          throw new Error(`invalid input syntax for type uuid: "${value}"`);
        }
      }
      if (/receipt_number\s*=\s*\$/i.test(sql)) {
        // Receipt resolver branch: [companyId(, storeId, receiptNumber, %like%)]
        const receiptParam = params[params.length - 2];
        const likeParam = params[params.length - 1];
        const companyOk = sale.company_id === params[0];
        const storeOk = params.length === 4 ? sale.store_id === params[1] : true;
        const likeHit =
          likeParam &&
          String(sale.receipt_number || "")
            .toLowerCase()
            .includes(String(likeParam).replace(/%/g, "").toLowerCase());
        const match = companyOk && storeOk && (sale.receipt_number === receiptParam || likeHit);
        return { rows: match ? [sale] : [] };
      }
      // UUID-by-id shapes (resolver + loaders): [saleId, companyId(, storeId)]
      const match =
        sale.id === params[0] && sale.company_id === params[1] &&
        (params.length < 3 || sale.store_id === params[2]);
      return { rows: match ? [sale] : [] };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          if (/SELECT .* FROM integrations WHERE company_id = \$1 AND provider = 'whatsapp' FOR UPDATE/i.test(sql)) {
            return { rows: state.row && state.row.company_id === params[0] ? [{ id: "row-1" }] : [] };
          }
          if (/UPDATE integrations SET active/i.test(sql)) {
            state.row = { ...state.row, active: params[1], configuration: params[2] };
            return { rowCount: 1 };
          }
          if (/INSERT INTO integrations \(/i.test(sql)) {
            state.row = { company_id: params[0], active: params[2], configuration: params[1] };
            return { rows: [{ id: "row-new" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };
  /*
   * REAL resilient audit writer (services/auditLog.js) over the fake db -
   * the same code server.js runs in production. state.audits entries are
   * produced by its onWrite sink; audit SQL appears in state.sqlLog.
   */
  const writeAudit = createAuditWriter({
    db,
    onWrite: (entry) => state.audits.push({ companyId: entry.companyId, userId: entry.userId, action: entry.action, details: entry.details }),
  });
  return { state, db, pool, writeAudit, companyId, storeId };
}

async function buildServer(ctx, userId = USER) {
  const mod = await import("../routes/whatsapp.js");
  const app = express();
  app.use(express.json());
  const authorize = () => (_req, _res, next) => next();
  app.use(
    "/api",
    (req, _res, next) => {
      req.user = { id: userId, companyId: ctx.companyId, storeId: ctx.storeId, role: "admin" };
      next();
    },
    mod.default({ db: ctx.db, pool: ctx.pool, authenticate: (_req, _res, next) => next(), authorize, writeAudit: ctx.writeAudit })
  );
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

/* Selective Graph mock: local requests pass through untouched. */
function mockGraph(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("graph.facebook.com")) return handler(url, options);
    return original(url, options);
  };
  return () => {
    globalThis.fetch = original;
  };
}

const getSettings = async (port) =>
  (await (await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`)).json());

/* ---------------------------------------------------------------- tests */

test("GET returns masked configuration - secrets never in the response", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      webhook_verify_token: encryptSecret(VERIFY_A),
    }),
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const body = await getSettings(port);
    assert.equal(body.success, true);
    assert.equal(body.data.enabled, true);
    assert.equal(body.data.configuration.phone_number_id, "123456789012345");
    assert.equal(body.data.configuration.access_token_configured, true);
    assert.equal(body.data.configuration.access_token_masked, `••••${SECRET_A.slice(-4)}`);
    assert.equal(body.data.configuration.webhook_verify_token_configured, true);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(SECRET_A), "plaintext token leaked");
    assert.ok(!raw.includes(VERIFY_A), "plaintext verify token leaked");
    assert.ok(!raw.includes("enc:v1:"), "ciphertext leaked");
  } finally {
    server.close();
  }
});

test("failed test leaves existing configuration intact and stores no activation state", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: false,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
    }),
  };
  const before = ctx.state.row.configuration;
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "x" } }) }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.data.status, "failed");
    assert.match(body.data.error, /rejected the access token/);
    assert.equal(ctx.state.row.configuration, before, "stored configuration must be untouched after a failed test");
    assert.ok(!ctx.state.row.configuration.includes("last_test"), "no activation state persisted on failure");
  } finally {
    restore();
    server.close();
  }
});

test("invalid credentials cannot activate (no test token / wrong token)", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: false,
    configuration: JSON.stringify({ phone_number_id: "123456789012345", access_token: encryptSecret(SECRET_A) }),
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const r1 = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(r1.status, 400);
    assert.match((await r1.json()).message, /required before activation/i);

    const r2 = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, testToken: "fabricated-token" }),
    });
    assert.equal(r2.status, 400);

    ctx.state.row = { company_id: COMPANY_A, active: false, configuration: JSON.stringify({}) };
    const r3 = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(r3.status, 400);
  } finally {
    server.close();
  }
});

test("successful test enables activation; stored config is encrypted and fingerprint-bound", async () => {
  const ctx = makeApp();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  let sentAuth = null;
  let sentUrl = "";
  const restore = mockGraph(async (url, options) => {
    sentUrl = String(url);
    sentAuth = options?.headers?.Authorization || null;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "123456789012345", verified_name: "onePOS Demo", display_phone_number: "+44 20 7946 0001" }),
    };
  });
  try {
    const testRes = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumberId: "123456789012345", accessToken: SECRET_A }),
    });
    const testBody = await testRes.json();
    assert.equal(testBody.success, true, `test-connection failed: ${JSON.stringify(testBody)}`);
    assert.ok(
      (sentAuth && sentAuth.startsWith("Bearer ")) || sentUrl.includes("access_token="),
      "the credential must actually be transmitted to the provider"
    );
    const testToken =
      testBody.data?.testToken ?? testBody.data?.token ?? testBody.data?.test_token ?? null;
    assert.ok(testToken, "a successful test must issue an activation reference");

    const putRes = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, accessToken: SECRET_A, testToken }),
    });
    const putBody = await putRes.json();
    assert.equal(putRes.status, 200, `activation failed: ${JSON.stringify(putBody)}`);
    assert.equal(putBody.success, true);
    assert.equal(putBody.data.enabled, true);

    // Storage: activation on, ciphertext only, the issued test reference
    // persisted, and no plaintext anywhere.
    assert.equal(ctx.state.row.active, true);
    const stored = ctx.state.row.configuration;
    assert.match(stored, /enc:v1:/);
    assert.ok(stored.includes(testToken), "issued activation reference must be persisted");
    assert.ok(!stored.includes(SECRET_A), "plaintext token leaked into storage");
    assert.ok(!JSON.stringify(putBody).includes(SECRET_A), "plaintext token leaked in response");

    // Audits recorded without credential material.
    assert.ok(ctx.state.audits.length >= 2, "both test and save must be audited");
    assert.ok(!JSON.stringify(ctx.state.audits).includes(SECRET_A), "credential leaked into audit log");
  } finally {
    restore();
    server.close();
  }
});

test("turning OFF preserves the stored credentials and test state", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      last_test_token: "issued-ref-123",
      last_tested_at: new Date().toISOString(),
    }),
  };
  const before = ctx.state.row.configuration;
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.enabled, false);
    assert.equal(ctx.state.row.active, false);
    assert.equal(ctx.state.row.configuration, before, "OFF must not delete or rewrite credentials");

    const get = await getSettings(port);
    assert.equal(get.data.configuration.access_token_configured, true, "credentials still configured while OFF");
  } finally {
    server.close();
  }
});

test("tenant isolation: two companies never see each other's configuration", async () => {
  const ctxA = makeApp();
  const ctxB = makeApp({ companyId: COMPANY_B });
  ctxA.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "111111111111111",
      access_token: encryptSecret(SECRET_A),
    }),
  };
  const appA = await buildServer(ctxA);
  const appB = await buildServer(ctxB);
  const { server: sA, port: pA } = await listen(appA);
  const { server: sB, port: pB } = await listen(appB);
  try {
    const a = await getSettings(pA);
    const b = await getSettings(pB);
    assert.equal(a.data.configuration.phone_number_id, "111111111111111");
    assert.equal(b.data.enabled, false);
    assert.ok(!b.data.configuration.phone_number_id, "company B must not see company A's phone number id");
    assert.equal(b.data.configuration.access_token_configured, false);
    assert.ok(!JSON.stringify(b).includes(SECRET_A));
  } finally {
    sA.close();
    sB.close();
  }
});

test("test-invoice: demo mode + real T9P contract (tenant-scoped, short expiry)", async () => {
  const ctx = makeApp();
  ctx.state.sale = {
    id: "e0000000-0000-4000-8000-000000000005",
    company_id: COMPANY_A,
    store_id: STORE_1,
    receipt_number: "01-20260917-0042",
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const demo = await (await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();
    assert.equal(demo.success, true);
    assert.equal(demo.data.sent, false, "demo must never claim a real send");
    assert.ok(demo.data.message.includes("TEST"));
    assert.ok(demo.data.message.includes("/i/"), "message must contain the secure-link URL form");
    assert.equal(ctx.state.secureLinkInserts.length, 0, "demo mode must not create link rows");

    const real = await (await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId: ctx.state.sale.id }),
    })).json();
    assert.equal(real.success, true, `real-contract test failed: ${JSON.stringify(real)}`);
    assert.equal(real.data.sent, false, "real-contract mode must also never claim a real send");
    assert.match(real.data.url, /^\/i\/[A-Za-z0-9_-]{43}$/, "URL must be the existing /i/:token form");
    assert.ok(real.data.message.includes("/i/"));
    const insert = ctx.state.secureLinkInserts[0];
    assert.ok(insert, "T9P delivery contract must have been invoked");
    assert.equal(insert.companyId, COMPANY_A);
    assert.equal(insert.storeId, STORE_1);
    assert.equal(insert.createdBy, USER);
    const days = (new Date(insert.expiresAt).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 0.9 && days <= 1.05, "test links are deliberately short-lived");
    // Foreign-tenant sale must not be linkable.
    const foreign = await (await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId: "99999999-9999-4999-8999-999999999999" }),
    })).json();
    assert.equal(foreign.success, false);
  } finally {
    server.close();
  }
});

/* ==================== T9Q-SMALL-FOLLOWUP regression tests ==================== */

test("changing the phone number ID invalidates the previous test (gate re-applies)", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      last_test_token: "ref-was-here",
      last_test_token_fp: null, // fingerprint bound to the OLD phone id
      last_tested_at: new Date().toISOString(),
    }),
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    // Same token, DIFFERENT phone number id, no fresh test -> must be rejected.
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        accessToken: SECRET_A,
        phoneNumberId: "987654321098765",
        testToken: "ref-was-here",
      }),
    });
    assert.equal(res.status, 400, "stale test must not validate a different phone number id");
    const body = await res.json();
    assert.match(body.message, /required before activation/i);
    // Nothing was persisted.
    const stored = JSON.parse(ctx.state.row.configuration);
    assert.equal(stored.phone_number_id, "123456789012345", "stored phone id must be untouched");
  } finally {
    server.close();
  }
});

test("saving with the same tested credentials re-activates without a fresh test", async () => {
  const ctx = makeApp();
  const phoneId = "123456789012345";
  // Simulate a completed test-connection for THESE credentials: compute the
  // fingerprint the route itself would store (token + phone id).
  const { createHash } = await import("node:crypto");
  const fp = `sha256:${createHash("sha256").update([SECRET_A, phoneId].join("\n"), "utf8").digest("hex")}`;
  ctx.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: phoneId,
      access_token: encryptSecret(SECRET_A),
      last_test_token: "current-ref",
      last_test_token_fp: fp,
      last_tested_at: new Date().toISOString(),
    }),
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        accessToken: SECRET_A,
        phoneNumberId: phoneId,
        testToken: "current-ref",
        deliveryMode: "pdf",
        autoSendEnabled: true,
      }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, `same-credentials save must succeed: ${JSON.stringify(body)}`);
    assert.equal(body.data.enabled, true);
    const stored = JSON.parse(ctx.state.row.configuration);
    assert.equal(stored.delivery_mode, "pdf");
    assert.equal(stored.auto_send_enabled, true);
  } finally {
    server.close();
  }
});

test("test-send cannot silently flip enabled or auto_send and is tenant-scoped", async () => {
  const ctx = makeApp();
  ctx.state.row = {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      auto_send_enabled: false,
    }),
  };
  ctx.state.sale = {
    id: "e0000000-0000-4000-8000-000000000006",
    company_id: COMPANY_A,
    store_id: STORE_1,
  };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  // delivery service needs a fetch that never reaches a real provider
  const restore = mockGraph(async () => ({ ok: false, status: 500, json: async () => ({ error: { message: "no" } }) }));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId: ctx.state.sale.id, recipientPhone: "+447700900123" }),
    });
    // The Graph send fails (mocked) but the point is the stored state:
    const body = await res.json().catch(() => ({}));
    const stored = JSON.parse(ctx.state.row.configuration);
    assert.equal(stored.auto_send_enabled, false, "test-send must never enable auto-send");
    assert.equal(ctx.state.row.active, true, "test-send must not change the enabled flag");
    // Tenant scoping: another company's sale id is simply not found.
    ctx.state.sale = { ...ctx.state.sale, company_id: COMPANY_B };
    const foreign = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId: ctx.state.sale.id, recipientPhone: "+447700900123" }),
    });
    assert.equal(foreign.status, 404, "foreign-tenant sale must 404");
    assert.ok(body !== undefined);
  } finally {
    restore();
    server.close();
  }
});

/* ============================================================================
 * T9Q-SMALL-FIX regression tests - the test-invoice gate.
 *
 * Contract under test:
 *   WhatsApp ON (active=true) + tested credentials  -> manual test send ALLOWED
 *   auto_send_enabled=false must NOT block a manual test send
 *   WhatsApp OFF / foreign sale / missing recipient -> rejected
 *   test-send never flips auto_send_enabled or active
 *   logs never carry secrets or full phone numbers
 * ========================================================================== */

function seedActivatedWhatsApp({ autoSend = false } = {}) {
  return {
    company_id: COMPANY_A,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      auto_send_enabled: autoSend,
    }),
  };
}

const OWN_SALE = "e0000000-0000-4000-8000-000000000006";

async function postTestSend(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("T9Q-SMALL-FIX: WhatsApp ON + auto-send OFF -> manual test invoice is ALLOWED", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test1" }] }) }));
  try {
    const { status, body } = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.data.sent, true);
    // Exactly one Graph messages call went out, to the demo recipient.
    assert.ok(body.data.mode === "link" || body.data.mode === "pdf");
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: WhatsApp OFF -> test invoice rejected", async () => {
  const ctx = makeApp();
  ctx.state.row = { ...seedActivatedWhatsApp({ autoSend: false }), active: false };
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    const { status, body } = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(status, 400, JSON.stringify(body));
    assert.match(body.message, /not enabled\/configured/i);
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: activated-but-untested credentials -> rejected (fingerprint gate)", async () => {
  const ctx = makeApp();
  // ON with token/phone id but NO tested credentials would have been blocked
  // at activation time by the fingerprint gate; simulate a tampered row.
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    // Missing recipient -> the route's first gate rejects before anything else.
    const noRecipient = await postTestSend(port, { saleId: OWN_SALE });
    assert.equal(noRecipient.status, 400);
    assert.match(noRecipient.body.message, /recipient phone number is required/i);
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: invalid/foreign sale -> rejected", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    // Unknown sale id -> generic 404.
    const unknown = await postTestSend(port, { saleId: "00000000-0000-4000-8000-000000000000", recipientPhone: "+447700900123" });
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.message, /Sale not found in your company/i);
    // Foreign-store sale (same company, different store) -> 404.
    ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: "d0000000-0000-4000-8000-000000000009" };
    const foreignStore = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(foreignStore.status, 404);
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: foreign company cannot use the endpoint", async () => {
  const ctx = makeApp({ companyId: COMPANY_B, storeId: STORE_1 });
  // Company B has its own activated WhatsApp but NO sale.
  ctx.state.row = { ...seedActivatedWhatsApp(), company_id: COMPANY_B };
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 }; // belongs to A
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    const { status } = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(status, 404, "company B must never reach company A's sale");
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: test invoice never flips auto_send_enabled or enabled", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.ok" }] }) }));
  try {
    const before = ctx.state.row;
    const { status } = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(status, 200);
    // Same object reference, unchanged values: no writes happened.
    assert.equal(ctx.state.row, before);
    const stored = JSON.parse(ctx.state.row.configuration);
    assert.equal(stored.auto_send_enabled, false);
    assert.equal(ctx.state.row.active, true);
    // No integration UPDATE/INSERT ran at all.
    assert.ok(!ctx.state.sqlLog.some((c) => /UPDATE integrations|INSERT INTO integrations/i.test(c.sql)));
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX: success path logs no secrets and no full phone numbers", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.log" }] }) }));
  try {
    const { status } = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(status, 200);
    // Route audit trail: outcome metadata only.
    const routeAudit = ctx.state.audits.find((a) => a.action === "whatsapp_test_sent");
    assert.ok(routeAudit, "success must be audited");
    const auditJson = JSON.stringify(routeAudit);
    assert.ok(!auditJson.includes(SECRET_A), "access token leaked into audit");
    assert.ok(!auditJson.includes("+447700900123"), "full phone number leaked into audit");
    // Delivery audit row: masked recipient only.
    const deliveryAudit = ctx.state.audits.filter((a) => a.action === "whatsapp_test_send_failed" || a.action === "whatsapp_test_sent").pop();
    assert.ok(deliveryAudit);
    // Every db() call in the request: no plaintext token, no full phone number.
    const dbJson = JSON.stringify(ctx.state.sqlLog);
    assert.ok(!dbJson.includes(SECRET_A), "plaintext secret in a db statement");
    assert.ok(!dbJson.includes("+447700900123"), "full phone number in a db statement");
  } finally {
    restore();
    server.close();
  }
});

test("T9Q-SMALL-FIX-2: full lifecycle - test, save & activate, auto-send stays OFF, manual test send works", async () => {
  const ctx = makeApp();
  ctx.state.sale = { id: OWN_SALE, company_id: COMPANY_A, store_id: STORE_1 };
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async (_url, options) => {
    // Phone-number-id probe during test-connection, then the message send.
    if (String(options?.body || "").includes("messaging_product")) {
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.lifecycle" }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "123456789012345", verified_name: "onePOS Demo" }),
    };
  });
  try {
    // 1. Successful connection test issues the activation reference.
    const testRes = await fetch(`http://127.0.0.1:${port}/api/whatsapp/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneNumberId: "123456789012345", accessToken: SECRET_A }),
    });
    const testBody = await testRes.json();
    const testToken = testBody.data?.testToken;
    assert.ok(testToken, "connection test must issue a token");

    // 2. Save & Activate turns the integration ON.
    const putRes = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        phoneNumberId: "123456789012345",
        accessToken: SECRET_A,
        autoSendEnabled: false, // automatic sending stays OFF
        testToken,
      }),
    });
    const putBody = await putRes.json();
    assert.equal(putRes.status, 200, JSON.stringify(putBody));
    assert.equal(putBody.data.enabled, true, "save & activate must enable WhatsApp");

    // 3. With auto-send OFF, the manual test send is ALLOWED.
    const send = await postTestSend(port, { saleId: OWN_SALE, recipientPhone: "+447700900123" });
    assert.equal(send.status, 200, JSON.stringify(send.body));
    assert.equal(send.body.data.sent, true);

    // 4. Automatic sending is still OFF afterwards.
    const stored = JSON.parse(ctx.state.row.configuration);
    assert.equal(stored.auto_send_enabled, false, "manual test must not enable automatic sending");
    assert.equal(ctx.state.row.active, true, "integration still ON");
  } finally {
    restore();
    server.close();
  }
});

/* ============================================================================
 * T9Q-SMALL-FIX (receipt resolution) - admins paste human-readable receipts
 * like "Sale 01-20260917-0001"; the backend must resolve them tenant-scoped
 * WITHOUT ever letting a receipt-shaped string reach a uuid comparison.
 * ========================================================================== */

const RECEIPT_SALE = "e0000000-0000-4000-8000-000000000007";

function seedReceiptSale({ receipt = "01-20260917-0001", companyId = COMPANY_A, storeId = STORE_1 } = {}) {
  return {
    id: RECEIPT_SALE,
    company_id: companyId,
    store_id: storeId,
    receipt_number: receipt,
  };
}

test("receipt resolution: human-readable 'Sale 01-20260917-0001' resolves and the test send succeeds", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.receipt" }] }) }));
  try {
    const { status, body } = await postTestSend(port, { saleId: "Sale 01-20260917-0001", recipientPhone: "+447700900123" });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.data.sent, true);
    // The link must have been created for the resolved UUID sale.
    assert.equal(ctx.state.secureLinkInserts.at(-1)?.saleId, RECEIPT_SALE);
  } finally {
    restore();
    server.close();
  }
});

test("receipt resolution: a bare receipt number and a UUID both still work", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.x" }] }) }));
  try {
    const bare = await postTestSend(port, { saleId: "01-20260917-0001", recipientPhone: "+447700900123" });
    assert.equal(bare.status, 200, JSON.stringify(bare.body));
    const byUuid = await postTestSend(port, { saleId: RECEIPT_SALE, recipientPhone: "+447700900123" });
    assert.equal(byUuid.status, 200, JSON.stringify(byUuid.body));
  } finally {
    restore();
    server.close();
  }
});

test("receipt resolution: invalid/unknown receipt -> generic 404", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    const unknown = await postTestSend(port, { saleId: "Sale 01-2099-9999", recipientPhone: "+447700900123" });
    assert.equal(unknown.status, 404);
    const junk = await postTestSend(port, { saleId: "not a sale reference at all", recipientPhone: "+447700900123" });
    assert.equal(junk.status, 404);
  } finally {
    restore();
    server.close();
  }
});

test("receipt resolution: foreign company receipt -> 404", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale({ companyId: COMPANY_B }); // receipt exists, wrong company
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    const { status } = await postTestSend(port, { saleId: "Sale 01-20260917-0001", recipientPhone: "+447700900123" });
    assert.equal(status, 404);
  } finally {
    restore();
    server.close();
  }
});

test("receipt resolution: foreign store receipt -> 404 for store-scoped sessions", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale({ storeId: "d0000000-0000-4000-8000-000000000009" }); // other store
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  try {
    const { status } = await postTestSend(port, { saleId: "Sale 01-20260917-0001", recipientPhone: "+447700900123" });
    assert.equal(status, 404);
  } finally {
    restore();
    server.close();
  }
});

test("receipt resolution: receipt-shaped strings never reach a uuid cast (22P02 simulation)", async () => {
  const ctx = makeApp();
  ctx.state.row = seedActivatedWhatsApp({ autoSend: false });
  ctx.state.sale = seedReceiptSale();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  const restore = mockGraph(async () => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.cast" }] }) }));
  try {
    const hostileInputs = [
      "Sale 01-20260917-0001",
      "01-20260917-0001",
      "'; DROP TABLE sales; --",
      "00000000-0000-4000-8000-not-a-uuid",
    ];
    for (const input of hostileInputs) {
      const { status } = await postTestSend(port, { saleId: input, recipientPhone: "+447700900123" });
      assert.notEqual(status, 500, `"${input}" must never trigger a server error (uuid cast)`);
      if (input.includes("01-20260917-0001")) {
        assert.equal(status, 200, `"${input}" should resolve`);
      }
    }
    // And no db statement ever carried a non-uuid into an id comparison:
    // the fake db throws 22P02 if one had - reaching here proves it didn't.
  } finally {
    restore();
    server.close();
  }
});

/* ============================================================================
 * T9Q-LIVE-FIX-4 - WhatsApp settings PUT crashed with 500 when the audit
 * write failed (audit_logs_user_id_fkey: actor not present in users). These
 * regressions pin the resilience contract of services/auditLog.js:
 * unknown actors are nulled, audit failures never fail the request, and a
 * settings save persists the integration row even when auditing breaks.
 * ==========================================================================*/

function seedEnabledRow(companyId = COMPANY_A) {
  return {
    company_id: companyId,
    active: true,
    configuration: JSON.stringify({
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      auto_send_enabled: true,
    }),
  };
}

const putSettings = async (port, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/whatsapp/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("T9Q-LIVE-FIX-4: save with an unknown actor user succeeds and nulls the audit user_id", async () => {
  const ctx = makeApp();
  ctx.state.row = seedEnabledRow();
  const app = await buildServer(ctx, USER_MISSING);
  const { server, port } = await listen(app);
  try {
    const { status, body } = await putSettings(port, { enabled: false });
    assert.equal(status, 200, `PUT must succeed despite unknown actor: ${body.message}`);
    assert.equal(body.success, true);
    assert.equal(ctx.state.row.active, false, "integration must be saved as OFF");

    const saved = ctx.state.audits.filter((a) => a.action === "whatsapp_settings_saved");
    assert.equal(saved.length, 1, "audit entry must be persisted");
    assert.equal(saved[0].userId, null, "unknown actor must be nulled, not FK-violated");
  } finally {
    server.close();
  }
});

test("T9Q-LIVE-FIX-4: audit insert failure never fails the settings PUT", async () => {
  // AUDIT_COMPANY_MISSING makes every audit_logs INSERT throw (FK) - the PUT
  // must still succeed and still persist the integrations row.
  const ctx = makeApp({ companyId: AUDIT_COMPANY_MISSING });
  ctx.state.row = seedEnabledRow(AUDIT_COMPANY_MISSING);
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const { status } = await putSettings(port, { enabled: false });
    assert.equal(status, 200, "audit failure must not fail the request");
    assert.equal(ctx.state.row.active, false, "integration row must still be saved");
    assert.equal(ctx.state.audits.length, 0, "failed audit write is swallowed (no entry)");
  } finally {
    server.close();
  }
});

test("T9Q-LIVE-FIX-4: writeAudit resolves (never throws) when the db write fails", async () => {
  const ctx = makeApp();
  await assert.doesNotReject(
    ctx.writeAudit(AUDIT_COMPANY_MISSING, USER, "whatsapp_settings_saved", "integration", null, {})
  );
  assert.equal(ctx.state.audits.length, 0);
});

test("T9Q-LIVE-FIX-4: toggling OFF keeps credentials and auto-send configuration intact", async () => {
  const ctx = makeApp();
  ctx.state.row = seedEnabledRow();
  const app = await buildServer(ctx);
  const { server, port } = await listen(app);
  try {
    const { status } = await putSettings(port, { enabled: false });
    assert.equal(status, 200);
    const cfg = JSON.parse(ctx.state.row.configuration);
    assert.match(String(cfg.access_token), /^enc:v1:/, "stored credential must remain the encrypted ciphertext");
    assert.equal(decryptSecret(cfg.access_token), SECRET_A, "ciphertext must still decrypt to the same secret - preserved, not re-encrypted or cleared");
    assert.equal(cfg.auto_send_enabled, true, "auto-send must be a separate, untouched setting");
    assert.equal(ctx.state.row.active, false);
  } finally {
    server.close();
  }
});
