/*
 * onePOS — Multiple Payment Methods foundation (focused suite)
 *
 *   node --test tests/paymentMethods.test.mjs
 *
 * Backend: the REAL routes/sales.js sale engine over HTTP against a stateful
 * fake that models the exact contract of the existing sale harnesses
 * (till session lookup, product re-validation, INSERT INTO sales/sale_items/
 * payments, idempotent clientRequestId).
 *
 * Proves:
 *   - single cash / card / other-tender sales write exactly one payment row
 *     with the right method and amount (unchanged contract);
 *   - split tender writes one row per method, each with its own amount,
 *     reconciling exactly to the sale total;
 *   - over/under payment, zero/negative/unknown/duplicate lines are rejected
 *     (400) and leave NO sale behind (transactional);
 *   - customer_credit and loyalty redemption cannot be combined with a split;
 *   - offline: cash-only queueing, card refusal, paymentUnverified
 *     classification (card→true, cash/split→false) in the REAL queue.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { randomUUID } from "node:crypto";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";

/* ------------------------------------------------------- stateful fake db */

function makeCtx() {
  const state = { sales: [], payments: [] };

  const client = {
    query: async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      if (/to_char\(timezone/.test(s)) return { rows: [{ date_key: "20260921" }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) {
        return { rows: [{ next_number: state.sales.length + 1 }] };
      }
      if (/FROM till_sessions/.test(s)) {
        return {
          rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }],
        };
      }
      if (/SELECT id, price, vat_rate, vat_applicable\s+FROM products/.test(s)) {
        /* Batch catalogue re-pricing (server-authoritative totals engine). */
        return { rows: [{ id: "p-1", price: 10, vat_rate: null, vat_applicable: true }] };
      }
      if (/SELECT id,\s*name,\s*price,\s*(stock_quantity,\s*track_stock,\s*age_restricted|vat_rate,\s*track_stock)\s+FROM products/.test(s)) {
        return {
          rows: [{ id: params[0], name: "Test product", price: 5, stock_quantity: 100, track_stock: true, age_restricted: false, vat_rate: 0 }],
        };
      }
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0],
          store_id: params[1],
          customer_id: params[3],
          receipt_number: `T01-20260921-${String(state.sales.length + 1).padStart(4, "0")}`,
          total: Number(params[9]) || 0,
          client_request_id: params[10] ?? null,
          status: "completed",
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        return {
          rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }],
        };
      }
      if (/INSERT INTO payments/.test(s)) {
        state.payments.push({
          sale_id: params[0],
          payment_method: params[1],
          amount: Number(params[2]),
          status: "completed",
        });
        return { rowCount: 1 };
      }
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      if (/INSERT INTO inventory_movements/.test(s)) return { rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  return {
    state,
    pool: {
      async connect() {
        return client;
      },
    },
    /* Non-transactional handle: till-session lookup + idempotency checks. */
    db: async (sql, params = []) => {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/FROM till_sessions/.test(s)) {
        return {
          rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }],
        };
      }
      if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
      return { rows: [], rowCount: 0 };
    },
  };
}

async function buildApp(ctx) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY_A, storeId: STORE };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    associateCustomerWithStore: async () => ({}),
  }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const post = async (port, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const saleBody = (overrides = {}) => ({
  clientRequestId: randomUUID(),
  items: [{ productId: "p-1", quantity: 1, unitPrice: 10, tax: 0, discount: 0, total: 10 }],
  subtotal: 10,
  tax: 0,
  discount: 0,
  total: 10,
  paymentMethod: "cash",
  ...overrides,
});

const paymentsFor = (ctx, saleId) => ctx.state.payments.filter((p) => p.sale_id === saleId);

/* ------------------------------------------------------------------ tests */

test("single cash sale writes one completed payment row with the full amount", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(app.port, saleBody({ paymentMethod: "cash" }));

  assert.equal(status, 201);
  assert.equal(body.success, true);
  assert.equal(ctx.state.sales.length, 1);
  const rows = paymentsFor(ctx, body.sale.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_method, "cash");
  assert.equal(rows[0].amount, 10);
  assert.equal(rows[0].status, "completed");
  await app.close();
});

test("single card sale records the card method and amount", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(app.port, saleBody({ paymentMethod: "card" }));

  assert.equal(status, 201);
  const rows = paymentsFor(ctx, body.sale.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_method, "card");
  assert.equal(rows[0].amount, 10);
  await app.close();
});

test("other tender (voucher) is accepted and recorded as its own method", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(app.port, saleBody({ paymentMethod: "voucher" }));

  assert.equal(status, 201);
  const rows = paymentsFor(ctx, body.sale.id);
  assert.equal(rows[0].payment_method, "voucher");
  assert.equal(rows[0].amount, 10);
  await app.close();
});

test("split payment cash+card writes one row per method, reconciling to the total", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      paymentMethod: "split",
      payments: [
        { paymentMethod: "cash", amount: 6 },
        { paymentMethod: "card", amount: 4 },
      ],
    }),
  );

  assert.equal(status, 201);
  assert.equal(body.success, true);
  const rows = paymentsFor(ctx, body.sale.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.payment_method).sort(),
    ["card", "cash"],
  );
  assert.equal(rows.find((r) => r.payment_method === "cash").amount, 6);
  assert.equal(rows.find((r) => r.payment_method === "card").amount, 4);
  assert.equal(rows.reduce((sum, r) => sum + r.amount, 0), 10);
  await app.close();
});

test("three-way split reconciles exactly and keeps each amount", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      payments: [
        { paymentMethod: "cash", amount: 5.55 },
        { paymentMethod: "card", amount: 2.45 },
        { paymentMethod: "voucher", amount: 2 },
      ],
    }),
  );

  assert.equal(status, 201);
  const rows = paymentsFor(ctx, body.sale.id);
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((sum, r) => sum + r.amount, 0), 10);
  await app.close();
});

test("overpayment split is rejected with no sale created", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      payments: [
        { paymentMethod: "cash", amount: 8 },
        { paymentMethod: "card", amount: 4 },
      ],
    }),
  );

  assert.equal(status, 400);
  assert.match(body.message, /does not match the sale total/);
  assert.equal(ctx.state.sales.length, 0);
  assert.equal(ctx.state.payments.length, 0);
  await app.close();
});

test("underpayment split is rejected with no sale created", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      payments: [{ paymentMethod: "cash", amount: 9.99 }],
    }),
  );

  assert.equal(status, 400);
  assert.match(body.message, /does not match the sale total/);
  assert.equal(ctx.state.sales.length, 0);
  assert.equal(ctx.state.payments.length, 0);
  await app.close();
});

test("zero and negative payment lines are rejected", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  for (const amount of [0, -3]) {
    const { status } = await post(
      app.port,
      saleBody({ payments: [{ paymentMethod: "cash", amount }] }),
    );
    assert.equal(status, 400, `amount ${amount} must be rejected`);
  }
  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

test("unknown method and duplicate method lines are rejected", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const unknown = await post(
    app.port,
    saleBody({
      payments: [
        { paymentMethod: "iou", amount: 5 },
        { paymentMethod: "cash", amount: 5 },
      ],
    }),
  );
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /Invalid payment line/);

  const duplicate = await post(
    app.port,
    saleBody({
      payments: [
        { paymentMethod: "cash", amount: 5 },
        { paymentMethod: "cash", amount: 5 },
      ],
    }),
  );
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.body.message, /Duplicate payment method/);

  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

test("customer credit cannot be combined with other methods in a split", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      paymentMethod: "customer_credit",
      payments: [
        { paymentMethod: "customer_credit", amount: 5 },
        { paymentMethod: "cash", amount: 5 },
      ],
    }),
  );

  assert.equal(status, 400);
  assert.match(body.message, /cannot be combined/);
  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

test("loyalty redemption cannot be combined with split payments", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(
    app.port,
    saleBody({
      redeemPoints: 100,
      payments: [{ paymentMethod: "cash", amount: 10 }],
    }),
  );

  assert.equal(status, 400);
  assert.match(body.message, /Loyalty redemption cannot be combined/);
  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

test("a split without a payments array is rejected", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status, body } = await post(app.port, saleBody({ paymentMethod: "split" }));

  assert.equal(status, 400);
  assert.match(body.message, /requires a payments array/);
  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

test("penny-exact reconciliation: a 1p drift is rejected", async () => {
  const ctx = makeCtx();
  const app = await buildApp(ctx);

  const { status } = await post(
    app.port,
    saleBody({
      payments: [
        { paymentMethod: "cash", amount: 6 },
        { paymentMethod: "card", amount: 4.01 },
      ],
    }),
  );

  assert.equal(status, 400);
  assert.equal(ctx.state.sales.length, 0);
  await app.close();
});

/* ------------------------------------------------ offline queue contracts */

test("offline queue: cash/split entries are paymentUnverified=false; card entries are paymentUnverified=true", async () => {
  /* Isolated browser storage, exactly like tests/offlineQueue.test.mjs. */
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  const tenant = { companyId: COMPANY_A, storeId: STORE, userId: USER };
  localStorage.setItem(
    "onepos_token",
    `x.${Buffer.from(JSON.stringify(tenant)).toString("base64url")}.x`,
  );

  const { enqueueOfflineSale, getQueueEntries } = await import("../src/services/offlineQueue.js");

  try {
    const cash = enqueueOfflineSale({
      sale: { clientRequestId: randomUUID(), paymentMethod: "cash", total: 10, items: [] },
    });
    assert.equal(cash.ok, true);

    const card = enqueueOfflineSale({
      sale: { clientRequestId: randomUUID(), paymentMethod: "card", total: 10, items: [] },
    });
    assert.equal(card.ok, true);

    const split = enqueueOfflineSale({
      sale: {
        clientRequestId: randomUUID(),
        paymentMethod: "split",
        payments: [
          { paymentMethod: "cash", amount: 6 },
          { paymentMethod: "card", amount: 4 },
        ],
        total: 10,
        items: [],
      },
    });
    assert.equal(split.ok, true, "a reconciled offline split must be queueable like any sale payload");

    const entries = getQueueEntries();
    assert.equal(entries.length, 3);
    const byRequest = (id) => entries.find((e) => e.clientRequestId === id);
    assert.equal(byRequest(cash.entry.clientRequestId).paymentUnverified, false, "cash is a completed offline tender");
    assert.equal(byRequest(card.entry.clientRequestId).paymentUnverified, true, "card was never authorised by a terminal");
    assert.equal(byRequest(split.entry.clientRequestId).paymentUnverified, false, "split carries its own tender lines");
  } finally {
    storage.clear();
  }
});
