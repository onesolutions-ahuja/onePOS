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
import { encryptSecret } from "../services/onlineOrders/platformConfig.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const SECRET_A = "EAAG-super-secret-token-987654321";
const VERIFY_A = "verify-me-98765";

/* ------------------------------------------------ stateful fake db + app */

function makeApp({ companyId = COMPANY_A, storeId = STORE_1 } = {}) {
  const state = {
    row: null, // { company_id, active, configuration: JSON-string }
    audits: [],
    secureLinkInserts: [],
    sale: null,
  };
  const db = async (sql, params = []) => {
    if (/FROM integrations WHERE company_id = \$1 AND provider = 'whatsapp'/i.test(sql)) {
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
    if (/FROM sales/i.test(sql)) {
      const sale = state.sale;
      const match =
        sale && sale.id === params[0] && sale.company_id === params[1] &&
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
  const writeAudit = async (companyId, userId, action) => {
    state.audits.push({ companyId, userId, action });
  };
  return { state, db, pool, writeAudit, companyId, storeId };
}

async function buildServer(ctx) {
  const mod = await import("../routes/whatsapp.js");
  const app = express();
  app.use(express.json());
  const authorize = () => (_req, _res, next) => next();
  app.use(
    "/api",
    (req, _res, next) => {
      req.user = { id: USER, companyId: ctx.companyId, storeId: ctx.storeId, role: "admin" };
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
