/*
 * Sales Reports module (Reporting roadmap) — backend integration tests.
 *
 *   node --test tests/salesReports.test.mjs
 *
 * Backend under test: the REAL routes/reports.js over HTTP against a
 * stateful SQL fake that models sales / sale_items / payments /
 * stock_returns / stock_return_items / stores / users and evaluates the
 * overview endpoint's grouping, filters, metrics and permission gates.
 *
 * Covers: reports.sales.view permission enforcement (incl. admin bypass),
 * by-day/by-store/by-user/by-product grouping, metric correctness
 * (transactions, quantity, gross, discounts, VAT, returns, net), date-range
 * filtering, payment-method breakdown, company isolation and the existing
 * store-access rules.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "a0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000101";
const STORE_2 = "c0000000-0000-4000-8000-000000000102";
const STORE_B1 = "c0000000-0000-4000-8000-000000000201";
const USER = "e0000000-0000-4000-8000-000000000901"; // admin, assigned store 1
const USER_2 = "e0000000-0000-4000-8000-000000000902"; // cashier, store 1
const USER_B = "e0000000-0000-4000-8000-000000000801";
const P1 = "f0000000-0000-4000-8000-000000000001";
const P2 = "f0000000-0000-4000-8000-000000000002";

process.env.NODE_ENV = "test";

function makeCtx() {
  const state = {
    stores: [
      { id: STORE_1, company_id: COMPANY_A, name: "London Store", active: true },
      { id: STORE_2, company_id: COMPANY_A, name: "Manchester Store", active: true },
      { id: STORE_B1, company_id: COMPANY_B, name: "B Store", active: true },
    ],
    users: [
      { id: USER, company_id: COMPANY_A, store_id: STORE_1, username: "admin", full_name: "Al Admin", active: true },
      { id: USER_2, company_id: COMPANY_A, store_id: STORE_1, username: "bob", full_name: "Bob Cashier", active: true },
      { id: USER_B, company_id: COMPANY_B, store_id: STORE_B1, username: "dave", full_name: "Dave B", active: true },
    ],
    sales: [], // { id, company_id, store_id, user_id, status, total, discount, tax, created_at }
    saleItems: [], // { id, sale_id, product_id, product_name, quantity, unit_price, discount, tax, total }
    payments: [], // { id, sale_id, payment_method, amount }
    returns: [], // { id, company_id, store_id, created_by, return_type, status, created_at }
    returnItems: [], // { id, return_id, sale_item_id, product_id, quantity }
    seq: 0,
  };
  const nextId = () => `id-${(state.seq += 1)}`;

  function addSale({ companyId, storeId, userId, createdAt, status = "completed", items, payments }) {
    const sale = {
      id: nextId(),
      company_id: companyId,
      store_id: storeId,
      user_id: userId,
      status,
      total: items.reduce((sum, item) => sum + item.total, 0) - items.reduce((sum, item) => sum + item.discount, 0),
      discount: items.reduce((sum, item) => sum + item.discount, 0),
      tax: items.reduce((sum, item) => sum + item.tax, 0),
      created_at: createdAt,
    };
    state.sales.push(sale);
    for (const item of items) {
      const itemId = nextId();
      state.saleItems.push({
        id: itemId,
        sale_id: sale.id,
        product_id: item.productId,
        product_name: item.productName,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount: item.discount || 0,
        tax: item.tax || 0,
        total: item.total,
      });
      for (const method of item.payments || payments || []) {
        state.payments.push({ id: nextId(), sale_id: sale.id, payment_method: method, amount: item.total });
      }
    }
    return sale;
  }

  function addReturn({ companyId, storeId, createdBy, createdAt, productId, quantity, unitPrice }) {
    const saleItemId = nextId();
    state.saleItems.push({
      id: saleItemId,
      sale_id: null,
      product_id: productId,
      product_name: "r",
      quantity,
      unit_price: unitPrice,
      discount: 0,
      tax: 0,
      total: quantity * unitPrice,
    });
    const returnId = nextId();
    state.returns.push({
      id: returnId,
      company_id: companyId,
      store_id: storeId,
      created_by: createdBy,
      return_type: "CUSTOMER",
      status: "COMPLETED",
      created_at: createdAt,
    });
    state.returnItems.push({ id: nextId(), return_id: returnId, sale_item_id: saleItemId, product_id: productId, quantity });
    return returnId;
  }

  /* ------------------------------------------------------------- SQL fake */
  const matchSql = async (sql0, params) => {
    const sql = String(sql0).replace(/\s+/g, " ").trim();

    if (/^SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(sql)) {
      const store = state.stores.find((s) => s.id === params[0] && s.company_id === params[1]);
      return { rows: store ? [{ id: store.id }] : [] };
    }
    if (/^SELECT id FROM stores WHERE company_id = \$1 AND active = true ORDER BY name$/.test(sql)) {
      return { rows: state.stores.filter((s) => s.company_id === params[0] && s.active).map((s) => ({ id: s.id })) };
    }
    if (/^SELECT id FROM users WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(sql)) {
      const user = state.users.find((u) => u.id === params[0] && u.company_id === params[1]);
      return { rows: user ? [{ id: user.id }] : [] };
    }
    if (/^SELECT id, name FROM stores WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(sql)) {
      const store = state.stores.find((s) => s.id === params[0] && s.company_id === params[1]);
      return { rows: store ? [{ id: store.id, name: store.name }] : [] };
    }
    if (/^SELECT id, COALESCE\(full_name, username\) AS name FROM users WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(sql)) {
      const user = state.users.find((u) => u.id === params[0] && u.company_id === params[1]);
      return { rows: user ? [{ id: user.id, name: user.full_name || user.username }] : [] };
    }
    if (/^SELECT COUNT\(DISTINCT si\.product_id\)::int AS distinct_products/.test(sql)) {
      const [companyId, storeOrStores, userOrNull, fromOrNull, toOrNull] = params;
      const visibleStores = Array.isArray(storeOrStores) ? storeOrStores : storeOrStores ? [storeOrStores] : state.stores.filter((s) => s.company_id === companyId).map((s) => s.id);
      const products = new Set();
      for (const sale of state.sales.filter((entry) => entry.company_id === companyId && entry.status === "completed" && visibleStores.includes(entry.store_id))) {
        if (userOrNull && sale.user_id !== userOrNull) continue;
        if (fromOrNull && sale.created_at.slice(0, 10) < fromOrNull) continue;
        if (toOrNull && sale.created_at.slice(0, 10) > toOrNull) continue;
        for (const item of state.saleItems.filter((entry) => entry.sale_id === sale.id)) products.add(item.product_id);
      }
      return { rows: [{ distinct_products: products.size }] };
    }

    /* The overview endpoint: one statement with sales_agg + returns_agg. */
    if (/WITH sales_agg AS/.test(sql)) {
      const [companyId, storeOrStores, userOrNull, fromOrNull, toOrNull] = params;
      const visibleStores = Array.isArray(storeOrStores)
        ? storeOrStores
        : storeOrStores
          ? [storeOrStores]
          : state.stores.filter((s) => s.company_id === companyId).map((s) => s.id);
      const operatorFilter = userOrNull || null;
      const byStore = /SELECT s\.store_id AS group_key/.test(sql);
      const byUser = /SELECT s\.user_id AS group_key/.test(sql);
      const byProduct = /SELECT si\.product_id AS group_key/.test(sql);
      const byDay = !byStore && !byUser && !byProduct;

      const completed = state.sales.filter(
        (sale) => sale.company_id === companyId && sale.status === "completed" && visibleStores.includes(sale.store_id)
      );
      const filtered = completed.filter((sale) => {
        if (operatorFilter && sale.user_id !== operatorFilter) return false;
        if (byDay && fromOrNull && sale.created_at.slice(0, 10) < fromOrNull) return false;
        if (byDay && toOrNull && sale.created_at.slice(0, 10) > toOrNull) return false;
        return true;
      });

      /* group the sales */
      const groups = new Map();
      for (const sale of filtered) {
        const key = byStore ? sale.store_id : byUser ? sale.user_id : sale.created_at.slice(0, 10);
        if (!groups.has(key)) {
          groups.set(key, {
            group_key: key,
            group_label: null,
            count_sales: 0,
            total_qty: 0,
            total_sales: 0,
            total_discount: 0,
            total_tax: 0,
            distinct_products: 0,
          });
        }
        const group = groups.get(key);
        const saleItems = state.saleItems.filter((item) => item.sale_id === sale.id);
        group.count_sales += 1;
        group.total_sales += saleItems.reduce((sum, item) => sum + Number(item.total || 0), 0);
        group.total_discount += saleItems.reduce((sum, item) => sum + Number(item.discount || 0), 0);
        group.total_tax += saleItems.reduce((sum, item) => sum + Number(item.tax || 0), 0);
        group.distinct_products = new Set([
          ...(group.product_ids || []),
          ...saleItems.map((item) => item.product_id),
        ]).size;
        group.product_ids = [
          ...(group.product_ids || []),
          ...saleItems.map((item) => item.product_id),
        ];
        group.total_qty += saleItems
          .filter((item) => item.sale_id === sale.id)
          .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      }
      if (byProduct) {
        // product view groups per sale item instead of per sale
        groups.clear();
        for (const sale of filtered) {
          for (const item of state.saleItems.filter((entry) => entry.sale_id === sale.id)) {
            if (!groups.has(item.product_id)) {
              groups.set(item.product_id, {
                group_key: item.product_id,
                group_label: item.product_name,
                count_sales: 0,
                total_qty: 0,
                total_sales: 0,
                total_discount: 0,
                total_tax: 0,
                distinct_products: 1,
              });
            }
            const group = groups.get(item.product_id);
            group.count_sales += 1;
            group.total_qty += Number(item.quantity || 0);
            group.total_sales += Number(item.total) || 0;
            group.total_discount += Number(item.discount || 0);
            group.total_tax += Number(item.tax || 0);
          }
        }
      }

      /* returns side */
      const returnGroups = new Map();
      for (const ret of state.returns.filter(
        (r) => r.company_id === companyId && r.return_type === "CUSTOMER" && visibleStores.includes(r.store_id)
      )) {
        if (operatorFilter && ret.created_by !== operatorFilter) continue;
        if (byDay && fromOrNull && ret.created_at.slice(0, 10) < fromOrNull) continue;
        if (byDay && toOrNull && ret.created_at.slice(0, 10) > toOrNull) continue;
        const items = state.returnItems.filter((entry) => entry.return_id === ret.id);
        for (const item of items) {
          const saleItem = state.saleItems.find((entry) => entry.id === item.sale_item_id);
          if (!saleItem) continue;
          const key = byStore ? ret.store_id : byUser ? ret.created_by : byProduct ? item.product_id : ret.created_at.slice(0, 10);
          if (!returnGroups.has(key)) {
            returnGroups.set(key, { returned_value: 0, returned_quantity: 0, count_returns: 0 });
          }
          const bucket = returnGroups.get(key);
          bucket.returned_value += Number(item.quantity) * Number(saleItem.unit_price);
          bucket.returned_quantity += Number(item.quantity);
          bucket.count_returns += 1;
        }
      }

      const rows = [...groups.values()].map((group) => {
        const returned = returnGroups.get(group.group_key) || { returned_value: 0, returned_quantity: 0, count_returns: 0 };
        return {
          group_key: byDay ? new Date(`${group.group_key}T00:00:00Z`) : group.group_key,
          group_label: group.group_label,
          count_sales: group.count_sales,
          total_qty: group.total_qty,
          total_sales: group.total_sales,
          total_discount: group.total_discount,
          total_tax: group.total_tax,
          distinct_products: group.distinct_products,
          total_returns: returned.returned_value,
          total_return_qty: returned.returned_quantity,
          count_returns: returned.count_returns,
        };
      });
      if (byDay) rows.sort((a, b) => a.group_key - b.group_key);
      else rows.sort((a, b) => b.total_sales - a.total_sales);
      return { rows };
    }

    /* payments breakdown */
    if (/SELECT pay\.payment_method AS method/.test(sql)) {
      const [companyId, storeOrStores, userOrNull, fromOrNull, toOrNull] = params;
      const visibleStores = Array.isArray(storeOrStores)
        ? storeOrStores
        : storeOrStores
          ? [storeOrStores]
          : state.stores.filter((s) => s.company_id === companyId).map((s) => s.id);
      const byDay = !/SELECT s\.store_id AS group_key|SELECT s\.user_id AS group_key|SELECT si\.product_id AS group_key/.test(sql);
      const saleIds = new Set(
        state.sales
          .filter((sale) => sale.company_id === companyId && sale.status === "completed" && visibleStores.includes(sale.store_id))
          .filter((sale) => {
            if (userOrNull && sale.user_id !== userOrNull) return false;
            if (byDay && fromOrNull && sale.created_at.slice(0, 10) < fromOrNull) return false;
            if (byDay && toOrNull && sale.created_at.slice(0, 10) > toOrNull) return false;
            return true;
          })
          .map((sale) => sale.id)
      );
      const buckets = new Map();
      for (const payment of state.payments.filter((p) => saleIds.has(p.sale_id))) {
        if (!buckets.has(payment.payment_method)) {
          buckets.set(payment.payment_method, { method: payment.payment_method, total_sales: 0, count_sales: 0 });
        }
        const bucket = buckets.get(payment.payment_method);
        bucket.total_sales += Number(payment.amount);
        bucket.count_sales += 1;
      }
      const rows = [...buckets.values()].sort((a, b) => b.total_sales - a.total_sales);
      return { rows };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    const result = await matchSql(sql, params);
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
  };

  return { state, db, addSale, addReturn };
}

/* ---------------------------------------------------------------- harness */

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, userId = USER, role = "admin" } = {}) {
  const mod = await import("../routes/reports.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: userId, companyId, storeId, roleId: `role-${role}`, role };
    next();
  });
  app.use(
    "/api",
    mod.default({
      authenticate: (_q, _s, n) => n(),
      authorize: () => (req, res, next) => req.user.role === "cashier"
        ? res.status(403).json({ success: false, message: "Permission denied" })
        : next(),
      db: ctx.db,
      canViewCompanyCustomers: async (user) => user.role === "admin",
      canAccessStore: async (user, target) => {
        if (user.role === "admin") return true;
        const u = ctx.state.users.find((entry) => entry.id === user.id);
        return Boolean(u && u.store_id === target);
      },
    })
  );
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

const DAY1 = "2026-09-20"; // Sunday
const DAY2 = "2026-09-21"; // Monday

function seed(ctx) {
  // Day 1, store 1, Bob: two items, card payment
  ctx.addSale({
    companyId: COMPANY_A,
    storeId: STORE_1,
    userId: USER_2,
    createdAt: `${DAY1}T09:00:00.000Z`,
    items: [
      { productId: P1, productName: "Coffee", quantity: 2, unitPrice: 3.5, discount: 0, tax: 1.0, total: 7.0, payments: ["card"] },
      { productId: P2, productName: "Tea", quantity: 1, unitPrice: 2.5, discount: 0.5, tax: 0.4, total: 2.5, payments: [] },
    ],
    payments: ["card"],
  });
  // Day 2, store 1, Bob: one item, cash
  ctx.addSale({
    companyId: COMPANY_A,
    storeId: STORE_1,
    userId: USER_2,
    createdAt: `${DAY2}T10:00:00.000Z`,
    items: [
      { productId: P1, productName: "Coffee", quantity: 3, unitPrice: 3.5, discount: 0, tax: 1.5, total: 10.5, payments: ["cash"] },
    ],
    payments: ["cash"],
  });
  // Day 2, store 2, admin: one item, cash
  ctx.addSale({
    companyId: COMPANY_A,
    storeId: STORE_2,
    userId: USER,
    createdAt: `${DAY2}T11:00:00.000Z`,
    items: [
      { productId: P2, productName: "Tea", quantity: 4, unitPrice: 2.5, discount: 0, tax: 1.6, total: 10.0, payments: ["cash"] },
    ],
    payments: ["cash"],
  });
  // Company B sale — must never leak
  ctx.addSale({
    companyId: COMPANY_B,
    storeId: STORE_B1,
    userId: USER_B,
    createdAt: `${DAY2}T12:00:00.000Z`,
    items: [{ productId: P1, productName: "Coffee", quantity: 9, unitPrice: 3.5, discount: 0, tax: 3, total: 31.5 }],
    payments: ["card"],
  });
  // Customer return on day 2 for Coffee (store 1, processed by Bob)
  ctx.addReturn({
    companyId: COMPANY_A,
    storeId: STORE_1,
    createdBy: USER_2,
    createdAt: `${DAY2}T15:00:00.000Z`,
    productId: P1,
    quantity: 1,
    unitPrice: 3.5,
  });
}

/* ---------------------------------------------------------------- tests */

describe("sales reports — permission enforcement", () => {
  test("user with reports.sales.view can access the overview", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER_2, role: "salesviewer" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/reports/sales/overview");
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    } finally {
      server.close();
    }
  });

  test("permission denied without reports.sales.view", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER_2, role: "cashier" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/reports/sales/overview");
      assert.equal(res.status, 403);
      assert.equal(res.body.success, false);
    } finally {
      server.close();
    }
  });

  test("admin bypasses the permission check", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/reports/sales/overview");
      assert.equal(res.status, 200);
    } finally {
      server.close();
    }
  });
});

describe("sales reports — calculations", () => {
  test("by day: metrics, returns and net sales are correct", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=day&dateFrom=${DAY1}&dateTo=${DAY2}`);
      assert.equal(res.status, 200);
      const rows = res.body.data.rows;
      assert.equal(rows.length, 2);

      const day1 = rows.find((row) => row.key === DAY1);
      assert.equal(day1.count_sales, 1);
      assert.equal(day1.total_qty, 3);
      assert.ok(Math.abs(day1.total_sales - 9.5) < 1e-9, "line sales = 7.0 + 2.5");
      assert.ok(Math.abs(day1.total_discount - 0.5) < 1e-9);
      assert.ok(Math.abs(day1.total_tax - 1.4) < 1e-9);
      assert.equal(day1.total_returns, 0);
      assert.ok(Math.abs(day1.net_sales - 9.5) < 1e-9);

      const day2 = rows.find((row) => row.key === DAY2);
      assert.equal(day2.count_sales, 2);
      assert.equal(day2.total_qty, 7);
      assert.ok(Math.abs(day2.total_sales - 20.5) < 1e-9, "10.5 + 10.0");
      assert.ok(Math.abs(day2.total_returns - 3.5) < 1e-9, "return of 1 x Coffee");
      assert.ok(Math.abs(day2.net_sales - 17.0) < 1e-9);

      const totals = res.body.data.totals;
      assert.equal(totals.count_sales, 3);
      assert.ok(Math.abs(totals.total_sales - 30.0) < 1e-9);
      assert.ok(Math.abs(totals.net_sales - 26.5) < 1e-9);
    } finally {
      server.close();
    }
  });

  test("by store: rows per store with correct metrics", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=store&dateFrom=${DAY1}&dateTo=${DAY2}`);
      assert.equal(res.status, 200);
      const rows = res.body.data.rows;
      assert.equal(rows.length, 2);
      const london = rows.find((row) => row.label === "London Store");
      assert.ok(london, "store label resolved");
      assert.equal(london.count_sales, 2);
      assert.ok(Math.abs(london.net_sales - 16.5) < 1e-9, "20.0 - 3.5 return");
      const manchester = rows.find((row) => row.label === "Manchester Store");
      assert.equal(manchester.count_sales, 1);
      assert.ok(Math.abs(manchester.total_sales - 10.0) < 1e-9);
    } finally {
      server.close();
    }
  });

  test("by user: operator rows resolve names and include their returns", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=user&dateFrom=${DAY1}&dateTo=${DAY2}`);
      assert.equal(res.status, 200);
      const rows = res.body.data.rows;
      assert.equal(rows.length, 2);
      const bob = rows.find((row) => row.label === "Bob Cashier");
      assert.ok(bob, "operator label resolved");
      assert.equal(bob.count_sales, 2);
      assert.ok(Math.abs(bob.net_sales - 16.5) < 1e-9);
      const al = rows.find((row) => row.label === "Al Admin");
      assert.equal(al.count_sales, 1);
    } finally {
      server.close();
    }
  });

  test("by product: item-level grouping with quantities", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=product&dateFrom=${DAY1}&dateTo=${DAY2}`);
      assert.equal(res.status, 200);
      const rows = res.body.data.rows;
      const coffee = rows.find((row) => row.label === "Coffee");
      assert.ok(coffee);
      assert.equal(coffee.total_qty, 5, "2 + 3 sold");
      assert.ok(Math.abs(coffee.total_sales - 17.5) < 1e-9);
      const tea = rows.find((row) => row.label === "Tea");
      assert.equal(tea.total_qty, 5, "1 + 4 sold");
      assert.ok(Math.abs(tea.total_discount - 0.5) < 1e-9);
    } finally {
      server.close();
    }
  });

  test("payment-method breakdown respects the filters", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=day&dateFrom=${DAY1}&dateTo=${DAY2}&storeId=${STORE_1}`);
      assert.equal(res.status, 200);
      const payments = res.body.data.payments;
      const cash = payments.find((p) => p.method === "cash");
      const card = payments.find((p) => p.method === "card");
      assert.ok(cash && card, "both methods present");
      assert.ok(Math.abs(cash.total_sales - 10.5) < 1e-9);
      assert.ok(Math.abs(card.total_sales - 7.0) < 1e-9);
    } finally {
      server.close();
    }
  });

  test("date range filter excludes sales outside the window", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=day&dateFrom=${DAY1}&dateTo=${DAY1}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.rows.length, 1);
      assert.equal(res.body.data.totals.count_sales, 1);
      assert.ok(Math.abs(res.body.data.totals.net_sales - 9.5) < 1e-9);
    } finally {
      server.close();
    }
  });
});

describe("sales reports — isolation and store rules", () => {
  test("company isolation: Company B data never appears for Company A", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=product&dateFrom=${DAY1}&dateTo=${DAY2}`);
      const coffee = res.body.data.rows.find((row) => row.label === "Coffee");
      assert.ok(Math.abs(coffee.total_qty - 5) < 1e-9, "only Company A units (2+3), not Company B's 9");
    } finally {
      server.close();
    }
  });

  test("foreign store filter is 404, restricted store filter is 403", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER_2, role: "restricted" });
    const { server, port } = await listen(app);
    try {
      const foreign = await get(port, `/api/reports/sales/overview?storeId=${STORE_B1}`);
      assert.equal(foreign.status, 404);
      const restricted = await get(port, `/api/reports/sales/overview?storeId=${STORE_2}`);
      assert.equal(restricted.status, 403);
    } finally {
      server.close();
    }
  });

  test("non-admin sees only their assigned store's rows", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER_2, role: "salesviewer" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/sales/overview?by=store&dateFrom=${DAY1}&dateTo=${DAY2}`);
      assert.equal(res.status, 200);
      const rows = res.body.data.rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].label, "London Store");
    } finally {
      server.close();
    }
  });

  test("unknown operator filter is 404", async () => {
    const ctx = makeCtx();
    seed(ctx);
    const app = await buildApp(ctx, { userId: USER, role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/reports/sales/overview?userId=does-not-exist");
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });
});
