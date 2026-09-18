/*
 * T9Q-NEXT-SMALL - focused tests for WhatsApp delivery history + manual resend.
 *
 * REAL router over HTTP against a stateful fake db; Graph API intercepted
 * with a SELECTIVE mock (only graph.facebook.com). Covers:
 *   - history: tenant/store scoping, ordering, limit, no secret/phone leakage
 *   - resend: tenant checks, activation check, phone check, pipeline reuse
 *     (link mode payload + PDF->link fallback), audit outcomes, single send
 *
 *   node --test tests/whatsappDeliveryOps.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { encryptSecret } from "../services/onlineOrders/platformConfig.js";
process.env.INVOICE_PUBLIC_BASE_URL = "https://pos.example.com";


const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const USER = "u0000000-0000-4000-8000-000000000009";
const SECRET_A = "EAAG-history-test-secret-123456";

const PHONE_PLAINTEXT = "+447700911222"; // never allowed in any response

/* ------------------------------------------------------------ harness */

function makeCtx({ companyId = COMPANY_A, storeId = STORE_1 } = {}) {
  const state = {
    integration: null, // { company_id, active, configuration(object) }
    sales: new Map(), // id -> sale row
    customers: new Map(), // id -> { name, phone }
    deliveryAudits: [], // { company_id, entity_id, details, created_at }
    resendAudits: [], // writeAudit calls from the resend route
    linkInserts: [],
    graphCalls: [], // { url, payload }
  };

  const db = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM integrations\b/i.test(s)) {
      const row = state.integration;
      return {
        rows: row && row.company_id === params[0]
          ? [{ active: row.active, configuration: row.configuration }]
          : [],
      };
    }
    if (/FROM audit_logs al/i.test(s) && /INNER JOIN sales s/i.test(s)) {
      // delivery-history query: params = [companyId, action, limit(, storeId)]
      const limit = params[2];
      const storeIdFilter = params.length > 3 ? params[3] : null;
      const rows = state.deliveryAudits
        .filter((a) => a.company_id === params[0] && a.action === params[1])
        .map((a) => {
          const sale = state.sales.get(a.entity_id);
          // Mirrors the real INNER JOIN: sale must exist and belong to the same
          // company; store scope filters the joined sale.
          if (!sale || sale.company_id !== params[0]) return null;
          if (storeIdFilter && sale.store_id !== storeIdFilter) return null;
          return { details: a.details, created_at: a.created_at, receipt_number: sale.receipt_number };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
      return { rows };
    }
    if (/INSERT INTO audit_logs/i.test(s)) {
      state.deliveryAudits.push({
        company_id: params[0],
        action: params[2],
        entity_id: params[3],
        details: JSON.parse(params[4]),
        created_at: new Date(),
      });
      return { rows: [] };
    }
    if (/FROM sales\b/i.test(s)) {
      const sale = state.sales.get(params[0]);
      const match =
        sale &&
        sale.company_id === params[1] &&
        (params.length < 3 || sale.store_id === params[2]);
      return { rows: match ? [sale] : [] };
    }
    if (/FROM sale_items/i.test(s)) {
      return { rows: [{ product_name: "Bread", quantity: 2, unit_price: 5, tax: 0, total: 10 }] };
    }
    if (/FROM payments/i.test(s)) {
      return { rows: [{ payment_method: "card", amount: 12 }] };
    }
    if (/FROM customers/i.test(s)) {
      // Models a real customers table: lookup by id (params[0]); a customer
      // row may exist without a phone, mirroring real data.
      const customer = state.customers.get(params[0]);
      return { rows: customer ? [{ name: customer.name, phone: customer.phone }] : [] };
    }
    if (/FROM companies/i.test(s)) {
      return { rows: [{ name: "Test Co Ltd", email: null, phone: null, currency: "GBP", timezone: "Europe/London" }] };
    }
    if (/INSERT INTO secure_invoice_links/i.test(s)) {
      state.linkInserts.push({ tokenHash: params[0], companyId: params[1], saleId: params[3] });
      return { rows: [{ id: "link-1", expires_at: new Date(Date.now() + 86400000) }] };
    }
    if (/UPDATE secure_invoice_links/i.test(s)) {
      return { rows: [] };
    }
    throw new Error("unexpected db use: " + s.slice(0, 70));
  };

  const pool = {
    async connect() {
      return { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
    },
  };
  const writeAudit = async (companyId, userId, action, entityType, entityId, details) => {
    state.resendAudits.push({ companyId, userId, action, entityId, details });
  };

  const buildApp = async () => {
    const mod = await import("../routes/whatsapp.js");
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

  return { state, buildApp, listen, companyId, storeId };
}

/* Graph-only interceptor; local requests pass through untouched. */
function mockGraph(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("graph.facebook.com")) {
      return original(url, options);
    }
    return handler(String(url), options);
  };
  return () => {
    globalThis.fetch = original;
  };
}

function seedSale(state, { id = "s0000000-0000-4000-8000-00000000000a", storeId = STORE_1, phone = PHONE_PLAINTEXT, company = COMPANY_A, customerId = "cust-1" } = {}) {
  state.sales.set(id, {
    id,
    company_id: company,
    store_id: storeId,
    receipt_number: "T01-20260917-0099",
    customer_id: customerId,
    subtotal: 10,
    tax: 2,
    discount: 0,
    total: 12,
    created_at: new Date(),
    completed_at: new Date(),
    company_currency: "GBP",
    company_timezone: "Europe/London",
  });
  state.customers.set(customerId, { name: "Kate", phone });
  return id;
}

function seedActiveWhatsApp(state, { active = true, deliveryMode = "link" } = {}) {
  state.integration = {
    company_id: COMPANY_A,
    active,
    configuration: {
      phone_number_id: "123456789012345",
      access_token: encryptSecret(SECRET_A),
      delivery_mode: deliveryMode,
      auto_send_enabled: false, // resend must NOT require auto-send
      default_country_code: "44",
    },
  };
}

const getHistory = async (port) =>
  (await (await fetch(`http://127.0.0.1:${port}/api/whatsapp/delivery-history?limit=20`)).json());
const resend = async (port, saleId) =>
  fetch(`http://127.0.0.1:${port}/api/whatsapp/resend-invoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ saleId }),
  });

/* ------------------------------------------------------- history tests */

test("delivery-history returns only current company/store records, newest first, limit honoured", async () => {
  const ctx = makeCtx();
  const saleId = seedSale(ctx.state);
  // 25 audit rows across two stores + another company, distinct timestamps.
  for (let i = 0; i < 25; i++) {
    ctx.state.deliveryAudits.push({
      company_id: COMPANY_A,
      action: "whatsapp_invoice_delivery",
      entity_id: saleId,
      created_at: new Date(Date.now() - (1000 - i) * 60000),
      details: { outcome: "sent", delivery_mode: "link", trigger: "auto" },
    });
  }
  ctx.state.deliveryAudits.push({
    company_id: COMPANY_B, // foreign company row must never appear
    action: "whatsapp_invoice_delivery",
    entity_id: saleId,
    created_at: new Date(),
    details: { outcome: "sent" },
  });
  ctx.state.sales.set("s0000000-0000-4000-8000-00000000000b", {
    id: "s0000000-0000-4000-8000-00000000000b",
    company_id: COMPANY_A,
    store_id: STORE_2, // other store of the SAME company
    receipt_number: "T02-OTHER",
  });
  ctx.state.deliveryAudits.push({
    company_id: COMPANY_A,
    action: "whatsapp_invoice_delivery",
    entity_id: "s0000000-0000-4000-8000-00000000000b",
    created_at: new Date(),
    details: { outcome: "sent" },
  });

  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  try {
    const body = await getHistory(port);
    assert.equal(body.success, true);
    const history = body.data.history;
    assert.equal(history.length, 20, "limit=20 honoured");
    // Newest first: first entry must be the most recent of the 25.
    assert.equal(history[0].outcome, "sent");
    const times = history.map((r) => new Date(r.createdAt).getTime());
    assert.deepEqual([...times].sort((a, b) => b - a), times, "newest first ordering");
    // Only STORE_1 rows: no STORE_2 receipt, no foreign company rows.
    assert.ok(history.every((r) => r.receiptNumber !== "T02-OTHER"));
    assert.equal(history.filter((r) => r.receiptNumber === null).length, 0, "join must resolve every receipt");
  } finally {
    server.close();
  }
});

test("delivery-history never exposes full phones, tokens, hashes or ciphertext", async () => {
  const ctx = makeCtx();
  const saleId = seedSale(ctx.state);
  ctx.state.deliveryAudits.push({
    company_id: COMPANY_A,
    action: "whatsapp_invoice_delivery",
    entity_id: saleId,
    created_at: new Date(),
    details: {
      outcome: "failed",
      delivery_mode: "link",
      recipient_masked: ".....9122",
      provider_message_id: "wamid.ABCDEF1234",
      error: "WhatsApp API returned HTTP 500",
      http_status: 500,
    },
  });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  try {
    const body = await getHistory(port);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(PHONE_PLAINTEXT), "full phone number leaked");
    assert.ok(!raw.includes(SECRET_A), "plaintext token leaked");
    assert.ok(!raw.includes("enc:v1:"), "ciphertext leaked");
    assert.ok(!raw.includes("sha256:"), "token-hash material leaked");
    assert.ok(!raw.includes(saleId), "internal sale UUID must not be exposed");
    const row = body.data.history[0];
    assert.equal(row.recipientMasked, ".....9122");
    assert.ok(row.providerMessageId.length <= 11, "provider id must be shortened");
    assert.equal(row.error, "WhatsApp API returned HTTP 500");
  } finally {
    server.close();
  }
});

test("foreign-company session receives an empty history, not someone else's rows", async () => {
  const ctxA = makeCtx({ companyId: COMPANY_A });
  const saleIdA = seedSale(ctxA.state);
  ctxA.state.deliveryAudits.push({
    company_id: COMPANY_A,
    action: "whatsapp_invoice_delivery",
    entity_id: saleIdA,
    created_at: new Date(),
    details: { outcome: "sent", delivery_mode: "link" },
  });
  const ctxB = makeCtx({ companyId: COMPANY_B });
  const appB = await ctxB.buildApp();
  const { server, port } = await ctxB.listen(appB);
  try {
    const body = await getHistory(port);
    assert.equal(body.success, true);
    assert.equal(body.data.history.length, 0, "company B must see nothing of company A");
  } finally {
    server.close();
  }
});

/* -------------------------------------------------------- resend tests */

test("manual resend uses the existing pipeline: one Graph send, T9P link, audit outcome", async () => {
  const ctx = makeCtx();
  const saleId = seedSale(ctx.state);
  seedActiveWhatsApp(ctx.state, { deliveryMode: "link" });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let payload = null;
  let messageCalls = 0;
  const restore = mockGraph((url, options) => {
    if (url.endsWith("/messages")) {
      messageCalls += 1;
      payload = JSON.parse(options.body);
    }
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.RESEND1" }] }) };
  });
  try {
    const res = await resend(port, saleId);
    const body = await res.json();
    assert.equal(res.status, 200, `resend failed: ${JSON.stringify(body)}`);
    assert.equal(body.success, true);
    // Exactly ONE message per resend request (no duplicate sends).
    assert.equal(messageCalls, 1);
    assert.equal(payload.to, "447700911222", "normalized customer number used");
    assert.match(payload.text.body, /\/i\/[A-Za-z0-9_-]{20,}/, "T9P secure link inside the message");
    assert.equal(ctx.state.linkInserts.length, 1, "link created via existing contract");
    assert.equal(ctx.state.linkInserts[0].tokenHash.length, 64, "hash-only storage");
    // Audit outcome recorded by the service + route.
    const deliveryAudit = ctx.state.deliveryAudits.find((a) => a.details.trigger === "manual_resend");
    assert.ok(deliveryAudit, "delivery outcome logged with manual_resend trigger");
    assert.equal(deliveryAudit.details.outcome, "sent");
    assert.ok(!JSON.stringify(deliveryAudit.details).includes(PHONE_PLAINTEXT), "no full phone in audit");
    const routeAudit = ctx.state.resendAudits.find((a) => a.action === "whatsapp_invoice_resent");
    assert.ok(routeAudit, "route audit recorded");
  } finally {
    restore();
    server.close();
  }
});

test("manual resend rejects foreign sale, missing phone, and inactive WhatsApp", async () => {
  const ctx = makeCtx();
  const saleId = seedSale(ctx.state);
  seedActiveWhatsApp(ctx.state);
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  const restore = mockGraph(() => ({ ok: true, status: 200, json: async () => ({ messages: [{ id: "x" }] }) }));
  try {
    // 1. foreign sale -> 404
    const foreign = await resend(port, "f0000000-0000-4000-8000-00000000000f");
    assert.equal(foreign.status, 404);

    // 2. missing customer phone -> 400 with a useful message
    seedSale(ctx.state, { id: "s0000000-0000-4000-8000-00000000000c", phone: null, customerId: "cust-nophone" });
    const noPhone = await resend(port, "s0000000-0000-4000-8000-00000000000c");
    assert.equal(noPhone.status, 400);
    assert.match((await noPhone.json()).message, /no usable customer phone/i);

    // 3. inactive WhatsApp -> 400 activation message
    ctx.state.integration.active = false;
    const inactive = await resend(port, saleId);
    assert.equal(inactive.status, 400);
    assert.match((await inactive.json()).message, /not activated\/configured/i);
    // And nothing was sent to Graph for the inactive case.
    assert.equal(ctx.state.deliveryAudits.filter((a) => a.details.outcome === "sent").length, 0);
  } finally {
    restore();
    server.close();
  }
});

test("Graph failure returns 502 without crashing, outcome audited; PDF failure falls back to link", async () => {
  const ctx = makeCtx();
  const saleId = seedSale(ctx.state);
  seedActiveWhatsApp(ctx.state, { deliveryMode: "pdf" });
  const app = await ctx.buildApp();
  const { server, port } = await ctx.listen(app);
  let messagePayloads = [];
  const restore = mockGraph((url, options) => {
    if (url.endsWith("/media")) {
      return { ok: false, status: 500, json: async () => ({ error: { message: "upload denied" } }) };
    }
    messagePayloads.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.FB1" }] }) };
  });
  try {
    // 1. Graph message failure -> 502, server still serving, audit has failure.
    const failing = await mockGraph(() => ({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) }));
    const resFail = await resend(port, saleId);
    assert.equal(resFail.status, 502);
    failing();
    const failAudit = ctx.state.deliveryAudits.filter((a) => a.details.trigger === "manual_resend").pop();
    assert.equal(failAudit.details.outcome, "failed");

    // 2. Retry with working Graph: PDF upload fails -> fallback link send.
    const res = await resend(port, saleId);
    assert.equal(res.status, 200);
    assert.equal(messagePayloads.length, 1, "exactly one message after fallback");
    assert.match(messagePayloads[0].text.body, /\/i\//, "fallback used secure link");
    const okAudit = ctx.state.deliveryAudits.filter((a) => a.details.trigger === "manual_resend").pop();
    assert.equal(okAudit.details.outcome, "sent");
    assert.equal(okAudit.details.delivery_mode, "link", "effective mode after fallback");

    // Server is still healthy after the failure path.
    const stillUp = await getHistory(port);
    assert.equal(stillUp.success, true);
  } finally {
    restore();
    server.close();
  }
});
