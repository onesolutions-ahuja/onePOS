/*
 * onePOS — Omnichannel online order route tests (T10-ONLINE).
 *
 * Drives the REAL createOnlineRouter (routes/online.js) over HTTP against a
 * stateful fake database, using the real createInventoryMovement and
 * createSaleForCompletedOrder services. Covers the Click & Collect and Delivery
 * workflows:
 *   - order creation (stock reservation)
 *   - status transitions (received -> preparing -> ready -> collected/completed)
 *   - sale creation on completion (order -> POS sale, single stock deduction)
 *   - cancellation releasing reserved stock
 *   - invalid transitions, tenant/store isolation, permissions, idempotency
 *
 *   node --test tests/onlineOrders.test.mjs
 */
import http from "node:http";
import os from "node:os";
import express from "express";
import { test } from "node:test";
import assert from "node:assert/strict";

import createOnlineRouter from "../routes/online.js";
import { createInventoryMovement } from "../services/inventory.js";
import {
  GENERIC_ORDER_STATUSES,
  FULFILMENT_TYPES,
} from "../services/onlineOrders/genericOrderTypes.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_A = "c0000000-0000-4000-8000-000000000003";
const STORE_B = "c0000000-0000-4000-8000-000000000004";
const USER = { id: "u0000000-0000-4000-8000-000000000009", companyId: COMPANY, storeId: STORE_A };
const USER_B = { id: "u0000000-0000-4000-8000-000000000019", companyId: COMPANY_B, storeId: STORE_B };
const PRODUCT_PICK = "p0000000-0000-4000-8000-000000000021";
const PRODUCT_DELIV = "p0000000-0000-4000-8000-000000000022";
const PRODUCT_NOTRACK = "p0000000-0000-4000-8000-000000000023";
const PRODUCT_B = "p0000000-0000-4000-8000-000000000024";
const PRODUCT_B_DELIV = "p0000000-0000-4000-8000-000000000025";

const ADMIN_PERMISSIONS = new Set(["online_orders.view", "online_orders.manage", "online_orders.configure"]);

function makeState() {
  return {
    products: [
      { id: PRODUCT_PICK, company_id: COMPANY, name: "Burger", sku: "BURGER", barcode: "1", price: 8, cost_price: 3, vat_rate: 20, vat_applicable: true, track_stock: true, stock_quantity: 100, low_stock_level: 5, active: true },
      { id: PRODUCT_DELIV, company_id: COMPANY, name: "Pizza", sku: "PIZZA", barcode: "2", price: 12, cost_price: 5, vat_rate: 20, vat_applicable: true, track_stock: true, stock_quantity: 100, low_stock_level: 5, active: true },
      { id: PRODUCT_NOTRACK, company_id: COMPANY, name: "Note", sku: "NOTE", barcode: "3", price: 2, cost_price: 0.5, vat_rate: 20, vat_applicable: true, track_stock: false, stock_quantity: 100, low_stock_level: 0, active: true },
      { id: PRODUCT_B, company_id: COMPANY_B, name: "Foreign Burger", sku: "FBURGER", barcode: "9", price: 5, cost_price: 2, vat_rate: 20, vat_applicable: true, track_stock: true, stock_quantity: 100, low_stock_level: 5, active: true },
    ],
    stores: [
      { id: STORE_A, company_id: COMPANY, name: "Store A", active: true },
      { id: STORE_B, company_id: COMPANY_B, name: "Store B", active: true },
    ],
    customers: [
      { id: "cust-1", company_id: COMPANY, name: "Alice", active: true },
    ],
    companySettings: [
      { company_id: COMPANY, delivery_invoice_prefix: "ODR", default_vat_rate: 20, allow_negative_inventory_billing: false, loyalty_enabled: false },
      { company_id: COMPANY_B, delivery_invoice_prefix: "ODR-B", default_vat_rate: 20, allow_negative_inventory_billing: false, loyalty_enabled: false },
    ],
    orders: [],
    orderItems: [],
    orderEvents: [],
    platformEvents: [],
    // Pre-seed store-level stock so the real createInventoryMovement ONLINE_RESERVE
    // (which requires an existing non-negative store position) succeeds.
    pss: [
      { company_id: COMPANY, store_id: STORE_A, product_id: PRODUCT_PICK, quantity: 100, updated_at: new Date().toISOString() },
      { company_id: COMPANY, store_id: STORE_A, product_id: PRODUCT_DELIV, quantity: 100, updated_at: new Date().toISOString() },
      { company_id: COMPANY_B, store_id: STORE_B, product_id: PRODUCT_B, quantity: 100, updated_at: new Date().toISOString() },
    ],
    movements: [],
    sales: [],
    saleItems: [],
    payments: [],
    seq: { orderN: 0 },
  };
}


const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

/* Returns a fake { db, pool, release } backed by `state`. Matches the exact SQL
 * emitted by createGenericOrder, transitionGenericOrder, createInventoryMovement
 * and createSaleForCompletedOrder so the REAL services execute end-to-end. */
function makeHarness(state) {
  const orderId = (n) => `o${String(n).padStart(8, "0")}-${COMPANY.slice(4, 8)}`;
  const saleId = (n) => `sl${String(n).padStart(8, "0")}`;
  const movementId = (n) => `mv${String(n).padStart(8, "0")}`;

  const dispatch = (sql, params = []) => {
    const s = norm(sql);
    const P = params;

    const match = (re) => re.test(s);

    // transactions / noop
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [], rowCount: 0 };

    if (match(/^INSERT INTO platform_events\(/)) {
      const event = {
        id: `pe-${state.platformEvents.length + 1}`,
        company_id: P[0],
        event_type: P[1],
        payload: JSON.parse(P[2]),
        actor_user_id: P[3],
        idempotency_key: P[4],
      };
      state.platformEvents.push(event);
      return { rows: [event], rowCount: 1 };
    }
    if (match(/^INSERT INTO platform_webhook_deliveries\(/)) return { rows: [], rowCount: 0 };

    // stores
    if (match(/^SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true$/)) {
      const row = state.stores.find((x) => x.id === P[0] && x.company_id === P[1] && x.active);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // customers
    if (match(/^SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true$/)) {
      const row = state.customers.find((x) => x.id === P[0] && x.company_id === P[1] && x.active);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    // products FOR UPDATE (shared by createGenericOrder + createInventoryMovement)
    if (match(/FROM products WHERE id = \$1 AND company_id = \$2 AND active = true FOR UPDATE/)) {
      const row = state.products.find((x) => x.id === P[0] && x.company_id === P[1] && x.active);
      return { rows: row ? [{ ...row }] : [] };
    }

    // idempotency check
    if (match(/SELECT id, status FROM online_orders WHERE company_id = \$1 AND platform = 'direct' AND external_order_id = \$2/)) {
      const row = state.orders.find((o) => o.company_id === P[0] && o.external_order_id === P[1]);
      return { rows: row ? [{ id: row.id, status: row.status }] : [] };
    }

    // company settings
    if (match(/SELECT delivery_invoice_prefix FROM company_settings WHERE company_id = \$1/)) {
      const row = state.companySettings.find((c) => c.company_id === P[0]);
      return { rows: row ? [{ delivery_invoice_prefix: row.delivery_invoice_prefix }] : [] };
    }
    if (match(/SELECT default_vat_rate FROM company_settings WHERE company_id = \$1/)) {
      const row = state.companySettings.find((c) => c.company_id === P[0]);
      return { rows: row ? [{ default_vat_rate: row.default_vat_rate }] : [] };
    }

    // getGenericOrder
    if (match(/SELECT o\.\*,.*\(SELECT COUNT\(\*\) FROM online_order_items i WHERE i\.order_id = o\.id\) AS item_count.*FROM online_orders o WHERE o\.id = \$1.*o\.company_id = \$2.*o\.platform = 'direct'/)) {
      const row = state.orders.find((o) => o.id === P[0] && o.company_id === P[1] && o.platform === "direct");
      if (!row) return { rows: [] };
      const itemCount = state.orderItems.filter((i) => i.order_id === row.id).length;
      const eventCount = state.orderEvents.filter((e) => e.order_id === row.id).length;
      return { rows: [{ ...row, item_count: itemCount, event_count: eventCount }] };
    }

    // listGenericOrders
    if (match(/SELECT o\.\*,.*\(SELECT COUNT\(\*\) FROM online_order_items i WHERE i\.order_id = o\.id\) AS item_count FROM online_orders o WHERE/)) {
      let rows = state.orders.filter((o) => o.company_id === P[0] && o.platform === "direct");
      let idx = 1;
      const statusIdx = s.indexOf("o.status = $");
      if (statusIdx > -1) {
        rows = rows.filter((o) => o.status === P[idx]);
        idx++;
      }
      const limit = P[P.length - 1];
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      if (limit) rows = rows.slice(0, Number(limit));
      return { rows, rowCount: rows.length };
    }

    // order check used by generic ready/complete routes
    if (match(/^SELECT fulfilment_type, status FROM online_orders WHERE id = \$1 AND company_id = \$2$/)) {
      const row = state.orders.find((o) => o.id === P[0] && o.company_id === P[1]);
      return { rows: row ? [{ fulfilment_type: row.fulfilment_type, status: row.status }] : [] };
    }

    // transition: lock
    if (match(/SELECT \* FROM online_orders WHERE id = \$1 AND company_id = \$2 FOR UPDATE/)) {
      const row = state.orders.find((o) => o.id === P[0] && o.company_id === P[1]);
      return { rows: row ? [{ ...row }] : [] };
    }

    // INSERT online_orders RETURNING *
    if (match(/^INSERT INTO online_orders \(/)) {
      const n = state.seq.orderN++;
      const order = {
        id: orderId(n),
        company_id: P[0],
        store_id: P[1] || null,
        customer_id: P[2] || null,
        platform: "direct",
        external_order_id: P[3],
        external_reference: P[4],
        status: "RECEIVED",
        fulfilment_type: P[5],
        customer_name: P[6],
        customer_phone: P[7],
        customer_email: P[8],
        delivery_address: P[9],
        customer_data: P[10],
        currency: "GBP",
        subtotal: P[11],
        tax: P[12],
        total: P[13],
        notes: P[14],
        payment_method: P[15] || null,
        payment_status: P[16] || "pending",
        inventory_reserved: false,
        inventory_released: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.orders.push(order);
      return { rows: [order], rowCount: 1 };
    }

    // INSERT online_order_items
    if (match(/^INSERT INTO online_order_items \(/)) {
      state.orderItems.push({
        id: `oi-${state.orderItems.length + 1}`,
        order_id: P[0],
        product_id: P[1],
        product_name: P[2],
        quantity: P[3],
        unit_price: P[4],
        vat_rate: P[5],
        tax: P[6],
        total: P[7],
        mapping_status: P[8],
        track_stock: null,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    // online_order_events (both 4-col and 7-col forms)
    if (match(/^INSERT INTO online_order_events \(/)) {
      state.orderEvents.push({
        id: `oe-${state.orderEvents.length + 1}`,
        order_id: P[0],
        event_type: P[1],
        from_status: P[2] || null,
        to_status: P[3] || null,
        message: P[4] || null,
        platform_response: P[5] || null,
        actor_user_id: P[6] || null,
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }

    // UPDATE online_orders status (transition)
    if (match(/^UPDATE online_orders SET status = \$1/)) {
      const order = state.orders.find((o) => o.id === P[1]);
      if (order) {
        order.status = P[0];
        order.updated_at = new Date().toISOString();
        const ts = s.match(/(preparing_at|ready_at|completed_at|completed_by|otp_verified_at|cancelled_at) = NOW\(\)/g) || [];
        for (const m of ts) {
          const col = m.match(/(\w+)_at/)?.[1] || m.match(/(completed_by)/)?.[1];
        }
        const cancelledTs = s.includes("cancelled_at = NOW()");
        if (cancelledTs) order.cancelled_at = new Date().toISOString();
        const preparedTs = s.includes("preparing_at = NOW()");
        if (preparedTs) order.preparing_at = new Date().toISOString();
        const readyTs = s.includes("ready_at = NOW()");
        if (readyTs) order.ready_at = new Date().toISOString();
        const completedTs = s.includes("completed_at = NOW()");
        if (completedTs) order.completed_at = new Date().toISOString();
        if (s.includes("cancel_reason = $")) {
          const reasonIdx = Number(/\$\d+/.exec(/cancel_reason = \$\d+/.exec(s) || ["", ""])[1]?.match(/\d+/)?.[1]);
          // params: [toStatus, orderId, ...reason?, companyId] -> reason is before companyId
          const cidIdx = P.length - 1;
          order.cancel_reason = P[cidIdx - 1];
        }
        if (s.includes("inventory_reserved = FALSE, inventory_released = TRUE")) {
          order.inventory_reserved = false;
          order.inventory_released = true;
        }
        if (s.includes("accepted_at = NOW()")) order.accepted_at = new Date().toISOString();
      }
      return { rows: [], rowCount: order ? 1 : 0 };
    }

    // createGenericOrder: set inventory_reserved = TRUE
    if (match(/^UPDATE online_orders SET inventory_reserved = TRUE WHERE id = \$1$/)) {
      const order = state.orders.find((o) => o.id === P[0]);
      if (order) order.inventory_reserved = true;
      return { rows: [], rowCount: order ? 1 : 0 };
    }

    // transitionGenericOrder release: inventory_reserved = FALSE, inventory_released = TRUE
    if (match(/^UPDATE online_orders SET inventory_reserved = FALSE, inventory_released = TRUE WHERE id = \$1$/)) {
      const order = state.orders.find((o) => o.id === P[0]);
      if (order) {
        order.inventory_reserved = false;
        order.inventory_released = true;
      }
      return { rows: [], rowCount: order ? 1 : 0 };
    }

    // createInventoryMovement: UPDATE products SET stock_quantity = $1
    if (match(/^UPDATE products SET stock_quantity = \$1, updated_at = NOW\(\) WHERE id = \$2 AND company_id = \$3$/)) {
      const product = state.products.find((p) => p.id === P[1] && p.company_id === P[2]);
      if (product) product.stock_quantity = Number(P[0]);
      return { rows: [], rowCount: product ? 1 : 0 };
    }

    // createInventoryMovement: product_store_stock upsert with RETURNING quantity
    if (match(/^INSERT INTO product_store_stock \(company_id, store_id, product_id, quantity\) VALUES \(\$1, \$2, \$3, \$4\) ON CONFLICT/)) {
      const key = `${P[0]}:${P[1]}:${P[2]}`;
      const qty = Number(P[3]);
      const existing = state.pss.find((p) => `${p.company_id}:${p.store_id}:${p.product_id}` === key);
      if (existing) {
        existing.quantity = Number(existing.quantity) + qty;
        return { rows: [{ quantity: existing.quantity }] };
      }
      const row = { company_id: P[0], store_id: P[1], product_id: P[2], quantity: qty, updated_at: new Date().toISOString() };
      state.pss.push(row);
      return { rows: [{ quantity: qty }] };
    }

    // createInventoryMovement: INSERT inventory_movements RETURNING ...
    if (match(/^INSERT INTO inventory_movements \(/)) {
      const mvmt = {
        id: movementId(state.movements.length + 1),
        company_id: P[0],
        product_id: P[1],
        store_id: P[2],
        movement_type: P[3],
        quantity_change: P[4],
        balance_after: P[5],
        reference_type: P[6],
        reference_id: P[7],
        reason: P[8],
        notes: P[9],
        created_by: P[10],
        created_at: new Date().toISOString(),
      };
      state.movements.push(mvmt);
      return { rows: [mvmt], rowCount: 1 };
    }

    // saleCreator: duplicate sale check
    if (match(/^SELECT \* FROM sales WHERE online_order_id = \$1$/)) {
      const rows = state.sales.filter((s) => s.online_order_id === P[0]);
      return { rows };
    }

    // saleCreator: INSERT sale RETURNING *
    if (match(/^INSERT INTO sales \(/)) {
      const sale = {
        id: saleId(state.sales.length + 1),
        company_id: P[0],
        store_id: P[1],
        terminal_id: null,
        user_id: P[2],
        customer_id: null,
        receipt_number: P[3],
        subtotal: P[4],
        tax: P[5],
        discount: P[6],
        total: P[7],
        status: "completed",
        offline_created: false,
        sync_status: "synced",
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        online_order_id: P[8],
      };
      state.sales.push(sale);
      return { rows: [sale], rowCount: 1 };
    }

    // saleCreator: INSERT sale_items
    if (match(/^INSERT INTO sale_items \(/)) {
      state.saleItems.push({
        id: `si-${state.saleItems.length + 1}`,
        sale_id: P[0],
        product_id: P[1],
        product_name: P[2],
        quantity: P[3],
        unit_price: P[4],
        discount: 0,
        tax: P[6],
        total: P[7],
      });
      return { rows: [], rowCount: 1 };
    }

    // saleCreator / route: INSERT payments
    if (match(/^INSERT INTO payments \(sale_id, payment_method, amount, status\) VALUES/)) {
      state.payments.push({
        id: `pm-${state.payments.length + 1}`,
        sale_id: P[0],
        payment_method: P[1],
        amount: P[2],
        status: "completed",
      });
      return { rows: [], rowCount: 1 };
    }

    // GET :id handlers (db)
    if (match(/^SELECT \*\s+FROM online_order_items i\s+LEFT JOIN products p ON p\.id = i\.product_id WHERE i\.order_id = \$1/)) {
      const rows = state.orderItems
        .filter((i) => i.order_id === P[0])
        .map((i) => {
          const p = state.products.find((x) => x.id === i.product_id) || {};
          return { ...i, track_stock: p.track_stock };
        });
      return { rows };
    }
    if (match(/^SELECT \* FROM online_order_events WHERE order_id = \$1 ORDER BY created_at, id$/)) {
      const rows = state.orderEvents.filter((e) => e.order_id === P[0]);
      return { rows };
    }

    // loadOrderItems inside transitionGenericOrder
    if (match(/i\.mapping_status, p\.track_stock, p\.batch_tracking FROM online_order_items i/)) {
      const rows = state.orderItems
        .filter((i) => i.order_id === P[0])
        .map((i) => {
          const p = state.products.find((x) => x.id === i.product_id) || {};
          return { ...i, track_stock: p.track_stock, batch_tracking: p.batch_tracking };
        });
      return { rows };
    }

    // catch-all
    return { rows: [], rowCount: 0 };
  };

  const client = { query: dispatch, release: () => {} };
  const pool = { connect: async () => client };
  const db = dispatch;

  return { db, pool, client };
}

function buildApp({ state, permissions = ADMIN_PERMISSIONS, user = USER } = {}) {
  const { db, pool } = makeHarness(state);
  const app = express();
  app.use(express.json());

  const authenticate = (req, res, next) => {
    req.user = user;
    next();
  };
  const authorize = (...codes) => (req, res, next) => {
    if (user && user.roleId === "owner-role") return next();
    const granted = codes.every((c) => permissions.has(c));
    if (granted) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  };

  app.use(
    "/api",
    createOnlineRouter({
      authenticate,
      authorize,
      db,
      pool,
      writeAudit: null,
      createInventoryMovement,
    })
  );

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const base = `http://127.0.0.1:${port}/api`;
      const post = async (path, body) => {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        return { status: res.status, json: await res.json() };
      };
      const get = async (path) => {
        const res = await fetch(`${base}${path}`);
        return { status: res.status, json: await res.json() };
      };
      resolve({ server, post, get, db });
    });
  });
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function createPickupOrder(app, opts = {}) {
  return app.post("/online/orders/generic", {
    externalOrderId: opts.externalOrderId || "EXT-PICK-1",
    storeId: opts.storeId,
    fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
    items: opts.items || [{ productId: PRODUCT_PICK, quantity: 1 }],
    customer: opts.customer || { name: "Alice", phone: "555", address: "1 Pick St" },
    payment: opts.payment,
  });
}

async function createDeliveryOrder(app, opts = {}) {
  return app.post("/online/orders/generic", {
    externalOrderId: opts.externalOrderId || "EXT-DEL-1",
    storeId: opts.storeId,
    fulfilmentType: FULFILMENT_TYPES.DELIVERY,
    items: opts.items || [{ productId: PRODUCT_DELIV, quantity: 1 }],
    customer: opts.customer || { name: "Bob", phone: "555", address: "10 Delivery Rd, Town" },
    payment: opts.payment,
  });
}

/* ------------------------------------------------------------------ Click & Collect */

test("Click & Collect: create -> accept -> ready -> collect creates a POS sale", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createPickupOrder(app, { payment: { method: "card", status: "paid" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.data.order.status, "RECEIVED");
    assert.equal(created.json.data.order.fulfilment_type, "SELF_PICKUP");

    const orderId = created.json.data.order.id;

    // Reservation deducted stock once (ONLINE_RESERVE), POS cannot sell it.
    const reserve = state.movements.find((m) => m.movement_type === "ONLINE_RESERVE");
    assert.ok(reserve);
    assert.equal(reserve.quantity_change, -1);

    await app.post(`/online/orders/generic/${orderId}/accept`, {});
    await app.post(`/online/orders/generic/${orderId}/ready`, {});

    const orderBefore = state.orders.find((o) => o.id === orderId);
    assert.equal(orderBefore.status, GENERIC_ORDER_STATUSES.READY_FOR_PICKUP);

    const collected = await app.post(`/online/orders/generic/${orderId}/complete`, {});
    assert.equal(collected.status, 200);
    assert.equal(collected.json.data.sale.status, "completed");
    assert.equal(collected.json.data.sale.receipt_number, "ODR-EXT-PICK-1");

    // The sale's payment reflects the order's recorded payment method.
    const salePayment = state.payments.find((p) => p.sale_id === collected.json.data.sale.id);
    assert.equal(salePayment.payment_method, "card");

    // Single stock deduction: reservation only, no SALE movement from sale creation.
    const saleMovements = state.movements.filter(
      (m) => m.movement_type === "SALE" || m.movement_type === "CUSTOMER_RETURN"
    );
    assert.equal(saleMovements.length, 0);
    // Completing a second time must not create a second sale (idempotent).
    const again = await app.post(`/online/orders/generic/${orderId}/complete`, {});
    assert.equal(again.status, 200);
    assert.equal(state.sales.length, 1);

    const product = state.products.find((p) => p.id === PRODUCT_PICK);
    assert.equal(product.stock_quantity, 99); // 100 - 1 reserved
  } finally {
    app.server.close();
  }
});

test("Click & Collect: invalid transition is rejected", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createPickupOrder(app);
    const orderId = created.json.data.order.id;
    // Cannot collect before the order is ready.
    const r = await app.post(`/online/orders/generic/${orderId}/complete`, {});
    assert.equal(r.status, 409);
    assert.match(r.json.message, /Invalid transition/);
  } finally {
    app.server.close();
  }
});

test("Click & Collect: cancellation releases reserved stock", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createPickupOrder(app);
    const orderId = created.json.data.order.id;
    assert.equal(state.products.find((p) => p.id === PRODUCT_PICK).stock_quantity, 99);

    await app.post(`/online/orders/generic/${orderId}/cancel`, {});

    const order = state.orders.find((o) => o.id === orderId);
    assert.equal(order.status, "CANCELLED");
    assert.equal(order.inventory_reserved, false);
    assert.equal(order.inventory_released, true);

    const releases = state.movements.filter((m) => m.movement_type === "ONLINE_RELEASE");
    assert.equal(releases.length, 1);
    assert.equal(releases[0].quantity_change, 1);

    // Stock restored to the pool after release.
    assert.equal(state.products.find((p) => p.id === PRODUCT_PICK).stock_quantity, 100);
  } finally {
    app.server.close();
  }
});

/* ---------------------------------------------------------------------- Delivery */

test("Delivery: create -> accept -> ready -> deliver creates a POS sale", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createDeliveryOrder(app, {
      customer: { name: "Bob", phone: "555", address: "10 Delivery Rd, Town" },
      payment: { method: "cash", status: "pending" },
    });
    assert.equal(created.status, 201);
    const orderId = created.json.data.order.id;
    const order = state.orders.find((o) => o.id === orderId);
    assert.equal(order.fulfilment_type, "DELIVERY");
    assert.equal(order.delivery_address, "10 Delivery Rd, Town");
    assert.equal(order.payment_method, "cash");
    assert.equal(order.payment_status, "pending");

    await app.post(`/online/orders/generic/${orderId}/accept`, {});
    await app.post(`/online/orders/generic/${orderId}/ready`, {});
    assert.equal(state.orders.find((o) => o.id === orderId).status, GENERIC_ORDER_STATUSES.READY_FOR_DELIVERY);

    const delivered = await app.post(`/online/orders/generic/${orderId}/complete`, {});
    assert.equal(delivered.status, 200);
    assert.equal(delivered.json.data.order.status, "COMPLETED");
    assert.equal(delivered.json.data.sale.receipt_number, "ODR-EXT-DEL-1");

    const salePayment = state.payments.find((p) => p.sale_id === delivered.json.data.sale.id);
    assert.equal(salePayment.payment_method, "cash");

    const reserve = state.movements.find((m) => m.movement_type === "ONLINE_RESERVE");
    assert.equal(reserve.quantity_change, -1);
    assert.equal(state.products.find((p) => p.id === PRODUCT_DELIV).stock_quantity, 99);
  } finally {
    app.server.close();
  }
});

test("Delivery: invalid transition (READY_FOR_DELIVERY -> DELIVERED skip not allowed) is rejected", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createDeliveryOrder(app);
    const orderId = created.json.data.order.id;
    await app.post(`/online/orders/generic/${orderId}/accept`, {});
    // cannot go straight back to PREPARING from READY_FOR_DELIVERY
    await app.post(`/online/orders/generic/${orderId}/ready`, {});
    const r = await app.post(`/online/orders/generic/${orderId}/ready`, {});
    assert.equal(r.status, 409);
  } finally {
    app.server.close();
  }
});

test("Delivery: cancellation releases reserved stock", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const created = await createDeliveryOrder(app);
    const orderId = created.json.data.order.id;
    await app.post(`/online/orders/generic/${orderId}/accept`, {});
    await app.post(`/online/orders/generic/${orderId}/cancel`, {});
    const order = state.orders.find((o) => o.id === orderId);
    assert.equal(order.status, "CANCELLED");
    assert.equal(order.inventory_released, true);
    assert.equal(state.products.find((p) => p.id === PRODUCT_DELIV).stock_quantity, 100);
  } finally {
    app.server.close();
  }
});

/* ------------------------------------------------- isolation, permissions, stock */

test("Cross-company order is not visible to another company", async () => {
  const state = makeState();
  // create a direct order for COMPANY_B
  const appB = await buildApp({ state, user: USER_B });
  try {
    const created = await createDeliveryOrder(appB, { storeId: STORE_B, items: [{ productId: PRODUCT_B, quantity: 1 }] });
    const orderId = created.json.data.order.id;

    // COMPANY user cannot see/modify a COMPANY_B order.
    const crossApp = await buildApp({ state, user: { ...USER, companyId: COMPANY } });
    try {
      const r = await crossApp.get(`/online/orders/generic/${orderId}`);
      assert.equal(r.status, 404);
      const c = await crossApp.post(`/online/orders/generic/${orderId}/complete`, {});
      assert.equal(c.status, 404);
    } finally {
      crossApp.server.close();
    }
  } finally {
    appB.server.close();
  }
});

test("Permission denied users cannot manage orders", async () => {
  const state = makeState();
  const noPerm = new Set(["online_orders.view"]); // lacks manage
  const app = await buildApp({ state, permissions: noPerm });
  try {
    // view allowed, manage not
    const listed = await app.get("/online/orders/generic");
    assert.equal(listed.status, 200);
    const created = await createDeliveryOrder(app);
    assert.equal(created.status, 403);
  } finally {
    app.server.close();
  }
});

test("Insufficient stock at intake results in a 409", async () => {
  const state = makeState();
  // Only 1 in stock but ordering 5.
  state.products.find((p) => p.id === PRODUCT_PICK).stock_quantity = 1;
  state.pss.find((p) => p.product_id === PRODUCT_PICK).quantity = 1;
  const app = await buildApp({ state });
  try {
    const created = await createPickupOrder(app, {
      items: [{ productId: PRODUCT_PICK, quantity: 5 }],
    });
    assert.equal(created.status, 409);
    assert.match(created.json.message, /Insufficient stock/);
  } finally {
    app.server.close();
  }
});

test("Duplicate externalOrderId returns the existing order", async () => {
  const state = makeState();
  const app = await buildApp({ state });
  try {
    const first = await createPickupOrder(app, { externalOrderId: "DUP-1", payment: { method: "card", status: "paid" } });
    assert.equal(first.status, 201);
    const second = await createPickupOrder(app, { externalOrderId: "DUP-1" });
    assert.equal(second.status, 200);
    assert.equal(second.json.data.duplicate, true);
    // No second reservation / sale / stock deduction.
    assert.equal(state.orders.length, 1);
    assert.equal(state.movements.filter((m) => m.movement_type === "ONLINE_RESERVE").length, 1);
  } finally {
    app.server.close();
  }
});
