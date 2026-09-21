/*
 * T9M-SMALL - Sales Returns end-to-end tests.
 *
 * Drives the REAL routes/returns.js router over HTTP against a stateful fake
 * db that models sales, sale_items, stock_returns(+items), payments, refunds
 * and a real inventory ledger (quantities actually move). Covers: full
 * return, partial, second partial, excessive quantity, invalid sale,
 * cross-company, cross-store, inventory restoration, authoritative totals,
 * duplicate/invalid protection, return numbering, history scoping.
 *
 *   node --test tests/salesReturnsE2E.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { validateSalesReturn } from "../src/services/salesReturn.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const USER = "u0000000-0000-4000-8000-000000000009";

const SALE_1 = "s0000000-0000-4000-8000-00000000000a";
const SI_A = "i0000000-0000-4000-8000-00000000000a"; // 5 x £4.00 (track)
const SI_B = "i0000000-0000-4000-8000-00000000000b"; // 2 x £7.50 (no track)

/* ------------------------------------------------------------- fake db */

function makeHarness() {
  const state = {
    sales: new Map(),
    saleItems: new Map(),
    stockReturns: [], // { id, company_id, store_id, return_type, return_number, sale_id, request_key, status, refund_amount, refund_method, reason, created_at }
    returnItems: [], // { return_id, sale_item_id, purchase_item_id, product_id, quantity, reason }
    refunds: [], // { sale_id, amount, payment_method, return_id }
    inventory: new Map(), // productId -> qty (per store via composite key)
    movements: [], // audit of createInventoryMovement calls
    returnNumberSeq: {},
  };
  const invKey = (pid, sid) => `${pid}:${sid}`;

  const fakeDb = async (sql, params = []) => {
    const s = String(sql);
    if (/FROM stock_returns sr\s*$|FROM stock_returns sr\s+LEFT JOIN/i.test(s) && /ORDER BY sr\.created_at DESC/i.test(s)) {
      const rows = state.stockReturns
        .filter((r) => r.company_id === params[0] && (!/store_id = \$2/i.test(s) || r.store_id === params[1]))
        .map((r) => ({
          ...r,
          item_count: state.returnItems.filter((i) => i.return_id === r.id).length,
          quantity: state.returnItems.filter((i) => i.return_id === r.id).reduce((sum, i) => sum + Number(i.quantity), 0),
          sale_receipt: r.sale_id ? state.sales.get(r.sale_id)?.receipt_number : null,
          customer_name: r.sale_id ? (state.sales.get(r.sale_id)?.customer_name ?? null) : null,
        }));
      return { rows };
    }
    if (/FROM integration_connections/i.test(s) || /FROM integration_endpoints/i.test(s) || /FROM integrations/i.test(s)) {
      // T9G integration dispatcher probes (fire-and-forget; irrelevant here).
      return { rows: [] };
    }
    if (/FROM stock_return_items sri\s+LEFT JOIN sale_items si/i.test(s)) {
      const returnId = params[0];
      return {
        rows: state.returnItems
          .filter((i) => i.return_id === returnId)
          .map((i) => {
            const si = i.sale_item_id ? state.saleItems.get(i.sale_item_id) : null;
            return { product_name: si?.product_name ?? `Product ${i.product_id.slice(0, 6)}`, quantity: Number(i.quantity), unit_price: si?.unit_price ?? null, reason: i.reason };
          }),
      };
    }
    throw new Error("unexpected db use: " + s.slice(0, 70));
  };

  const fakePool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const s = String(sql);
          if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [], rowCount: 0 };
          if (/SELECT id FROM sales[\s\S]*receipt_number = \$/i.test(s)) {
            // lookup probe: params = [companyId(, storeId), search]
            const search = params[params.length - 1];
            const companyId = params[0];
            const storeScoped = params.length === 3;
            const found = [...state.sales.values()].find(
              (sale) => sale.company_id === companyId &&
                (!storeScoped || sale.store_id === params[1]) &&
                (sale.receipt_number === search || sale.id === search)
            );
            return { rows: found ? [{ id: found.id }] : [] };
          }
          if (/SELECT id FROM sales WHERE id=\$1 AND company_id=\$2 .* FOR UPDATE/i.test(s)) {
            const sale = state.sales.get(params[0]);
            const ok = sale && sale.company_id === params[1] && (params.length < 3 || sale.store_id === params[2]);
            return { rows: ok ? [{ id: sale.id }] : [] };
          }
          if (/SELECT id, store_id, supplier_id FROM purchases/i.test(s)) {
            return { rows: [] }; // no purchases in this suite
          }
          if (/SELECT id, return_number FROM stock_returns WHERE company_id=/i.test(s)) {
            const dup = state.stockReturns.find((r) => r.company_id === params[0] && r.request_key === params[1]);
            return { rows: dup ? [{ id: dup.id, return_number: dup.return_number }] : [] };
          }
          if (/COALESCE\(MAX\(NULLIF\(SUBSTRING\(return_number/i.test(s)) {
            const seq = state.returnNumberSeq[params[0]] || 0;
            return { rows: [{ next_number: seq + 1 }] };
          }
          if (/SELECT 1 FROM stock_returns WHERE return_number = \$1/i.test(s)) {
            const clash = state.stockReturns.some((r) => r.return_number === params[0]);
            return { rows: clash ? [{ 1: 1 }] : [] };
          }
          if (/SELECT s\.id, s\.company_id, s\.store_id, s\.customer_id, s\.receipt_number/i.test(s)) {
            const sale = state.sales.get(params[0]);
            const ok = sale && sale.company_id === params[1] && (params.length < 3 || sale.store_id === params[2]);
            if (!ok) return { rows: [] };
            return {
              rows: [{
                id: sale.id, company_id: sale.company_id, store_id: sale.store_id,
                receipt_number: sale.receipt_number, status: sale.status,
                subtotal: sale.subtotal, tax: sale.tax, discount: sale.discount, total: sale.total,
                created_at: sale.created_at, completed_at: sale.completed_at,
                customer_name: sale.customer_name, customer_phone: null, customer_email: null,
                payment_method: sale.payment_method, payment_amount: sale.total, payment_status: "completed",
              }],
            };
          }
          if (/FROM sale_items si\s+LEFT JOIN products pr/i.test(s)) {
            const items = [...state.saleItems.values()].filter((i) => i.sale_id === params[0]);
            const returnedByItem = new Map();
            for (const ri of state.returnItems) {
              if (!ri.sale_item_id) continue;
              const parent = state.stockReturns.find((r) => r.id === ri.return_id);
              if (parent?.return_type === "CUSTOMER" && parent?.status === "COMPLETED") {
                returnedByItem.set(ri.sale_item_id, (returnedByItem.get(ri.sale_item_id) || 0) + Number(ri.quantity));
              }
            }
            return {
              rows: items.map((i) => ({
                id: i.id, product_id: i.product_id, product_name: i.product_name,
                quantity: i.quantity, unit_price: i.unit_price, discount: i.discount, tax: i.tax,
                total: i.total, track_stock: i.track_stock,
                returned_quantity: returnedByItem.get(i.id) || 0,
              })),
            };
          }
          if (/COALESCE\(SUM\(amount\), 0\) AS refunded/i.test(s) || /COALESCE\(SUM\(amount\),0\) AS total\s+FROM refunds/i.test(s)) {
            const refunded = state.refunds.filter((r) => r.sale_id === params[0]).reduce((sum, r) => sum + Number(r.amount), 0);
            return { rows: [{ refunded, total: refunded }] };
          }
          if (/SELECT COALESCE\(SUM\(amount\),0\) AS total_paid/i.test(s)) {
            const sale = state.sales.get(params[0]);
            const paid = sale ? Number(sale.total) : 0;
            return { rows: [{ total_paid: paid, payment_method: sale?.payment_method ?? null }] };
          }
          if (/SELECT payment_method, COALESCE\(SUM\(amount\),0\) AS refunded\s+FROM refunds WHERE sale_id=\$1 GROUP BY/i.test(s)) {
            /* Per-method refund totals for the allocation cap. */
            const byMethod = new Map();
            for (const r of state.refunds.filter((x) => x.sale_id === params[0])) {
              byMethod.set(r.payment_method, (byMethod.get(r.payment_method) || 0) + Number(r.amount));
            }
            return { rows: [...byMethod.entries()].map(([payment_method, refunded]) => ({ payment_method, refunded })) };
          }
          if (/SELECT payment_method, amount FROM payments/i.test(s)) {
            /* Full tender list (single or split) for the sale — the
               payment-method-aware refund allocation reads this. */
            const sale = state.sales.get(params[0]);
            const rows = sale?.payment_method
              ? [{ payment_method: sale.payment_method, amount: sale.total }]
              : [];
            return { rows };
          }
          if (/SELECT COALESCE\(SUM\(sri\.quantity\),0\) AS quantity/i.test(s)) {
            const saleItemId = params[1];
            let returned = 0;
            for (const ri of state.returnItems) {
              if (ri.sale_item_id !== saleItemId) continue;
              const parent = state.stockReturns.find((r) => r.id === ri.return_id);
              if (parent?.return_type === "CUSTOMER" && parent?.status === "COMPLETED") returned += Number(ri.quantity);
            }
            return { rows: [{ quantity: returned }] };
          }
          if (/INSERT INTO stock_returns/i.test(s)) {
            const row = {
              id: `r${state.stockReturns.length + 1}`,
              company_id: params[0], store_id: params[1], return_type: "CUSTOMER",
              return_number: params[2], sale_id: params[3], request_key: params[4],
              status: "COMPLETED", refund_amount: params[6] || null, refund_method: params[7] || null,
              reason: params[5] || null, created_at: new Date(),
            };
            state.stockReturns.push(row);
            state.returnNumberSeq[params[0]] = (state.returnNumberSeq[params[0]] || 0) + 1;
            return { rows: [{ id: row.id }] };
          }
          if (/INSERT INTO stock_return_items/i.test(s)) {
            state.returnItems.push({ return_id: params[0], product_id: params[1], sale_item_id: params[2], purchase_item_id: null, quantity: Number(params[3]), reason: params[4] });
            return { rows: [] };
          }
          if (/INSERT INTO refunds/i.test(s)) {
            state.refunds.push({ sale_id: params[0], amount: Number(params[2]), payment_method: params[4], return_id: params[5] });
            return { rows: [] };
          }
          if (/UPDATE stock_returns SET refund_amount/i.test(s)) {
            const row = state.stockReturns.find((r) => r.id === params[2]);
            if (row) { row.refund_amount = Number(params[0]); row.refund_method = params[1]; }
            return { rows: [] };
          }
          throw new Error("unexpected pool query: " + s.slice(0, 70));
        },
        release() {},
      };
    },
  };

  // createInventoryMovement: a REAL mini-ledger so restoration is observable.
  const createInventoryMovement = async (client, { productId, storeId, quantityChange }) => {
    const key = invKey(productId, storeId);
    state.inventory.set(key, (state.inventory.get(key) || 0) + Number(quantityChange));
    state.movements.push({ productId, storeId, quantityChange });
    return { rows: [] };
  };

  const buildApp = async ({ companyId = COMPANY_A, storeId = STORE_1 } = {}) => {
    const mod = await import("../routes/returns.js");
    const app = express();
    app.use(express.json());
    const authorize = () => (_req, _res, next) => next();
    app.use(
      "/api",
      (req, _res, next) => {
        req.user = { id: USER, companyId, storeId, role: "admin" };
        next();
      },
      mod.default({ db: fakeDb, pool: fakePool, authenticate: (_req, _res, next) => next(), authorize, createInventoryMovement })
    );
    return app;
  };

  const listen = async (app) => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, port: server.address().port };
  };

  function seedSale1() {
    state.sales.set(SALE_1, {
      id: SALE_1, company_id: COMPANY_A, store_id: STORE_1,
      receipt_number: "T01-20260917-0001", status: "completed",
      subtotal: 35, tax: 0, discount: 0, total: 35,
      created_at: new Date(), completed_at: new Date(),
      customer_name: "Kate Brown", payment_method: "card",
    });
    state.saleItems.set(SI_A, { id: SI_A, sale_id: SALE_1, product_id: "p1111111-1111-4111-8111-111111111111", product_name: "Bread", quantity: 5, unit_price: 4, discount: 0, tax: 0, total: 20, track_stock: true });
    state.saleItems.set(SI_B, { id: SI_B, sale_id: SALE_1, product_id: "p2222222-2222-4222-8222-222222222222", product_name: "Milk", quantity: 2, unit_price: 7.5, discount: 0, tax: 0, total: 15, track_stock: false });
    state.inventory.set(invKey("p1111111-1111-4111-8111-111111111111", STORE_1), 100);
  }

  return { state, buildApp, listen, seedSale1, invKey, fakeDb };
}

const postReturn = (port, body) =>
  fetch(`http://127.0.0.1:${port}/api/returns/customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/* --------------------------------------------------------------- tests */

test("lookup returns authoritative items incl. already-returned and remaining", async () => {
  const h = makeHarness();
  h.seedSale1();
  // Pre-existing partial return of 2 units of item A.
  h.state.stockReturns.push({ id: "r9", company_id: COMPANY_A, store_id: STORE_1, return_type: "CUSTOMER", return_number: "RET-0001", sale_id: SALE_1, status: "COMPLETED", created_at: new Date() });
  h.state.returnItems.push({ return_id: "r9", product_id: "p1111111-1111-4111-8111-111111111111", sale_item_id: SI_A, quantity: 2 });
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/returns/lookup?receipt=${encodeURIComponent("T01-20260917-0001")}`);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.sale.receiptNumber, "T01-20260917-0001");
    assert.equal(body.data.sale.returnable, true);
    assert.equal(body.data.sale.customer.name, "Kate Brown");
    assert.equal(body.data.sale.payment.method, "card");
    const itemA = body.data.items.find((i) => i.id === SI_A);
    const itemB = body.data.items.find((i) => i.id === SI_B);
    assert.equal(itemA.quantity, 5);
    assert.equal(itemA.returnedQuantity, 2);
    assert.equal(itemA.remainingQuantity, 3);
    assert.equal(itemA.unitRefundValue, 4);
    assert.equal(itemB.remainingQuantity, 2);
    assert.equal(itemB.unitRefundValue, 7.5);
  } finally {
    server.close();
  }
});

test("full return: all items, refund equals authoritative total, stock restored", async () => {
  const h = makeHarness();
  h.seedSale1();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    const res = await postReturn(port, {
      saleId: SALE_1,
      items: [
        { saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 5 },
        { saleItemId: SI_B, productId: "p2222222-2222-4222-8222-222222222222", quantity: 2 },
      ],
      reason: "Changed mind",
      requestKey: "req-full-1",
    });
    const body = await res.json();
    assert.equal(res.status, 201, JSON.stringify(body));
    assert.match(body.data.returnNumber, /^RET-\d{4}$/);
    assert.equal(body.data.refund.amount, 35); // 5*4 + 2*7.5
    // Inventory: tracked product +5, untracked product untouched.
    assert.equal(h.state.inventory.get(h.invKey("p1111111-1111-4111-8111-111111111111", STORE_1)), 105);
    assert.equal(h.state.movements.filter((m) => m.productId.startsWith("p1")).length, 1);
    assert.equal(h.state.movements.filter((m) => m.productId.startsWith("p2")).length, 0);
    // Refund linked to the return.
    assert.equal(h.state.refunds.length, 1);
    assert.equal(h.state.refunds[0].amount, 35);
    assert.equal(h.state.refunds[0].return_id, body.data.id);
  } finally {
    server.close();
  }
});

test("partial return then second partial return: quantities and refunds accumulate", async () => {
  const h = makeHarness();
  h.seedSale1();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    // First partial: 2 of 5 item A = £8.
    const first = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 2 }], reason: "Damaged", requestKey: "req-p1" });
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    assert.equal(firstBody.data.refund.amount, 8);
    assert.equal(h.state.inventory.get(h.invKey("p1111111-1111-4111-8111-111111111111", STORE_1)), 102);

    // Second partial: 2 more = £8, cumulative refund £16.
    const second = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 2 }], requestKey: "req-p2" });
    assert.equal(second.status, 201);
    const secondBody = await second.json();
    assert.equal(secondBody.data.refund.amount, 8);
    assert.equal(h.state.inventory.get(h.invKey("p1111111-1111-4111-8111-111111111111", STORE_1)), 104);

    // Return numbers increment per company.
    assert.notEqual(firstBody.data.returnNumber, secondBody.data.returnNumber);

    // Third attempt of 2 exceeds the remaining 1 -> rejected.
    const third = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 2 }], requestKey: "req-p3" });
    assert.equal(third.status, 400);
    assert.match((await third.json()).message, /exceeds .*remaining returnable quantity/i);
  } finally {
    server.close();
  }
});

test("excessive quantity, invalid item, zero quantity and unknown sale are rejected", async () => {
  const h = makeHarness();
  h.seedSale1();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    // Excessive vs sold quantity.
    const excess = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 6 }], requestKey: "x1" });
    assert.equal(excess.status, 400);
    assert.match((await excess.json()).message, /exceed/i);

    // Invalid item id (not part of the sale).
    const wrongItem = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: "i9999999-9999-4999-8999-999999999999", productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "x2" });
    assert.equal(wrongItem.status, 400);

    // Product/line mismatch.
    const mismatch = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p2222222-2222-4222-8222-222222222222", quantity: 1 }], requestKey: "x3" });
    assert.equal(mismatch.status, 400);

    // Zero/negative quantity rejected by the validator.
    const zero = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 0 }], requestKey: "x4" });
    assert.equal(zero.status, 400);

    // Nothing was created.
    assert.equal(h.state.stockReturns.length, 0);
    assert.equal(h.state.refunds.length, 0);
    assert.equal(h.state.inventory.get(h.invKey("p1111111-1111-4111-8111-111111111111", STORE_1)), 100);
  } finally {
    server.close();
  }
});

test("cross-company and cross-store returns are rejected with a generic not-found", async () => {
  const h = makeHarness();
  h.seedSale1();
  const appB = await h.buildApp({ companyId: COMPANY_B, storeId: STORE_1 });
  const { server: sB, port: pB } = await h.listen(appB);
  try {
    const foreign = await postReturn(pB, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "zz1" });
    assert.equal(foreign.status, 404);
    assert.equal(h.state.stockReturns.length, 0);
  } finally {
    sB.close();
  }

  const appOtherStore = await h.buildApp({ companyId: COMPANY_A, storeId: STORE_2 });
  const { server: sS, port: pS } = await h.listen(appOtherStore);
  try {
    const otherStore = await postReturn(pS, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "zz2" });
    assert.equal(otherStore.status, 404);
    assert.equal(h.state.stockReturns.length, 0);
  } finally {
    sS.close();
  }
});

test("duplicate requestKey is idempotent (409) and does not create a second return", async () => {
  const h = makeHarness();
  h.seedSale1();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    const first = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "same-key" });
    assert.equal(first.status, 201);
    const dup = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "same-key" });
    assert.equal(dup.status, 409);
    assert.equal(dup.data, undefined);
    const dupBody = await dup.json();
    assert.equal(dupBody.data.duplicate, true);
    assert.equal(h.state.stockReturns.length, 1, "exactly one return row");
    assert.equal(h.state.refunds.length, 1, "exactly one refund row");
    assert.equal(h.state.inventory.get(h.invKey("p1111111-1111-4111-8111-111111111111", STORE_1)), 101);
  } finally {
    server.close();
  }
});

test("draft/void sale status is not returnable", async () => {
  const h = makeHarness();
  h.seedSale1();
  h.state.sales.get(SALE_1).status = "voided";
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  try {
    const res = await postReturn(port, { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1111111-1111-4111-8111-111111111111", quantity: 1 }], requestKey: "st1" });
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /Only completed sales can be returned/i);
  } finally {
    server.close();
  }
});

test("return history endpoint returns only the caller's company/store, mapped safely", async () => {
  const h = makeHarness();
  h.seedSale1();
  h.state.stockReturns.push({ id: "r1", company_id: COMPANY_A, store_id: STORE_1, return_type: "CUSTOMER", return_number: "RET-0001", sale_id: SALE_1, status: "COMPLETED", refund_amount: 8, refund_method: "card", reason: "Damaged", created_at: new Date("2026-09-17T10:00:00Z") });
  h.state.returnItems.push({ return_id: "r1", product_id: "p1111111-1111-4111-8111-111111111111", sale_item_id: SI_A, quantity: 2 });
  h.state.stockReturns.push({ id: "r2", company_id: COMPANY_B, store_id: STORE_1, return_type: "CUSTOMER", return_number: "RET-0002", sale_id: SALE_1, status: "COMPLETED", created_at: new Date() });
  const app = await h.buildApp({ companyId: COMPANY_A, storeId: STORE_1 });
  const { server, port } = await h.listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/returns`);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1, "only own company rows");
    const row = body.data[0];
    assert.equal(row.returnNumber, "RET-0001");
    assert.equal(row.originalInvoice, "T01-20260917-0001");
    assert.equal(row.customerName, "Kate Brown");
    assert.equal(row.refundAmount, 8);
    assert.equal(row.itemCount, 1);
    assert.equal(row.quantity, 2);
    assert.equal(row.status, "COMPLETED");
  } finally {
    server.close();
  }
});

test("validator guard: validateSalesReturn still enforces core maths (regression)", () => {
  const saleItems = [
    { id: SI_A, product_id: "p1", quantity: 5, unit_price: 4, discount: 0, tax: 0, total: 20, returned_quantity: 0 },
  ];
  const ok = validateSalesReturn({ saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1", quantity: 5 }] }, saleItems);
  assert.equal(ok.valid, true);
  const over = validateSalesReturn({ saleId: SALE_1, items: [{ saleItemId: SI_A, productId: "p1", quantity: 6 }] }, saleItems);
  assert.equal(over.valid, false);
});
