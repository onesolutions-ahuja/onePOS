/*
 * onePOS — Stock by Store/Location foundation (focused suite)
 *
 *   node --test tests/stockByStore.test.mjs
 *
 * Backend under test:
 *   - the REAL services/inventory.js createInventoryMovement (the single
 *     stock-write primitive every writer shares) over an in-memory SQL fake
 *     modelling products, stores, product_store_stock and inventory_movements;
 *   - the REAL routes/inventory.js stock-read endpoints over HTTP.
 *
 * Proves: independent per-store quantities, company/store isolation,
 * duplicate-record impossibility (unique key upsert), store filtering,
 * permission-gated multi-store access, existing sales/purchase attribution.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

const CA = "a0000000-0000-4000-8000-000000000001";
const CB = "a0000000-0000-4000-8000-000000000002";
const S1 = "c0000000-0000-4000-8000-000000000101";
const S2 = "c0000000-0000-4000-8000-000000000102";
const SB = "c0000000-0000-4000-8000-000000000103";
const P1 = "p0000000-0000-4000-8000-000000000001";
const P2 = "p0000000-0000-4000-8000-000000000002";
const PB = "p0000000-0000-4000-8000-000000000003";
const USER = "e0000000-0000-4000-8000-000000000901";

process.env.NODE_ENV = "test";

const { createInventoryMovement, resolveStockStore, inventoryMovementTypes } = await import("../services/inventory.js");

function makeCtx() {
  const state = {
    products: [
      { id: P1, company_id: CA, name: "Product A", sku: "A-1", stock_quantity: 33, active: true, price: 10, vat_rate: 20, track_stock: true },
      { id: P2, company_id: CA, name: "Product B", sku: "B-1", stock_quantity: 7, active: true, price: 5, vat_rate: 20, track_stock: true },
      { id: PB, company_id: CB, name: "B Product", sku: "B-9", stock_quantity: 5, active: true, price: 1, vat_rate: 20, track_stock: true },
    ],
    stores: [
      { id: S1, company_id: CA, name: "Store 1" },
      { id: S2, company_id: CA, name: "Store 2" },
      { id: SB, company_id: CB, name: "B Store" },
    ],
    pss: [
      { company_id: CB, store_id: SB, product_id: PB, quantity: 5 },
    ],
    movements: [],
  };

  const norm = (sql) => String(sql).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

  const query = async (sql, params = []) => {
    const s = norm(sql);
    if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rows: [], rowCount: 0 };

    /* createInventoryMovement: product lock-read */
    if (/FROM products WHERE id = \$1 AND company_id = \$2 AND active = true FOR UPDATE/.test(s)) {
      const p = state.products.find((x) => x.id === params[0] && x.company_id === params[1] && x.active);
      return { rows: p ? [{ ...p }] : [] };
    }
    /* createInventoryMovement: company aggregate update */
    if (/UPDATE products SET stock_quantity = \$1, updated_at = NOW\(\) WHERE id = \$2 AND company_id = \$3/.test(s)) {
      const p = state.products.find((x) => x.id === params[1] && x.company_id === params[2]);
      if (p) p.stock_quantity = Number(params[0]);
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    /* createInventoryMovement: store position upsert (unique key models the DB constraint) */
    if (/INSERT INTO product_store_stock \(company_id, store_id, product_id, quantity\)/.test(s)) {
      let row = state.pss.find((x) => x.company_id === params[0] && x.store_id === params[1] && x.product_id === params[2]);
      const delta = Number(params[3]);
      if (row) {
        row.quantity = Number(row.quantity) + delta;
      } else {
        row = { company_id: params[0], store_id: params[1], product_id: params[2], quantity: delta };
        state.pss.push(row);
      }
      return { rows: [{ quantity: row.quantity }] };
    }
    /* createInventoryMovement: ledger append */
    if (/INSERT INTO inventory_movements/.test(s)) {
      const m = {
        id: `mv-${state.movements.length + 1}`,
        company_id: params[0], product_id: params[1], store_id: params[2], movement_type: params[3],
        quantity_change: params[4], balance_after: params[5], reference_type: params[6], reference_id: params[7],
        reason: params[8], notes: params[9], created_by: params[10], created_at: new Date().toISOString(),
      };
      state.movements.push(m);
      return { rows: [m] };
    }

    /* GET /inventory/stock — single store with company fallback */
    if (/COALESCE\(pss\.quantity, p\.stock_quantity\) AS quantity/.test(s)) {
      const rows = state.products
        .filter((p) => p.company_id === params[0] && p.active)
        .map((p) => {
          const pos = state.pss.find((x) => x.product_id === p.id && x.company_id === p.company_id && x.store_id === params[1]);
          return {
            product_id: p.id, name: p.name, sku: p.sku,
            quantity: pos ? pos.quantity : p.stock_quantity,
            is_company_fallback: !pos,
          };
        });
      return { rows };
    }
    /* GET /inventory/stock?allStores=true */
    if (/SELECT pss\.product_id, pss\.store_id, pss\.quantity, s\.name AS store_name/.test(s)) {
      const storeFilter = params[1];
      const rows = state.pss
        .filter((x) => x.company_id === params[0])
        .filter((x) => !storeFilter || storeFilter.includes(x.store_id))
        .map((x) => ({ ...x, store_name: state.stores.find((st) => st.id === x.store_id)?.name }))
        .sort((a, b) => String(a.store_name).localeCompare(String(b.store_name)));
      return { rows };
    }
    /* GET /inventory/stock/:productId */
    if (/SELECT pss\.store_id, pss\.quantity, s\.name AS store_name/.test(s)) {
      const storeFilter = params[2];
      const rows = state.pss
        .filter((x) => x.company_id === params[0] && x.product_id === params[1])
        .filter((x) => !storeFilter || storeFilter.includes(x.store_id))
        .map((x) => ({ ...x, store_name: state.stores.find((st) => st.id === x.store_id)?.name }))
        .sort((a, b) => String(a.store_name).localeCompare(String(b.store_name)));
      return { rows };
    }

    return { rows: [], rowCount: 0 };
  };

  const client = { query, release() {} };
  return { state, db: query, pool: { connect: async () => client } };
}

async function buildApp(ctx, { companyId = CA, storeId = S1, role = "manager", assignedStoreIds = [S1] } = {}) {
  const mod = await import("../routes/inventory.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId, roleId: `role-${role}`, role, assignedStoreIds };
    next();
  });
  const canViewCompanyCustomers = async (user) => user.role === "admin";
  /* Mirrors server.js canAccessStore: the admin check is awaited INSIDE —
   * `promise || fallback` would short-circuit on the truthy Promise object
   * and never run the assigned-store check. */
  const canAccessStore = async (user, target) => {
    if (await canViewCompanyCustomers(user)) return true;
    return Array.isArray(user.assignedStoreIds) && user.assignedStoreIds.includes(target);
  };
  app.use("/api", mod.default({
    authenticate: (_q, _s, n) => n(),
    authorize: () => (_q, _s, n) => n(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement,
    inventoryMovementTypes,
    canAccessStore,
    canViewCompanyCustomers,
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, port: server.address().port };
}
const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe("stock-by-store service primitive", () => {
  test("the same product holds independent quantities at two stores", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    const a = await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "OPENING", quantityChange: 25, createdBy: USER });
    const b = await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S2, movementType: "OPENING", quantityChange: 8, createdBy: USER });
    assert.equal(a.storeBalance, 25);
    assert.equal(b.storeBalance, 8);
    const positions = ctx.state.pss.filter((x) => x.product_id === P1).sort((x, y) => x.quantity - y.quantity);
    assert.deepEqual(positions.map((x) => [x.store_id, x.quantity]), [[S2, 8], [S1, 25]]);
    /* Company aggregate tracks the sum: 33 initial + 25 + 8. */
    assert.equal(ctx.state.products.find((p) => p.id === P1).stock_quantity, 66);
    assert.equal(ctx.state.movements.length, 2);
  });

  test("duplicate store/product stock record is impossible — the unique upsert accumulates", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "ADJUSTMENT_IN", quantityChange: 5, createdBy: USER });
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "ADJUSTMENT_IN", quantityChange: 5, createdBy: USER });
    const rows = ctx.state.pss.filter((x) => x.product_id === P1 && x.store_id === S1);
    assert.equal(rows.length, 1); // one record, never two
    assert.equal(rows[0].quantity, 10); // accumulated, not duplicated
  });

  test("non-SALE movement cannot drive a store position negative", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await assert.rejects(
      () => createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "ADJUSTMENT_OUT", quantityChange: -30, createdBy: USER }),
      /Insufficient stock/
    );
    /* The ledger row is never written; the caller's transaction rolls back
     * the store-position upsert (real DB) — no confirmed stock change. */
    assert.equal(ctx.state.movements.length, 0);
  });

  test("SALE keeps the existing policy: may go negative at store level", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    const r = await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "SALE", quantityChange: -30, createdBy: USER });
    assert.equal(r.storeBalance, -30); // SALE-only negative, as before
  });

  test("resolveStockStore: own store by default, other stores only via the existing access model", async () => {
    const user = { storeId: S1, assignedStoreIds: [S1], role: "manager" };
    assert.equal(await resolveStockStore({ user, requestedStoreId: null }), S1);
    assert.equal(await resolveStockStore({ user, requestedStoreId: S1 }), S1);
    await assert.rejects(
      () => resolveStockStore({ user, requestedStoreId: S2, canAccessStore: async () => false }),
      (e) => e.statusCode === 403
    );
    assert.equal(await resolveStockStore({ user, requestedStoreId: S2, canAccessStore: async () => true }), S2);
  });
});

describe("stock-by-store API", () => {
  test("current-store stock: store positions with company-fallback flagged, never a bare company total", async () => {
    const ctx = makeCtx();
    ctx.state.pss.push({ company_id: CA, store_id: S1, product_id: P2, quantity: 4 });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/inventory/stock");
      assert.equal(res.status, 200);
      const a = res.body.data.find((r) => r.productId === P1);
      assert.equal(a.quantity, 33); // no store row yet → explicit company fallback
      assert.equal(a.isCompanyFallback, true);
      const b = res.body.data.find((r) => r.productId === P2);
      assert.equal(b.quantity, 4); // store position wins over the company aggregate
      assert.equal(b.isCompanyFallback, false);
    } finally { server.close(); }
  });

  test("allStores: admin sees every company store; Company B rows are never exposed", async () => {
    const ctx = makeCtx();
    ctx.state.pss.push({ company_id: CA, store_id: S1, product_id: P1, quantity: 25 });
    ctx.state.pss.push({ company_id: CA, store_id: S2, product_id: P1, quantity: 8 });
    const app = await buildApp(ctx, { role: "admin", assignedStoreIds: [S1, S2] });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/inventory/stock?allStores=true");
      assert.equal(res.status, 200);
      const p1Rows = res.body.data.filter((r) => r.product_id === P1);
      assert.deepEqual(p1Rows.map((r) => r.store_id).sort(), [S1, S2].sort());
      assert.ok(!res.body.data.some((r) => r.store_id === SB)); // company isolation
    } finally { server.close(); }
  });

  test("allStores: multi-store user sees only assigned stores; single-store user is refused", async () => {
    const ctx = makeCtx();
    ctx.state.pss.push({ company_id: CA, store_id: S1, product_id: P1, quantity: 25 });
    ctx.state.pss.push({ company_id: CA, store_id: S2, product_id: P1, quantity: 8 });
    const multi = await buildApp(ctx, { assignedStoreIds: [S1, S2] });
    const m = await listen(multi);
    try {
      const res = await get(m.port, "/api/inventory/stock?allStores=true");
      assert.equal(res.status, 200);
      assert.deepEqual([...new Set(res.body.data.map((r) => r.store_id))].sort(), [S1, S2].sort());
    } finally { m.server.close(); }

    const single = await buildApp(ctx, { assignedStoreIds: [S1] });
    const s = await listen(single);
    try {
      const res = await get(s.port, "/api/inventory/stock?allStores=true");
      assert.equal(res.status, 403);
    } finally { s.server.close(); }
  });

  test("product stock across stores: labelled total; store filtering for assigned (non-admin) users", async () => {
    const ctx = makeCtx();
    ctx.state.pss.push({ company_id: CA, store_id: S1, product_id: P1, quantity: 25 });
    ctx.state.pss.push({ company_id: CA, store_id: S2, product_id: P1, quantity: 8 });
    const admin = await buildApp(ctx, { role: "admin", assignedStoreIds: [S1, S2] });
    const a = await listen(admin);
    try {
      const res = await get(a.port, `/api/inventory/stock/${P1}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.stores.length, 2);
      assert.equal(res.body.data.total, 33);
    } finally { a.server.close(); }

    const restricted = await buildApp(ctx, { assignedStoreIds: [S1] });
    const r = await listen(restricted);
    try {
      const res = await get(r.port, `/api/inventory/stock/${P1}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.stores.map((s) => s.storeId), [S1]);
      assert.equal(res.body.data.total, 25);
    } finally { r.server.close(); }
  });

  test("company isolation: Company B user never reads Company A stock", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { companyId: CB, storeId: SB, role: "admin", assignedStoreIds: [SB] });
    const { server, port } = await listen(app);
    try {
      const all = await get(port, "/api/inventory/stock?allStores=true");
      assert.ok(all.body.data.every((r) => r.store_id === SB));
      const one = await get(port, `/api/inventory/stock/${P1}`);
      assert.equal(one.body.data.stores.length, 0); // P1 belongs to Company A
    } finally { server.close(); }
  });

  test("adjustment defaults to the operator's store; another store needs access", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { assignedStoreIds: [S1] });
    const { server, port } = await listen(app);
    try {
      const denied = await post(port, "/api/inventory/adjustments", { productId: P1, adjustmentQuantity: 5, storeId: S2 });
      assert.equal(denied.status, 403);
      assert.equal(ctx.state.movements.length, 0);

      const ok = await post(port, "/api/inventory/adjustments", { productId: P1, adjustmentQuantity: 5 });
      assert.equal(ok.status, 201);
      assert.equal(ctx.state.movements[0].store_id, S1);
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1).quantity, 5);
    } finally { server.close(); }
  });

  test("adjustment with an assigned store is honoured (store-scoped writes)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { assignedStoreIds: [S1, S2] });
    const { server, port } = await listen(app);
    try {
      const ok = await post(port, "/api/inventory/adjustments", { productId: P1, adjustmentQuantity: 2, storeId: S2 });
      assert.equal(ok.status, 201);
      assert.equal(ctx.state.movements[0].store_id, S2);
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S2).quantity, 2);
    } finally { server.close(); }
  });
});

describe("stock attribution static contracts", () => {
  test("sales deduct against the sale's store (req.user.storeId SALE movement)", async () => {
    const src = fs.readFileSync("routes/sales.js", "utf8");
    assert.ok(/movementType: "SALE"/.test(src));
    assert.ok(/storeId: req\.user\.storeId,\s*\n\s*movementType: "SALE"/.test(src));
  });

  test("purchases receive into the purchase's store", async () => {
    const src = fs.readFileSync("services/purchaseReceiving.js", "utf8");
    assert.ok(/storeId: purchase\.store_id \|\| storeId/.test(src));
    assert.ok(/movementType: "PURCHASE"/.test(src));
  });

  test("product opening stock lands at the operator's store", async () => {
    const src = fs.readFileSync("routes/products.js", "utf8");
    assert.ok(/movementType: "OPENING"/.test(src));
    assert.ok(/storeId: req\.user\.storeId/.test(src));
  });

  test("offline queue preserves the tenant store identity for later stock sync", async () => {
    const src = fs.readFileSync("src/services/offlineQueue.js", "utf8");
    assert.ok(/tenant\.storeId/.test(src));
    assert.ok(/companyId: tenant\.companyId/.test(src));
  });
});
