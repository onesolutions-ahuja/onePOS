/*
 * Customer purchase history / sales linked to customers — focused suite.
 *
 * Backend: the REAL routes/customers.js customer-detail history query and
 * the REAL routes/sales.js sale-create customer linking, over HTTP against
 * stateful fakes modelling sales/payments/customers tables.
 * Frontend: source contracts — history table shows payment method + reuses
 * the existing SaleDetailModal via the existing GET /api/sales/:id.
 *
 *   node --test tests/customerSalesHistory.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const STORE_B = "c0000000-0000-4000-8000-000000000004";
const USER = "u0000000-0000-4000-8000-000000000009";
const CUSTOMER = "d0000000-0000-4000-8000-000000000001";
const CUSTOMER_OTHER = "d0000000-0000-4000-8000-000000000002";

/* ------------------------------------------------------------ fake ctx */

function makeCtx() {
  const state = {
    sales: [],
    payments: [],
    customers: new Map([[CUSTOMER, { id: CUSTOMER, company_id: COMPANY_A, name: "Amy Wong", active: true }]]),
    customerStores: [{ customer_id: CUSTOMER, store_id: STORE, active: true }],
  };

  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    /* customer existence / ownership checks */
    if (/SELECT id, name FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ id: c.id, name: c.name }] : [] };
    }
    /* Customer detail query (the big join) — one customer row. */
    if (/FROM customers c\s+LEFT JOIN customer_stores cs/.test(s)) {
      const c = state.customers.get(params[0]);
      if (!c || c.company_id !== params[1]) return { rows: [] };
      return { rows: [{ id: c.id, company_id: c.company_id, name: c.name, stores: state.customerStores }] };
    }
    /* store visibility for non-admins */
    if (/SELECT 1 FROM customer_stores WHERE customer_id = \$1 AND store_id = \$2 AND active = true/.test(s)) {
      const visible = state.customerStores.some((cs) => cs.customer_id === params[0] && cs.store_id === params[1] && cs.active);
      return { rows: visible ? [{ ok: 1 }] : [] };
    }
    /* THE history query (customer detail). */
    if (/FROM sales s\s+LEFT JOIN stores st ON st\.id = s\.store_id\s+WHERE s\.customer_id = \$1 AND s\.company_id = \$2/.test(s)) {
      const rows = state.sales
        .filter((sale) => sale.customer_id === params[0] && sale.company_id === params[1])
        .filter((sale) => !(sale.offline_created === true && sale.sync_status !== "synced"))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 100)
        .map((sale) => {
          const pay = [...state.payments].reverse().find((p) => p.sale_id === sale.id && p.status === "completed");
          const store = { [STORE]: "High Street", [STORE_B]: "Market Branch" }[sale.store_id];
          return {
            id: sale.id, receipt_number: sale.receipt_number, store_id: sale.store_id,
            store_name: store || null, total: sale.total, status: sale.status,
            created_at: sale.created_at, payment_method: pay?.payment_method || null,
            confirmed: !(sale.offline_created === true && sale.sync_status !== "synced"),
          };
        });
      return { rows };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/to_char\(timezone/.test(s)) return { rows: [{ date_key: "20260920" }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) return { rows: [{ next_number: state.sales.length + 1 }] };
      if (/SELECT id,\s*name,\s*price,\s*(stock_quantity,\s*track_stock,\s*age_restricted|vat_rate,\s*track_stock)\s+FROM products/.test(s)) {
        return { rows: [{ id: params[0], name: "Test product", price: 5, stock_quantity: 100, track_stock: true, age_restricted: false }] };
      }
      if (/SELECT credit_enabled, credit_limit, maximum_credit_age_days FROM customers/.test(s)) {
        const c = state.customers.get(params[0]);
        return { rows: c && c.company_id === params[1] ? [{ credit_enabled: true, credit_limit: 500, maximum_credit_age_days: null }] : [] };
      }
      if (/SELECT COALESCE\(SUM\(amount \* CASE WHEN transaction_type/.test(s)) return { rows: [{ outstanding: 0 }] };
      if (/INSERT INTO customer_credit_ledger/.test(s)) return { rowCount: 1 };
      if (/INSERT INTO sales \(/.test(s)) {
        /* params: companyId(0) storeId(1) userId(2) customerId(3) … */
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0], store_id: params[1], customer_id: params[3],
          receipt_number: `T01-20260920-${String(state.sales.length + 1).padStart(4, "0")}`,
          total: Number(params[9]) || 0, status: "completed",
          offline_created: false, sync_status: "synced",
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
      }
      if (/INSERT INTO payments/.test(s)) {
        state.payments.push({ sale_id: params[0], payment_method: params[1], status: "completed" });
        return { rowCount: 1 };
      }
      if (/INSERT INTO inventory_movements/.test(s)) return { rowCount: 1 };
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  const dbForSales = async (sql) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
    return { rows: [], rowCount: 0 };
  };

  return { state, db, dbForSales, pool: { async connect() { return { ...client, release() {} }; } } };
}

/* ------------------------------------------------------------ builders */

async function buildCustomersApp(ctx, { companyId, storeId, companyAdmin }) {
  const mod = await import("../routes/customers.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId, role: companyAdmin ? "admin" : "cashier" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    canViewCompanyCustomers: async (user) => user.role === "admin",
    associateCustomerWithStore: async () => ({}),
  }));
  return app;
}

async function buildSalesApp(ctx, { mode = null } = {}) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY_A, storeId: STORE, ...(mode ? { mode } : {}) };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.dbForSales,
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

const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const saleBody = (customerId, paymentMethod) => ({
  items: [{ productId: "p-1", quantity: 1, unitPrice: 5, tax: 0, discount: 0, total: 5 }],
  customerId,
  subtotal: 5, tax: 0, discount: 0, total: 5,
  paymentMethod,
});

/* ----------------------------------------------------------------- tests */

describe("POS sale → customer linking (cash, card, credit; walk-in untouched)", () => {
  test("cash sale with a selected customer persists customer_id", async () => {
    const ctx = makeCtx();
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/sales", saleBody(CUSTOMER, "cash"));
      assert.equal(res.status, 201);
      assert.equal(ctx.state.sales[0].customer_id, CUSTOMER, "sale permanently linked to the customer");
    } finally { server.close(); }
  });

  test("card sale with a selected customer persists customer_id", async () => {
    const ctx = makeCtx();
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/sales", saleBody(CUSTOMER, "card"));
      assert.equal(res.status, 201);
      assert.equal(ctx.state.sales[0].customer_id, CUSTOMER);
    } finally { server.close(); }
  });

  test("credit sale with a selected customer persists customer_id", async () => {
    const ctx = makeCtx();
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/sales", saleBody(CUSTOMER, "customer_credit"));
      assert.equal(res.status, 201, res.body?.message || "credit sale accepted");
      assert.equal(ctx.state.sales[0].customer_id, CUSTOMER, "credit sale keeps the customer relationship");
    } finally { server.close(); }
  });

  test("walk-in (no customer) sale stays unlinked — customer_id NULL", async () => {
    const ctx = makeCtx();
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/sales", saleBody(null, "cash"));
      assert.equal(res.status, 201);
      assert.equal(ctx.state.sales[0].customer_id, null, "anonymous sale must not be linked");
    } finally { server.close(); }
  });
});

describe("Customer purchase history endpoint", () => {
  test("returns ONLY that customer's company-scoped sales with receipt, store, date, payment method, total, status", async () => {
    const ctx = makeCtx();
    ctx.state.sales = [
      { id: "s-1", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "T01-20260920-0001", total: 10, status: "completed", created_at: "2026-09-20T10:00:00Z", offline_created: false, sync_status: "synced" },
      { id: "s-2", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER_OTHER, receipt_number: "T01-20260920-0002", total: 99, status: "completed", created_at: "2026-09-20T11:00:00Z", offline_created: false, sync_status: "synced" },
    ];
    ctx.state.payments = [
      { sale_id: "s-1", payment_method: "card", status: "completed" },
      { sale_id: "s-2", payment_method: "cash", status: "completed" },
    ];
    const app = await buildCustomersApp(ctx, { companyId: COMPANY_A, storeId: STORE, companyAdmin: true });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUSTOMER}`);
      assert.equal(res.status, 200);
      const sales = res.body.data.sales;
      assert.equal(sales.length, 1, "only THIS customer's sales");
      assert.equal(sales[0].id, "s-1");
      assert.equal(sales[0].receipt_number, "T01-20260920-0001");
      assert.equal(sales[0].store_name, "High Street");
      assert.equal(sales[0].payment_method, "card", "payment method is visible in history");
      assert.equal(sales[0].total, 10);
      assert.equal(sales[0].status, "completed");
      assert.equal(sales[0].confirmed, true);
    } finally { server.close(); }
  });

  test("company isolation: company B's viewer never sees company A's customer sales", async () => {
    const ctx = makeCtx();
    ctx.state.sales = [
      { id: "s-A", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "T01-20260920-0001", total: 10, status: "completed", created_at: "2026-09-20T10:00:00Z", offline_created: false, sync_status: "synced" },
    ];
    /* B asks using A's customer id: ownership check must 404. */
    const appB = await buildCustomersApp(ctx, { companyId: COMPANY_B, storeId: STORE_B, companyAdmin: true });
    const b = await listen(appB);
    try {
      const res = await get(b.port, `/api/customers/${CUSTOMER}`);
      assert.equal(res.status, 404, "foreign customer is not visible cross-company");
    } finally { b.server.close(); }
  });

  test("store isolation: a non-admin scoped to another store gets 404 for this store's customer", async () => {
    const ctx = makeCtx();
    const app = await buildCustomersApp(ctx, { companyId: COMPANY_A, storeId: STORE_B, companyAdmin: false });
    const { server, port } = await listen(app);
    try {
      /* The customer is visible only via customer_stores(STORE); the viewer
         is scoped to STORE_B and is not a company admin. */
      const res = await get(port, `/api/customers/${CUSTOMER}`);
      assert.equal(res.status, 404, "store restrictions follow the existing customer_stores model");
    } finally { server.close(); }
  });

  test("payment-method visibility: credit sale shows 'credit', cash shows 'cash'", async () => {
    const ctx = makeCtx();
    ctx.state.sales = [
      { id: "s-1", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "R-1", total: 5, status: "completed", created_at: "2026-09-20T10:00:00Z", offline_created: false, sync_status: "synced" },
      { id: "s-2", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "R-2", total: 7, status: "completed", created_at: "2026-09-20T12:00:00Z", offline_created: false, sync_status: "synced" },
    ];
    ctx.state.payments = [
      { sale_id: "s-1", payment_method: "credit", status: "completed" },
      { sale_id: "s-2", payment_method: "cash", status: "completed" },
    ];
    const app = await buildCustomersApp(ctx, { companyId: COMPANY_A, storeId: STORE, companyAdmin: true });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUSTOMER}`);
      const methods = Object.fromEntries(res.body.data.sales.map((s) => [s.id, s.payment_method]));
      assert.equal(methods["s-1"], "credit");
      assert.equal(methods["s-2"], "cash");
    } finally { server.close(); }
  });

  test("offline sale appears ONLY after confirmed synchronization (sync_status gate)", async () => {
    const ctx = makeCtx();
    ctx.state.sales = [
      /* Row written by the sync engine but still flagged unsynced — the
         customer must NOT see it as a confirmed sale. */
      { id: "s-off", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "SC-20260920-0001", total: 4, status: "completed", created_at: "2026-09-20T09:00:00Z", offline_created: true, sync_status: "pending" },
      /* After the sync engine marks it synced (or a normal online sale). */
      { id: "s-ok", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "SC-20260920-0002", total: 6, status: "completed", created_at: "2026-09-20T09:30:00Z", offline_created: true, sync_status: "synced" },
    ];
    const app = await buildCustomersApp(ctx, { companyId: COMPANY_A, storeId: STORE, companyAdmin: true });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUSTOMER}`);
      const ids = res.body.data.sales.map((s) => s.id);
      assert.equal(ids.includes("s-off"), false, "unconfirmed offline sale is NOT presented");
      assert.equal(ids.includes("s-ok"), true, "confirmed offline sale appears after sync");
      const shown = res.body.data.sales.find((s) => s.id === "s-ok");
      assert.equal(shown.confirmed, true);
    } finally { server.close(); }
  });

  test("refunded/returned sales retain their customer relationship in history", async () => {
    const ctx = makeCtx();
    ctx.state.sales = [
      { id: "s-ref", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "R-REF", total: 5, status: "refunded", created_at: "2026-09-19T10:00:00Z", offline_created: false, sync_status: "synced" },
      { id: "s-part", company_id: COMPANY_A, store_id: STORE, customer_id: CUSTOMER, receipt_number: "R-PART", total: 8, status: "part_refunded", created_at: "2026-09-19T11:00:00Z", offline_created: false, sync_status: "synced" },
    ];
    const app = await buildCustomersApp(ctx, { companyId: COMPANY_A, storeId: STORE, companyAdmin: true });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/customers/${CUSTOMER}`);
      assert.equal(res.body.data.sales.length, 2, "refunded sales are NOT deleted from history");
      const statuses = Object.fromEntries(res.body.data.sales.map((s) => [s.id, s.status]));
      assert.equal(statuses["s-ref"], "refunded");
      assert.equal(statuses["s-part"], "part_refunded");
    } finally { server.close(); }
  });
});

describe("Frontend contracts (no second sale-detail system)", () => {
  test("history SQL excludes unconfirmed offline sales at the source", () => {
    const src = fs.readFileSync(new URL("../routes/customers.js", import.meta.url), "utf8");
    assert.match(src, /AND NOT \(s\.offline_created = true AND s\.sync_status <> 'synced'\)/, "the sales-history WHERE clause must gate on sync_status");
  });

  test("customer history reuses the existing SaleDetailModal + GET /api/sales/:id", () => {
    const src = fs.readFileSync(new URL("../src/pages/customers/CustomersAdmin.jsx", import.meta.url), "utf8");
    assert.match(src, /import SaleDetailModal from "\.\.\/sales\/SaleDetailModal\.jsx"/);
    assert.match(src, /apiRequest\(`\/api\/sales\/\$\{sale\.id\}`\)/, "details come from the EXISTING sale endpoint");
    assert.match(src, /openHistorySale/, "history rows open the shared detail view");
    assert.match(src, /payment_method/, "history shows the payment method");
  });

  test("history table shows receipt, store, date/time, status, total columns", () => {
    const src = fs.readFileSync(new URL("../src/pages/customers/CustomersAdmin.jsx", import.meta.url), "utf8");
    for (const column of ["Reference", "Store", "Date", "Payment", "Status", "Total"]) {
      assert.ok(src.includes(column), `history table includes ${column}`);
    }
  });

  test("customer selection does not alter POS totals/VAT/credit maths", () => {
    const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    /* Totals come from the shared engine, not from customer context. */
    assert.match(posSrc, /computeBasketTotals/);
    /* Customer affects credit lookup only, never pricing. */
    assert.match(posSrc, /selectedCustomer\?\.id/);
    assert.doesNotMatch(posSrc, /selectedCustomer\?\.id\s*\?\s*price/);
    /* Credit modal wiring untouched. */
    assert.match(posSrc, /\/credit`/);
  });
});
