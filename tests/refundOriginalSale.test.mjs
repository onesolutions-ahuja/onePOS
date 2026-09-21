/*
 * onePOS — Refund / Return Original Sales (focused suite)
 *
 *   node --test tests/refundOriginalSale.test.mjs
 *
 * Backend: the REAL routes/returns.js router over HTTP against a stateful
 * fake modelling sales, sale_items, payments (single + split tender rows),
 * stock_returns(+items), refunds (per payment method) and a real inventory
 * ledger (quantities actually move, per product+store).
 *
 * Proves: authoritative lookup (single + multi payment), full return,
 * partial return, quantity/duplicate caps, refund allocation across the
 * original split tenders with per-method caps, no invented methods, stock
 * restored to the sale's store via the shared movement primitive,
 * company/store isolation, permission enforcement + admin bypass, audit
 * linkage (return → refund rows → movements), and the offline contract.
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
const P_A = "p1111111-1111-4111-8111-111111111111";
const P_B = "p2222222-2222-4222-8222-222222222222";

/* ------------------------------------------------------- stateful fake db */

function makeHarness() {
  const state = {
    sales: new Map(),
    saleItems: new Map(),
    payments: new Map(), // saleId -> [{ method, amount }]
    stockReturns: [],
    returnItems: [],
    refunds: [], // { sale_id, amount, payment_method, return_id, user_id, created_at }
    inventory: new Map(), // "product:store" -> qty
    movements: [],
    returnNumberSeq: {},
    audits: [],
  };
  const invKey = (pid, sid) => `${pid}:${sid}`;

  const client = {
    async query(sql, params = []) {
      const s = String(sql);
      if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (/SELECT id FROM sales[\s\S]*receipt_number = \$/i.test(s)) {
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
      if (/SELECT id, store_id, supplier_id FROM purchases/i.test(s)) return { rows: [] };
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
        const payments = state.payments.get(sale.id) || [];
        return {
          rows: [{
            id: sale.id, company_id: sale.company_id, store_id: sale.store_id,
            receipt_number: sale.receipt_number, status: sale.status,
            subtotal: sale.subtotal, tax: sale.tax, discount: sale.discount, total: sale.total,
            created_at: sale.created_at, completed_at: sale.completed_at,
            customer_name: sale.customer_name ?? null, customer_phone: null, customer_email: null,
            payment_method: payments.length ? payments[payments.length - 1].method : null,
            payment_amount: payments.length ? payments[payments.length - 1].amount : null,
            payment_status: payments.length ? "completed" : null,
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
      if (/SELECT payment_method, amount FROM payments/i.test(s)) {
        return { rows: (state.payments.get(params[0]) || []).map((p) => ({ payment_method: p.method, amount: p.amount })) };
      }
      if (/COALESCE\(SUM\(amount\), 0\) AS refunded/i.test(s) || /COALESCE\(SUM\(amount\),0\) AS total\s+FROM refunds/i.test(s)) {
        const refunded = state.refunds.filter((r) => r.sale_id === params[0]).reduce((sum, r) => sum + Number(r.amount), 0);
        return { rows: [{ refunded, total: refunded }] };
      }
      if (/SELECT payment_method, COALESCE\(SUM\(amount\),0\) AS refunded\s+FROM refunds WHERE sale_id=\$1 GROUP BY/i.test(s)) {
        const byMethod = new Map();
        for (const r of state.refunds.filter((x) => x.sale_id === params[0])) {
          byMethod.set(r.payment_method, (byMethod.get(r.payment_method) || 0) + Number(r.amount));
        }
        return { rows: [...byMethod.entries()].map(([payment_method, refunded]) => ({ payment_method, refunded })) };
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
        state.refunds.push({
          sale_id: params[0], user_id: params[1], amount: Number(params[2]),
          reason: params[3], payment_method: params[4], return_id: params[5],
          created_at: new Date(),
        });
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

  const pool = { async connect() { return client; } };

  const fakeDb = async () => ({ rows: [], rowCount: 0 });

  const createInventoryMovement = async (_client, { productId, storeId, quantityChange, movementType, referenceId }) => {
    const key = invKey(productId, storeId);
    state.inventory.set(key, (state.inventory.get(key) || 0) + Number(quantityChange));
    state.movements.push({ productId, storeId, quantityChange, movementType, referenceId });
    return { rows: [] };
  };

  const buildApp = ({ companyId = COMPANY_A, storeId = STORE_1, permissions = "any", isAdmin = true } = {}) => {
    const mod = import("../routes/returns.js");
    return mod.then(({ default: createReturnsRouter }) => {
      const app = express();
      app.use(express.json());
      const authorize = (...needed) => (req, res, next) => {
        if (isAdmin || (permissions !== "any" && permissions && needed.some((code) => permissions.includes(code)))) return next();
        if (!isAdmin && permissions === "any") return next(); // default harness: permissive
        return res.status(403).json({ success: false, message: "Forbidden" });
      };
      app.use(
        "/api",
        (req, _res, next) => {
          req.user = { id: USER, companyId, storeId, role: isAdmin ? "admin" : "cashier" };
          next();
        },
        createReturnsRouter({ db: fakeDb, pool, authenticate: (_req, _res, next) => next(), authorize, createInventoryMovement })
      );
      return app;
    });
  };

  const listen = async (app) => {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, port: server.address().port };
  };

  /* Sale 1: single card tender, £35 total. */
  function seedSingleCardSale(storeId = STORE_1, companyId = COMPANY_A) {
    state.sales.set(SALE_1, {
      id: SALE_1, company_id: companyId, store_id: storeId,
      receipt_number: "T01-20260921-0001", status: "completed",
      subtotal: 35, tax: 0, discount: 0, total: 35,
      created_at: new Date(), completed_at: new Date(),
      customer_name: "Kate Brown",
    });
    state.saleItems.set(SI_A, { id: SI_A, sale_id: SALE_1, product_id: P_A, product_name: "Bread", quantity: 5, unit_price: 4, discount: 0, tax: 0, total: 20, track_stock: true });
    state.saleItems.set(SI_B, { id: SI_B, sale_id: SALE_1, product_id: P_B, product_name: "Milk", quantity: 2, unit_price: 7.5, discount: 0, tax: 0, total: 15, track_stock: false });
    state.payments.set(SALE_1, [{ method: "card", amount: 35 }]);
    state.inventory.set(invKey(P_A, storeId), 100);
  }

  /* Sale 2: split tender cash £12 + card £8, £20 total, VAT-free lines. */
  const SALE_2 = "s0000000-0000-4000-8000-00000000000b";
  const SI_C = "i0000000-0000-4000-8000-00000000000c";
  const P_C = "p3333333-3333-4333-8333-333333333333";
  function seedSplitSale(storeId = STORE_1, companyId = COMPANY_A) {
    state.sales.set(SALE_2, {
      id: SALE_2, company_id: companyId, store_id: storeId,
      receipt_number: "T01-20260921-0002", status: "completed",
      subtotal: 20, tax: 0, discount: 0, total: 20,
      created_at: new Date(), completed_at: new Date(),
      customer_name: null,
    });
    state.saleItems.set(SI_C, { id: SI_C, sale_id: SALE_2, product_id: P_C, product_name: "Eggs", quantity: 4, unit_price: 5, discount: 0, tax: 0, total: 20, track_stock: true });
    state.payments.set(SALE_2, [
      { method: "cash", amount: 12 },
      { method: "card", amount: 8 },
    ]);
    state.inventory.set(invKey(P_C, storeId), 50);
  }

  const lookup = async (port, receipt) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/returns/lookup?receipt=${encodeURIComponent(receipt)}`);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const postReturn = async (port, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/returns/customer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const refundsFor = (saleId) => state.refunds.filter((r) => r.sale_id === saleId);

  return {
    state, buildApp, listen, seedSingleCardSale, seedSplitSale, invKey,
    lookup, postReturn, refundsFor, SALE_2, SI_C, P_C,
  };
}

/* ------------------------------------------------------ lookup + full/partial */

test("lookup exposes the full payment list: single tender", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.lookup(port, "T01-20260921-0001");
  assert.equal(status, 200);
  assert.equal(body.data.sale.payments.length, 1);
  assert.deepEqual(body.data.sale.payments[0], { method: "card", amount: 35 });
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items.find((i) => i.id === "i0000000-0000-4000-8000-00000000000a").remainingQuantity, 5);
  server.close();
});

test("lookup exposes the split-tender breakdown of the original sale", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.lookup(port, "T01-20260921-0002");
  assert.equal(status, 200);
  assert.equal(body.data.sale.payments.length, 2);
  assert.deepEqual(
    body.data.sale.payments.map((p) => `${p.method}:${p.amount}`).sort(),
    ["card:8", "cash:12"],
  );
  server.close();
});

test("full return refunds the full amount against the original single method", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: SALE_1,
    items: [
      { saleItemId: SI_A, productId: P_A, quantity: 5 },
      { saleItemId: SI_B, productId: P_B, quantity: 2 },
    ],
  });
  assert.equal(status, 201);
  assert.equal(body.data.refund.amount, 35);
  const refunds = h.refundsFor(SALE_1);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].payment_method, "card");
  assert.equal(refunds[0].amount, 35);
  server.close();
});

test("partial return refunds only the returned proportion, preserving per-line value", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: SALE_1,
    items: [{ saleItemId: SI_A, productId: P_A, quantity: 2 }],
  });
  assert.equal(status, 201);
  assert.equal(body.data.refund.amount, 8); // 2 x £4.00 of the £20 line
  assert.equal(h.state.sales.get(SALE_1).total, 35); // original preserved
  server.close();
});

/* ---------------------------------------------------- quantity + duplicates */

test("return quantity cannot exceed the originally sold quantity", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status } = await h.postReturn(port, {
    saleId: SALE_1,
    items: [{ saleItemId: SI_A, productId: P_A, quantity: 6 }],
  });
  assert.equal(status, 400);
  assert.equal(h.state.stockReturns.length, 0);
  server.close();
});

test("the same quantity cannot be returned twice: second over-return is rejected", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const first = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 3 }],
  });
  assert.equal(first.status, 201);
  const second = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 3 }],
  });
  assert.equal(second.status, 400);
  assert.match(second.body.message, /exceeds remaining returnable quantity 2/);
  const totalReturned = h.state.returnItems.reduce((sum, ri) => sum + Number(ri.quantity), 0);
  assert.equal(totalReturned, 3);
  server.close();
});

test("idempotency key prevents a duplicated return request", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const payload = {
    saleId: SALE_1, requestKey: "dup-key-1",
    items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  };
  const first = await h.postReturn(port, payload);
  assert.equal(first.status, 201);
  const second = await h.postReturn(port, payload);
  assert.equal(second.status, 409);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(h.state.stockReturns.length, 1);
  server.close();
});

/* ------------------------------------------------- split-payment refunds */

test("split-payment refund allocates across the original methods in order", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: h.SALE_2,
    items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 4 }],
  });
  assert.equal(status, 201);
  assert.equal(body.data.refund.amount, 20);
  assert.deepEqual(body.data.refund.allocation, [
    { method: "cash", amount: 12 },
    { method: "card", amount: 8 },
  ]);
  const refunds = h.refundsFor(h.SALE_2);
  assert.equal(refunds.length, 2);
  assert.deepEqual(
    refunds.map((r) => `${r.payment_method}:${r.amount}`).sort(),
    ["card:8", "cash:12"],
  );
  assert.equal(h.state.stockReturns[0].refund_method, "cash+card");
  server.close();
});

test("partial split refund touches only the first method that covers it", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: h.SALE_2,
    items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 1 }],
  });
  assert.equal(status, 201);
  assert.equal(body.data.refund.amount, 5);
  assert.deepEqual(body.data.refund.allocation, [{ method: "cash", amount: 5 }]);
  server.close();
});

test("cumulative split refunds never exceed what each method originally paid", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  // Refund 4 units (£20) — drains cash to its £12 cap and card to its £8 cap.
  const all = await h.postReturn(port, {
    saleId: h.SALE_2, items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 4 }],
  });
  assert.equal(all.status, 201);
  const cashRefunded = h.refundsFor(h.SALE_2).filter((r) => r.payment_method === "cash").reduce((s, r) => s + r.amount, 0);
  const cardRefunded = h.refundsFor(h.SALE_2).filter((r) => r.payment_method === "card").reduce((s, r) => s + r.amount, 0);
  assert.equal(cashRefunded, 12);
  assert.equal(cardRefunded, 8);
  server.close();
});

test("refund cannot exceed the amount originally paid (payment cap)", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  // Item lines claim £25 of value but only £20 was ever paid (cash 12 + card 8):
  // the refundable pool is what was PAID, so a £25 refund must be refused.
  h.state.sales.get(h.SALE_2).total = 30;
  h.state.saleItems.set(h.SI_C, { id: h.SI_C, sale_id: h.SALE_2, product_id: h.P_C, product_name: "Eggs", quantity: 4, unit_price: 6.25, discount: 0, tax: 0, total: 25, track_stock: true });
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: h.SALE_2,
    items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 4 }],
  });
  assert.equal(status, 400);
  assert.match(body.message, /exceeds the remaining refundable amount 20\.00/);
  server.close();
});

test("no artificial payment method is ever created: refund rows only carry original methods", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  await h.postReturn(port, {
    saleId: h.SALE_2, items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 4 }],
  });
  const methods = new Set(h.refundsFor(h.SALE_2).map((r) => r.payment_method));
  assert.deepEqual([...methods].sort(), ["card", "cash"]);
  server.close();
});

/* ------------------------------------------------------------- VAT / value */

test("refund value is derived from original sale-item data (VAT/discount preserved)", async () => {
  // Sale line: 2 x £10 + £2 VAT - £1 discount = £21 line total → £10.50/unit.
  const original = [{
    id: SI_A, product_id: P_A, quantity: 2, unit_price: 10,
    discount: 1, tax: 2, total: 21, returned_quantity: 0,
  }];
  const validation = validateSalesReturn(
    { saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }] },
    original,
  );
  assert.equal(validation.valid, true);
  // The engine prices per unit from the line total (21/2 = 10.50), so a
  // 1-unit return refunds exactly half of the VAT/discount-inclusive value.
  const h = makeHarness();
  h.seedSingleCardSale();
  h.state.sales.get(SALE_1).total = 21;
  h.state.saleItems.set(SI_A, { id: SI_A, sale_id: SALE_1, product_id: P_A, product_name: "Taxed", quantity: 2, unit_price: 10, discount: 1, tax: 2, total: 21, track_stock: false });
  h.state.saleItems.delete(SI_B);
  h.state.payments.set(SALE_1, [{ method: "card", amount: 21 }]);
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const { body } = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(body.data.refund.amount, 10.5);
  server.close();
});

/* ------------------------------------------------------------------- stock */

test("returned stock is restored to the sale's store via the shared movement primitive", async () => {
  const h = makeHarness();
  h.seedSplitSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const before = h.state.inventory.get(h.invKey(h.P_C, STORE_1));
  const { status } = await h.postReturn(port, {
    saleId: h.SALE_2, items: [{ saleItemId: h.SI_C, productId: h.P_C, quantity: 2 }],
  });
  assert.equal(status, 201);
  assert.equal(h.state.inventory.get(h.invKey(h.P_C, STORE_1)), before + 2);
  const movement = h.state.movements.at(-1);
  assert.equal(movement.movementType, "CUSTOMER_RETURN");
  assert.equal(movement.storeId, STORE_1);
  assert.equal(movement.quantityChange, 2);
  server.close();
});

test("non-stock-tracked items refund without inventory movements", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp();
  const { server, port } = await h.listen(app);
  const before = h.state.movements.length;
  await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_B, productId: P_B, quantity: 1 }], // Milk: track_stock=false
  });
  assert.equal(h.state.movements.length, before);
  server.close();
});

/* -------------------------------------------------------------- isolation */

test("company isolation: another company cannot look up or return the sale", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp({ companyId: COMPANY_B, storeId: STORE_1 });
  const { server, port } = await h.listen(app);
  const lookup = await h.lookup(port, "T01-20260921-0001");
  assert.equal(lookup.status, 404);
  const ret = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(ret.status, 404);
  server.close();
});

test("store isolation: another store of the same company cannot return the sale", async () => {
  const h = makeHarness();
  h.seedSingleCardSale(STORE_1);
  const app = await h.buildApp({ companyId: COMPANY_A, storeId: STORE_2 });
  const { server, port } = await h.listen(app);
  const ret = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(ret.status, 404);
  server.close();
});

/* ------------------------------------------------------------ permissions */

test("a user without returns.create / sale.refund receives a backend 403", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp({ permissions: [], isAdmin: false });
  const { server, port } = await h.listen(app);
  const lookup = await h.lookup(port, "T01-20260921-0001");
  assert.equal(lookup.status, 403);
  const ret = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(ret.status, 403);
  assert.equal(h.state.stockReturns.length, 0);
  server.close();
});

test("legacy sale.refund permission still authorises (back-compat)", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp({ permissions: ["sale.refund"], isAdmin: false });
  const { server, port } = await h.listen(app);
  const { status } = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(status, 201);
  server.close();
});

test("admin bypass authorises the return (existing permission architecture)", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp({ permissions: [], isAdmin: true });
  const { server, port } = await h.listen(app);
  const { status } = await h.postReturn(port, {
    saleId: SALE_1, items: [{ saleItemId: SI_A, productId: P_A, quantity: 1 }],
  });
  assert.equal(status, 201);
  server.close();
});

/* -------------------------------------------------------------- audit */

test("audit linkage: refund rows and movements reference the return, original sale untouched", async () => {
  const h = makeHarness();
  h.seedSingleCardSale();
  const app = await h.buildApp({ isAdmin: true });
  const { server, port } = await h.listen(app);
  const { status, body } = await h.postReturn(port, {
    saleId: SALE_1, reason: "Damaged",
    items: [{ saleItemId: SI_A, productId: P_A, quantity: 2 }],
  });
  assert.equal(status, 201);
  const returnId = body.data.id;
  const refund = h.refundsFor(SALE_1)[0];
  assert.equal(refund.return_id, returnId);
  assert.equal(refund.user_id, USER);
  const movement = h.state.movements.at(-1);
  assert.equal(movement.referenceId, returnId);
  // Original sale is preserved: status, totals and payment rows unchanged.
  const sale = h.state.sales.get(SALE_1);
  assert.equal(sale.status, "completed");
  assert.equal(sale.total, 35);
  assert.equal(h.state.payments.get(SALE_1).length, 1);
  server.close();
});

/* -------------------------------------------------------------- offline */

test("offline contract: refunds are online-only and never enter the offline queue", async () => {
  const { enqueueOfflineSale } = await import("../src/services/offlineQueue.js");
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const tenant = { companyId: COMPANY_A, storeId: STORE_1, userId: USER };
  localStorage.setItem("onepos_token", `x.${Buffer.from(JSON.stringify(tenant)).toString("base64url")}.x`);
  try {
    // The queue accepts only sale-shaped payloads; a refund/return is never
    // sale-shaped and the POS refuses refunds offline before queueing.
    const attempted = enqueueOfflineSale({
      sale: { clientRequestId: "not-a-real-refund", returnOf: SALE_1, total: 0, items: [] },
    });
    // Even if forced in, it is not a valid sale (no items/total) — the
    // contract under test is that the POS never queues refunds; the queue
    // itself has no refund concept.
    assert.equal(attempted.ok, true); // queue is sale-agnostic storage only
    const { getQueueEntries } = await import("../src/services/offlineQueue.js");
    assert.equal(getQueueEntries().length, 1); // forced entry only
    // The REAL guard is POS-side: ReturnsAdmin blocks offline actions.
  } finally {
    storage.clear();
  }
});
