/*
 * T9D-NEXT - focused tests for SMS + Email invoice delivery.
 *
 * REAL routers over HTTP against a stateful fake db; the provider HTTP layer
 * is intercepted with a selective global fetch mock (only non-local hosts).
 * No real SMS/email is ever sent. Covers the required verification matrix:
 * success paths, missing contacts, tenant isolation, provider-failure
 * resilience, credential non-exposure, opaque link URLs, auto-send default
 * OFF, activation gating, and no-duplicate sends.
 *
 *   node --test tests/invoiceDeliveryOps.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { encryptSecret } from "../services/onlineOrders/platformConfig.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const USER = "u0000000-0000-4000-8000-000000000009";
const SECRET = "sk-invoice-test-secret-987654";
const PHONE = "+447700911222";
const EMAIL = "kate@example.com";
const ENDPOINT = "https://provider.example.com/send";

const SALE = "s0000000-0000-4000-8000-00000000000a";

/* ------------------------------------------------------------ harness */

function makeCtx({ companyId = COMPANY_A, storeId = STORE_1 } = {}) {
  const state = {
    integrations: new Map(), // provider -> { active, configuration }
    sales: new Map(),
    customers: new Map(),
    deliveryAudits: [],
    routeAudits: [],
    linkInserts: [],
  };

  const db = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM integrations/i.test(s)) {
      // params: [companyId, provider]
      const target = state.integrations.get(params[1]);
      return {
        rows: target && target.company_id === params[0]
          ? [{ active: target.active, configuration: target.configuration }]
          : [],
      };
    }
    if (/INSERT INTO audit_logs/i.test(s)) {
      state.deliveryAudits.push({
        company_id: params[0], action: params[2], entity_id: params[3], details: JSON.parse(params[4]),
      });
      return { rows: [] };
    }
    if (/FROM sales s[\s\S]*INNER JOIN companies/i.test(s)) {
      const sale = state.sales.get(params[0]);
      const ok = sale && sale.company_id === params[1] && (params.length < 3 || sale.store_id === params[2]);
      return { rows: ok ? [{ id: sale.id, receipt_number: sale.receipt_number, total: sale.total, customer_id: sale.customer_id }] : [] };
    }
    // createSecureInvoiceLink's ownership check: SELECT s.id, s.company_id, s.store_id, s.customer_id FROM sales s WHERE s.id = $1 ...
    if (/FROM sales s[\s\S]*WHERE s\.id = \$1/i.test(s)) {
      const sale = state.sales.get(params[0]);
      const ok = sale && sale.company_id === params[1] && (params.length < 3 || sale.store_id === params[2]);
      return { rows: ok ? [{ id: sale.id, company_id: sale.company_id, store_id: sale.store_id, customer_id: sale.customer_id }] : [] };
    }
    if (/FROM customers/i.test(s)) {
      const customer = state.customers.get(params[0]);
      return { rows: customer ? [{ name: customer.name, phone: customer.phone, email: customer.email }] : [] };
    }
    if (/SELECT name FROM companies/i.test(s)) {
      return { rows: [{ name: "Test Co Ltd" }] };
    }
    if (/INSERT INTO secure_invoice_links/i.test(s)) {
      state.linkInserts.push({ tokenHash: params[0], companyId: params[1], saleId: params[3] });
      return { rows: [{ id: "link-1", expires_at: new Date(Date.now() + 86400000) }] };
    }
    if (/UPDATE secure_invoice_links/i.test(s)) return { rows: [] };
    if (/SELECT id FROM sales/i.test(s)) {
      const sale = state.sales.get(params[0]);
      const ok = sale && sale.company_id === params[1] && (params.length < 3 || sale.store_id === params[2]);
      return { rows: ok ? [{ id: sale.id }] : [] };
    }
    throw new Error("unexpected db use: " + s.slice(0, 70));
  };

  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const s = String(sql);
          if (/SELECT id FROM integrations WHERE company_id = \$1 AND provider = \$2 FOR UPDATE/i.test(s)) {
            const row = state.integrations.get(params[1]);
            return { rows: row && row.company_id === params[0] ? [{ id: "row-1" }] : [] };
          }
          if (/UPDATE integrations SET active/i.test(s)) {
            // params: [id, active, configuration] - locate by stored _dbId
            for (const row of state.integrations.values()) {
              if (row._dbId === params[0]) {
                row.active = params[1];
                row.configuration = JSON.parse(params[2]);
              }
            }
            return { rowCount: 1 };
          }
          if (/INSERT INTO integrations/i.test(s)) {
            const provider = params[2];
            state.integrations.set(provider, {
              company_id: params[0], _dbId: `row-${provider}`,
              active: params[4], configuration: JSON.parse(params[3]),
            });
            return { rows: [{ id: `row-${provider}` }] };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  };

  const writeAudit = async (companyId, userId, action, entityType, entityId, details) => {
    state.routeAudits.push({ companyId, action, entityId, details });
  };

  const buildApp = async () => {
    const mod = await import("../routes/invoiceDelivery.js");
    const app = express();
    app.use(express.json());
    const authorize = () => (_req, _res, next) => next();
    app.use(
      "/api",
      (req, _res, next) => {
        req.user = { id: USER, companyId, storeId, role: "admin" };
        next();
      },
      mod.default({ db, pool, authenticate: (_req, _res, next) => next(), authorize, writeAudit })
    );
    return app;
  };

  const listen = async (app) => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, port: server.address().port };
  };

  function seedSale({ withPhone = true, withEmail = true } = {}) {
    state.sales.set(SALE, {
      id: SALE, company_id: COMPANY_A, store_id: STORE_1,
      receipt_number: "T01-20260917-0077", total: 25, customer_id: "cust-1",
    });
    state.customers.set("cust-1", {
      name: "Kate",
      phone: withPhone ? PHONE : null,
      email: withEmail ? EMAIL : null,
    });
  }

  function seedChannel(channel, { active = true, autoSend = false } = {}) {
    state.integrations.set(channel === "sms" ? "sms_invoice" : "email_invoice", {
      company_id: COMPANY_A,
      _dbId: channel === "sms" ? "row-sms_invoice" : "row-email_invoice",
      active,
      configuration: {
        api_base_url: ENDPOINT,
        auth_token: encryptSecret(SECRET),
        default_country_code: "44",
        auto_send_enabled: autoSend,
      },
    });
  }

  return { state, db, buildApp, listen, seedSale, seedChannel };
}

/* Selective provider mock: only external https hosts are intercepted. */
function mockProvider(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1") || u.startsWith("http://localhost")) {
      return original(url, options);
    }
    return handler(u, options);
  };
  return () => {
    globalThis.fetch = original;
  };
}

const getSettings = (port, channel) =>
  fetch(`http://127.0.0.1:${port}/api/invoice-delivery/${channel}/settings`).then((r) => r.json());
const putSettings = (port, channel, body) =>
  fetch(`http://127.0.0.1:${port}/api/invoice-delivery/${channel}/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
const testConnection = (port, channel, body) =>
  fetch(`http://127.0.0.1:${port}/api/invoice-delivery/${channel}/test-connection`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
const resend = (port, channel, saleId) =>
  fetch(`http://127.0.0.1:${port}/api/invoice-delivery/${channel}/resend`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saleId }),
  });

/* ------------------------------------------------------- settings tests */

test("settings GET returns masked configuration - secrets never leak", async () => {
  const ctx = makeCtx();
  ctx.seedChannel("sms", { active: true });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  try {
    const body = await getSettings(port, "sms");
    assert.equal(body.success, true);
    assert.equal(body.data.enabled, true);
    assert.equal(body.data.configuration.auth_token_configured, true);
    assert.equal(body.data.configuration.auth_token_masked, `••••${SECRET.slice(-4)}`);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(SECRET), "plaintext secret leaked");
    assert.ok(!raw.includes("enc:v1:"), "ciphertext leaked");
  } finally {
    server.close();
  }
});

test("activation requires a successful test with THESE credentials (gate enforced)", async () => {
  const ctx = makeCtx();
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  const restore = mockProvider(async () => ({
    ok: true, status: 200, json: async () => ({ id: "provider-ref-1" }),
  }));
  try {
    // 1. Activate without any test -> rejected.
    const noTest = await putSettings(port, "sms", {
      enabled: true,
      apiBaseUrl: ENDPOINT,
      authToken: SECRET,
    });
    assert.equal(noTest.status, 400);
    assert.match((await noTest.json()).message, /connection test/i);

    // 2. Successful test issues a token.
    const tested = await testConnection(port, "sms", {
      apiBaseUrl: ENDPOINT,
      authToken: SECRET,
    });
    assert.equal(tested.success, true, JSON.stringify(tested));
    assert.ok(tested.data.testToken);

    // 3. Activation with the issued token succeeds; secret stored encrypted.
    const activated = await putSettings(port, "sms", {
      enabled: true,
      apiBaseUrl: ENDPOINT,
      authToken: SECRET,
      testToken: tested.data.testToken,
    });
    assert.equal(activated.status, 200, JSON.stringify(await activated.json()));
    const stored = ctx.state.integrations.get("sms_invoice").configuration;
    assert.ok(stored.auth_token.startsWith("enc:v1:"), "secret must be encrypted at rest");
    assert.ok(!JSON.stringify(stored).includes(SECRET), "plaintext secret in storage");
  } finally {
    restore();
    server.close();
  }
});

test("automatic sending is OFF by default and never flips implicitly", async () => {
  const ctx = makeCtx();
  ctx.seedChannel("sms", { active: true, autoSend: false });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  const restore = mockProvider(async () => ({ ok: true, status: 200, json: async () => ({ id: "x" }) }));
  try {
    const body = await getSettings(port, "sms");
    assert.equal(body.data.configuration.auto_send_enabled, false, "default must be OFF");
    // Settings save that does not mention autoSend must not enable it.
    const saved = await putSettings(port, "sms", { enabled: false, apiBaseUrl: ENDPOINT });
    assert.equal(saved.status, 200);
    assert.equal(ctx.state.integrations.get("sms_invoice").configuration.auto_send_enabled, false);
  } finally {
    restore();
    server.close();
  }
});

test("connection test failure keeps configuration intact and stores no activation state", async () => {
  const ctx = makeCtx();
  ctx.seedChannel("sms", { active: false });
  const before = JSON.stringify(ctx.state.integrations.get("sms_invoice").configuration);
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  const restore = mockProvider(async () => ({
    ok: false, status: 401, json: async () => ({ error: { message: "bad key" } }),
  }));
  try {
    const body = await testConnection(port, "sms", { apiBaseUrl: ENDPOINT, authToken: SECRET });
    assert.equal(body.success, false);
    assert.equal(body.data.status, "failed");
    const after = JSON.stringify(ctx.state.integrations.get("sms_invoice").configuration);
    assert.equal(
      after.replace(/"auth_token":"[^"]*"/, '"auth_token":"X"'),
      before.replace(/"auth_token":"[^"]*"/, '"auth_token":"X"'),
      "failed test must not change stored config (except nothing)"
    );
    assert.ok(!after.includes("last_test_token"), "no activation state on failure");
  } finally {
    restore();
    server.close();
  }
});

/* ----------------------------------------------------- delivery tests */

test("successful manual SMS delivery: one provider call, T9P link, safe audit", async () => {
  const ctx = makeCtx();
  ctx.seedSale();
  ctx.seedChannel("sms", { active: true, autoSend: false });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let smsCalls = 0;
  let smsPayload = null;
  const restore = mockProvider((url, options) => {
    smsCalls += 1;
    smsPayload = JSON.parse(options.body);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "sms-ref-77" }) });
  });
  try {
    const res = await resend(port, "sms", SALE);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(smsCalls, 1, "exactly one provider call per resend");
    assert.equal(smsPayload.to, "447700911222", "normalized customer number used");
    assert.match(smsPayload.message, /\/i\/[A-Za-z0-9_-]{20,}/, "message carries the secure link");
    assert.ok(!smsPayload.message.includes(SALE), "no sale ID in the message");
    assert.equal(ctx.state.linkInserts.length, 1);
    assert.equal(ctx.state.linkInserts[0].tokenHash.length, 64, "hash-only link storage");
    // Safe audit: masked phone, no full number, no token, no secret.
    const audit = ctx.state.deliveryAudits.find((a) => a.action === "sms_invoice_delivery");
    assert.equal(audit.details.outcome, "sent");
    assert.ok(!JSON.stringify(audit.details).includes(PHONE), "full phone in audit");
    assert.ok(!JSON.stringify(audit.details).includes(SECRET), "secret in audit");
    assert.ok(!JSON.stringify(audit.details).includes("/i/"), "link token in audit");
  } finally {
    restore();
    server.close();
  }
});

test("successful manual Email delivery: one provider call, masked-email audit", async () => {
  const ctx = makeCtx();
  ctx.seedSale();
  ctx.seedChannel("email", { active: true });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let emailPayload = null;
  let emailCalls = 0;
  const restore = mockProvider((url, options) => {
    emailCalls += 1;
    emailPayload = JSON.parse(options.body);
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: "email-ref-9" }) });
  });
  try {
    const res = await resend(port, "email", SALE);
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(emailCalls, 1);
    assert.equal(emailPayload.to, EMAIL);
    assert.match(emailPayload.subject, /invoice/i);
    assert.match(emailPayload.text, /\/i\/[A-Za-z0-9_-]{20,}/, "email body carries the secure link");
    const audit = ctx.state.deliveryAudits.find((a) => a.action === "email_invoice_delivery");
    assert.equal(audit.details.outcome, "sent");
    assert.ok(!JSON.stringify(audit.details).includes(EMAIL), "full email in audit");
    assert.ok(JSON.stringify(audit.details).includes("*"), "masked email expected");
  } finally {
    restore();
    server.close();
  }
});

test("missing phone -> no SMS provider call; missing email -> no email provider call", async () => {
  const ctx = makeCtx();
  ctx.seedSale({ withPhone: false, withEmail: false });
  ctx.seedChannel("sms", { active: true });
  ctx.seedChannel("email", { active: true });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let providerCalls = 0;
  const restore = mockProvider(() => {
    providerCalls += 1;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  try {
    const smsRes = await resend(port, "sms", SALE);
    assert.equal(smsRes.status, 400);
    assert.match((await smsRes.json()).message, /no usable customer phone/i);
    const emailRes = await resend(port, "email", SALE);
    assert.equal(emailRes.status, 400);
    assert.match((await emailRes.json()).message, /no usable customer email/i);
    assert.equal(providerCalls, 0, "no provider call without a recipient");
  } finally {
    restore();
    server.close();
  }
});

test("foreign-company and foreign-store sales are rejected with a generic 404", async () => {
  const ctx = makeCtx();
  ctx.seedSale();
  ctx.seedChannel("sms", { active: true });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let providerCalls = 0;
  const restore = mockProvider(() => {
    providerCalls += 1;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  try {
    // Foreign-store: session for STORE_2 cannot see the STORE_1 sale.
    const ctxS2 = makeCtx({ companyId: COMPANY_A, storeId: STORE_2 });
    ctxS2.state.sales.set(SALE, ctx.state.sales.get(SALE)); // sale belongs to STORE_1
    ctxS2.seedChannel("sms", { active: true });
    const appS2 = await ctxS2.buildApp();
    const { server: sS, port: pS } = await ctxS2.listen(appS2);
    const foreignStore = await resend(pS, "sms", SALE);
    assert.equal(foreignStore.status, 404);
    sS.close();

    // Foreign-company: an empty company B harness cannot see company A's sale
    // (generic 404 - indistinguishable from "not found").
    const ctxB = makeCtx({ companyId: COMPANY_B, storeId: STORE_1 });
    ctxB.seedChannel("sms", { active: true });
    const appB2 = await ctxB.buildApp();
    const { server: sB, port: pB } = await ctxB.listen(appB2);
    const foreignCompany = await resend(pB, "sms", SALE);
    assert.equal(foreignCompany.status, 404);
    sB.close();
    assert.equal(providerCalls, 0, "no provider call for a foreign sale");
  } finally {
    restore();
    server.close();
  }
});

test("provider failure returns 502 without crashing the server; auto dispatch never throws", async () => {
  const ctx = makeCtx();
  ctx.seedSale();
  ctx.seedChannel("sms", { active: true, autoSend: true });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  const restore = mockProvider(() => Promise.reject(new Error("connection refused")));
  try {
    const res = await resend(port, "sms", SALE);
    assert.equal(res.status, 502);
    const audit = ctx.state.deliveryAudits.filter((a) => a.action === "sms_invoice_delivery").pop();
    assert.equal(audit.details.outcome, "failed");
    // Server still healthy.
    const stillUp = await getSettings(port, "sms");
    assert.equal(stillUp.success, true);
    // Auto dispatch (fire-and-forget entry point) must resolve, never throw.
    const { dispatchSmsInvoiceDelivery } = await import("../services/invoiceDelivery.js");
    const autoSms = await dispatchSmsInvoiceDelivery({ db: ctx.db, saleId: SALE, companyId: COMPANY_A, storeId: STORE_1 });
    assert.ok(autoSms);
  } finally {
    restore();
    server.close();
  }
});

test("auto dispatch skips when integration disabled or auto-send OFF (default)", async () => {
  const ctx = makeCtx();
  ctx.seedSale();
  ctx.seedChannel("sms", { active: true, autoSend: false });
  ctx.seedChannel("email", { active: false, autoSend: false });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let providerCalls = 0;
  const restore = mockProvider(() => {
    providerCalls += 1;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  try {
    const { dispatchSmsInvoiceDelivery, dispatchEmailInvoiceDelivery } = await import("../services/invoiceDelivery.js");
    const sms = await dispatchSmsInvoiceDelivery({ db: ctx.db, saleId: SALE, companyId: COMPANY_A, storeId: STORE_1 });
    assert.equal(sms.outcome, "skipped");
    const email = await dispatchEmailInvoiceDelivery({ db: ctx.db, saleId: SALE, companyId: COMPANY_A, storeId: STORE_1 });
    assert.equal(email.outcome, "skipped");
    assert.equal(providerCalls, 0, "disabled/off channels must not call the provider");
  } finally {
    restore();
    server.close();
  }
});
