/*
 * T10U — Negative Inventory Billing safety: focused suite.
 *
 * Backend: the REAL routes/sales.js POST /api/sales and the REAL
 * routes/settings.js negative-inventory-billing endpoint, driven over HTTP
 * against stateful fakes of the DB client (same pattern as
 * selfCheckout.test.mjs). Covers:
 *   1. Default OFF: insufficient stock is rejected exactly as before.
 *   2. With the setting ON: the sale proceeds through the EXISTING engine,
 *      inventory may go negative via the existing SALE ledger movement.
 *   3. The sale-time audit (SALE_NEGATIVE_STOCK) records product, requested
 *      quantity, recorded stock, resulting stock, user, company, sale ref.
 *   4. allowNegativeStockSale cannot force negative billing when the
 *      company setting is OFF (server is authoritative).
 *   5. Settings endpoint: admin-only (settings.manage), enabling without
 *      acknowledgement is rejected, ON/OFF transitions audited, tenant
 *      isolation (no company id accepted from the client).
 *   6. Frontend contract: the POS shows the read-only Insufficient
 *      Inventory warning (stock + requested qty, Cancel / Continue Sale)
 *      and the settings page shows the Admin/Owner-only toggle.
 *
 *   node --test tests/negativeInventory.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import createSalesRouter from "../routes/sales.js";
import createSettingsRouter from "../routes/settings.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const ROLE = "r0000000-0000-4000-8000-000000000001";

/* ------------------------------------------------------------ fakes */

function makeSalesCtx({ settingOn = false, stock = 2 } = {}) {
  const state = {
    sales: [], payments: [], stockLedger: [],
    products: new Map([["p-1", productRow(stock)]]),
    settingOn, stock, balance: stock, audits: [],
  };
  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/SELECT allow_negative_inventory_billing FROM company_settings/.test(s)) {
        return { rows: [{ allow_negative_inventory_billing: state.settingOn }] };
      }
      if (/to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) return { rows: [{ date_key: "20260918" }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) return { rows: [{ next_number: state.sales.length + 1 }] };
      if (/FROM products WHERE id = \$1\n?\s*AND company_id = \$2\n?\s*AND active = true/.test(s)) {
        const row = state.products?.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
        const found = state.sales.find((sale) => sale.company_id === params[0] && sale.client_request_id === params[1]);
        return { rows: found ? [{ id: found.id, created_at: found.created_at, total: found.total, receipt_number: found.receipt_number }] : [] };
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
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
    /* T10U setting read inside the sale transaction. */
    if (/SELECT allow_negative_inventory_billing FROM company_settings/.test(s)) {
      return { rows: [{ allow_negative_inventory_billing: state.settingOn }] };
    }
    /* Resulting-stock read for the audit. */
    if (/SELECT stock_quantity FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
      return { rows: [{ stock_quantity: state.balance }] };
    }
    return { rows: [], rowCount: 0 };
  };
  /* The shared inventory writer, as server.js builds it: ledger + balance. */
  const createInventoryMovement = async (cl, entry) => {
    state.balance -= Math.abs(Number(entry.quantityChange) || 0);
    state.stockLedger.push({ ...entry, balance: state.balance });
    return { balance: state.balance, movement: { id: `mov-${state.stockLedger.length}` } };
  };
  return { state, db, pool: { async connect() { return client; } }, createInventoryMovement };
}

const adminUser = { id: USER, companyId: COMPANY, storeId: STORE, roleId: ROLE, username: "kate" };
const productRow = (stock) => ({
  id: "p-1", company_id: COMPANY, name: "Cola 330ml", active: true,
  price: 1.5, vat_rate: 20, track_stock: true, stock_quantity: stock, age_restricted: false,
});

async function buildSalesApp(ctx, { user = adminUser, writeAudit } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => { req.user = user; next(); });
  app.use("/api", createSalesRouter({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: ctx.createInventoryMovement,
    associateCustomerWithStore: async () => ({}),
    writeAudit,
    selfCheckoutMode: () => false,
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const req = async (port, method, path, body = null) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const saleBody = (qty = 5) => ({
  items: [{ productId: "p-1", quantity: qty, unitPrice: 1.5, tax: 0, discount: 0, total: 1.5 * qty }],
  subtotal: 1.5 * qty, tax: 0, discount: 0, total: 1.5 * qty,
  paymentMethod: "cash",
});

/* --------------------------------------------------------------- tests */

describe("T10U negative inventory — sale path", () => {
  test("default OFF: insufficient stock is rejected exactly as before", async () => {
    const ctx = makeSalesCtx({ settingOn: false, stock: 2 });
    const app = await buildSalesApp(ctx);
    try {
      const { status, body } = await req(app.port, "POST", "/api/sales", saleBody(5));
      assert.equal(status, 500);
      assert.match(body.message, /Insufficient stock for Cola 330ml/);
      assert.equal(ctx.state.sales.length, 0, "no sale row written");
      assert.equal(ctx.state.stockLedger.length, 0, "no inventory movement written");
      assert.equal(ctx.state.balance, 2, "stock unchanged");
    } finally { app.server.close(); }
  });

  test("client cannot force negative billing while the setting is OFF", async () => {
    const ctx = makeSalesCtx({ settingOn: false, stock: 2 });
    const app = await buildSalesApp(ctx);
    try {
      const { status } = await req(app.port, "POST", "/api/sales", { ...saleBody(5), allowNegativeStockSale: true });
      assert.equal(status, 500, "the server setting — not the request flag — decides");
      assert.equal(ctx.state.sales.length, 0);
    } finally { app.server.close(); }
  });

  test("setting ON + client confirmation: sale proceeds through the EXISTING engine; stock goes negative via the SALE ledger", async () => {
    const ctx = makeSalesCtx({ settingOn: true, stock: 2 });
    const app = await buildSalesApp(ctx);
    try {
      /* The POS "Continue Sale" path sends the explicit confirmation flag;
         the server independently verifies the company setting is ON. */
      const { status, body } = await req(app.port, "POST", "/api/sales", { ...saleBody(5), allowNegativeStockSale: true });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(ctx.state.sales.length, 1, "one sale, one receipt — no duplicates");
      assert.match(body.sale.receipt_number, /^T01-20260918-/);
      assert.deepEqual(ctx.state.payments.map((p) => p.method), ["cash"]);
      /* Negative balance flows from the EXISTING createInventoryMovement path. */
      assert.equal(ctx.state.stockLedger.length, 1);
      assert.equal(ctx.state.stockLedger[0].movementType, "SALE");
      assert.equal(ctx.state.stockLedger[0].balance, -3, "2 - 5 = -3 through the existing ledger");
      assert.equal(ctx.state.balance, -3);
    } finally { app.server.close(); }
  });

  test("T10U audit: SALE_NEGATIVE_STOCK records product, quantities, stocks, user, company, sale ref", async () => {
    const ctx = makeSalesCtx({ settingOn: true, stock: 2 });
    const audits = [];
    const writeAudit = async (companyId, userId, action, entityType, entityId, details) => {
      audits.push({ companyId, userId, action, entityType, entityId, details });
    };
    const app = await buildSalesApp(ctx, { writeAudit });
    try {
      const { status } = await req(app.port, "POST", "/api/sales", { ...saleBody(5), allowNegativeStockSale: true });
      assert.equal(status, 201);
      await new Promise((r) => setTimeout(r, 30)); /* fire-and-forget flush */

      const event = audits.find((a) => a.action === "SALE_NEGATIVE_STOCK");
      assert.ok(event, "negative-stock sale must be audited");
      assert.equal(event.companyId, COMPANY);
      assert.equal(event.userId, USER);
      assert.equal(event.entityType, "sale");
      assert.match(String(event.entityId), /^sale-/);
      assert.equal(event.details.receiptNumber, ctx.state.sales[0].receipt_number);
      assert.equal(event.details.storeId, STORE);
      assert.equal(event.details.lines.length, 1);
      const line = event.details.lines[0];
      assert.equal(line.productId, "p-1");
      assert.equal(line.productName, "Cola 330ml");
      assert.equal(line.recordedStock, 2, "recorded stock before the sale");
      assert.equal(line.requestedQuantity, 5);
      assert.equal(line.resultingStock, -3, "resulting stock from the ledger");
    } finally { app.server.close(); }
  });

  test("setting ON but basket within stock: no negative-stock audit, normal sale", async () => {
    const ctx = makeSalesCtx({ settingOn: true, stock: 10 });
    const audits = [];
    const writeAudit = async (companyId, userId, action) => { audits.push({ action }); };
    const app = await buildSalesApp(ctx, { writeAudit });
    try {
      const { status } = await req(app.port, "POST", "/api/sales", { ...saleBody(2), allowNegativeStockSale: true });
      assert.equal(status, 201);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(ctx.state.balance, 8);
      assert.ok(!audits.some((a) => a.action === "SALE_NEGATIVE_STOCK"), "no audit for a normal sale");
    } finally { app.server.close(); }
  });

  test("setting ON but WITHOUT the client confirmation flag: still rejected (operator must confirm)", async () => {
    const ctx = makeSalesCtx({ settingOn: true, stock: 2 });
    const app = await buildSalesApp(ctx);
    try {
      const { status } = await req(app.port, "POST", "/api/sales", saleBody(5));
      assert.equal(status, 500, "the setting alone never bypasses the insufficient-stock check");
      assert.equal(ctx.state.sales.length, 0);
    } finally { app.server.close(); }
  });
});

/* ------------------------------------------------- settings endpoint */

function makeSettingsCtx({ current = false } = {}) {
  const state = { value: current, audits: [] };
  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/SELECT allow_negative_inventory_billing FROM company_settings WHERE company_id=\$1 FOR UPDATE/.test(s)) {
        return { rows: [{ allow_negative_inventory_billing: state.value }] };
      }
      if (/INSERT INTO company_settings/.test(s)) {
        state.value = params[1] === true;
        return { rowCount: 1 };
      }
      if (/INSERT INTO audit_logs/.test(s)) {
        state.audits.push({ companyId: params[0], userId: params[1], details: JSON.parse(params[2]) });
        return { rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = async () => ({ rows: [], rowCount: 0 });
  return { state, db, pool: { async connect() { return client; } } };
}

async function buildSettingsApp(ctx, user) {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => { req.user = user; next(); });
  app.use("/api", createSettingsRouter({
    authenticate: (_req, _res, next) => next(),
    authorize: (code) => (req, res, next) => {
      if (req.user?.permissions?.includes(code)) return next();
      return res.status(403).json({ success: false, message: "Administrator permission required" });
    },
    db: ctx.db,
    pool: ctx.pool,
    writeAudit: async () => {},
    testPaymentTerminal: async () => ({}),
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

describe("T10U negative inventory — Admin/Owner setting endpoint", () => {
  test("enabling WITHOUT acknowledgement is rejected (strong confirmation)", async () => {
    const ctx = makeSettingsCtx({ current: false });
    const app = await buildSettingsApp(ctx, { ...adminUser, permissions: ["settings.manage"] });
    try {
      const { status, body } = await req(app.port, "PUT", "/api/settings/negative-inventory-billing", { enabled: true });
      assert.equal(status, 400);
      assert.match(body.message ?? "", /acknowledgement/i);
      assert.equal(ctx.state.value, false, "setting unchanged");
    } finally { app.server.close(); }
  });

  test("admin enables with acknowledgement → ON, audited with previous value", async () => {
    const ctx = makeSettingsCtx({ current: false });
    const app = await buildSettingsApp(ctx, { ...adminUser, permissions: ["settings.manage"] });
    try {
      const { status, body } = await req(app.port, "PUT", "/api/settings/negative-inventory-billing", { enabled: true, acknowledged: true });
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(ctx.state.value, true);
      const audit = ctx.state.audits.find((a) => a.details && a.details.enabled === true);
      assert.ok(audit, "setting change audited");
      assert.equal(audit.details.previousValue, false);
    } finally { app.server.close(); }
  });

  test("disable needs no acknowledgement and is audited; idempotent disable is a no-op", async () => {
    const ctx = makeSettingsCtx({ current: true });
    const app = await buildSettingsApp(ctx, { ...adminUser, permissions: ["settings.manage"] });
    try {
      const off = await req(app.port, "PUT", "/api/settings/negative-inventory-billing", { enabled: false });
      assert.equal(off.status, 200);
      assert.equal(ctx.state.value, false);
      const audit = ctx.state.audits.find((a) => a.details && a.details.enabled === false);
      assert.ok(audit && audit.details.previousValue === true);

      const again = await req(app.port, "PUT", "/api/settings/negative-inventory-billing", { enabled: false });
      assert.equal(again.status, 200);
      assert.match(again.body.message, /Already disabled/);
      assert.equal(ctx.state.audits.filter((a) => a.details && a.details.enabled === false).length, 1, "no duplicate audit");
    } finally { app.server.close(); }
  });

  test("a user WITHOUT settings.manage is rejected (403) — cannot self-enable", async () => {
    const ctx = makeSettingsCtx({ current: false });
    const app = await buildSettingsApp(ctx, { ...adminUser, permissions: ["sale.create"] });
    try {
      const { status } = await req(app.port, "PUT", "/api/settings/negative-inventory-billing", { enabled: true, acknowledged: true });
      assert.equal(status, 403);
      assert.equal(ctx.state.value, false);
    } finally { app.server.close(); }
  });

  test("company isolation: the endpoint never accepts a company id from the client", async () => {
    const ctx = makeSettingsCtx({ current: false });
    const app = await buildSettingsApp(ctx, { ...adminUser, permissions: ["settings.manage"] });
    try {
      await req(app.port, "PUT", "/api/settings/negative-inventory-billing", {
        enabled: true, acknowledged: true, companyId: "b0000000-0000-4000-8000-000000000002",
      });
      /* The write and the audit are keyed to req.user.companyId only. */
      const audit = ctx.state.audits[0];
      assert.equal(audit.companyId, COMPANY);
    } finally { app.server.close(); }
  });
});

/* -------------------------------------------------- frontend contract */

describe("T10U negative inventory — frontend contract", () => {
  const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
  const settingsSrc = fs.readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");

  test("POS shows a read-only Insufficient Inventory warning with Cancel / Continue Sale", () => {
    assert.match(posSrc, /Insufficient Inventory/);
    assert.match(posSrc, /negativeStockNotice/);
    assert.match(posSrc, /data-testid="negative-stock-line"/);
    assert.match(posSrc, /Continue Sale/);
    /* Recorded stock + requested quantity are both displayed per line. */
    assert.match(posSrc, /\{line\.recordedStock\}/);
    assert.match(posSrc, /\{line\.requestedQuantity\}/);
    /* Continue re-enters the EXISTING checkout with the same payment method. */
    assert.match(posSrc, /completeSale\(method, \{ skipStockWarning: true \}\)/);
  });

  test("POS pre-flight check reuses the normalised product stock, no new engine", () => {
    assert.match(posSrc, /item\.trackStock === true/);
    assert.match(posSrc, /Number\(item\.stock \|\| 0\) < Number\(item\.quantity \|\| 0\)/);
    assert.ok(!posSrc.includes("allowNegativeInventoryBilling = true"), "POS never decides policy locally");
  });

  test("settings page gates the toggle to Admin/Owner and warns before enabling", () => {
    assert.match(settingsSrc, /NegativeInventoryBillingSetting/);
    assert.match(settingsSrc, /allowNegativeInventoryBilling/);
    assert.match(settingsSrc, /negative-inventory-billing/);
    assert.match(settingsSrc, /WARNING — Allow Negative Inventory Billing\?/);
    assert.match(settingsSrc, /acknowledged: nextEnabled/);
    assert.match(settingsSrc, /if \(!isAdmin \|\| !loaded\) return null/);
    assert.match(settingsSrc, /<Toggle\s*\n?\s*checked=\{enabled\}/);
  });
});
