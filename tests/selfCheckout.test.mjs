/*
 * T10D — Self-Checkout mode foundation: focused regression suite.
 *
 * Backend: the REAL routes/selfCheckout.js router + createSelfCheckoutModeGate
 * + the REAL routes/sales.js (cash rejection) over HTTP against stateful
 * fakes, with JWTs signed by the same session layer the server uses.
 * Frontend: source-contract assertions for App/POS/SelfCheckout wiring and
 * shared-engine usage.
 *
 *   node --test tests/selfCheckout.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { signSessionPayload } from "../services/session.js";
import createSelfCheckoutRouter, { createSelfCheckoutModeGate } from "../routes/selfCheckout.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const ROLE = "r0000000-0000-4000-8000-000000000001";

/* ------------------------------------------------------------ fakes */

function makeScoCtx() {
  const state = { audits: [], sessions: 0 };
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/SELECT s\.id, s\.name FROM stores s WHERE s\.id = \$1 AND s\.company_id = \$2/.test(s)) {
      // Tenant-scoped: the store row must match BOTH ids to exist.
      const stores = {
        [STORE]: { id: STORE, company_id: COMPANY, name: "High Street" },
      };
      const store = stores[params[0]];
      return { rows: store && store.company_id === params[1] ? [store] : [] };
    }
    return { rows: [], rowCount: 0 };
  };
  return { state, db };
}

function makeSalesCtx() {
  const state = { sales: [], payments: [] };
  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) return { rows: [{ date_key: "20260918" }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) return { rows: [{ next_number: state.sales.length + 1 }] };
      if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
        const found = state.sales.find((sale) => sale.company_id === params[0] && sale.client_request_id === params[1]);
        return { rows: found ? [{ id: found.id, created_at: found.created_at, total: found.total, receipt_number: found.receipt_number }] : [] };
      }
      if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const row = state.products?.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0],
          receipt_number: `T01-20260918-${String(state.sales.length + 1).padStart(4, "0")}`,
          total: Number(params[9]) || 0,
          client_request_id: params[10] ?? null,
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
      }
      if (/INSERT INTO payments/.test(s)) { state.payments.push({ saleId: params[0], method: params[1] }); return { rowCount: 1 }; }
      if (/INSERT INTO inventory_movements/.test(s)) return { rowCount: 1 };
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  const db = async (sql) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
    return { rows: [], rowCount: 0 };
  };
  return { state, db, pool: { async connect() { return { ...client, release() {} }; } } };
}

/* -------------------------------------------------------------- builders */

async function buildScoApp(ctx, { user, writeAudit } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api", createSelfCheckoutRouter({
    authenticate: (_req, _res, next) => next(),
    // Mirror the real authorize(): admin/owner passes, permission check otherwise.
    authorize: (code) => async (req, res, next) => {
      if (req.user?.permissions?.includes(code)) return next();
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
    },
    db: ctx.db,
    writeAudit,
  }));
  return app;
}

async function buildSalesApp(ctx, { user } = {}) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    associateCustomerWithStore: async () => ({}),
    selfCheckoutMode: (req) => req.user?.mode === "self_checkout",
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const req = async (port, method, path, { body, token } = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const adminUser = { id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE, username: "kate", permissions: ["sale.create"] };

/* ---------------------------------------------------------------- tests */

describe("Self-Checkout session (enter/exit, authorisation, isolation)", () => {
  test("authorised user can enter Self-Checkout mode and receives a scoped mode token", async () => {
    const ctx = makeScoCtx();
    const app = await buildScoApp(ctx, { user: adminUser });
    const { server, port } = await listen(app);
    try {
      const { status, body } = await req(port, "POST", "/api/self-checkout/session", { body: {} });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(body.data.mode, "self_checkout");
      assert.equal(body.data.store.id, STORE, "mode is tied to the authenticated user's own store");
      assert.equal(body.data.store.name, "High Street");

      const payload = JSON.parse(Buffer.from(body.data.modeToken.split(".")[1], "base64").toString());
      assert.equal(payload.mode, "self_checkout");
      assert.equal(payload.companyId, COMPANY);
      assert.equal(payload.storeId, STORE, "browser cannot choose the store — claims come from the session");
      assert.ok(payload.exp > payload.iat, "mode token has a hard expiry");
    } finally { server.close(); }
  });

  test("unauthorised user cannot enter Self-Checkout mode", async () => {
    const ctx = makeScoCtx();
    const app = await buildScoApp(ctx, { user: { ...adminUser, permissions: ["sale.refund"] } });
    const { server, port } = await listen(app);
    try {
      const { status } = await req(port, "POST", "/api/self-checkout/session", { body: {} });
      assert.equal(status, 403, "without sale.create the session must be refused");
    } finally { server.close(); }
  });

  test("foreign store context cannot be used to open a session (company/store isolation)", async () => {
    const ctx = makeScoCtx();
    const app = await buildScoApp(ctx, { user: { ...adminUser, storeId: "d0000000-0000-4000-8000-000000000009" } });
    const { server, port } = await listen(app);
    try {
      const { status } = await req(port, "POST", "/api/self-checkout/session", { body: {} });
      assert.equal(status, 403, "a store outside the company context must be refused");
    } finally { server.close(); }
  });

  test("mode start/stop are audited through the existing audit writer", async () => {
    const ctx = makeScoCtx();
    const audits = [];
    const writeAudit = async (companyId, userId, action) => { audits.push({ companyId, userId, action }); };
    const app = await buildScoApp(ctx, { user: adminUser, writeAudit });
    const { server, port } = await listen(app);
    try {
      await req(port, "POST", "/api/self-checkout/session", { body: {} });
      await req(port, "DELETE", "/api/self-checkout/session");
      assert.deepEqual(audits.map((a) => a.action), ["SELF_CHECKOUT_MODE_STARTED", "SELF_CHECKOUT_MODE_EXITED"]);
    } finally { server.close(); }
  });
});

describe("server-side mode gate (privileged operations blocked)", () => {
  const gate = createSelfCheckoutModeGate();

  const runApp = (handler) =>
    new Promise((resolve) => {
      const app = express();
      app.use(handler);
      app.use("/api", (req, res) => res.json({ reached: req.path }));
      const server = app.listen(0);
      server.on("listening", () => {
        const port = server.address().port;
        const token = signSessionPayload({ id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE, mode: "self_checkout" });
        const normal = signSessionPayload({ id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE });
        Promise.all([
          fetch(`http://127.0.0.1:${port}/api/settings`).then((r) => r.json()),
          fetch(`http://127.0.0.1:${port}/api/products`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
          fetch(`http://127.0.0.1:${port}/api/reports`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status),
          fetch(`http://127.0.0.1:${port}/api/sales`, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, method: "POST", body: "{}" }).then((r) => r.json()),
          fetch(`http://127.0.0.1:${port}/api/settings`, { headers: { Authorization: `Bearer ${normal}` } }).then((r) => r.json()),
        ]).then((results) => {
          server.close();
          resolve(results);
        });
      });
    });

  test("self-checkout token reaches only sale operations; normal token is unaffected", async () => {
    const [noTokenSettings, scoProducts, scoReports, scoSales, normalSettings] = await runApp(gate);
    assert.equal(noTokenSettings.reached, "/settings", "no token -> gate transparent");
    assert.equal(scoProducts.reached, "/products", "products (read for the basket) is allowed");
    assert.equal(scoReports, 403, "reports is blocked server-side");
    assert.equal(scoSales.reached, "/sales", "sale creation is allowed");
    assert.equal(normalSettings.reached, "/settings", "a normal operator token is NOT restricted");
  });

  test("mode token cannot WRITE settings or products (method-aware gate)", async () => {
    const token = signSessionPayload({ id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE, mode: "self_checkout" });
    const app = express();
    app.use(gate);
    app.use("/api", (req, res) => res.json({ reached: req.path }));
    const { server, port } = await listen(app);
    try {
      const putSettings = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      const postProducts = await fetch(`http://127.0.0.1:${port}/api/products`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      const putProducts = await fetch(`http://127.0.0.1:${port}/api/products/p-1`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
      const delProducts = await fetch(`http://127.0.0.1:${port}/api/products/p-1`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      assert.equal(putSettings.status, 403, "PUT /settings must be blocked for mode tokens");
      assert.equal(postProducts.status, 403, "POST /products must be blocked for mode tokens");
      assert.equal(putProducts.status, 403, "PUT /products must be blocked for mode tokens");
      assert.equal(delProducts.status, 403, "DELETE /products must be blocked for mode tokens");
    } finally { server.close(); }
  });

  test("gate forbids admin/settings/purchases/inventory/till/users paths for mode tokens", async () => {
    const token = signSessionPayload({ id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE, mode: "self_checkout" });
    const app = express();
    app.use(gate);
    app.use("/api", (req, res) => res.json({ reached: req.path }));
    const { server, port } = await listen(app);
    try {
      for (const path of ["/api/purchases", "/api/inventory", "/api/till/sessions", "/api/users", "/api/integrations", "/api/whatsapp/settings"]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
        assert.equal(res.status, 403, `${path} must be blocked in Self-Checkout mode`);
      }
    } finally { server.close(); }
  });
});

describe("Self-Checkout sales (card-only, existing engine)", () => {
  test("cash payment is rejected server-side for a self-checkout session; card proceeds", async () => {
    const ctx = makeSalesCtx();
    ctx.state.products = new Map([
      ["p-1", { id: "p-1", company_id: COMPANY, name: "Tea", active: true, track_stock: false, age_restricted: false }],
    ]);
    const app = await buildSalesApp(ctx, { user: { ...adminUser, mode: "self_checkout" } });
    const { server, port } = await listen(app);
    try {
      const cash = await req(port, "POST", "/api/sales", {
        body: { items: [{ productId: "p-1", quantity: 1, unitPrice: 3, tax: 0, discount: 0, total: 3 }], total: 3, paymentMethod: "cash" },
      });
      assert.equal(cash.status, 403);
      assert.match(cash.body.message, /Cash is not accepted at Self-Checkout/);
      assert.equal(ctx.state.sales.length, 0, "no sale row is written for a cash attempt");
      assert.equal(ctx.state.payments.length, 0, "no payment row is written for a cash attempt");

      const card = await req(port, "POST", "/api/sales", {
        body: { items: [{ productId: "p-1", quantity: 1, unitPrice: 3, tax: 0, discount: 0, total: 3 }], total: 3, paymentMethod: "card" },
      });
      assert.equal(card.status, 201, JSON.stringify(card.body));
      assert.equal(ctx.state.sales.length, 1, "card sale uses the EXISTING sale engine");
      assert.deepEqual(ctx.state.payments.map((p) => p.method), ["card"]);
    } finally { server.close(); }
  });

  test("normal POS session can still pay cash (existing behaviour unchanged)", async () => {
    const ctx = makeSalesCtx();
    ctx.state.products = new Map([
      ["p-1", { id: "p-1", company_id: COMPANY, name: "Tea", active: true, track_stock: false, age_restricted: false }],
    ]);
    const app = await buildSalesApp(ctx, { user: adminUser });
    const { server, port } = await listen(app);
    try {
      const cash = await req(port, "POST", "/api/sales", {
        body: { items: [{ productId: "p-1", quantity: 1, unitPrice: 3, tax: 0, discount: 0, total: 3 }], total: 3, paymentMethod: "cash" },
      });
      assert.equal(cash.status, 201, "staff POS cash sale must be untouched");
    } finally { server.close(); }
  });

  test("T10C age verification still applies to self-checkout sales", async () => {
    const ctx = makeSalesCtx();
    ctx.state.products = new Map([
      ["p-2", { id: "p-2", company_id: COMPANY, name: "Knife", active: true, track_stock: false, age_restricted: true }],
    ]);
    const app = await buildSalesApp(ctx, { user: { ...adminUser, mode: "self_checkout" } });
    const { server, port } = await listen(app);
    try {
      const noVerify = await req(port, "POST", "/api/sales", {
        body: { items: [{ productId: "p-2", quantity: 1, unitPrice: 20, tax: 0, discount: 0, total: 20 }], total: 20, paymentMethod: "card" },
      });
      assert.equal(noVerify.status, 403);
      assert.match(noVerify.body.message, /Age verification required/);

      const verified = await req(port, "POST", "/api/sales", {
        body: { items: [{ productId: "p-2", quantity: 1, unitPrice: 20, tax: 0, discount: 0, total: 20 }], total: 20, paymentMethod: "card", ageVerified: true },
      });
      assert.equal(verified.status, 201);
    } finally { server.close(); }
  });
});

describe("Self-Checkout frontend contract", () => {
  const scoSrc = fs.readFileSync(new URL("../src/pages/selfCheckout/SelfCheckout.jsx", import.meta.url), "utf8");
  const appSrc = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");

  test("screen uses the SHARED totals/VAT engine and the existing sale API", () => {
    assert.match(scoSrc, /computeBasketTotals\(basket/, "basket totals come from the shared engine");
    assert.doesNotMatch(scoSrc, /paymentMethod: "(?!card")/, "no payment method other than card is ever sent");
    assert.match(scoSrc, /apiRequest\("\/api\/sales"/, "sales go through the existing sale engine");
    assert.match(scoSrc, /Authorization: `Bearer \$\{modeToken\}`/, "sale requests carry the mode token");
  });

  test("age verification (T10C) is present and cash is absent", () => {
    assert.match(scoSrc, /AgeVerificationModal/, "T10C gate exists in self-checkout");
    assert.match(scoSrc, /basketHasAgeRestricted && !ageVerifiedThisSale/, "restricted basket cannot reach payment");
    /* The ONLY paymentMethod literal in the screen is "card" — no cash
     * affordance (button, action or payload) exists anywhere. */
    const withoutCard = scoSrc.replace(/paymentMethod:\s*"card"/g, "");
    assert.doesNotMatch(withoutCard, /paymentMethod:/, "no other payment method is ever sent");
    assert.doesNotMatch(scoSrc, /[>"']Cash[<"']/, "no Cash button is rendered");
  });

  test("mode is entered explicitly, renders only self-checkout, and exits safely", () => {
    assert.match(appSrc, /enterSelfCheckout/, "explicit entry action exists");
    assert.match(appSrc, /if \(scoToken\) \{[\s\S]*?<SelfCheckout[\s\S]*?\}\s*\n\s*if \(view === "admin"\)/s, "while in mode ONLY SelfCheckout renders");
    assert.match(appSrc, /exitSelfCheckout/, "explicit exit exists");
    assert.match(posSrc, /onStartSelfCheckout/, "staff POS exposes the entry action");
  });
});
