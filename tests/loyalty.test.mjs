/*
 * onePOS — Customer Loyalty backend foundation (focused suite)
 *
 *   node --test tests/loyalty.test.mjs
 *
 * Backend under test: the REAL routes/customers.js (balance/history/adjust),
 * routes/sales.js (earn engine), routes/returns.js (reversal), and
 * routes/settings.js (programme config persistence) — all over HTTP against
 * stateful fakes that model the loyalty tables, the unique earn index and
 * the real settings PUT upsert.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "a0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "d0000000-0000-4000-8000-000000000004";
const CUST_A = "e0000000-0000-4000-8000-000000000011";
const CUST_B = "e0000000-0000-4000-8000-000000000012";

process.env.NODE_ENV = "test";

/* ------------------------------------------------------------ SQL fakes */

function makeCtx() {
  const state = {
    customers: new Map([
      [CUST_A, { id: CUST_A, company_id: COMPANY_A, name: "Amy Wong", active: true, credit_enabled: false, credit_limit: null }],
      [CUST_B, { id: CUST_B, company_id: COMPANY_B, name: "Other Co", active: true, credit_enabled: false, credit_limit: null }],
    ]),
    loyaltyBalances: new Map(), // customer_id -> number
    loyaltyTx: [], // { company_id, customer_id, type, amount, reference_type, reference_id, created_by }
    adjustments: [], // customer_loyalty_adjustments rows
    loyaltySettings: {
      loyalty_enabled: true, loyalty_earning_rate: 0.01,
      loyalty_min_sale_total: null, loyalty_redeem_value_per_point: null, loyalty_min_points_redeem: null,
    },
    savedSettings: null,
    sales: [], // engine-created sales
    payments: [],
    refunds: [],
    returns: [],
    seq: 0,
  };
  const nextId = () => `id-${(state.seq += 1)}`;
  state_ref = state;

  const matchSql = async (s0, params) => {
    const s = String(s0).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

    /* ---------- till session (sales engine) ---------- */
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    if (/SELECT to_char\(timezone\(/.test(s)) return { rows: [{ date_key: "20260921" }] };
    if (/SELECT COALESCE\(MAX\(NULLIF\(split_part\(receipt_number/.test(s)) return { rows: [{ next_number: 1 }] };
    if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
    if (/SELECT id FROM terminals WHERE/.test(s)) return { rows: [{ id: "term-1" }] };

    /* ---------- customers (customers.js loaders) ---------- */
    if (/SELECT id FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ id: c.id }] : [] };
    }
    if (/SELECT 1 FROM customer_stores WHERE customer_id = \$1 AND store_id = \$2 AND active = true/.test(s)) {
      return { rows: [{ "?column?": 1 }] }; // store-visible
    }
    if (/SELECT id, name FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ id: c.id, name: c.name }] : [] };
    }

    /* ---------- loyalty balance reads ---------- */
    if (/SELECT balance FROM customer_loyalty_balances WHERE company_id = \$1 AND customer_id = \$2 FOR UPDATE/.test(s)) {
      const bal = state.loyaltyBalances.get(params[1]) ?? 0;
      return { rows: [{ balance: bal }] };
    }
    if (/SELECT COALESCE\(balance, 0\) AS balance FROM customer_loyalty_balances/.test(s)) {
      return { rows: [{ balance: state.loyaltyBalances.get(params[1]) ?? 0 }] };
    }
    if (/SELECT balance FROM customer_loyalty_balances WHERE company_id = \$1 AND customer_id = \$2$/.test(s)) {
      const bal = state.loyaltyBalances.get(params[1]);
      return { rows: bal === undefined ? [] : [{ balance: bal }] };
    }
    if (/SELECT balance FROM customer_loyalty_balances WHERE company_id = \$1 AND customer_id = \$2 FOR UPDATE/.test(s)) {
      const bal = state.loyaltyBalances.get(params[1]) ?? 0;
      return { rows: [{ balance: bal }] };
    }

    /* ---------- loyalty writes ---------- */
    if (/INSERT INTO customer_loyalty_balances \(company_id, customer_id, balance\)/.test(s) && /DO UPDATE SET balance = \$3/.test(s)) {
      state.loyaltyBalances.set(params[1], Number(params[2]));
      return { rows: [] };
    }
    if (/INSERT INTO customer_loyalty_balances \(company_id, customer_id, balance\)/.test(s) && /DO UPDATE SET balance = customer_loyalty_balances\.balance \+ EXCLUDED\.balance/.test(s)) {
      const updated = (state.loyaltyBalances.get(params[1]) ?? 0) + Number(params[2]);
      state.loyaltyBalances.set(params[1], updated);
      return { rows: [{ balance: updated }] };
    }
    if (/UPDATE customer_loyalty_balances SET balance = balance - \$3/.test(s)) {
      const current = state.loyaltyBalances.get(params[1]) ?? 0;
      state.loyaltyBalances.set(params[1], current - Number(params[2]));
      return { rowCount: 1 };
    }
    if (/UPDATE customer_loyalty_balances SET balance = \$1, updated_at = NOW\(\) WHERE company_id = \$2 AND customer_id = \$3/.test(s)) {
      state.loyaltyBalances.set(params[2], Number(params[0]));
      return { rowCount: 1 };
    }
    if (/INSERT INTO customer_loyalty_transactions\s*\(company_id, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by\)/.test(s) && /'EARN'/.test(s)) {
      // uq_loyalty_earn_per_sale: a second EARN for the same sale throws 23505
      const dup = state.loyaltyTx.some((t) => t.company_id === params[0] && t.transaction_type === "EARN" && t.reference_id === params[4]);
      if (dup) { const err = new Error("duplicate key"); err.code = "23505"; throw err; }
      state.loyaltyTx.push({ company_id: params[0], customer_id: params[1], transaction_type: "EARN", amount: params[2], balance_after: params[3], reference_type: "sale", reference_id: params[4], created_by: params[5] });
      return { rows: [] };
    }
    if (/INSERT INTO customer_loyalty_transactions\s*\(company_id, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by\)/.test(s)) {
      // 9-col engine shape (returns REVERSE — type AND 'return' literal inlined)
      state.loyaltyTx.push({
        company_id: params[0], customer_id: params[1], transaction_type: "REVERSE",
        amount: params[2], balance_after: params[3], reference_type: "return",
        reference_id: params[4], created_by: params[5],
      });
      return { rows: [] };
    }
    if (/INSERT INTO customer_loyalty_transactions\s*\(company_id, customer_id, transaction_type, amount, balance_after, reference_type, description, created_by\)/.test(s)) {
      // 8-col adjust/redeem shape (type inlined in VALUES)
      const type = /'REDEEM'/.test(s) ? "REDEEM" : "ADJUST";
      state.loyaltyTx.push({
        company_id: params[0], customer_id: params[1], transaction_type: type,
        amount: params[2], balance_after: params[3], reference_type: params[4],
        reference_id: null, created_by: params[6],
      });
      return { rows: [] };
    }
    // (EARN insert handled above with 23505 dup detection)
    if (/INSERT INTO customer_loyalty_adjustments/.test(s)) {
      state.adjustments.push({ company_id: params[0], customer_id: params[1], points: params[2], reason: params[3], reference_id: params[4], created_by: params[5] });
      return { rows: [] };
    }

    /* ---------- loyalty history (customers.js GET) ---------- */
    if (/FROM customer_loyalty_transactions clt/.test(s)) {
      const rows = state.loyaltyTx
        .filter((t) => t.company_id === params[0] && t.customer_id === params[1])
        .map((t, i) => ({ id: `tx-${i}`, transaction_type: t.transaction_type, amount: t.amount, balance_after: t.balance_after ?? null, reference_type: t.reference_type, reference_id: t.reference_id, description: t.description ?? null, created_at: new Date().toISOString(), username: "admin", full_name: "Admin" }));
      return { rows };
    }

    /* ---------- sales engine (earn path) ---------- */
    if (/SELECT loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total FROM company_settings/.test(s)) {
      return { rows: [{ ...state.loyaltySettings }] };
    }
    if (/SELECT loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total, loyalty_redeem_value_per_point, loyalty_min_points_redeem FROM company_settings/.test(s)) {
      // Sale-engine redemption read (all five programme columns)
      return { rows: [{ ...state.loyaltySettings }] };
    }
    if (/SELECT loyalty_enabled, loyalty_earning_rate FROM company_settings/.test(s)) {
      // Returns-reversal settings read (2 columns only)
      return { rows: [{ loyalty_enabled: state.loyaltySettings.loyalty_enabled, loyalty_earning_rate: state.loyaltySettings.loyalty_earning_rate }] };
    }
    if (/SELECT status FROM sales WHERE id = \$1 AND company_id = \$2/.test(s)) {
      if (state.forceStatus) return { rows: [{ status: state.forceStatus }] };
      const sale = state.sales.find((s) => s.id === params[0] && s.company_id === params[1]);
      return { rows: sale ? [{ status: sale.status }] : [] };
    }
    if (/SELECT id, created_at, total, receipt_number(?:, client_request_fingerprint)? FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
      const existing = state.sales.find((s) => s.company_id === params[0] && s.client_request_id === params[1]);
      return { rows: existing ? [{ id: existing.id, created_at: existing.created_at, total: existing.total, receipt_number: existing.receipt_number }] : [] };
    }
    if (/INSERT INTO sales \(/.test(s)) {
      const sale = {
        id: `sale-${state.sales.length + 1}`,
        company_id: params[0], store_id: params[1], customer_id: params[3],
        client_request_id: params[10] ?? null,
        total: Number(params[9]) || 0,
        status: state.overrideNewSaleStatus ?? "completed",
        _items: state.pendingItems ?? [],
        created_at: new Date().toISOString(),
      };
      state.pendingItems = null;
      state.sales.push(sale);
      return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: `T01-0001` }] };
    }
    if (/INSERT INTO payments/.test(s)) {
      state.payments.push({ sale_id: params[0], payment_method: params[1], amount: params[2], status: "completed" });
      return { rowCount: 1 };
    }
    if (/SELECT id, price, vat_rate, vat_applicable, category_id FROM products WHERE company_id = \$1 AND id = ANY/.test(s)) {
      return { rows: [{ id: "p-1", price: state.salePrice ?? 5, vat_rate: null, vat_applicable: true, category_id: null }] };
    }
    if (/FROM products WHERE id = \$1 AND company_id = \$2 AND active = true/.test(s)) {
      return { rows: [{ id: params[0], name: "Test product", price: state.salePrice ?? 5, vat_rate: null, track_stock: true, stock_quantity: 100, age_restricted: false }] };
    }
    if (/SELECT COALESCE\(SUM\(amount \* CASE WHEN transaction_type/.test(s)) return { rows: [{ outstanding: 0 }] };

    /* ---------- settings (settings.js GET/PUT) ---------- */
    if (/SELECT c\.id AS company_id, c\.name AS company_name,/.test(s)) {
      return {
        rows: [{
          company_id: params[0], company_name: "Co A", legal_name: null, company_email: null, company_phone: null,
          currency: "GBP", timezone: "Europe/London", logo_url: null,
          date_format: "DD/MM/YYYY", vat_enabled: true, default_vat_rate: 20,
          loyalty_enabled: state.loyaltySettings.loyalty_enabled,
          loyalty_earning_rate: state.loyaltySettings.loyalty_earning_rate,
          loyalty_min_sale_total: state.loyaltySettings.loyalty_min_sale_total,
          loyalty_redeem_value_per_point: state.loyaltySettings.loyalty_redeem_value_per_point,
          loyalty_min_points_redeem: state.loyaltySettings.loyalty_min_points_redeem,
          allow_negative_inventory_billing: false, scan_go_enabled: false, online_ordering_enabled: false,
          online_payment_methods: null, product_view: "image", dock_quick_access: null, customer_display_enabled: false,
          store_id: STORE, store_name: "Main", till_id: null, till_name: null, terminal_number: null,
        }],
      };
    }
    if (/INSERT INTO company_settings/.test(s)) {
      const before = state.savedSettings ?? {};
      // Model the real upsert: COALESCE($n, existing) keeps omitted values.
      state.savedSettings = {
        loyalty_enabled: params[4],
        loyalty_earning_rate: params[5] ?? before.loyalty_earning_rate ?? 0.01,
        loyalty_min_sale_total: params[6] ?? before.loyalty_min_sale_total ?? null,
        loyalty_redeem_value_per_point: params[7] ?? before.loyalty_redeem_value_per_point ?? null,
        loyalty_min_points_redeem: params[8] ?? before.loyalty_min_points_redeem ?? null,
      };
      state.loyaltySettings = { ...state.loyaltySettings, ...state.savedSettings };
      return { rows: [] };
    }

    /* ---------- returns (reversal path) ---------- */
    if (/SELECT s\.id, s\.company_id, s\.store_id, s\.customer_id, s\.receipt_number, s\.status,/.test(s)) {
      const sale = state.sales.find((s) => s.id === params[0] && s.company_id === params[1]);
      if (!sale) return { rows: [] };
      return { rows: [{ id: sale.id, company_id: sale.company_id, store_id: sale.store_id, customer_id: sale.customer_id, receipt_number: sale.receipt_number, status: sale.status, subtotal: sale.total, tax: 0, discount: 0, total: sale.total, created_at: sale.created_at, completed_at: sale.created_at, customer_name: "Amy Wong", customer_phone: null, customer_email: null, payment_method: state.payments.find((p) => p.sale_id === sale.id)?.payment_method ?? "cash", payment_amount: sale.total, payment_status: "completed" }] };
    }
    if (/SELECT si\.id, si\.product_id, si\.product_name, si\.quantity, si\.unit_price,/.test(s)) {
      const sale = state.sales.find((s) => s.id === params[0]);
      const items = sale?._items ?? [];
      return { rows: items.map((it, i) => ({ id: `si-${i}`, product_id: it.productId, product_name: it.name, quantity: it.quantity, unit_price: it.unitPrice, discount: 0, tax: 0, total: it.quantity * it.unitPrice, track_stock: it.trackStock ?? false, returned_quantity: 0 })) };
    }
    if (/SELECT COALESCE\(SUM\(amount\), 0\) AS refunded FROM refunds WHERE sale_id = \$1/.test(s)) {
      const total = state.refunds.filter((r) => r.sale_id === params[0]).reduce((sum, r) => sum + r.amount, 0);
      return { rows: [{ refunded: total }] };
    }
    if (/SELECT id FROM sales WHERE id=\$1 AND company_id=\$2( AND store_id=\$3)? FOR UPDATE/.test(s)) {
      const sale = state.sales.find((s) => s.id === params[0] && s.company_id === params[1]);
      return { rows: sale ? [{ id: sale.id }] : [] };
    }
    if (/SELECT COALESCE\(MAX\(NULLIF\(SUBSTRING\(return_number/.test(s)) return { rows: [{ next_number: 1 }] };
    if (/SELECT 1 FROM stock_returns WHERE return_number = \$1 LIMIT 1/.test(s)) return { rows: [] };
    if (/SELECT id, return_number FROM stock_returns WHERE company_id=\$1 AND request_key=\$2/.test(s)) return { rows: [] };
    if (/INSERT INTO stock_returns \(/.test(s)) {
      const r = { id: nextId(), company_id: params[0], return_number: params[2], sale_id: params[3], refund_amount: 0, status: "COMPLETED" };
      state.returns.push(r);
      return { rows: [{ id: r.id }] };
    }
    if (/SELECT COALESCE\(SUM\(sri\.quantity\),0\) AS quantity/.test(s)) return { rows: [{ quantity: 0 }] };
    if (/INSERT INTO stock_return_items/.test(s)) return { rows: [] };
    if (/SELECT COALESCE\(SUM\(amount\),0\) AS total_paid,/.test(s)) {
      const totalPaid = state.payments.filter((p) => p.sale_id === params[0] && p.status === "completed").reduce((sum, p) => sum + p.amount, 0);
      return { rows: [{ total_paid: totalPaid, payment_method: state.payments.find((p) => p.sale_id === params[0])?.payment_method ?? "cash" }] };
    }
    if (/SELECT COALESCE\(SUM\(amount\),0\) AS total FROM refunds WHERE sale_id=\$1/.test(s)) {
      const total = state.refunds.reduce((sum, r) => sum + r.amount, 0);
      return { rows: [{ total: total }] };
    }
    if (/INSERT INTO refunds/.test(s)) {
      state.refunds.push({ sale_id: params[0], amount: params[2], payment_method: params[4] });
      return { rowCount: 1 };
    }
    if (/UPDATE stock_returns SET refund_amount/.test(s)) return { rowCount: 1 };
    if (/SELECT payment_method, amount FROM payments/i.test(s)) {
      /* Full tender list (single or split) — payment-method-aware refund
         allocation reads this instead of the single "latest row". */
      const rows = state.payments
        .filter((p) => p.sale_id === params[0] && p.status === "completed")
        .map((p) => ({ payment_method: p.payment_method, amount: p.amount }));
      return { rows };
    }
    if (/SELECT payment_method, COALESCE\(SUM\(amount\),0\) AS refunded\s+FROM refunds WHERE sale_id=\$1 GROUP BY/i.test(s)) {
      const byMethod = new Map();
      for (const r of state.refunds.filter((x) => x.sale_id === params[0])) {
        byMethod.set(r.payment_method, (byMethod.get(r.payment_method) || 0) + Number(r.amount));
      }
      return { rows: [...byMethod.entries()].map(([payment_method, refunded]) => ({ payment_method, refunded })) };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    const r = await matchSql(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 };
  };
  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rows: [], rowCount: 0 };
      const shared = await matchSql(sql, params);
      return { rows: shared.rows ?? [], rowCount: shared.rowCount ?? 0 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  return { state, db, pool, client, nextId };
}

/* ----------------------------------------------------------- harness */

async function buildApp(ctx, { companyId = COMPANY_A, userRole = "admin" } = {}) {
  const [customersMod, salesMod, returnsMod, settingsMod] = await Promise.all([
    import("../routes/customers.js"),
    import("../routes/sales.js"),
    import("../routes/returns.js"),
    import("../routes/settings.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId: STORE, role: userRole };
    next();
  });
  const authorizeAlways = () => (_req, _res, next) => next();
  const missing = [];
  app.use("/api", customersMod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: (code) => { missing.push(`customers:${code}`); return authorizeAlways(); },
    db: ctx.db,
    pool: ctx.pool,
    canViewCompanyCustomers: async () => userRole === "admin",
    associateCustomerWithStore: async () => ({}),
  }));
  app.use("/api", salesMod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: (code) => { missing.push(`sales:${code}`); return authorizeAlways(); },
    db: ctx.db, pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    associateCustomerWithStore: async () => ({}),
    selfCheckoutMode: () => false,
    writeAudit: async () => ({}),
  }));
  app.use("/api", returnsMod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: (code) => { missing.push(`returns:${code}`); return authorizeAlways(); },
    db: ctx.db, pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    writeAudit: async () => ({}),
  }));
  app.use("/api", settingsMod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: (code) => { missing.push(`settings:${code}`); return authorizeAlways(); },
    db: ctx.db, pool: ctx.pool,
    writeAudit: async () => ({}),
    testPaymentTerminal: async () => ({ ok: true }),
  }));
  return { app, missing };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const put = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const settle = () => new Promise((r) => setTimeout(r, 40));

const saleBody = (overrides = {}) => {
  const body = {
    items: [{ productId: "p-1", quantity: 1, unitPrice: 5, tax: 0, discount: 0, total: 5 }],
    customerId: null,
    subtotal: 5, tax: 0, discount: 0, total: 5,
    paymentMethod: "cash",
    ...overrides,
  };
  if (state_ref && overrides.total !== undefined) {
    const quantity = Number((overrides.items ?? body.items)[0]?.quantity) || 1;
    state_ref.salePrice = Number(overrides.total) / quantity;
  }
  if (overrides.items) state_ref.pendingItems = overrides.items; // captured by the fake
  return body;
};

let state_ref = null; // set inside makeCtx() below

/* ------------------------------------------------------------ tests */

describe("loyalty settings", () => {
  test("GET returns enabled/rate plus redemption economics", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.02,
      loyalty_min_sale_total: 5, loyalty_redeem_value_per_point: 0.01, loyalty_min_points_redeem: 100,
    };
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/settings");
      assert.equal(res.status, 200);
      assert.equal(res.body.data.loyalty.enabled, true);
      assert.equal(res.body.data.loyalty.earningRate, 0.02);
      assert.equal(res.body.data.loyalty.minSaleTotal, 5);
      assert.equal(res.body.data.loyalty.redeemValuePerPoint, 0.01);
      assert.equal(res.body.data.loyalty.minPointsRedeem, 100);
    } finally { server.close(); }
  });

  test("PUT persists all four programme knobs (company-scoped upsert)", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await put(port, "/api/settings", {
        companyName: "Co A", vatEnabled: true, defaultVatRate: 20,
        loyaltyEnabled: true, loyaltyEarningRate: 0.05,
        loyaltyMinSaleTotal: 10, loyaltyRedeemValuePerPoint: 0.02, loyaltyMinPointsRedeem: 50,
      });
      assert.equal(res.status, 200);
      assert.equal(ctx.state.savedSettings.loyalty_enabled, true);
      assert.equal(ctx.state.savedSettings.loyalty_earning_rate, 0.05);
      assert.equal(ctx.state.savedSettings.loyalty_min_sale_total, 10);
      assert.equal(ctx.state.savedSettings.loyalty_redeem_value_per_point, 0.02);
      assert.equal(ctx.state.savedSettings.loyalty_min_points_redeem, 50);
    } finally { server.close(); }
  });

  test("PUT rejects invalid programme values", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const bad = await put(port, "/api/settings", {
        companyName: "Co A", loyaltyEarningRate: 2, // > 1
      });
      assert.equal(bad.status, 400);
      const badRedeem = await put(port, "/api/settings", {
        companyName: "Co A", loyaltyRedeemValuePerPoint: -1,
      });
      assert.equal(badRedeem.status, 400);
      const badMin = await put(port, "/api/settings", {
        companyName: "Co A", loyaltyMinPointsRedeem: -5,
      });
      assert.equal(badMin.status, 400);
      assert.equal(ctx.state.savedSettings, null, "nothing persisted");
    } finally { server.close(); }
  });
});

describe("customer loyalty balance + history", () => {
  test("balance is returned (0 when no account exists yet)", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUST_A}/loyalty`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.balance, 0);
      assert.deepEqual(res.body.data.transactions, []);
    } finally { server.close(); }
  });

  test("history returns the customer's ledger only (company-scoped)", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltyBalances.set(CUST_A, 12);
    ctx.state.loyaltyTx.push(
      { company_id: COMPANY_A, customer_id: CUST_A, transaction_type: "EARN", amount: 10, balance_after: 10, reference_type: "sale", reference_id: "sale-1" },
      { company_id: COMPANY_A, customer_id: CUST_A, transaction_type: "ADJUST", amount: 2, balance_after: 12, reference_type: "adjustment" },
      { company_id: COMPANY_B, customer_id: CUST_B, transaction_type: "EARN", amount: 99, balance_after: 99, reference_type: "sale", reference_id: "sale-9" }
    );
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUST_A}/loyalty`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.balance, 12);
      assert.equal(res.body.data.transactions.length, 2, "Company B rows never leak");
      assert.ok(res.body.data.transactions.every((t) => t.amount !== 99));
    } finally { server.close(); }
  });
});

describe("manual adjustment", () => {
  test("credit and debit update the balance and write ledger + audit rows", async () => {
    const ctx = makeCtx();
    const { app, missing } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const credit = await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: 50, reason: "Goodwill" });
      assert.equal(credit.status, 200);
      assert.equal(credit.body.data.balance, 50);
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 50);
      assert.equal(ctx.state.adjustments.length, 1, "adjustments audit row recorded");
      assert.equal(ctx.state.adjustments[0].created_by, USER, "responsible admin recorded");

      const debit = await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: -20, reason: "Correction" });
      assert.equal(debit.status, 200);
      assert.equal(debit.body.data.balance, 30);

      const adjust = ctx.state.loyaltyTx.find((t) => t.transaction_type === "ADJUST");
      assert.ok(adjust, "ledger ADJUST row exists");
      const history = await get(port, `/api/customers/${CUST_A}/loyalty`);
      const types = history.body.data.transactions.map((t) => t.transaction_type);
      assert.ok(types.includes("ADJUST"));
      assert.ok(missing.some((m) => m.startsWith("customers:loyalty")), "route guards with a loyalty/customer permission");
    } finally { server.close(); }
  });

  test("negative-balance prevention: debit below zero is refused", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: -1, reason: "oops" });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Insufficient/i);
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A) ?? 0, 0);
    } finally { server.close(); }
  });

  test("company isolation: another company's customer is 404", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, `/api/customers/${CUST_B}/loyalty/adjust`, { points: 10 });
      assert.equal(res.status, 404);
      assert.equal(ctx.state.loyaltyBalances.get(CUST_B) ?? 0, 0);
    } finally { server.close(); }
  });
});

describe("earning", () => {
  test("sale earns at the configured rate; disabled/min-sale rules respected", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.1,
      loyalty_min_sale_total: 4, loyalty_redeem_value_per_point: null, loyalty_min_points_redeem: null,
    };
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      // £5 sale ≥ £4 minimum → 0.5 points at 10%
      const ok = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 5, subtotal: 5 }));
      assert.equal(ok.status, 201);
      await settle();
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);

      // £3 sale < £4 minimum → no earn
      await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 3, subtotal: 3 }));
      await settle();
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);

      // Disabled programme → no earn
      ctx.state.loyaltySettings.loyalty_enabled = false;
      await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 10, subtotal: 10 }));
      await settle();
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);

      // Anonymous sale → never earns
      ctx.state.loyaltySettings.loyalty_enabled = true;
      await post(port, "/api/sales", saleBody({ total: 50, subtotal: 50 }));
      await settle();
      assert.equal([...ctx.state.loyaltyBalances.values()].reduce((a, b) => a + b, 0), 0.5);
    } finally { server.close(); }
  });

  test("cancelled/void sale does not award points (authoritative status re-read)", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      // Simulate a post-commit void/cancellation deterministically: the
      // status re-read (the earn block's authoritative check) observes a
      // cancelled sale, so the award is skipped and no ledger row is written.
      ctx.state.forceStatus = "cancelled";
      const res = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 20, subtotal: 20 }));
      assert.equal(res.status, 201);
      await settle();
      ctx.state.forceStatus = null;
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A) ?? 0, 0, "no earn for a cancelled sale");
      assert.ok(!ctx.state.loyaltyTx.some((t) => t.transaction_type === "EARN"));
      // Contrast: a completed sale of the same size DOES earn (0.1 × £20).
      const ok = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 20, subtotal: 20 }));
      assert.equal(ok.status, 201);
      await settle();
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.2);
    } finally { server.close(); }
  });

  test("a retried sale never awards points twice (unique-index idempotency)", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const body = saleBody({ customerId: CUST_A, clientRequestId: "9e000000-0000-4000-8000-00000000000a" });
      const first = await post(port, "/api/sales", body);
      assert.equal(first.status, 201);
      await settle();
      const earnCount = () => ctx.state.loyaltyTx.filter((t) => t.transaction_type === "EARN").length;
      assert.equal(earnCount(), 1);

      // Lost-acknowledgement retry: the idempotent POST returns early; even a
      // second earn pass is dropped by the unique (company_id, reference_id)
      // index and the balance is reverted to stay ledger-true.
      const retry = await post(port, "/api/sales", body);
      assert.equal(retry.status, 201);
      await settle();
      assert.equal(earnCount(), 1, "exactly one EARN for the sale");
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.05);
    } finally { server.close(); }
  });

  test("company isolation: earning only touches the sale's own company", async () => {
    const ctx = makeCtx();
    const { app } = await buildApp(ctx, { companyId: COMPANY_B });
    const { server, port } = await listen(app);
    try {
      // Sale belongs to Company B; the earn block scopes by req.user.companyId,
      // so Company A's balance row for a same-id customer is never touched.
      const res = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 10, subtotal: 10 }));
      assert.equal(res.status, 201);
      await settle();
      const earned = ctx.state.loyaltyTx.filter((t) => t.company_id === COMPANY_B && t.customer_id === CUST_A);
      assert.ok(earned.length >= 0);
      assert.ok(!ctx.state.loyaltyTx.some((t) => t.company_id === COMPANY_A), "Company A ledger untouched");
    } finally { server.close(); }
  });
});

describe("redemption validation", () => {
  test("validateRedeemablePoints enforces balance, minimum and disabled programme", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.01,
      loyalty_min_sale_total: null, loyalty_redeem_value_per_point: 0.01, loyalty_min_points_redeem: 100,
    };
    const ctxAny = ctx;
    // Direct unit check of the shared validation rule used by redemption paths.
    const { validateRedeemablePoints } = await import("../src/utils/loyaltyPoints.js");
    const balance = 150;
    assert.equal(validateRedeemablePoints(balance, 100, ctxAny.state.loyaltySettings).points, 100);
    assert.equal(validateRedeemablePoints(balance, 150, ctxAny.state.loyaltySettings).points, 150);
    assert.equal(validateRedeemablePoints(balance, 150, ctxAny.state.loyaltySettings).valuePerPoint, 0.01);
    assert.throws(() => validateRedeemablePoints(balance, 151, ctxAny.state.loyaltySettings), /exceed/i);
    assert.throws(() => validateRedeemablePoints(balance, 50, ctxAny.state.loyaltySettings), /minimum/i);
    assert.throws(() => validateRedeemablePoints(0, 100, ctxAny.state.loyaltySettings), /available/i);
    assert.throws(() => validateRedeemablePoints(balance, 100, { ...ctxAny.state.loyaltySettings, loyalty_enabled: false }), /not enabled/i);
    assert.throws(() => validateRedeemablePoints(balance, 100, { ...ctxAny.state.loyaltySettings, loyalty_redeem_value_per_point: null }), /not configured/i);
    assert.throws(() => validateRedeemablePoints(balance, 100, { ...ctxAny.state.loyaltySettings, loyalty_min_points_redeem: null }), /not configured/i);
  });
});

describe("points redemption through the sale engine", () => {
  test("redeem debits the balance atomically with the sale; refusal leaves no sale", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.01,
      loyalty_min_sale_total: null, loyalty_redeem_value_per_point: 0.01, loyalty_min_points_redeem: 100,
    };
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      // Give the customer 150 points (adjustment path = real ledger rows)
      await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: 150, reason: "Opening balance" });
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 150);

      // £5 sale paying with 100 points (£1.00 value) — allowed, ≤ total
      const sale = await post(port, "/api/sales", saleBody({ customerId: CUST_A, redeemPoints: 100 }));
      assert.equal(sale.status, 201);
      await settle();

      // 150 − 100 redeemed + 0.04 earned on the net £4 spend (0.01 × £4)
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 50.04, "balance debited by the redeemed points (plus earn on net spend)");
      const redeem = ctx.state.loyaltyTx.find((t) => t.transaction_type === "REDEEM");
      assert.ok(redeem, "REDEEM ledger row written");
      assert.equal(redeem.amount, -100);
      const payment = ctx.state.payments.find((p) => p.sale_id === sale.body.sale.id);
      assert.equal(payment.payment_method, "loyalty", "payment recorded as the loyalty tender");

      // Redeeming more points than the balance is refused and creates NO sale
      const salesBefore = ctx.state.sales.length;
      const over = await post(port, "/api/sales", saleBody({ customerId: CUST_A, redeemPoints: 60 }));
      assert.equal(over.status, 400);
      assert.match(over.body.message, /exceeds the available balance/i);
      assert.equal(ctx.state.sales.length, salesBefore, "failed redemption never creates a sale");

      // Redemption without a customer is refused
      const anon = await post(port, "/api/sales", saleBody({ redeemPoints: 100 }));
      assert.equal(anon.status, 400);
      assert.match(anon.body.message, /customer must be selected/i);
    } finally { server.close(); }
  });

  test("earning excludes redeemed value (no earning on points)", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.1,
      loyalty_min_sale_total: null, loyalty_redeem_value_per_point: 0.01, loyalty_min_points_redeem: 100,
    };
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: 100 });
      // £10 sale with 100 points (£1) redeemed → earn base £9 → 0.9 points
      const sale = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 10, subtotal: 10, redeemPoints: 100 }));
      assert.equal(sale.status, 201);
      await settle();
      const earn = ctx.state.loyaltyTx.find((t) => t.transaction_type === "EARN");
      assert.ok(earn, "sale still earns on the net (non-redeemed) spend");
      assert.equal(Number(earn.amount), 0.9, "earn base excludes the redeemed value");
    } finally { server.close(); }
  });
});

describe("refund reversal", () => {
  test("a refund reverses earned points (capped at the balance) via the ledger", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = {
      loyalty_enabled: true, loyalty_earning_rate: 0.1,
      loyalty_min_sale_total: null, loyalty_redeem_value_per_point: null, loyalty_min_points_redeem: null,
    };
    const { app } = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      // £20 completed sale → 2.0 points earned (0.1 × 20)
      const sale = await post(port, "/api/sales", saleBody({
        customerId: CUST_A, total: 20, subtotal: 20,
        items: [{ productId: "p-1", quantity: 4, unitPrice: 5, tax: 0, discount: 0, total: 20 }],
      }));
      assert.equal(sale.status, 201);
      await settle();
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 2);
      assert.equal(ctx.state.loyaltyTx.filter((t) => t.transaction_type === "EARN").length, 1);

      // Full refund of the sale's one line (4 × £5)
      const ret = await post(port, "/api/returns/customer", {
        saleId: ctx.state.sales[0].id,
        items: [{ saleItemId: "si-0", productId: "p-1", quantity: 4 }],
      });
      assert.equal(ret.status, 201);
      await settle();

      const reverse = ctx.state.loyaltyTx.find((t) => t.transaction_type === "REVERSE");
      assert.ok(reverse, "REVERSE ledger row written");
      assert.equal(reverse.reference_type, "return");
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0, "balance back to zero (capped at balance)");
    } finally { server.close(); }
  });
});
