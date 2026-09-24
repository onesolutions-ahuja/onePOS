/*
 * Reporting -> Profit / Margin — backend/API integration tests.
 *
 * Exercises GET /api/reports/profit against a real PostgreSQL database using
 * the EXISTING onePOS sales / sale_items / stock_returns / products tables:
 *   1. COGS calculation (from products.cost_price, returns reverse COGS)
 *   2. Gross profit calculation
 *   3. Gross margin percentage
 *   4. Date / date-range filtering
 *   5. Store + product filtering (session store default, access-checked override)
 *   6. Permission enforcement (reports.profit.view required)
 *   7. Products with missing/zero cost (unknown cost, never fake profit)
 *   8. Existing sales data unaffected by the report
 *
 * Run:  node --test tests/profitMargin.test.mjs
 */
import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import reportsRt from "../routes/reports.js";
import { requireTestDatabaseUrl } from "./testDatabaseEnv.mjs";

const tag = () => crypto.randomUUID().slice(0, 8);

const createTestDb = async () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  const db = (q, p) => pool.query(q, p);
  const t = tag();
  const company = await db(`INSERT INTO companies(name) VALUES($1) RETURNING id`, [`profit-${t}`]);
  const companyId = company.rows[0].id;
  const store = await db(`INSERT INTO stores(company_id, name) VALUES($1, $2) RETURNING id`, [companyId, `profit-store-${t}`]);
  const storeId = store.rows[0].id;
  const otherStore = await db(`INSERT INTO stores(company_id, name) VALUES($1, $2) RETURNING id`, [companyId, `profit-other-${t}`]);
  const otherStoreId = otherStore.rows[0].id;
  const role = await db(`INSERT INTO roles(company_id,name) VALUES($1,$2) RETURNING id`, [companyId, `operator-${t}`]);
  const user = await db(
    `INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [companyId, storeId, role.rows[0].id, `op-${t}`, `Operator ${t}`, await bcrypt.hash("pass", 10)]
  );
  const userId = user.rows[0].id;
  const cat = await db(`INSERT INTO categories(company_id,name) VALUES($1,$2) RETURNING id`, [companyId, `ProfitTest-${t}`]);
  const categoryId = cat.rows[0].id;
  const insertProduct = async ({ name, cost }) =>
    (
      await db(
        `INSERT INTO products(company_id,category_id,name,sku,price,cost_price,vat_rate,vat_applicable,stock_quantity,low_stock_level,track_stock,active)
         VALUES($1,$2,$3,$4,$5,$6,20,true,100,5,true,true) RETURNING id,name,cost_price`,
        [companyId, categoryId, name, `SKU-${tag()}`, 10, cost]
      )
    ).rows[0];

  const insertSale = async ({ store = storeId, createdAt, items }) => {
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const tax = items.reduce((s, i) => s + i.tax, 0);
    const sale = await db(
      `INSERT INTO sales(company_id,store_id,user_id,subtotal,tax,discount,total,status,created_at) VALUES($1,$2,$3,$4,$5,0,$6,'completed',$7) RETURNING id`,
      [companyId, store, userId, subtotal, tax, subtotal, createdAt]
    );
    const saleId = sale.rows[0].id;
    for (const i of items) {
      await db(
        `INSERT INTO sale_items(sale_id,product_id,product_name,quantity,unit_price,discount,tax,total,item_type) VALUES($1,$2,$3,$4,$5,0,$6,$7,'PRODUCT')`,
        [saleId, i.productId, i.name, i.quantity, i.unitPrice, i.tax, i.total]
      );
    }
    return saleId;
  };

  /* A: known cost; B/C have unknown cost. */
  const productA = await insertProduct({ name: "Costed Product A", cost: 4 });
  const productB = await insertProduct({ name: "Zero Cost Product B", cost: 0 });
  const productC = await insertProduct({ name: "Null Cost Product C", cost: null });

  /* Sale 1 (today): 2 × A @ 10.00, line tax 4.00 → VAT-excl revenue 16.00, COGS 8.00 */
  const sale1 = await insertSale({
    createdAt: new Date(),
    items: [{ productId: productA.id, name: productA.name, quantity: 2, unitPrice: 10, tax: 4, total: 20 }],
  });
  /* Sale 2 (today): 1 × B @ 12.00 (zero cost) + 1 × C @ 5.00 (null cost) */
  await insertSale({
    createdAt: new Date(),
    items: [
      { productId: productB.id, name: productB.name, quantity: 1, unitPrice: 12, tax: 0, total: 12 },
      { productId: productC.id, name: productC.name, quantity: 1, unitPrice: 5, tax: 0, total: 5 },
    ],
  });
  /* Sale 3 (2 years ago): 1 × A — outside default date filters */
  const old = new Date();
  old.setFullYear(old.getFullYear() - 2);
  await insertSale({ createdAt: old, items: [{ productId: productA.id, name: productA.name, quantity: 1, unitPrice: 10, tax: 4, total: 20 }] });
  /* Sale 4 (today, other store): 1 × A — excluded unless store override allowed */
  await insertSale({
    store: otherStoreId,
    createdAt: new Date(),
    items: [{ productId: productA.id, name: productA.name, quantity: 1, unitPrice: 10, tax: 4, total: 20 }],
  });

  /* Customer return: 1 of the 2 sold A units back */
  await db(
    `INSERT INTO stock_returns(company_id,store_id,return_type,status,sale_id,created_by) VALUES($1,$2,'CUSTOMER','COMPLETED',$3,$4)`,
    [companyId, storeId, sale1, userId]
  );
  const returnRow = await db(`SELECT id FROM stock_returns WHERE company_id=$1 AND store_id=$2 AND sale_id=$3 LIMIT 1`, [companyId, storeId, sale1]);
  const saleItemA = await db(`SELECT id FROM sale_items WHERE sale_id=$1 AND product_id=$2 LIMIT 1`, [sale1, productA.id]);
  await db(`INSERT INTO stock_return_items(return_id,sale_item_id,product_id,quantity) VALUES($1,$2,$3,1)`, [returnRow.rows[0].id, saleItemA.rows[0].id, productA.id]);

  const cleanup = async () => {
    await db(`DELETE FROM stock_return_items WHERE return_id IN (SELECT id FROM stock_returns WHERE company_id=$1)`, [companyId]);
    await db(`DELETE FROM stock_returns WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE company_id=$1)`, [companyId]);
    await db(`DELETE FROM sales WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM products WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM categories WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM users WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM roles WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM stores WHERE company_id=$1`, [companyId]);
    await db(`DELETE FROM companies WHERE id=$1`, [companyId]);
    await pool.end();
  };

  return { pool, db, companyId, storeId, otherStoreId, userId, productA, productB, productC, cleanup };
};


/* Harness: router mounted under /api with an injectable authorize() (mirrors
 * the granular-permissions suite) so permission behaviour is really tested. */
const buildApp = (ctx, { granted = true } = {}) => {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    req.user = { id: ctx.userId, companyId: ctx.companyId, storeId: ctx.storeId, roleId: "role-1", username: "tester" };
    const authenticate = (_req, _res, next) => next();
    const authorize = () => async (_req, res, next) => {
      if (granted) return next();
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
    };
    reportsRt({
      authenticate,
      authorize,
      db: ctx.db,
      canAccessStore: async (user, requestedStoreId) => requestedStoreId === ctx.otherStoreId || requestedStoreId === ctx.storeId,
      canViewCompanyCustomers: async () => false,
    })(req, res, next);
  });
  return app;
};

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0);
    server.once("listening", () => resolve({ server, port: server.address().port }));
  });

const req = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const withDefaults = async (ctx, granted = true) => {
  const { server, port } = await listen(buildApp(ctx, { granted }));
  return { server, get: (path) => req(port, path) };
};

/* Expected headline numbers for the default (today, session store) window:
 *   sold today in session store: 2×A + 1×B + 1×C (Sale 3 is old, Sale 4 other store)
 *   return reverses 1 × A → net 1×A + 1×B + 1×C
 *   VAT-excl sold revenue = 16 + 12 + 5 = 33; returned share = 16/2 = 8
 *   COGS = 2×4 − 1×4 = 4; costed net revenue = 16 − 8 = 8
 *   grossProfit = 8 − 4 = 4; margin = 4/8 = 50%
 */
test("COGS, gross profit and gross margin are calculated correctly and returns reverse them", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const { status, body } = await get("/api/reports/profit");
    assert.equal(status, 200);
    assert.equal(body.success, true);
    const d = body.data;
    assert.equal(d.grossSales, 37); // 20 + 12 + 5 (old + other-store sales excluded)
    assert.equal(d.vat, 4);
    /* 1. COGS: 2×4 sold − 1×4 returned = 4 (uncosted B/C lines contribute nothing) */
    assert.equal(d.cogs, 4);
    /* 2. Gross profit: costed net revenue (16 − 8) − cogs (4) = 4 */
    assert.equal(d.grossProfit, 4);
    /* 3. Gross margin %: 4 / 8 = 50% */
    assert.equal(d.grossMargin, 50);
    /* quantity sold net of the return */
    assert.equal(d.soldQuantity, 5);
    assert.equal(d.returnedQuantity, 1);
    assert.equal(d.quantitySold, 4);
    assert.equal(d.transactions, 2);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("date / date-range filtering restricts the profit window", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const iso = (d) => d.toISOString().slice(0, 10);
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);

    /* a narrow window: only the old sale (1×A, no return on it) */
    const fromOld = new Date(old);
    fromOld.setDate(fromOld.getDate() - 1);
    const toOld = new Date(old);
    toOld.setDate(toOld.getDate() + 1);
    const oldOnly = await get(`/api/reports/profit?dateFrom=${iso(fromOld)}&dateTo=${iso(toOld)}`);
    assert.equal(oldOnly.status, 200);
    assert.equal(oldOnly.body.data.grossSales, 20);
    assert.equal(oldOnly.body.data.cogs, 4); // 1×4, no return in this window
    assert.equal(oldOnly.body.data.grossProfit, 12); // revenue 16 − cogs 4
    assert.equal(oldOnly.body.data.grossMargin, 75);

    /* from=today: excludes the old sale entirely */
    const today = await get(`/api/reports/profit?dateFrom=${iso(new Date())}`);
    assert.equal(today.body.data.grossSales, 37);
    assert.equal(today.body.data.grossProfit, 4);

    /* impossible range: nothing */
    const empty = await get("/api/reports/profit?dateFrom=2099-01-01&dateTo=2099-12-31");
    assert.equal(empty.body.data.grossSales, 0);
    assert.equal(empty.body.data.cogs, 0);
    assert.equal(empty.body.data.grossProfit, 0);
    assert.equal(empty.body.data.grossMargin, 0);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("store filtering: session store by default, access-checked override, unknown store 404", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);

    /* default = authenticated session store only (other store's sale excluded) */
    const mine = await get("/api/reports/profit");
    assert.equal(mine.body.data.grossSales, 37);

    /* allowed override to the second store (canAccessStore grants it) */
    const other = await get(`/api/reports/profit?storeId=${ctx.otherStoreId}`);
    assert.equal(other.status, 200);
    assert.equal(other.body.data.grossSales, 20); // 1×A, no returns in that store
    assert.equal(other.body.data.cogs, 4);
    assert.equal(other.body.data.grossMargin, 75);
    assert.equal(other.body.data.filters.storeId, ctx.otherStoreId);

    /* unknown store → 404 */
    const missing = await get(`/api/reports/profit?storeId=00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("product filtering narrows the report to one product", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const onlyA = await get(`/api/reports/profit?productId=${ctx.productA.id}`);
    assert.equal(onlyA.status, 200);
    assert.equal(onlyA.body.data.grossSales, 20);
    assert.equal(onlyA.body.data.quantitySold, 1); // 2 sold − 1 returned
    assert.equal(onlyA.body.data.cogs, 4);
    assert.equal(onlyA.body.data.grossProfit, 4);

    /* unknown product → 404, never a silent full-report fallback */
    const missing = await get(`/api/reports/profit?productId=00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("products with missing/zero cost are reported as unknown, never as free profit", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const d = (await get("/api/reports/profit")).body.data;

    /* B (cost 0) and C (cost NULL) are excluded from COGS/profit, not counted
     * as 100%-margin lines; the report says exactly what was left out. */
    assert.equal(d.costComplete, false);
    assert.equal(d.excluded.quantity, 2); // 1×B + 1×C
    assert.equal(d.excluded.revenue, 17); // 12 + 5

    /* their own breakdown rows flag the missing cost */
    const rowB = d.products.find((p) => p.product === "Zero Cost Product B");
    const rowA = d.products.find((p) => p.product === "Costed Product A");
    assert.equal(rowB.costKnown, false);
    assert.equal(rowB.costComplete, false);
    assert.equal(rowB.grossProfit, 0);
    assert.equal(rowA.costKnown, true);
    assert.equal(rowA.grossProfit, 4);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("permission enforcement: reports.profit.view is required for the profit report", async () => {
  const ctx = await createTestDb();
  try {
    /* denied → 403, no data */
    const denied = await withDefaults(ctx, false);
    const forbidden = await denied.get("/api/reports/profit");
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.success, false);
    denied.server.close();

    /* granted → 200 (authorisation, not availability, is the difference) */
    const allowed = await withDefaults(ctx, true);
    const ok = await allowed.get("/api/reports/profit");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.success, true);
    allowed.server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("operator (user) filtering is supported and company-scoped", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const byUser = await get(`/api/reports/profit?userId=${ctx.userId}`);
    assert.equal(byUser.status, 200);
    assert.equal(byUser.body.data.grossSales, 37); // all sales belong to this operator
    assert.equal(byUser.body.data.operators.length, 1);
    assert.equal(byUser.body.data.operators[0].username, "tester");

    const missing = await get(`/api/reports/profit?userId=00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
    server.close();
  } finally {
    await ctx.cleanup();
  }
});

test("running the profit report does not change existing sales data or other reports", async () => {
  const ctx = await createTestDb();
  try {
    const { server, get } = await withDefaults(ctx);
    const before = await get("/api/reports/summary");
    const counts = await ctx.db(`SELECT COUNT(*)::int n FROM sales WHERE company_id=$1`, [ctx.companyId]);
    const items = await ctx.db(`SELECT COUNT(*)::int n FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE company_id=$1)`, [ctx.companyId]);

    await get("/api/reports/profit");
    await get(`/api/reports/profit?productId=${ctx.productA.id}`);

    const after = await get("/api/reports/summary");
    assert.deepEqual(after.body.data, before.body.data);
    const countsAfter = await ctx.db(`SELECT COUNT(*)::int n FROM sales WHERE company_id=$1`, [ctx.companyId]);
    const itemsAfter = await ctx.db(`SELECT COUNT(*)::int n FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE company_id=$1)`, [ctx.companyId]);
    assert.equal(countsAfter.rows[0].n, counts.rows[0].n);
    assert.equal(itemsAfter.rows[0].n, items.rows[0].n);

    /* the products report still sees the same sold quantities */
    const products = await get("/api/reports/products");
    const rowA = products.body.data.find((p) => Number(p.grossSales) === 40); // 4 × A overall
    assert.ok(rowA, "product report still lists the costed product's full sales");
    server.close();
  } finally {
    await ctx.cleanup();
  }
});
