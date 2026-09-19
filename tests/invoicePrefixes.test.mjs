/*
 * INVOICE PREFIXES — permanent suite (configurable receipt prefixes per sale
 * source: Till TO, Delivery DEL, Self-Checkout SC).
 *
 * Backend: drives the REAL routes/settings.js (GET/PUT round-trip) and the
 * REAL routes/sales.js receipt-numbering block over HTTP against stateful
 * fake dbs — the same harness patterns as tests/tillProductView.test.mjs and
 * tests/selfCheckout.test.mjs. Also drives the REAL
 * services/onlineOrders/saleCreator.js for the delivery prefix.
 *
 *   node --test tests/invoicePrefixes.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const STORE = "c0000000-0000-4000-8000-000000000003";
const TERMINAL = "t0000000-0000-4000-8000-000000000001";
const USER = "u0000000-0000-4000-8000-000000000001";

/* ------------------------------------------------- settings fake db */

function makeSettingsDb() {
  const state = {
    row: {
      company_id: COMPANY,
      till_invoice_prefix: "TO",
      delivery_invoice_prefix: "DEL",
      self_checkout_invoice_prefix: "SC",
      terminal_number: "T01",
    },
    saved: [],
  };
  const rows = (sql, params) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM companies c LEFT JOIN company_settings cs ON cs\.company_id = c\.id/.test(s)) {
      return { rows: [{ ...state.row, company_name: "Co", store_id: STORE, store_name: "London", till_id: null, till_name: null }] };
    }
    if (/INSERT INTO company_settings \(company_id, date_format/.test(s)) {
      /* Mirrors the route's COALESCE: null keeps the stored value.
         Prefix params are 13/14/15. */
      const next = { ...state.row };
      if (params[12] != null) next.till_invoice_prefix = params[12];
      if (params[13] != null) next.delivery_invoice_prefix = params[13];
      if (params[14] != null) next.self_checkout_invoice_prefix = params[14];
      state.saved.push({ till: params[12], delivery: params[13], selfCheckout: params[14] });
      state.row = next;
      return { rows: [] };
    }
    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
    return { rows: [] };
  };
  const db = async (sql, params = []) => rows(sql, params);
  const client = { async query(sql, params = []) { return rows(sql, params); }, release() {} };
  return { state, db, pool: { async connect() { return client; } } };
}

async function buildSettingsApp(ctx) {
  const mod = await import("../routes/settings.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY, storeId: STORE, roleId: "r1", username: "admin" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_q, _s, n) => n(),
    authorize: () => (_q, _s, n) => n(),
    db: ctx.db,
    pool: ctx.pool,
    writeAudit: async () => {},
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const req = async (port, method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const SETTINGS_BODY = {
  companyName: "Co",
  dateFormat: "DD/MM/YYYY",
  vatEnabled: true,
  defaultVatRate: 20,
  loyaltyEnabled: false,
  scanGoEnabled: false,
  onlineOrderingEnabled: false,
};

describe("Invoice prefixes in Settings (GET/PUT)", () => {
  test("GET returns the three prefixes with TO/DEL/SC defaults", async () => {
    const ctx = makeSettingsDb();
    const app = await buildSettingsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/settings");
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.invoicePrefixes, { till: "TO", delivery: "DEL", selfCheckout: "SC" });
    } finally { server.close(); }
  });

  test("PUT changes each prefix; GET round-trips the new values", async () => {
    const ctx = makeSettingsDb();
    const app = await buildSettingsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/settings", {
        ...SETTINGS_BODY,
        invoicePrefixes: { till: "SHOP", delivery: "WEB", selfCheckout: "KIOSK" },
      });
      assert.equal(put.status, 200);

      const get = await req(port, "GET", "/api/settings");
      assert.deepEqual(get.body.data.invoicePrefixes, { till: "SHOP", delivery: "WEB", selfCheckout: "KIOSK" });
    } finally { server.close(); }
  });

  test("PUT with a missing prefix key keeps the stored value (no accidental reset)", async () => {
    const ctx = makeSettingsDb();
    ctx.state.row.till_invoice_prefix = "SHOP";
    const app = await buildSettingsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/settings", {
        ...SETTINGS_BODY,
        invoicePrefixes: { delivery: "WEB" }, // till + selfCheckout omitted
      });
      assert.equal(put.status, 200);
      const get = await req(port, "GET", "/api/settings");
      assert.deepEqual(get.body.data.invoicePrefixes, { till: "SHOP", delivery: "WEB", selfCheckout: "SC" });
    } finally { server.close(); }
  });

  test("PUT without the whole invoicePrefixes object changes nothing", async () => {
    const ctx = makeSettingsDb();
    const app = await buildSettingsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/settings", { ...SETTINGS_BODY });
      assert.equal(put.status, 200);
      assert.equal(ctx.state.saved.length, 1);
      assert.deepEqual(ctx.state.saved[0], { till: null, delivery: null, selfCheckout: null });
      const get = await req(port, "GET", "/api/settings");
      assert.deepEqual(get.body.data.invoicePrefixes, { till: "TO", delivery: "DEL", selfCheckout: "SC" });
    } finally { server.close(); }
  });

  test("invalid prefixes rejected: too long, non-alphanumeric, non-string", async () => {
    for (const bad of [
      { till: "TOOLONGPREFIX" },
      { delivery: "DE L" },
      { selfCheckout: "SC#1" },
      { till: 42 },
    ]) {
      const ctx = makeSettingsDb();
      const app = await buildSettingsApp(ctx);
      const { server, port } = await listen(app);
      try {
        const put = await req(port, "PUT", "/api/settings", { ...SETTINGS_BODY, invoicePrefixes: bad });
        assert.equal(put.status, 400, JSON.stringify(bad));
      } finally { server.close(); }
    }
  });
});

/* ------------------------------------------------- sale engine fake db */

function makeSalesDb({ prefixes = {}, mode = null } = {}) {
  const state = {
    sales: [],
    saleItems: [],
    payments: [],
    settingsRow: {
      till_invoice_prefix: prefixes.till ?? null,
      self_checkout_invoice_prefix: prefixes.selfCheckout ?? null,
      delivery_invoice_prefix: prefixes.delivery ?? null,
    },
    nextNumber: 1,
  };
  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/SELECT till_invoice_prefix, self_checkout_invoice_prefix FROM company_settings/.test(s)) {
        return { rows: [state.settingsRow] };
      }
      if (/SELECT ts\.id, ts\.terminal_id, t\.terminal_number, c\.timezone FROM till_sessions ts/.test(s)) {
        return { rows: [{ id: "till-1", terminal_id: TERMINAL, terminal_number: "T01", timezone: "Europe/London" }] };
      }
      if (/to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) return { rows: [{ date_key: "20260919" }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) {
        return { rows: [{ next_number: state.nextNumber }] };
      }
      if (/SELECT allow_negative_inventory_billing FROM company_settings/.test(s)) return { rows: [] };
      if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
        const found = state.sales.find((sale) => sale.client_request_id === params[1]);
        return { rows: found ? [{ id: found.id, created_at: found.created_at, total: found.total, receipt_number: found.receipt_number }] : [] };
      }
      if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        return { rows: [{ id: params[0], name: "Tea", price: 3, stock_quantity: 5, track_stock: false, age_restricted: false }] };
      }
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0],
          receipt_number: params[5],
          total: Number(params[9]) || 0,
          client_request_id: params[10] ?? null,
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        state.nextNumber += 1;
        return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
      }
      if (/INSERT INTO sale_items \(/.test(s)) { state.saleItems.push(params); return { rows: [] }; }
      if (/INSERT INTO payments/.test(s)) { state.payments.push({ method: params[1] }); return { rows: [] }; }
      if (/INSERT INTO inventory_movements/.test(s)) return { rows: [{ balance: 0 }] };
      if (/loyalty_enabled/.test(s)) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = async (sql) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: TERMINAL, terminal_number: "T01", timezone: "Europe/London" }] };
    }
    return { rows: [], rowCount: 0 };
  };
  return { state, db, pool: { async connect() { return client; } } };
}

async function buildSalesApp(ctx, { mode: userMode = null } = {}) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY, storeId: STORE, roleId: "r1", username: "till", ...(userMode ? { mode: userMode } : {}) };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_q, _s, n) => n(),
    authorize: () => (_q, _s, n) => n(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0 }),
    associateCustomerWithStore: async () => {},
    writeAudit: async () => {},
    selfCheckoutMode: (r) => r.user?.mode === "self_checkout",
  }));
  return app;
}

const SALE_BODY = {
  items: [{ productId: "p-1", quantity: 1, unitPrice: 3, tax: 0, discount: 0, total: 3 }],
  subtotal: 3,
  tax: 0,
  discount: 0,
  total: 3,
  paymentMethod: "card",
};

describe("Receipt prefixes by sale source (routes/sales.js)", () => {
  test("staff till sale uses the configured TILL prefix", async () => {
    const ctx = makeSalesDb({ prefixes: { till: "TO" } });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.match(r.body.sale.receipt_number, /^TO-20260919-\d{4}$/);
      assert.equal(r.body.sale.receipt_number, "TO-20260919-0001");
    } finally { server.close(); }
  });

  test("self-checkout sale uses the configured SELF-CHECKOUT prefix (same engine)", async () => {
    const ctx = makeSalesDb({ prefixes: { till: "TO", selfCheckout: "SC" } });
    const app = await buildSalesApp(ctx, { mode: "self_checkout" });
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.match(r.body.sale.receipt_number, /^SC-20260919-\d{4}$/);
    } finally { server.close(); }
  });

  test("no configured prefix → legacy terminal-number prefix applies unchanged", async () => {
    const ctx = makeSalesDb({ prefixes: {} });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(r.status, 201);
      assert.match(r.body.sale.receipt_number, /^T01-20260919-\d{4}$/);
    } finally { server.close(); }
  });

  test("numbering continues correctly after a prefix change (no reset, no collision)", async () => {
    const ctx = makeSalesDb({ prefixes: { till: "TO" } });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const first = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(first.body.sale.receipt_number, "TO-20260919-0001");

      /* Company changes the till prefix mid-day (simulated via the settings
         row the engine reads inside the transaction). */
      ctx.state.settingsRow.till_invoice_prefix = "SHOP";

      const second = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(second.body.sale.receipt_number, "SHOP-20260919-0002",
        "sequence continues (0002, not 0001) — the counter is per terminal/day, not per prefix");

      /* Changing BACK still continues: 0003. */
      ctx.state.settingsRow.till_invoice_prefix = "TO";
      const third = await req(port, "POST", "/api/sales", SALE_BODY);
      assert.equal(third.body.sale.receipt_number, "TO-20260919-0003");
    } finally { server.close(); }
  });
});

/* ------------------------------------------------- delivery (saleCreator) */

function makeDeliveryClient(state) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/SELECT delivery_invoice_prefix FROM company_settings/.test(s)) {
        return { rows: [{ delivery_invoice_prefix: state.deliveryPrefix }] };
      }
      if (/SELECT \* FROM sales WHERE online_order_id = \$1/.test(s)) return { rows: [] };
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = { id: "sale-1", receipt_number: params[3] };
        state.sales.push(sale);
        return { rows: [sale] };
      }
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      if (/UPDATE online_orders SET status/.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("Delivery receipts use the configured DELIVERY prefix (saleCreator)", () => {
  test("completed online order receipt = DEL-<external order id>", async () => {
    const state = { deliveryPrefix: "DEL", sales: [] };
    const mod = await import("../services/onlineOrders/saleCreator.js");
    const sale = await mod.createSaleForCompletedOrder(makeDeliveryClient(state), {
      order: { id: "ord-1", company_id: COMPANY, store_id: STORE, platform: "uber", external_order_id: "UBER-ORD-9" },
      items: [],
      user: { id: USER },
    });
    assert.equal(sale.sale.receipt_number, "DEL-UBER-ORD-9");
  });

  test("company-configured delivery prefix replaces the platform name", async () => {
    const state = { deliveryPrefix: "WEB", sales: [] };
    const mod = await import("../services/onlineOrders/saleCreator.js");
    const sale = await mod.createSaleForCompletedOrder(makeDeliveryClient(state), {
      order: { id: "ord-2", company_id: COMPANY, store_id: STORE, platform: "deliveroo", external_order_id: "DR-77" },
      items: [],
      user: { id: USER },
    });
    assert.equal(sale.sale.receipt_number, "WEB-DR-77");
  });

  test("no settings row → legacy platform-name prefix unchanged (regression)", async () => {
    const state = { deliveryPrefix: null, sales: [] };
    const mod = await import("../services/onlineOrders/saleCreator.js");
    const sale = await mod.createSaleForCompletedOrder(makeDeliveryClient(state), {
      order: { id: "ord-3", company_id: COMPANY, store_id: STORE, platform: "uber", external_order_id: "UBER-LEGACY" },
      items: [],
      user: { id: USER },
    });
    assert.equal(sale.sale.receipt_number, "UBER EATS-UBER-LEGACY".replace(/\s+/g, "-"));
  });
});

/* ------------------------------------------------- schema + static contracts */

describe("Invoice prefix persistence contracts", () => {
  const SCHEMA = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
  const INIT = fs.readFileSync(new URL("../database/init.js", import.meta.url), "utf8");
  const SETTINGS = fs.readFileSync(new URL("../routes/settings.js", import.meta.url), "utf8");
  const UI = fs.readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");

  test("three prefix columns exist with TO/DEL/SC defaults (schema + live migration)", () => {
    assert.match(SCHEMA, /till_invoice_prefix VARCHAR\(10\) NOT NULL DEFAULT 'TO'/);
    assert.match(SCHEMA, /delivery_invoice_prefix VARCHAR\(10\) NOT NULL DEFAULT 'DEL'/);
    assert.match(SCHEMA, /self_checkout_invoice_prefix VARCHAR\(10\) NOT NULL DEFAULT 'SC'/);
    assert.match(INIT, /ADD COLUMN IF NOT EXISTS till_invoice_prefix/);
    assert.match(INIT, /ADD COLUMN IF NOT EXISTS delivery_invoice_prefix/);
    assert.match(INIT, /ADD COLUMN IF NOT EXISTS self_checkout_invoice_prefix/);
  });

  test("sale engine picks the prefix by source; numbering stays per terminal/day", () => {
    const SALES = fs.readFileSync(new URL("../routes/sales.js", import.meta.url), "utf8");
    assert.match(SALES, /self_checkout_invoice_prefix/);
    assert.match(SALES, /isSelfCheckoutSale/);
    assert.match(SALES, /MAX\(NULLIF\(split_part\(receipt_number, '-', 3\), ''\)::int\), 0\) \+ 1/);
  });

  test("delivery receipts use the delivery_invoice_prefix setting", () => {
    const CREATOR = fs.readFileSync(new URL("../services/onlineOrders/saleCreator.js", import.meta.url), "utf8");
    assert.match(CREATOR, /delivery_invoice_prefix FROM company_settings/);
  });

  test("Settings page exposes the three prefix fields on the existing page", () => {
    /* The field testids are generated from the same key list the UI renders,
       so pin the generated pattern plus each rendered key. */
    assert.match(UI, /data-testid=\{`invoice-prefix-\$\{field\.key\}`\}/);
    assert.match(UI, /key: "till"/);
    assert.match(UI, /key: "delivery"/);
    assert.match(UI, /key: "selfCheckout"/);
    assert.match(UI, /Invoice Prefixes/);
  });
});
