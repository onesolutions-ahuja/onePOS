/*
 * onePOS — Stock Transfers between locations (focused suite)
 *
 *   node --test tests/stockTransfers.test.mjs
 *
 * Backend under test: the REAL routes/inventory.js transfer endpoints over
 * HTTP plus the REAL services/inventory.js movement primitive, against the
 * same style of stateful SQL fakes as tests/stockByStore.test.mjs.
 *
 * Proves: atomic two-sided execution (TRANSFER_OUT/TRANSFER_IN), source and
 * destination stock effects, insufficient-source rejection, validation
 * (same store, quantity, lines), store-access and company isolation, multi-
 * product transfers, history + detail audit trail.
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
const USER = "e0000000-0000-4000-8000-000000000901";

process.env.NODE_ENV = "test";

const { createInventoryMovement } = await import("../services/inventory.js");

function makeCtx() {
  const state = {
    products: [
      { id: P1, company_id: CA, name: "Product A", sku: "A-1", stock_quantity: 0, active: true, price: 10, vat_rate: 20, track_stock: true },
      { id: P2, company_id: CA, name: "Product B", sku: "B-1", stock_quantity: 0, active: true, price: 5, vat_rate: 20, track_stock: true },
    ],
    stores: [
      { id: S1, company_id: CA, name: "Store 1", active: true },
      { id: S2, company_id: CA, name: "Store 2", active: true },
      { id: SB, company_id: CB, name: "B Store", active: true },
    ],
    pss: [],
    movements: [],
    transfers: [],
    transferItems: [],
    transferSeq: 0,
  };

  const norm = (sql) => String(sql).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

  const query = async (sql, params = []) => {
    const s = norm(sql);
    if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rows: [], rowCount: 0 };

    /* createInventoryMovement internals */
    if (/FROM products WHERE id = \$1 AND company_id = \$2 AND active = true FOR UPDATE/.test(s)) {
      const p = state.products.find((x) => x.id === params[0] && x.company_id === params[1] && x.active);
      return { rows: p ? [{ ...p }] : [] };
    }
    if (/UPDATE products SET stock_quantity = \$1, updated_at = NOW\(\) WHERE id = \$2 AND company_id = \$3/.test(s)) {
      const p = state.products.find((x) => x.id === params[1] && x.company_id === params[2]);
      if (p) p.stock_quantity = Number(params[0]);
      return { rows: [], rowCount: p ? 1 : 0 };
    }
    if (/INSERT INTO product_store_stock \(company_id, store_id, product_id, quantity\)/.test(s)) {
      let row = state.pss.find((x) => x.company_id === params[0] && x.store_id === params[1] && x.product_id === params[2]);
      if (row) row.quantity = Number(row.quantity) + Number(params[3]);
      else {
        row = { company_id: params[0], store_id: params[1], product_id: params[2], quantity: Number(params[3]) };
        state.pss.push(row);
      }
      return { rows: [{ quantity: row.quantity }] };
    }
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

    /* Transfer numbering */
    if (/MAX\(NULLIF\(SUBSTRING\(transfer_number FROM '\[0-9\]\+\$'\)/.test(s)) {
      const nums = state.transfers
        .filter((t) => t.company_id === params[0] && t.transfer_number)
        .map((t) => Number(t.transfer_number.match(/(\d+)$/)?.[1]) || 0);
      return { rows: [{ next_number: (nums.length ? Math.max(...nums) : 0) + 1 }] };
    }
    if (s === "SELECT 1 FROM stock_transfers WHERE transfer_number = $1 LIMIT 1") {
      return { rows: state.transfers.some((t) => t.transfer_number === params[0]) ? [{ 1: 1 }] : [] };
    }

    /* Transfer header insert */
    if (/INSERT INTO stock_transfers \(company_id, transfer_number, from_store_id, to_store_id, status, notes, created_by\)/.test(s)) {
      const t = {
        id: `tr-${(state.transferSeq += 1)}`,
        company_id: params[0], transfer_number: params[1], from_store_id: params[2], to_store_id: params[3],
        status: "COMPLETED", notes: params[4], created_by: params[5], created_at: new Date().toISOString(),
      };
      state.transfers.push(t);
      return { rows: [{ id: t.id, transfer_number: t.transfer_number, created_at: t.created_at }] };
    }
    /* Transfer line insert */
    if (/INSERT INTO stock_transfer_items \(transfer_id, product_id, quantity\) VALUES \(\$1, \$2, \$3\)/.test(s)) {
      state.transferItems.push({ transfer_id: params[0], product_id: params[1], quantity: Number(params[2]) });
      return { rows: [], rowCount: 1 };
    }

    /* Transfer history */
    if (/COUNT\(ti\.id\)::int AS item_count/.test(s)) {
      const filter = params[1];
      const rows = state.transfers
        .filter((t) => t.company_id === params[0])
        .filter((t) => !filter || filter.includes(t.from_store_id) || filter.includes(t.to_store_id))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map((t) => {
          const items = state.transferItems.filter((i) => i.transfer_id === t.id);
          const from = state.stores.find((st) => st.id === t.from_store_id);
          const to = state.stores.find((st) => st.id === t.to_store_id);
          return {
            id: t.id, transfer_number: t.transfer_number, from_store_id: t.from_store_id, to_store_id: t.to_store_id,
            from_store_name: from?.name, to_store_name: to?.name, status: t.status, notes: t.notes,
            created_by_name: "op", created_at: t.created_at,
            item_count: items.length, total_quantity: items.reduce((a, i) => a + i.quantity, 0),
          };
        });
      return { rows };
    }
    /* Transfer detail header */
    if (/WHERE t\.id = \$2 AND t\.company_id = \$1/.test(s)) {
      const t = state.transfers.find(
        (x) => x.id === params[1] && x.company_id === params[0] &&
          (!params[2] || params[2].includes(x.from_store_id) || params[2].includes(x.to_store_id))
      );
      if (!t) return { rows: [] };
      return { rows: [{ ...t, from_store_name: state.stores.find((st) => st.id === t.from_store_id)?.name, to_store_name: state.stores.find((st) => st.id === t.to_store_id)?.name, created_by_name: "op" }] };
    }
    /* Transfer detail items */
    if (/SELECT ti\.product_id, p\.name AS product_name, p\.sku, ti\.quantity/.test(s)) {
      const rows = state.transferItems
        .filter((i) => i.transfer_id === params[0])
        .map((i) => ({ ...i, product_name: state.products.find((p) => p.id === i.product_id)?.name, sku: "X" }));
      return { rows };
    }
    /* Transfer detail movements */
    if (/m\.reference_type = 'STOCK_TRANSFER' AND m\.reference_id = \$1/.test(s)) {
      const rows = state.movements
        .filter((m) => m.reference_type === "STOCK_TRANSFER" && m.reference_id === params[0])
        .map((m) => ({ ...m, store_name: state.stores.find((st) => st.id === m.store_id)?.name, username: "op" }));
      return { rows };
    }
    /* transfer-stores picker */
    if (/SELECT s\.id, s\.name, s\.code\s+FROM stores s/.test(s)) {
      const filter = params[1];
      const rows = state.stores
        .filter((st) => st.company_id === params[0] && st.active)
        .filter((st) => !filter || filter.includes(st.id));
      return { rows };
    }
    /* Company-membership pre-check on the transfer create path */
    if (/SELECT id FROM stores WHERE company_id = \$1 AND \(id = \$2 OR id = \$3\)/.test(s)) {
      const rows = state.stores.filter((st) => st.company_id === params[0] && (st.id === params[1] || st.id === params[2]));
      return { rows: rows.map((st) => ({ id: st.id })) };
    }

    return { rows: [], rowCount: 0 };
  };

  /* Transaction support: the fake must model real atomicity — a ROLLBACK
   * restores every mutation made inside the transaction, so atomicity
   * assertions test the ROUTE's use of transactions, not the fake's mercy. */
  const makeTxClient = () => {
    let insideTx = false;
    return {
      async query(sql, params = []) {
        const s = norm(sql);
        if (/^BEGIN$/i.test(s)) { insideTx = true; return { rows: [], rowCount: 0 }; }
        if (/^ROLLBACK$/i.test(s)) {
          if (insideTx) {
            state.pss = state._txSnapshot.pss.map((x) => ({ ...x }));
            state.movements = state._txSnapshot.movements.map((x) => ({ ...x }));
            state.transfers = state._txSnapshot.transfers.map((x) => ({ ...x }));
            state.transferItems = state._txSnapshot.transferItems.map((x) => ({ ...x }));
            state.products.forEach((p, i) => Object.assign(p, state._txSnapshot.products[i]));
            state.movements.length = state._txSnapshot.movements.length; // keep refs fresh
          }
          insideTx = false;
          return { rows: [], rowCount: 0 };
        }
        if (/^COMMIT$/i.test(s)) { insideTx = false; return { rows: [], rowCount: 0 }; }
        if (insideTx && !state._txSnapshot) throw new Error("tx snapshot missing");
        return query(sql, params);
      },
      release() {},
    };
  };
  /* BEGIN takes a snapshot lazily; ROLLBACK restores it. */
  const rawClientQuery = makeTxClient().query;
  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$/i.test(s)) {
        state._txSnapshot = {
          pss: state.pss.map((x) => ({ ...x })),
          movements: [...state.movements],
          transfers: [...state.transfers],
          transferItems: [...state.transferItems],
          products: state.products.map((x) => ({ ...x })),
        };
        return { rows: [], rowCount: 0 };
      }
      if (/^ROLLBACK$/i.test(s)) {
        if (state._txSnapshot) {
          state.pss = state._txSnapshot.pss.map((x) => ({ ...x }));
          state.movements = state._txSnapshot.movements.slice();
          state.transfers = state._txSnapshot.transfers.slice();
          state.transferItems = state._txSnapshot.transferItems.slice();
          state.products.forEach((p, i) => Object.assign(p, state._txSnapshot.products[i]));
          state._txSnapshot = null;
        }
        return { rows: [], rowCount: 0 };
      }
      if (/^COMMIT$/i.test(s)) { state._txSnapshot = null; return { rows: [], rowCount: 0 }; }
      return query(sql, params);
    },
    release() {},
  };
  return { state, db: query, pool: { connect: async () => client } };
}

async function buildApp(ctx, { companyId = CA, storeId = S1, role = "manager", assignedStoreIds = [S1, S2] } = {}) {
  const mod = await import("../routes/inventory.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId, roleId: `role-${role}`, role, assignedStoreIds };
    next();
  });
  const canViewCompanyCustomers = async (user) => user.role === "admin";
  /* Mirrors server.js: the admin check is awaited INSIDE (a truthy Promise
   * from `promise || fallback` would short-circuit the assigned-store check). */
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
    inventoryMovementTypes: (await import("../services/inventory.js")).inventoryMovementTypes,
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
const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* Seed S1 with 25 of P1 and 10 of P2 (opening movements, store-attributed). */
async function seed(ctx) {
  const client = await ctx.pool.connect();
  await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "OPENING", quantityChange: 25, createdBy: USER });
  await createInventoryMovement(client, { companyId: CA, productId: P2, storeId: S1, movementType: "OPENING", quantityChange: 10, createdBy: USER });
  return client;
}

describe("stock transfers", () => {
  test("successful multi-product transfer: source decreases, destination increases, both movements recorded", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/inventory/transfers", {
        fromStoreId: S1, toStoreId: S2, notes: "Rebalance shelf stock",
        items: [{ productId: P1, quantity: 10 }, { productId: P2, quantity: 4 }],
      });
      assert.equal(res.status, 201);
      assert.match(res.body.data.transferNumber, /^TRF-\d{4}$/);
      assert.equal(res.body.data.items.length, 2);
      assert.equal(res.body.data.items[0].sourceBalanceAfter, 15);
      assert.equal(res.body.data.items[0].destinationBalanceAfter, 10);

      const s1 = ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1);
      const s2 = ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S2);
      assert.equal(s1.quantity, 15); // source decreased
      assert.equal(s2.quantity, 10); // destination increased

      const transferMovements = ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER");
      assert.equal(transferMovements.length, 4); // 2 products × (OUT + IN)
      assert.equal(transferMovements.filter((m) => m.movement_type === "TRANSFER_OUT").length, 2);
      assert.equal(transferMovements.filter((m) => m.movement_type === "TRANSFER_IN").length, 2);
      for (const m of transferMovements) {
        assert.equal(m.company_id, CA);
        assert.ok(m.store_id === S1 || m.store_id === S2);
        assert.equal(m.created_by, USER); // audit information
        assert.ok(m.reference_id); // transfer reference
      }
      const out = transferMovements.find((m) => m.movement_type === "TRANSFER_OUT" && m.product_id === P1);
      assert.equal(out.store_id, S1);
      assert.equal(out.quantity_change, -10);
    } finally { server.close(); }
  });

  test("single-product transfer works and writes one OUT/IN pair", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 1 }] });
      assert.equal(res.status, 201);
      assert.equal(ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER").length, 2);
    } finally { server.close(); }
  });

  test("insufficient source stock: rejected, nothing changed, no movements", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 26 }] });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Insufficient stock/i);
      assert.equal(ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER").length, 0);
      assert.equal(ctx.state.transfers.length, 0); // atomic: no orphan header
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1).quantity, 25);
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S2), undefined);
    } finally { server.close(); }
  });

  test("atomic rollback: a second-line failure leaves the first line untouched", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      /* Line 1 is fine (2 of P1); line 2 asks for 50 of P2 (only 10 exist). */
      const res = await post(port, "/api/inventory/transfers", {
        fromStoreId: S1, toStoreId: S2,
        items: [{ productId: P1, quantity: 2 }, { productId: P2, quantity: 50 }],
      });
      assert.equal(res.status, 400);
      const outs = ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER");
      assert.equal(outs.length, 0); // the successful first leg was rolled back too
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S2), undefined);
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1).quantity, 25);
      assert.equal(ctx.state.transfers.length, 0);
      assert.equal(ctx.state.transferItems.length, 0);
    } finally { server.close(); }
  });

  test("validation: same store, zero/negative quantity, missing lines, duplicate lines", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const same = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S1, items: [{ productId: P1, quantity: 1 }] });
      assert.equal(same.status, 400);
      assert.match(same.body.message, /different/i);

      const zero = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 0 }] });
      assert.equal(zero.status, 400);

      const negative = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: -3 }] });
      assert.equal(negative.status, 400);

      const empty = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [] });
      assert.equal(empty.status, 400);

      const dup = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }] });
      assert.equal(dup.status, 400);

      assert.equal(ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER").length, 0);
    } finally { server.close(); }
  });

  test("source-store permission: a store outside the operator's assignments is refused", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    /* Operator assigned only to S2: S1 is not theirs. */
    const app = await buildApp(ctx, { storeId: S2, assignedStoreIds: [S2] });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 5 }] });
      assert.equal(res.status, 403);
      assert.equal(ctx.state.movements.filter((m) => m.reference_type === "STOCK_TRANSFER").length, 0);
    } finally { server.close(); }
  });

  test("destination-store permission: refusing an inaccessible destination keeps source intact", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx, { assignedStoreIds: [S1] });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 5 }] });
      assert.equal(res.status, 403);
      assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1).quantity, 25);
      assert.equal(ctx.state.transfers.length, 0);
    } finally { server.close(); }
  });

  test("company isolation: Company B user cannot transfer into or out of Company A stores", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx, { companyId: CB, storeId: SB, role: "admin", assignedStoreIds: [SB] });
    const { server, port } = await listen(app);
    try {
      const asDest = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: SB, items: [{ productId: P1, quantity: 5 }] });
      assert.equal(asDest.status, 403);
      const asSource = await post(port, "/api/inventory/transfers", { fromStoreId: SB, toStoreId: S1, items: [{ productId: P1, quantity: 5 }] });
      assert.equal(asSource.status, 403);
      assert.equal(ctx.state.transfers.length, 0);
    } finally { server.close(); }
  });

  test("history is store-access filtered; detail 404s for inaccessible transfers", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const appA = await buildApp(ctx, { assignedStoreIds: [S1, S2] });
    const a = await listen(appA);
    let transferId;
    try {
      const created = await post(a.port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 3 }] });
      transferId = created.body.data.id;
      const list = await get(a.port, "/api/inventory/transfers");
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 1);
      assert.equal(list.body.data[0].transfer_number.startsWith("TRF-"), true);
      const detail = await get(a.port, `/api/inventory/transfers/${transferId}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.items.length, 1);
      assert.equal(detail.body.data.movements.length, 2);
      assert.ok(detail.body.data.movements.every((m) => m.movement_type === "TRANSFER_OUT" || m.movement_type === "TRANSFER_IN"));
    } finally { a.server.close(); }

    /* A Company B viewer sees neither the list entry nor the detail. */
    const appB = await buildApp(ctx, { companyId: CB, storeId: SB, role: "admin", assignedStoreIds: [SB] });
    const b = await listen(appB);
    try {
      const list = await get(b.port, "/api/inventory/transfers");
      assert.equal(list.body.data.length, 0);
      const detail = await get(b.port, `/api/inventory/transfers/${transferId}`);
      assert.equal(detail.status, 404);
    } finally { b.server.close(); }

    /* A Company A user assigned only to S1 still sees the transfer (it involves their store). */
    const appS1 = await buildApp(ctx, { assignedStoreIds: [S1] });
    const s1 = await listen(appS1);
    try {
      const list = await get(s1.port, "/api/inventory/transfers");
      assert.equal(list.body.data.length, 1);
      const detail = await get(s1.port, `/api/inventory/transfers/${transferId}`);
      assert.equal(detail.status, 200);
    } finally { s1.server.close(); }
  });

  test("transfer numbering is per-company sequential (TRF-0001, TRF-0002)", async () => {
    const ctx = makeCtx();
    await seed(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const first = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 1 }] });
      const second = await post(port, "/api/inventory/transfers", { fromStoreId: S1, toStoreId: S2, items: [{ productId: P1, quantity: 1 }] });
      assert.equal(first.body.data.transferNumber, "TRF-0001");
      assert.equal(second.body.data.transferNumber, "TRF-0002");
    } finally { server.close(); }
  });

  test("transfer-stores picker only offers accessible stores", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { assignedStoreIds: [S1, S2] });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/inventory/transfer-stores");
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.map((s) => s.id).sort(), [S1, S2].sort());
      assert.ok(!res.body.data.some((s) => s.id === SB));
    } finally { server.close(); }
  });
});

describe("stock transfer static contracts", () => {
  test("movement types are registered in the shared set and both DDL check constraints", async () => {
    const svc = fs.readFileSync("services/inventory.js", "utf8");
    assert.ok(/"TRANSFER_OUT"/.test(svc) && /"TRANSFER_IN"/.test(svc));
    const init = fs.readFileSync("database/init.js", "utf8");
    assert.ok(/'TRANSFER_OUT',\s*\n\s*'TRANSFER_IN'/.test(init));
    const schema = fs.readFileSync("database/schema.sql", "utf8");
    assert.ok(/'TRANSFER_OUT',\s*\n\s*'TRANSFER_IN'/.test(schema));
  });

  test("transfer execution goes through the shared movement primitive (no second stock system)", async () => {
    const src = fs.readFileSync("routes/inventory.js", "utf8");
    const createCalls = (src.match(/movementType: "TRANSFER_OUT"/g) || []).length;
    const inCalls = (src.match(/movementType: "TRANSFER_IN"/g) || []).length;
    assert.ok(createCalls >= 1 && inCalls >= 1, "both legs use createInventoryMovement");
    assert.match(src, /referenceType: "STOCK_TRANSFER"/, "movements reference the transfer");
  });
});
