/*
 * T10Y — Customer Credit Management & Customer Ledger (permanent suite).
 *
 * Drives the REAL routes/customers.js + routes/sales.js credit paths over
 * HTTP against a stateful fake db that models customers, customer_stores,
 * customer_credit_ledger, sales and roles — same convention as
 * tests/customersManagement.test.mjs. The pure service layer
 * (services/customerCredit.js) is unit-tested directly (cents math, limit
 * checks, statement generation) so the suite runs without PostgreSQL.
 *
 *   node --test tests/customerCredit.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  toCents,
  fromCents,
  calculateBalance,
  checkCreditLimit,
  checkPayment,
  txSign,
  generateStatement,
  buildPaymentTransaction,
  buildAdjustmentTransaction,
  normalizeCreditLedgerTransaction,
} from "../services/customerCredit.js";

/* Real associateCustomerWithStore (ported verbatim from server.js, same as
 * tests/customersManagement.test.mjs) — the sale engine calls it whenever a
 * sale carries a customerId. */
async function associateCustomerWithStore(client, customerId, storeId, companyId, lastPurchaseAt = null) {
  const customer = await client.query(
    `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND active = true`,
    [customerId, companyId]
  );
  if (!customer.rows.length) throw new Error("Customer not found");
  const store = await client.query(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2 AND active = true`,
    [storeId, companyId]
  );
  if (!store.rows.length) throw new Error("Store not found");
  await client.query(
    `
    INSERT INTO customer_stores (customer_id, store_id, last_purchase_at)
    VALUES ($1,$2,$3)
    ON CONFLICT (customer_id, store_id) DO UPDATE SET
      active = true,
      last_purchase_at = CASE
        WHEN EXCLUDED.last_purchase_at IS NULL THEN customer_stores.last_purchase_at
        WHEN customer_stores.last_purchase_at IS NULL THEN EXCLUDED.last_purchase_at
        WHEN EXCLUDED.last_purchase_at > customer_stores.last_purchase_at THEN EXCLUDED.last_purchase_at
        ELSE customer_stores.last_purchase_at
      END
    `,
    [customerId, storeId, lastPurchaseAt]
  );
}

/* ----------------------------------------------- pure service unit tests */

describe("customer credit service (pure functions)", () => {
  test("toCents/fromCents round-trip without float drift", () => {
    assert.equal(toCents(19.99), 1999);
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(fromCents(1999), 19.99);
    assert.equal(toCents("not a number"), 0);
  });

  test("txSign directions: credit_sale/opening increase, payment/debit_note decrease", () => {
    assert.equal(txSign("credit_sale"), 1);
    assert.equal(txSign("opening"), 1);
    assert.equal(txSign("credit_note"), 1);
    assert.equal(txSign("payment"), -1);
    assert.equal(txSign("debit_note"), -1);
  });

  test("calculateBalance: credit sale increases, payment decreases", () => {
    const balance = calculateBalance([
      { transaction_type: "credit_sale", amount: 50 },
      { transaction_type: "payment", amount: 20 },
    ]);
    assert.equal(balance, 3000); // £30.00
  });

  test("available credit calculation", () => {
    const r = checkCreditLimit(2000, 1000, 5000); // £20 owed, £10 sale, £50 limit
    assert.equal(r.allowed, true);
    assert.equal(r.availableCredit, 3000);
    assert.equal(r.newBalance, 3000);
  });

  test("credit limit enforcement at the exact boundary", () => {
    assert.equal(checkCreditLimit(5000, 1, 5000).allowed, false); // £50 limit, £50 owed, 1p sale
    assert.equal(checkCreditLimit(4999, 1, 5000).allowed, true); // exactly £50 total is allowed
  });

  test("null limit means unlimited credit", () => {
    const r = checkCreditLimit(100000, 100000, null);
    assert.equal(r.allowed, true);
  });

  test("checkPayment rejects overpayment", () => {
    assert.deepEqual(checkPayment(2000, 2500), { allowed: false, overpayment: 500 });
    assert.equal(checkPayment(2000, 2000).allowed, true);
    assert.equal(checkPayment(2000, 1500).allowed, true);
  });

  test("generateStatement: opening balance, date filtering, running balance", () => {
    const t0 = "2026-01-01T10:00:00Z";
    const t1 = "2026-01-05T10:00:00Z";
    const t2 = "2026-01-10T10:00:00Z";
    const t3 = "2026-01-15T10:00:00Z";
    const transactions = [
      { id: "a", transaction_type: "credit_sale", amount: 100, created_at: t0 },
      { id: "b", transaction_type: "payment", amount: 40, created_at: t1 },
      { id: "c", transaction_type: "credit_sale", amount: 25, created_at: t2 },
      { id: "d", transaction_type: "payment", amount: 10, created_at: t3 },
    ];
    const s = generateStatement({ transactions, fromDate: "2026-01-03", toDate: "2026-01-31" });
    // Opening = balance before Jan 3 = £100 credit sale. Then −£40 +£25 −£10.
    assert.equal(s.openingBalance, 100);
    assert.equal(s.closingBalance, 75);
    assert.equal(s.transactions.length, 3);
    // Running balance is chronological.
    assert.equal(s.transactions[0].running_balance, 60);
    assert.equal(s.transactions[1].running_balance, 85);
    assert.equal(s.transactions[2].running_balance, 75);
  });

  test("statement with no date filter starts from zero", () => {
    const s = generateStatement({
      transactions: [{ transaction_type: "credit_sale", amount: 12.5, created_at: "2026-02-01" }],
    });
    assert.equal(s.openingBalance, 0);
    assert.equal(s.closingBalance, 12.5);
  });

  test("ledger transactions carry references and unsigned amounts", () => {
    const payment = buildPaymentTransaction({
      customerId: "c1", companyId: "co1", amount: 15, paymentMethod: "cash", userId: "u1",
    });
    assert.equal(payment.transaction_type, "payment");
    assert.equal(payment.amount, 15); // unsigned magnitude
    assert.ok(payment.reference_type);

    const debit = buildAdjustmentTransaction({
      customerId: "c1", companyId: "co1", amount: 5, adjustmentType: "debit_note", userId: "u1", reason: "goodwill",
    });
    assert.equal(debit.transaction_type, "debit_note");
    assert.equal(debit.amount, 5);
  });

  test("normalizeCreditLedgerTransaction derives direction from type", () => {
    const n = normalizeCreditLedgerTransaction({
      id: "t1", company_id: "co1", transaction_type: "payment", amount: 10, created_at: "2026-03-01T09:00:00Z",
    });
    assert.equal(n.is_credit_incurred, false);
    assert.equal(n.is_credit_repaid, true);
    assert.equal(n.amount, 10);
  });
});

/* ----------------------------------------------------- fake db + app */

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const ADMIN_ROLE = "r0000000-0000-4000-8000-00000000000a";
const STAFF_ROLE = "r0000000-0000-4000-8000-00000000000b";

function makeDb() {
  const state = {
    customers: new Map(),
    customerStores: [],
    ledger: [],
    sales: [],
    payments: [],
    products: new Map(),
    stores: new Map([
      [STORE_1, { id: STORE_1, company_id: COMPANY_A, name: "London", active: true }],
      [STORE_2, { id: STORE_2, company_id: COMPANY_A, name: "Leeds", active: true }],
    ]),
    roles: new Map([
      [ADMIN_ROLE, { id: ADMIN_ROLE, company_id: COMPANY_A, name: "Admin" }],
      [STAFF_ROLE, { id: STAFF_ROLE, company_id: COMPANY_A, name: "Staff" }],
    ]),
    saleIdSeq: 0,
  };

  const rows = (sql, params) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    /* ---------- customers (shared with routes/customers.js) ---------- */
    if (/SELECT id, name, company_id, credit_enabled, credit_limit FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [c] : [] };
    }
    if (/UPDATE customers SET credit_enabled/.test(s)) {
      const c = state.customers.get(params[2]);
      if (!c || c.company_id !== params[3]) return { rows: [] };
      c.credit_enabled = params[0] === true;
      c.credit_limit = params[1];
      return { rows: [{ credit_enabled: c.credit_enabled, credit_limit: c.credit_limit }] };
    }
    if (/INSERT INTO customer_credit_ledger/.test(s)) {
      // Column order: company, store, customer, type, amount, reference_type,
      // reference_id, description, ... — resolve by named params map since
      // two insert shapes exist (sale path has net/vat/gross/idempotency).
      const named = {};
      const m = s.match(/INSERT INTO customer_credit_ledger\s*\(([^)]*)\)/);
      const cols = m[1].split(",").map((c) => c.trim());
      cols.forEach((col, i) => { named[col] = params[i]; });
      if (named.idempotency_key && state.ledger.some((e) => e.company_id === named.company_id && e.idempotency_key === named.idempotency_key)) {
        const err = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
      const entry = {
        id: `led-${state.ledger.length + 1}`,
        company_id: named.company_id,
        store_id: named.store_id ?? null,
        customer_id: named.customer_id,
        transaction_type: named.transaction_type,
        amount: Number(named.amount),
        balance_after: named.balance_after ?? null,
        reference_type: named.reference_type ?? null,
        reference_id: named.reference_id ?? null,
        description: named.description ?? null,
        vat_amount: named.vat_amount ?? null,
        net_amount: named.net_amount ?? null,
        gross_amount: named.gross_amount ?? null,
        payment_method: named.payment_method ?? null,
        idempotency_key: named.idempotency_key ?? null,
        created_by: named.created_by ?? null,
        created_at: new Date().toISOString(),
      };
      state.ledger.push(entry);
      return { rows: [entry], rowCount: 1 };
    }
    if (/SELECT COALESCE\(SUM\(l?\.?amount \* CASE WHEN (l\.)?transaction_type/.test(s) || (/SELECT COALESCE\(SUM\(amount \* CASE/.test(s) && /customer_credit_ledger/.test(s))) {
      const companyId = params[0];
      const customerId = params[1];
      const sum = state.ledger
        .filter((e) => e.company_id === companyId && e.customer_id === customerId)
        .reduce(
          (acc, e) => acc + e.amount * (e.transaction_type === "payment" || e.transaction_type === "debit_note" ? -1 : 1),
          0
        );
      return { rows: [{ outstanding: sum }] };
    }
    if (/FROM customer_credit_ledger l\s+LEFT JOIN users u ON u\.id = l\.created_by/.test(s)) {
      const entries = state.ledger
        .filter((e) => e.company_id === params[0] && e.customer_id === params[1])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 25);
      return { rows: entries.map((e) => ({ ...e, created_by_name: null })) };
    }
    if (/SELECT transaction_type, amount, reference_type, reference_id, description, created_at\s+FROM customer_credit_ledger/.test(s)) {
      const entries = state.ledger
        .filter((e) => e.company_id === params[0] && e.customer_id === params[1])
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return { rows: entries.map(({ ...e }) => ({ ...e })) };
    }

    /* ---------- sales engine (routes/sales.js credit path) ---------- */
    if (/INSERT INTO customer_credit_ledger/.test(s)) {
      // handled above
    }
    if (/SELECT credit_enabled, credit_limit FROM customers WHERE id = \$1 AND company_id = \$2 FOR UPDATE/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [c] : [] };
    }
    if (/INSERT INTO sales \(/.test(s)) {
      const id = `sale-${++state.saleIdSeq}`;
      const sale = {
        id,
        company_id: params[0],
        store_id: params[1],
        user_id: params[2],
        customer_id: params[3],
        receipt_number: params[5],
        subtotal: params[6], tax: params[7], discount: params[8], total: params[9],
        status: "completed",
        created_at: new Date().toISOString(),
      };
      state.sales.push(sale);
      return { rows: [{ id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
    }
    if (/INSERT INTO sale_items \(/.test(s)) {
      return { rows: [] };
    }
    if (/INSERT INTO payments \(/.test(s)) {
      state.payments.push({ sale_id: params[0], payment_method: params[1], amount: params[2], status: "completed" });
      return { rows: [] };
    }
    if (/SELECT\s+id,\s*name,\s*price,\s*vat_rate,\s*track_stock\s+FROM products/.test(s) || /SELECT\s+id,\s*name,\s*price,\s*stock_quantity,\s*track_stock,\s*age_restricted\s+FROM products/.test(s)) {
      const p = state.products.get(params[0]);
      return { rows: p && p.company_id === params[1] && p.active ? [p] : [] };
    }
    if (/SELECT allow_negative_inventory_billing FROM company_settings/.test(s)) {
      return { rows: [] }; // setting absent → negative billing disabled (default)
    }
    if (/INSERT INTO client_sessions|SELECT terminal_id FROM client_sessions/.test(s)) {
      return { rows: [{ terminal_id: "term-1" }] };
    }
    if (/SELECT\s+t\.store_id|FROM client_sessions t? WHERE/.test(s)) {
      return { rows: [{ terminal_id: "term-1", store_id: STORE_1 }] };
    }
    if (/till|session/i.test(s) && /SELECT/i.test(s)) {
      return { rows: [{ terminal_id: "term-1" }] };
    }

    if (/SELECT ts\.id, ts\.terminal_id, t\.terminal_number, c\.timezone\s+FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T1", timezone: "UTC" }] };
    }
    if (/SELECT to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) {
      return { rows: [{ date_key: "20260919" }] };
    }
    if (/SELECT COALESCE\(MAX\(NULLIF\(split_part\(receipt_number/.test(s)) {
      return { rows: [{ next_number: 1 }] };
    }
    if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
      const hit = state.sales.find((sale) => sale.company_id === params[0] && sale.client_request_id === params[1]);
      return { rows: hit ? [{ id: hit.id, created_at: hit.created_at, total: hit.total, receipt_number: hit.receipt_number }] : [] };
    }

    if (/SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] && c.active ? [{ id: c.id }] : [] };
    }
    if (/SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true/.test(s)) {
      const store = state.stores.get(params[0]);
      return { rows: store && store.company_id === params[1] && store.active ? [{ id: store.id }] : [] };
    }
    if (/INSERT INTO customer_stores/.test(s)) {
      const existing = state.customerStores.find(
        (cs) => cs.customer_id === params[0] && cs.store_id === params[1]
      );
      if (existing) {
        existing.active = true;
        if (params[2] && (!existing.last_purchase_at || params[2] > existing.last_purchase_at)) {
          existing.last_purchase_at = params[2];
        }
      } else {
        state.customerStores.push({
          customer_id: params[0], store_id: params[1],
          last_purchase_at: params[2] || null, active: true,
        });
      }
      return { rowCount: 1 };
    }

    /* ---------- customers router misc (list/detail) ---------- */
    if (/SELECT 1 FROM customer_stores WHERE customer_id = \$1 AND store_id = \$2/.test(s)) {
      const hit = state.customerStores.find(
        (cs) => cs.customer_id === params[0] && cs.store_id === params[1] && cs.active
      );
      return { rows: hit ? [{ ok: 1 }] : [] };
    }
    if (/SELECT c\.id, c\.company_id, c\.name.*GROUP BY c\.id/.test(s)) {
      const c = state.customers.get(params[0]);
      if (!c || c.company_id !== params[1]) return { rows: [] };
      const outstanding = state.ledger
        .filter((e) => e.company_id === c.company_id && e.customer_id === c.id)
        .reduce((acc, e) => acc + e.amount * (e.transaction_type === "payment" || e.transaction_type === "debit_note" ? -1 : 1), 0);
      return { rows: [{ ...c, credit_balance: outstanding }] };
    }
    if (/SELECT 1 FROM roles WHERE id = \$1 AND company_id = \$2/.test(s)) {
      return { rows: params[0] === ADMIN_ROLE ? [{ ok: 1 }] : [] };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    // Simulate the unique-constraint idempotency guard for direct db() calls too.
    return rows(sql, params);
  };
  /* Transaction-aware client (used by the sale engine): ROLLBACK must
   * actually undo writes so rejected sales leave no rows — mirrors real
   * PostgreSQL semantics that the fake otherwise lacks. */
  const txStack = [];
  const client = {
    async query(sql, params = []) {
      const verb = String(sql).trim().toUpperCase();
      if (verb === "BEGIN") {
        txStack.push({
          sales: state.sales.length,
          payments: state.payments.length,
          ledger: state.ledger.length,
        });
        return { rows: [] };
      }
      if (verb === "ROLLBACK") {
        const snap = txStack.pop();
        if (snap) {
          state.sales.length = snap.sales;
          state.payments.length = snap.payments;
          state.ledger.length = snap.ledger;
        }
        return { rows: [] };
      }
      if (verb === "COMMIT") {
        txStack.pop();
        return { rows: [] };
      }
      return rows(sql, params);
    },
  };

  return { state, db, client };
}

/* --------------------------------------------------------- app builder */

function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, roleId = ADMIN_ROLE } = {}) {
  const customersMod = import("../routes/customers.js");
  const salesMod = import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  let customersRouter = null;
  let salesRouter = null;
  const pickRouter = (req, res, next) => {
    if (customersRouter && (req.path.startsWith("/customers") || req.path.startsWith("/customer-lookup"))) return customersRouter(req, res, next);
    if (salesRouter && req.path.startsWith("/sales")) return salesRouter(req, res, next);
    next();
  };
  app.use("/api", (req, res, next) => {
    req.user = { id: "u1", companyId, storeId, roleId, username: "tester" };
    if (customersRouter && salesRouter) return pickRouter(req, res, next);
    next();
  });
  return (async () => {
    const [cMod, sMod] = await Promise.all([customersMod, salesMod]);
    customersRouter = cMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.client.query, release() {} }; } },
      canViewCompanyCustomers: async (user) => user.roleId === ADMIN_ROLE,
      associateCustomerWithStore: async () => ({}),
    });
    salesRouter = sMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.client.query, release() {} }; } },
      writeAudit: async () => {},
      createInventoryMovement: async () => ({ balance: 0 }),
      selfCheckoutMode: () => false,
      associateCustomerWithStore,
    });
    return app;
  })();
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: userServerPort(server) };
}

/* helper so listen() stays tidy */
function userServerPort(server) {
  return server.address().port;
}

const req = async (port, method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ----------------------------------------------------- integration tests */

describe("credit account configuration", () => {
  test("enable credit + set limit; persists and returns summary", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: false, credit_limit: null, active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/customers/cust-1/credit", { enabled: true, limit: 250 });
      assert.equal(put.status, 200);
      assert.equal(put.body.data.enabled, true);
      assert.equal(put.body.data.limit, 250);

      const get = await req(port, "GET", "/api/customers/cust-1/credit");
      assert.equal(get.status, 200);
      assert.equal(get.body.data.credit.enabled, true);
      assert.equal(get.body.data.credit.limit, 250);
      assert.equal(get.body.data.credit.balance, 0);
      assert.equal(get.body.data.credit.available, 250);
    } finally {
      server.close();
    }
  });

  test("negative limit rejected; invalid amount rejected", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: false, credit_limit: null, active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const bad = await req(port, "PUT", "/api/customers/cust-1/credit", { enabled: true, limit: -5 });
      assert.equal(bad.status, 400);

      const ok = await req(port, "PUT", "/api/customers/cust-1/credit", { enabled: true, limit: 100 });
      assert.equal(ok.status, 200);
    } finally {
      server.close();
    }
  });
});

describe("credit payments, adjustments and isolation", () => {
  const seed = (ctx) => {
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: true, credit_limit: 500, active: true,
    });
    ctx.state.customerStores.push({ customer_id: "cust-1", store_id: STORE_1, active: true });
  };

  test("payment reduces balance; overpayment rejected; zero/negative rejected", async () => {
    const ctx = makeDb();
    seed(ctx);
    ctx.state.ledger.push({
      id: "led-0", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "credit_sale",
      amount: 100, created_at: new Date().toISOString(),
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const over = await req(port, "POST", "/api/customers/cust-1/credit/payments", { amount: 150, method: "cash" });
      assert.equal(over.status, 409);

      const zero = await req(port, "POST", "/api/customers/cust-1/credit/payments", { amount: 0, method: "cash" });
      assert.equal(zero.status, 400);

      const negative = await req(port, "POST", "/api/customers/cust-1/credit/payments", { amount: -10, method: "cash" });
      assert.equal(negative.status, 400);

      const ok = await req(port, "POST", "/api/customers/cust-1/credit/payments", { amount: 40, method: "card", notes: "part payment" });
      assert.equal(ok.status, 201);
      assert.equal(ok.body.data.balance, 60);

      const summary = await req(port, "GET", "/api/customers/cust-1/credit");
      assert.equal(summary.body.data.credit.balance, 60);
    } finally {
      server.close();
    }
  });

  test("payment on credit-disabled customer rejected (409)", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "NoCredit", credit_enabled: false, credit_limit: null, active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/customers/cust-1/credit/payments", { amount: 10, method: "cash" });
      assert.equal(r.status, 409);
    } finally {
      server.close();
    }
  });

  test("credit note respects credit limit; debit note cannot exceed balance", async () => {
    const ctx = makeDb();
    seed(ctx);
    ctx.state.ledger.push({
      id: "led-0", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "credit_sale",
      amount: 100, created_at: new Date().toISOString(),
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      // Limit £500, outstanding £100 → £400 credit note OK (= limit), £450 would exceed.
      const over = await req(port, "POST", "/api/customers/cust-1/credit/adjustments", { type: "credit", amount: 450, notes: "too much" });
      assert.equal(over.status, 409);

      const okNote = await req(port, "POST", "/api/customers/cust-1/credit/adjustments", { type: "credit", amount: 400, notes: "goodwill" });
      assert.equal(okNote.status, 201);
      assert.equal(okNote.body.data.balance, 500);

      // Debit note larger than balance rejected.
      const badDebit = await req(port, "POST", "/api/customers/cust-1/credit/adjustments", { type: "debit", amount: 1000, notes: "nope" });
      assert.equal(badDebit.status, 409);

      const okDebit = await req(port, "POST", "/api/customers/cust-1/credit/adjustments", { type: "debit", amount: 50, notes: "correction" });
      assert.equal(okDebit.status, 201);
      assert.equal(okDebit.body.data.balance, 450);
    } finally {
      server.close();
    }
  });
});

describe("statement endpoint", () => {
  test("date filtering + running balance + references", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: true, credit_limit: 500, active: true,
    });
    const jan = (d) => new Date(`2026-01-${String(d).padStart(2, "0")}T10:00:00Z`).toISOString();
    ctx.state.ledger.push(
      { id: "l1", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "credit_sale", amount: 100, reference_type: "sale", reference_id: "sale-1", created_at: jan(2) },
      { id: "l2", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "payment", amount: 40, reference_type: "payment", created_at: jan(5) },
      { id: "l3", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "credit_sale", amount: 25, reference_type: "sale", reference_id: "sale-2", created_at: jan(10) }
    );
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const full = await req(port, "GET", "/api/customers/cust-1/credit/statement");
      assert.equal(full.status, 200);
      assert.equal(full.body.data.statement.openingBalance, 0);
      assert.equal(full.body.data.statement.closingBalance, 85);

      const filtered = await req(port, "GET", "/api/customers/cust-1/credit/statement?from=2026-01-04&to=2026-01-31");
      assert.equal(filtered.status, 200);
      assert.equal(filtered.body.data.statement.openingBalance, 100);
      assert.equal(filtered.body.data.statement.closingBalance, 85);
      assert.equal(filtered.body.data.statement.transactions.length, 2);
      // References preserved.
      assert.equal(filtered.body.data.statement.transactions[0].reference_type, "payment");
      assert.equal(filtered.body.data.statement.transactions[1].reference_id, "sale-2");
    } finally {
      server.close();
    }
  });
});

/* Sales-engine integration: the credit path in routes/sales.js. */
describe("credit sale in the existing sale engine", () => {
  const seedSaleCtx = (ctx) => {
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: true, credit_limit: 50, active: true,
    });
    ctx.state.products.set("prod-1", {
      id: "prod-1", company_id: COMPANY_A, name: "Tea", price: 10, vat_rate: 20, track_stock: false, active: true,
    });
  };

  const saleBody = (paymentMethod = "customer_credit") => ({
    items: [{ productId: "prod-1", quantity: 2, unitPrice: 10, tax: 2, total: 20 }],
    customerId: "cust-1",
    subtotal: 20,
    tax: 4,
    discount: 0,
    total: 24,
    paymentMethod,
  });

  test("credit sale records sale + ledger entry; balance increases", async () => {
    const ctx = makeDb();
    seedSaleCtx(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", saleBody());
      assert.equal(r.status, 201);
      assert.equal(ctx.state.ledger.length, 1);
      assert.equal(ctx.state.ledger[0].transaction_type, "credit_sale");
      assert.equal(ctx.state.ledger[0].amount, 24);
      assert.equal(ctx.state.ledger[0].reference_type, "sale");
      assert.equal(ctx.state.ledger[0].customer_id, "cust-1");
      assert.equal(ctx.state.payments[0].payment_method, "customer_credit");
    } finally {
      server.close();
    }
  });

  test("credit limit exceeded → sale rejected, no ledger entry", async () => {
    const ctx = makeDb();
    seedSaleCtx(ctx);
    ctx.state.ledger.push({
      id: "led-0", company_id: COMPANY_A, customer_id: "cust-1", transaction_type: "credit_sale",
      amount: 30, created_at: new Date().toISOString(),
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", saleBody());
      assert.equal(r.status, 409); // engine returns a clean business rejection
      assert.match(r.body.message, /Credit limit exceeded/);
      assert.equal(ctx.state.ledger.length, 1); // no new entry
      assert.equal(ctx.state.sales.length, 0); // sale rolled back
    } finally {
      server.close();
    }
  });

  test("cash/card sales never touch the credit ledger (regression)", async () => {
    const ctx = makeDb();
    seedSaleCtx(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const cash = await req(port, "POST", "/api/sales", saleBody("cash"));
      assert.equal(cash.status, 201);
      const card = await req(port, "POST", "/api/sales", saleBody("card"));
      assert.equal(card.status, 201);
      assert.equal(ctx.state.ledger.length, 0);
      assert.equal(ctx.state.sales.length, 2);
    } finally {
      server.close();
    }
  });

  test("credit sale for credit-disabled customer rejected", async () => {
    const ctx = makeDb();
    seedSaleCtx(ctx);
    ctx.state.customers.get("cust-1").credit_enabled = false;
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", saleBody());
      assert.equal(r.status, 409);
      assert.match(r.body.message, /credit is not enabled/i);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("credit sale without a customer rejected", async () => {
    const ctx = makeDb();
    seedSaleCtx(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const body = saleBody();
      body.customerId = null;
      const r = await req(port, "POST", "/api/sales", body);
      assert.equal(r.status, 400);
      assert.match(r.body.message, /customer is required/i);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });
});

/* Company/store isolation is enforced by loadCustomerForCredit + SQL scoping. */
describe("company and store isolation", () => {
  test("foreign company customer → 404 on every credit endpoint", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-b", {
      id: "cust-b", company_id: COMPANY_B, name: "B customer", credit_enabled: true, credit_limit: 100, active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      assert.equal((await req(port, "GET", "/api/customers/cust-b/credit")).status, 404);
      assert.equal((await req(port, "PUT", "/api/customers/cust-b/credit", { enabled: true, limit: 10 })).status, 404);
      assert.equal((await req(port, "POST", "/api/customers/cust-b/credit/payments", { amount: 5, method: "cash" })).status, 404);
      assert.equal((await req(port, "GET", "/api/customers/cust-b/credit/statement")).status, 404);
      assert.equal(ctx.state.ledger.length, 0);
    } finally {
      server.close();
    }
  });

  test("store-scoped user cannot see credit of customer linked only to another store", async () => {
    const ctx = makeDb();
    ctx.state.customers.set("cust-1", {
      id: "cust-1", company_id: COMPANY_A, name: "Kate", credit_enabled: true, credit_limit: 100, active: true,
    });
    ctx.state.customerStores.push({ customer_id: "cust-1", store_id: STORE_2, active: true }); // linked to Leeds only
    const app = await buildApp(ctx, { roleId: STAFF_ROLE, storeId: STORE_1 }); // staff at London
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/customers/cust-1/credit");
      assert.equal(r.status, 404);
    } finally {
      server.close();
    }
  });
});
