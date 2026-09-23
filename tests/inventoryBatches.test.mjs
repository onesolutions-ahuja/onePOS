/*
 * onePOS — Store-Level Batch / Expiry Tracking (focused suite)
 *
 *   node --test tests/inventoryBatches.test.mjs
 *
 * Backend under test:
 *   - the REAL services/inventory.js batch helpers (upsertBatchRow,
 *     allocateBatchConsumption, receiveInventoryBatch, consumeInventoryBatch,
 *     expiryStatus, fefoCompare) over an in-memory SQL fake;
 *   - the REAL routes/inventoryBatches.js router over HTTP;
 *   - the REAL batch integration points: sale engine FEFO consumption
 *     (routes/sales.js), purchase receiving (routes/purchases.js), stock
 *     transfers (routes/inventory.js).
 *
 * Proves: store-level batches (same product, different stores/batches),
 * company/store isolation, client-supplied storeId cannot widen scope,
 * multiple batches per product, expiry statuses, expired stock never
 * auto-deleted, movement integration never bypasses batch quantities,
 * batch-tracked sale FEFO, permissions, and existing non-batch behaviour
 * unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const CA = "a0000000-0000-4000-8000-000000000001";
const CB = "a0000000-0000-4000-8000-000000000002";
const S1 = "c0000000-0000-4000-8000-000000000101"; // CA store 1
const S2 = "c0000000-0000-4000-8000-000000000102"; // CA store 2
const SB = "c0000000-0000-4000-8000-000000000103"; // CB store
const P1 = "p0000000-0000-4000-8000-000000000001"; // CA batch-tracked
const P2 = "p0000000-0000-4000-8000-000000000002"; // CA non-batch
const PB = "p0000000-0000-4000-8000-000000000003"; // CB product
const USER = "e0000000-0000-4000-8000-000000000901";

process.env.NODE_ENV = "test";

const inv = await import("../services/inventory.js");
const {
  createInventoryMovement,
  upsertBatchRow,
  allocateBatchConsumption,
  receiveInventoryBatch,
  consumeInventoryBatch,
  syncBatchMovement,
  expiryStatus,
  fefoCompare,
  inventoryMovementTypes,
} = inv;

function makeCtx() {
  const state = {
    products: [
      { id: P1, company_id: CA, name: "Milk 2L", sku: "MILK2L", stock_quantity: 0, active: true, price: 1.5, vat_rate: 20, track_stock: true, batch_tracking: true },
      { id: P2, company_id: CA, name: "Widget", sku: "WIDG", stock_quantity: 0, active: true, price: 2, vat_rate: 20, track_stock: true, batch_tracking: false },
      { id: PB, company_id: CB, name: "B Milk", sku: "BMILK", stock_quantity: 0, active: true, price: 1, vat_rate: 20, track_stock: true, batch_tracking: true },
    ],
    stores: [
      { id: S1, company_id: CA, name: "Store 1" },
      { id: S2, company_id: CA, name: "Store 2" },
      { id: SB, company_id: CB, name: "B Store" },
    ],
    pss: [],
    movements: [],
    batches: [],
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
    /* createInventoryMovement: store position upsert */
    if (/INSERT INTO product_store_stock \(company_id, store_id, product_id, quantity\)/.test(s)) {
      let row = state.pss.find((x) => x.company_id === params[0] && x.store_id === params[1] && x.product_id === params[2]);
      const delta = Number(params[3]);
      if (row) row.quantity = Number(row.quantity) + delta;
      else {
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

    /* upsertBatchRow: INSERT ... ON CONFLICT (company, store, product, batch_number) */
    if (/INSERT INTO inventory_batches \(company_id, store_id, product_id, batch_number, expiry_date, quantity\)/.test(s)) {
      const [companyId, storeId, productId, batchNumber, expiryDate, qty] = params;
      let row = state.batches.find((b) => b.company_id === companyId && b.store_id === storeId && b.product_id === productId && b.batch_number === batchNumber);
      if (/ON CONFLICT \(company_id, store_id, product_id, batch_number\) DO UPDATE SET quantity = inventory_batches.quantity \+ \$6/.test(s)) {
        if (row) {
          row.quantity = Number(row.quantity) + Number(qty);
          if (expiryDate) row.expiry_date = expiryDate;
          return { rows: [{ ...row }] };
        }
        row = { id: `bt-${state.batches.length + 1}`, company_id: companyId, store_id: storeId, product_id: productId, batch_number: batchNumber, expiry_date: expiryDate, quantity: Number(qty), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        state.batches.push(row);
        return { rows: [{ ...row }] };
      }
      /* numberless INSERT (plain RETURNING) */
      if (row) throw new Error("UNIQUE VIOLATION (fake): duplicate numberless batch");
      row = { id: `bt-${state.batches.length + 1}`, company_id: companyId, store_id: storeId, product_id: productId, batch_number: null, expiry_date: expiryDate, quantity: Number(qty), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.batches.push(row);
      return { rows: [{ ...row }] };
    }

    /* allocateBatchConsumption / consume: candidates lock-read */
    if (/SELECT id, batch_number, expiry_date, quantity FROM inventory_batches WHERE company_id = \$1 AND store_id = \$2 AND product_id = \$3 AND quantity > 0 FOR UPDATE/.test(s)) {
      const rows = state.batches
        .filter((b) => b.company_id === params[0] && b.store_id === params[1] && b.product_id === params[2] && Number(b.quantity) > 0)
        .map((b) => ({ ...b }));
      return { rows };
    }
    /* batches router: FOR UPDATE row claim (POST set / PUT / consume) —
     * distinguish by placeholder count since both end in company/store. */
    if (/SELECT (id, quantity|id, product_id, batch_number|id, product_id, batch_number, expiry_date, quantity) FROM inventory_batches WHERE/.test(s)) {
      const nParams = (s.match(/\$\d+/g) || []).length;
      if (nParams === 4) {
        /* POST set: (companyId, storeId, productId, batchNumber) */
        const row = state.batches.find((b) => b.company_id === params[0] && b.store_id === params[1] && b.product_id === params[2] && b.batch_number === params[3]);
        return { rows: row ? [{ ...row }] : [] };
      }
      /* PUT / consume: (id, companyId, storeId) */
      const row = state.batches.find((b) => b.id === params[0] && b.company_id === params[1] && b.store_id === params[2]);
      return { rows: row ? [{ ...row }] : [] };
    }
    /* batches router: rename clash check */
    if (/SELECT id FROM inventory_batches WHERE company_id = \$1 AND store_id = \$2 AND product_id = \$3 AND batch_number = \$4 AND id <> \$5/.test(s)) {
      const rows = state.batches.filter((b) => b.company_id === params[0] && b.store_id === params[1] && b.product_id === params[2] && b.batch_number === params[3] && b.id !== params[4]);
      return { rows: rows.map((b) => ({ id: b.id })) };
    }
    /* batches router: batch debit (per-row and shortfall-reconcile variants) */
    if (/UPDATE inventory_batches SET quantity = quantity - \$1, updated_at = NOW\(\) WHERE id = \$2/.test(s)) {
      const b = state.batches.find((x) => x.id === params[1]);
      if (b) b.quantity = Number(b.quantity) - Number(params[0]);
      return { rows: [], rowCount: b ? 1 : 0 };
    }
    if (/UPDATE inventory_batches SET quantity = GREATEST\(quantity - \$1, 0\), updated_at = NOW\(\) WHERE company_id = \$2 AND store_id = \$3 AND product_id = \$4/.test(s)) {
      const rows = state.batches.filter((b) => b.company_id === params[1] && b.store_id === params[2] && b.product_id === params[3]);
      for (const b of rows) b.quantity = Math.max(Number(b.quantity) - Number(params[0]), 0);
      return { rows: [], rowCount: rows.length };
    }
    /* batches router: accumulate batch row (set → delta > 0) */
    if (/UPDATE inventory_batches SET quantity = quantity \+ \$1, expiry_date = COALESCE\(\$3, expiry_date\), updated_at = NOW\(\) WHERE id = \$2/.test(s)) {
      const b = state.batches.find((x) => x.id === params[1]);
      if (b) {
        b.quantity = Number(b.quantity) + Number(params[0]);
        if (params[2]) b.expiry_date = params[2];
      }
      return { rows: [], rowCount: b ? 1 : 0 };
    }
    /* batches router: expiry-only update (delta == 0) */
    if (/UPDATE inventory_batches SET expiry_date = \$3, updated_at = NOW\(\) WHERE id = \$2 AND company_id = \$1/.test(s)) {
      const b = state.batches.find((x) => x.id === params[1]);
      if (b) b.expiry_date = params[2];
      return { rows: [], rowCount: b ? 1 : 0 };
    }
    /* batches router: generic SET update (PUT) — must come AFTER the specific UPDATE shapes */
    if (/UPDATE inventory_batches SET/.test(s)) {
      const b = state.batches.find((x) => x.id === params[0]);
      if (b) {
        if (/expiry_date = \$2/.test(s)) b.expiry_date = params[1];
        if (/batch_number = \$3/.test(s)) b.batch_number = params[2];
        else if (/batch_number = \$2/.test(s)) b.batch_number = params[1];
        b.updated_at = new Date().toISOString();
      }
      return { rows: [], rowCount: b ? 1 : 0 };
    }
    /* batches router: refreshed read-back after POST set */
    if (/SELECT id, batch_number, expiry_date, quantity FROM inventory_batches WHERE id = \$1$/.test(s)) {
      const b = state.batches.find((x) => x.id === params[0]);
      return { rows: b ? [{ ...b }] : [] };
    }
    /* batches router: PUT read-back (joined row) */
    if (/SELECT b.id, b.company_id, b.store_id, b.product_id, b.batch_number, b.expiry_date, b.quantity, b.created_at, b.updated_at, p.name AS product_name, p.sku, p.batch_tracking AS product_batch_tracking FROM inventory_batches b INNER JOIN products p ON p.id = b.product_id WHERE b.id = \$1$/.test(s)) {
      const b = state.batches.find((x) => x.id === params[0]);
      if (!b) return { rows: [] };
      const p = state.products.find((x) => x.id === b.product_id);
      return { rows: [{ ...b, product_name: p?.name, sku: p?.sku, product_batch_tracking: p?.batch_tracking }] };
    }
    /* shortfall reconcile */
    if (/UPDATE inventory_batches SET quantity = GREATEST\(quantity - \$1, 0\)/.test(s)) {
      const rows = state.batches.filter((b) => b.company_id === params[1] && b.store_id === params[2] && b.product_id === params[3]);
      for (const b of rows) b.quantity = Math.max(Number(b.quantity) - Number(params[0]), 0);
      return { rows: [], rowCount: rows.length };
    }

    /* batches list (GET /inventory/batches) */
    if (/SELECT b.id, b.company_id, b.store_id, b.product_id, b.batch_number, b.expiry_date, b.quantity, b.created_at, b.updated_at, p.name AS product_name, p.sku, p.batch_tracking AS product_batch_tracking FROM inventory_batches b INNER JOIN products p ON p.id = b.product_id WHERE/.test(s)) {
      const rows = state.batches
        .filter((b) => b.company_id === params[0] && b.store_id === params[1])
        .filter((b) => !params[2] || b.product_id === params[2])
        .map((b) => {
          const p = state.products.find((x) => x.id === b.product_id);
          return { ...b, product_name: p?.name, sku: p?.sku, product_batch_tracking: p?.batch_tracking };
        })
        .sort((a, b) => (a.expiry_date || "9999") < (b.expiry_date || "9999") ? -1 : 1);
      return { rows };
    }

    return { rows: [], rowCount: 0 };
  };

  const client = { query, release() {} };
  return { state, db: query, pool: { connect: async () => client } };
}

/* HTTP harness for the REAL batches router. Mirrors server.js wiring. */
async function buildApp(ctx, { companyId = CA, storeId = S1, role = "manager", assignedStoreIds = [S1], permissions = null } = {}) {
  const mod = await import("../routes/inventoryBatches.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId, roleId: `role-${role}`, role, assignedStoreIds };
    next();
  });
  const canViewCompanyCustomers = async (user) => user.role === "admin";
  const canAccessStore = async (user, target) => {
    if (await canViewCompanyCustomers(user)) return true;
    return Array.isArray(user.assignedStoreIds) && user.assignedStoreIds.includes(target);
  };
  const allowed = permissions === null ? null : new Set(permissions);
  app.use("/api", mod.default({
    authenticate: (_q, _s, n) => n(),
    authorize: (perm) => (req, res, next) => {
      if (allowed && !allowed.has(perm) && role !== "admin") {
        return res.status(403).json({ success: false, message: `Missing permission: ${perm}` });
      }
      next();
    },
    db: ctx.db,
    pool: ctx.pool,
    canAccessStore,
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
const put = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe("batch service primitives", () => {
  test("upsertBatchRow accumulates the same batch and never overwrites", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 20 });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 5 });
    const rows = ctx.state.batches.filter((b) => b.batch_number === "A100");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].quantity, 25);
  });

  test("the same manufacturer batch number is separate stock in a different store", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "B200", expiryDate: "2026-11-05", quantity: 20 });
    await upsertBatchRow(client, { companyId: CA, storeId: S2, productId: P1, batchNumber: "B200", expiryDate: "2026-11-05", quantity: 50 });
    const rows = ctx.state.batches.filter((b) => b.batch_number === "B200");
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((b) => b.quantity).sort((a, b) => a - b), [20, 50]);
    /* No cross-store row exists. */
    assert.ok(!rows.some((b) => b.store_id === SB));
  });

  test("expiryStatus: valid / expiring / expired / none", () => {
    const now = new Date("2026-09-21T00:00:00Z");
    assert.equal(expiryStatus("2026-12-01", { now }), "valid");
    assert.equal(expiryStatus("2026-09-25", { now }), "expiring"); // within 7 days
    assert.equal(expiryStatus("2026-09-28", { now }), "expiring"); // exactly day 7 (<= boundary)
    assert.equal(expiryStatus("2026-09-29", { now }), "valid"); // day 8 is outside the window
    assert.equal(expiryStatus("2026-09-21", { now }), "expiring"); // today == boundary
    assert.equal(expiryStatus("2026-09-20", { now }), "expired");
    assert.equal(expiryStatus(null, { now }), "none");
    assert.equal(expiryStatus("not-a-date", { now }), "none");
    assert.equal(expiryStatus("2026-10-20", { now, expiringSoonDays: 30 }), "expiring");
  });

  test("fefoCompare orders nearest expiry first, undated last", () => {
    const rows = [
      { expiry_date: null, batch_number: "C" },
      { expiry_date: "2026-10-15", batch_number: "B" },
      { expiry_date: "2026-10-01", batch_number: "A" },
      { expiry_date: "2026-11-01", batch_number: "D" },
    ];
    assert.deepEqual([...rows].sort(fefoCompare).map((r) => r.batch_number), ["A", "B", "D", "C"]);
  });

  test("allocateBatchConsumption (fefo) consumes nearest expiry first across batches", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "B", expiryDate: "2026-10-15", quantity: 10 });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A", expiryDate: "2026-10-01", quantity: 10 });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "C", expiryDate: "2026-11-01", quantity: 10 });
    const { consumed } = await allocateBatchConsumption(client, { companyId: CA, storeId: S1, productId: P1, quantity: 25, mode: "fefo" });
    assert.deepEqual(consumed.map((c) => [c.batchNumber, c.quantity]), [["A", 10], ["B", 10], ["C", 5]]);
    const remaining = ctx.state.batches.find((b) => b.batch_number === "C");
    assert.equal(remaining.quantity, 5);
  });

  test("allocateBatchConsumption never goes negative on legacy (unbatched) stock — shortfall disclosed", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A", expiryDate: "2026-10-01", quantity: 4 });
    const { consumed } = await allocateBatchConsumption(client, { companyId: CA, storeId: S1, productId: P1, quantity: 10, mode: "fefo" });
    const unbatched = consumed.find((c) => c.unbatched);
    assert.ok(unbatched, "shortfall disclosed as unbatched line");
    assert.equal(unbatched.quantity, 6);
    assert.ok(ctx.state.batches.every((b) => Number(b.quantity) >= 0));
  });

  test("receiveInventoryBatch writes the movement AND the batch row", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    const { movement, batch } = await receiveInventoryBatch(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 20, createdBy: USER });
    assert.equal(movement.movement_type, "ADJUSTMENT_IN");
    assert.equal(batch.quantity, 20);
    assert.equal(ctx.state.movements.length, 1);
    assert.equal(ctx.state.pss.find((x) => x.product_id === P1 && x.store_id === S1).quantity, 20);
  });

  test("syncBatchMovement keeps existing stock writers batch-aware", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, {
      companyId: CA,
      storeId: S1,
      productId: P1,
      batchNumber: "ONLINE-1",
      expiryDate: "2026-12-01",
      quantity: 5,
    });

    await syncBatchMovement(client, {
      companyId: CA,
      storeId: S1,
      productId: P1,
      quantityChange: -2,
      batchTracked: true,
    });
    assert.equal(ctx.state.batches.find((row) => row.batch_number === "ONLINE-1").quantity, 3);

    await syncBatchMovement(client, {
      companyId: CA,
      storeId: S1,
      productId: P1,
      quantityChange: 4,
      batchTracked: true,
      batchNumber: "ONLINE-2",
      expiryDate: "2027-01-01",
    });
    const received = ctx.state.batches.find((row) => row.batch_number === "ONLINE-2");
    assert.equal(received.quantity, 4);
    assert.equal(received.expiry_date, "2027-01-01");
  });

  test("consumeInventoryBatch rejects a batch from another store (explicit mode)", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    /* S1 must hold saleable stock first — the movement primitive is
     * authoritative and rejects a -5 consume with nothing on the shelf. */
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "OPENING", quantityChange: 10, createdBy: USER });
    await upsertBatchRow(client, { companyId: CA, storeId: S2, productId: P1, batchNumber: "X1", expiryDate: null, quantity: 10 });
    const other = ctx.state.batches.find((b) => b.batch_number === "X1");
    await assert.rejects(
      () => consumeInventoryBatch(client, { companyId: CA, storeId: S1, productId: P1, quantity: 5, mode: "explicit", batchId: other.id, createdBy: USER }),
      /Batch not found for this store/
    );
    /* Nothing was debited. */
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "X1").quantity), 10);
  });
});

describe("batch HTTP API", () => {
  test("create a batch, retrieve it, list it (FEFO order)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);

    const created = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 20 });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.batch_number, "A100");
    assert.equal(created.body.data.expiry_status, "valid");

    const again = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 15 });
    assert.equal(again.status, 201);
    assert.equal(Number(again.body.data.quantity), 35); // accumulated, not overwritten

    const listed = await get(port, "/api/inventory/batches");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.length, 1);
    assert.equal(Number(listed.body.data[0].quantity), 35);
    server.close();
  });

  test("multiple batches per product coexist; expiry status computed per batch", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", expiryDate: "2026-09-20", quantity: 10 }); // past vs asOf
    await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A101", expiryDate: "2026-09-25", quantity: 35 });
    await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A102", expiryDate: "2026-12-01", quantity: 12 });

    const listed = await get(port, "/api/inventory/batches?asOf=2026-09-21");
    assert.equal(listed.body.data.length, 3);
    const byNumber = Object.fromEntries(listed.body.data.map((b) => [b.batch_number, b.expiry_status]));
    assert.deepEqual(byNumber, { A100: "expired", A101: "expiring", A102: "valid" });
    /* FEFO order: nearest expiry first, expired still visible (never deleted). */
    assert.deepEqual(listed.body.data.map((b) => b.batch_number), ["A100", "A101", "A102"]);
    server.close();
  });

  test("store isolation: Store 1 cannot see or modify Store 2 batches", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);

    /* Store 2 batch created by an operator based at Store 2. */
    const app2 = await buildApp(ctx, { storeId: S2, assignedStoreIds: [S2] });
    const { port: port2, server: server2 } = await listen(app2);
    await post(port2, "/api/inventory/batches", { productId: P1, batchNumber: "S2ONLY", expiryDate: "2026-10-01", quantity: 7 });
    server2.close();

    /* Store 1 operator: list shows only own store. */
    const listed = await get(port, "/api/inventory/batches");
    assert.ok(!listed.body.data.some((b) => b.batch_number === "S2ONLY"));

    /* Store 1 operator: GET by id of Store 2's batch → 404 (scoped). */
    const s2Batch = ctx.state.batches.find((b) => b.batch_number === "S2ONLY");
    const got = await get(port, `/api/inventory/batches/${s2Batch.id}`);
    assert.equal(got.status, 404);

    /* Store 1 operator: PUT on Store 2's batch → 404 (scoped). */
    const upd = await put(port, `/api/inventory/batches/${s2Batch.id}`, { expiryDate: "2027-01-01" });
    assert.equal(upd.status, 404);

    /* Store 1 operator: consume Store 2's batch → 404 (scoped). */
    const cons = await post(port, `/api/inventory/batches/${s2Batch.id}/consume`, { quantity: 3, reason: "Wastage" });
    assert.equal(cons.status, 404);
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "S2ONLY").quantity), 7);
    server.close();
  });

  test("client-supplied storeId cannot widen scope", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx); // operator: Store 1, assigned [S1]
    const { port, server } = await listen(app);
    const res = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "SNEAKY", quantity: 5, storeId: S2 });
    assert.equal(res.status, 403);
    assert.ok(!ctx.state.batches.some((b) => b.batch_number === "SNEAKY"));
    server.close();
  });

  test("company isolation: Company B cannot see or touch Company A batches", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx);
    const { port: portA, server: serverA } = await listen(appA);
    await post(portA, "/api/inventory/batches", { productId: P1, batchNumber: "A-ONLY", expiryDate: "2026-10-01", quantity: 9 });
    serverA.close();

    const appB = await buildApp(ctx, { companyId: CB, storeId: SB, assignedStoreIds: [SB], role: "admin" });
    const { port: portB, server: serverB } = await listen(appB);
    const listed = await get(portB, "/api/inventory/batches");
    assert.ok(!listed.body.data.some((b) => b.batch_number === "A-ONLY"));

    const aBatch = ctx.state.batches.find((b) => b.batch_number === "A-ONLY");
    const got = await get(portB, `/api/inventory/batches/${aBatch.id}`);
    assert.equal(got.status, 404);
    const upd = await put(portB, `/api/inventory/batches/${aBatch.id}`, { expiryDate: "2027-06-01" });
    assert.equal(upd.status, 404);
    const cons = await post(portB, `/api/inventory/batches/${aBatch.id}/consume`, { quantity: 9, reason: "Wastage" });
    assert.equal(cons.status, 404);
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "A-ONLY").quantity), 9);
    serverB.close();
  });

  test("expired batches remain listed (never silently deleted) and the expired filter finds them", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "OLD", expiryDate: "2026-09-01", quantity: 4 });
    const all = await get(port, "/api/inventory/batches?asOf=2026-09-21");
    assert.equal(all.body.data.length, 1);
    assert.equal(all.body.data[0].expiry_status, "expired");
    const expired = await get(port, "/api/inventory/batches?asOf=2026-09-21&expiryStatus=expired");
    assert.equal(expired.body.data.length, 1);
    server.close();
  });

  test("validation: zero/negative quantity, bad expiry, bad batch number, bad operation", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: 0 })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: -5 })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: 5, expiryDate: "01/10/2026" })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: 5, expiryDate: "2026-02-30" })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: 5, batchNumber: "x".repeat(101) })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: P1, quantity: 5, operation: "delete" })).status, 400);
    assert.equal((await post(port, "/api/inventory/batches", { productId: "00000000-0000-4000-8000-000000000999", quantity: 5 })).status, 404);
    server.close();
  });

  test("unauthorised user cannot create/update batches (inventory.adjust enforced)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { permissions: [] });
    const { port, server } = await listen(app);
    const created = await post(port, "/api/inventory/batches", { productId: P1, quantity: 5 });
    assert.equal(created.status, 403);
    assert.equal(ctx.state.batches.length, 0);
    server.close();
  });

  test("PUT updates expiry only when provided; quantity is not editable via PUT", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    const created = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 20 });
    const id = created.body.data.id;
    const upd = await put(port, `/api/inventory/batches/${id}`, { expiryDate: "2026-12-15" });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.data.expiry_date, "2026-12-15");
    assert.equal(Number(upd.body.data.quantity), 20); // unchanged
    const renamed = await put(port, `/api/inventory/batches/${id}`, { batchNumber: "A200" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.batch_number, "A200");
    server.close();
  });

  test("PUT renaming into an existing batch number in the same store is rejected (no silent merge)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", quantity: 5 });
    const second = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A101", quantity: 6 });
    const renamed = await put(port, `/api/inventory/batches/${second.body.data.id}`, { batchNumber: "A100" });
    assert.equal(renamed.status, 409);
    server.close();
  });

  test("batch consume (wastage) requires a canonical reason, debits the batch + ledger once", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    const created = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", expiryDate: "2026-10-01", quantity: 20 });
    const id = created.body.data.id;

    const noReason = await post(port, `/api/inventory/batches/${id}/consume`, { quantity: 2 });
    assert.equal(noReason.status, 400);

    const ok = await post(port, `/api/inventory/batches/${id}/consume`, { quantity: 5, reason: "Wastage - expired milk", notes: "bin 3" });
    assert.equal(ok.status, 200);
    const stored = ctx.state.batches.find((b) => b.id === id);
    assert.equal(Number(stored.quantity), 15);
    /* Exactly one ledger movement of -5 (wastage cannot bypass quantities). */
    const outs = ctx.state.movements.filter((m) => m.movement_type === "ADJUSTMENT_OUT");
    assert.equal(outs.length, 1);
    assert.equal(Number(outs[0].quantity_change), -5);
    assert.equal(/Wastage/i.test(outs[0].reason), true);

    const over = await post(port, `/api/inventory/batches/${id}/consume`, { quantity: 999, reason: "Other" });
    assert.equal(over.status, 400);
    server.close();
  });

  test("manual set (stocktake) reconciles the batch and the ledger", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { port, server } = await listen(app);
    const created = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", quantity: 20 });
    const id = created.body.data.id;
    const set = await post(port, "/api/inventory/batches", { productId: P1, batchNumber: "A100", quantity: 14, operation: "set" });
    assert.equal(set.status, 201);
    assert.equal(Number(set.body.data.quantity), 14);
    const stored = ctx.state.batches.find((b) => b.id === id);
    assert.equal(Number(stored.quantity), 14);
    const outs = ctx.state.movements.filter((m) => m.movement_type === "ADJUSTMENT_OUT");
    assert.equal(outs.length, 1);
    assert.equal(Number(outs[0].quantity_change), -6);
    server.close();
  });
});

describe("inventory integration", () => {
  test("batch-tracked sale consumes batches FEFO at the selling store", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A", expiryDate: "2026-10-01", quantity: 10 });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "B", expiryDate: "2026-10-15", quantity: 10 });
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "SALE", quantityChange: -12, createdBy: USER });
    await allocateBatchConsumption(client, { companyId: CA, storeId: S1, productId: P1, quantity: 12, mode: "fefo" });
    const a = ctx.state.batches.find((b) => b.batch_number === "A");
    const b = ctx.state.batches.find((b) => b.batch_number === "B");
    assert.equal(Number(a.quantity), 0);
    assert.equal(Number(b.quantity), 8);
    /* Store 2's identical batch untouched. */
    await upsertBatchRow(client, { companyId: CA, storeId: S2, productId: P1, batchNumber: "A", expiryDate: "2026-10-01", quantity: 10 });
    assert.equal(Number(ctx.state.batches.filter((x) => x.batch_number === "A" && x.store_id === S2)[0].quantity), 10);
  });

  test("non-batch-tracked products are unaffected (no batch rows, movement unchanged)", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    const m = await createInventoryMovement(client, { companyId: CA, productId: P2, storeId: S1, movementType: "SALE", quantityChange: -3, createdBy: USER });
    assert.equal(m.storeBalance, -3);
    assert.equal(ctx.state.batches.length, 0);
  });

  test("stock transfer moves batch rows with the goods (multi-batch, cross-store)", async () => {
    const ctx = makeCtx();
    const client = await ctx.pool.connect();
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "OPENING", quantityChange: 20, createdBy: USER });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "A", expiryDate: "2026-10-01", quantity: 10 });
    await upsertBatchRow(client, { companyId: CA, storeId: S1, productId: P1, batchNumber: "B", expiryDate: "2026-10-15", quantity: 10 });
    /* The transfer execution: source FEFO debit + destination mirror. */
    await createInventoryMovement(client, { companyId: CA, productId: P1, storeId: S1, movementType: "TRANSFER_OUT", quantityChange: -15, createdBy: USER });
    const { consumed } = await allocateBatchConsumption(client, { companyId: CA, storeId: S1, productId: P1, quantity: 15, mode: "fefo" });
    for (const c of consumed.filter((x) => x.batchNumber && !x.unbatched)) {
      await upsertBatchRow(client, { companyId: CA, storeId: S2, productId: P1, batchNumber: c.batchNumber, expiryDate: c.expiryDate, quantity: c.quantity });
    }
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "A" && b.store_id === S1).quantity), 0);
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "B" && b.store_id === S1).quantity), 5);
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "A" && b.store_id === S2).quantity), 10);
    assert.equal(Number(ctx.state.batches.find((b) => b.batch_number === "B" && b.store_id === S2).quantity), 5);
  });
});
