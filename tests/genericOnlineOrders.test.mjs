/*
 * onePOS — Generic Online Orders tests (T10-ONLINE).
 *
 * Tests the REAL services/onlineOrders/genericOrderService.js over a
 * stateful fake db/pool (same pattern as the route-level suites in this repo).
 *
 *   node --test tests/genericOnlineOrders.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createGenericOrder,
  getGenericOrder,
  listGenericOrders,
  transitionGenericOrder,
} from "../services/onlineOrders/genericOrderService.js";
import {
  GENERIC_ORDER_STATUSES,
  FULFILMENT_TYPES,
  canTransition,
  resolveNextStatus,
} from "../services/onlineOrders/genericOrderTypes.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_A = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const PRODUCT_A = "p0000000-0000-4000-8000-000000000021";
const PRODUCT_B = "p0000000-0000-4000-8000-000000000022";
const PRODUCT_CROSS = "p0000000-0000-4000-8000-000000000023";
const ORDER_ID = "o0000000-0000-4000-8000-000000000100";

/* ---------------------------------------------------------------- helpers */

function makeCtx() {
  const state = {
    products: [
      {
        id: PRODUCT_A, company_id: COMPANY, name: "Cola 500ml", sku: "COLA-500",
        barcode: "1234567890123", price: 1.5, cost_price: 0.6, vat_rate: 20,
        vat_applicable: true, track_stock: true, stock_quantity: 50, low_stock_level: 5, active: true,
      },
      {
        id: PRODUCT_B, company_id: COMPANY, name: "Chips", sku: "CHIPS-100",
        barcode: "1234567890124", price: 2.0, cost_price: 0.8, vat_rate: 20,
        vat_applicable: true, track_stock: true, stock_quantity: 20, low_stock_level: 3, active: true,
      },
      {
        id: PRODUCT_CROSS, company_id: COMPANY_B, name: "Foreign Product",
        sku: "FOR-1", price: 10, cost_price: 5, vat_rate: 20, vat_applicable: true,
        track_stock: true, stock_quantity: 100, low_stock_level: 5, active: true,
      },
    ],
    stores: [
      { id: STORE_A, company_id: COMPANY, name: "Store A", active: true },
    ],
    pss: [
      { company_id: COMPANY, store_id: STORE_A, product_id: PRODUCT_A, quantity: 25 },
      { company_id: COMPANY, store_id: STORE_A, product_id: PRODUCT_B, quantity: 10 },
    ],
    customers: [
      { id: " cust-1", company_id: COMPANY, name: "Alice", active: true },
    ],
    orders: [],
    orderItems: [],
    orderEvents: [],
    movements: [],
    nextOrderId: 1,
  };

  const genId = () => `gen-${state.nextOrderId++}`;

  const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

  const db = async (sql, params = []) => {
    const s = norm(sql);

    if (/^SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
      const row = state.stores.find((st) => st.id === params[0] && st.company_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/^SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
      const row = state.customers.find((c) => c.id === params[0] && c.company_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/^SELECT id FROM products WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
      const row = state.products.find((p) => p.id === params[0] && p.company_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/SELECT.*FROM online_orders o.*WHERE o\.id = \$1.*company_id = \$2.*platform = 'direct'/.test(s)) {
      const row = state.orders.find((o) => o.id === params[0] && o.company_id === params[1]);
      if (!row) return { rows: [null] };
      const itemCount = state.orderItems.filter((i) => i.order_id === row.id).length;
      const eventCount = state.orderEvents.filter((e) => e.order_id === row.id).length;
      return { rows: [{ ...row, item_count: itemCount, event_count: eventCount }] };
    }
    if (/SELECT o\.\*,\s*\(SELECT COUNT\(\*\) FROM online_order_items i WHERE i\.order_id = o\.id\) AS item_count FROM online_orders o WHERE /.test(s)) {
      let rows = state.orders.filter((o) => o.company_id === params[0] && o.platform === "direct");
      const statusIdx = s.indexOf("o.status = $");
      if (statusIdx > -1) {
        const statusParam = params[1];
        rows = rows.filter((o) => o.status === statusParam);
      }
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    async query(sql, params = []) {
      const s = norm(sql);

      if (/^BEGIN$/.test(s)) return { rows: [], rowCount: 0 };
      if (/^COMMIT$/.test(s)) return { rows: [], rowCount: 0 };
      if (/^ROLLBACK$/.test(s)) return { rows: [], rowCount: 0 };

      /* SELECT id FROM stores for store check */
      if (/^SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
        const row = state.stores.find((st) => st.id === params[0] && st.company_id === params[1]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      /* SELECT id FROM customers for customer check */
      if (/^SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
        const row = state.customers.find((c) => c.id === params[0] && c.company_id === params[1]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      /* SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE */
      if (/SELECT \* FROM online_orders WHERE id = \$1 AND company_id = \$2 FOR UPDATE/.test(s)) {
        const row = state.orders.find((o) => o.id === params[0] && o.company_id === params[1]);
        return { rows: row ? [{ ...row }] : [] };
      }

      /* SELECT product FOR UPDATE */
      if (/FROM products WHERE id = \$1 AND company_id = \$2 AND active = true FOR UPDATE/.test(s)) {
        const p = state.products.find((x) => x.id === params[0] && x.company_id === params[1] && x.active);
        return { rows: p ? [{ ...p }] : [] };
      }

      /* SELECT id FROM online_orders for idempotency check */
      if (/SELECT id, status FROM online_orders WHERE company_id = \$1 AND platform = 'direct' AND external_order_id = \$2/.test(s)) {
        const row = state.orders.find(
          (o) => o.company_id === params[0] && o.external_order_id === params[1]
        );
        return { rows: row ? [{ id: row.id, status: row.status }] : [] };
      }

      /* INSERT INTO online_orders */
      if (/^INSERT INTO online_orders \(/.test(s)) {
        const order = {
          id: ORDER_ID, company_id: params[0], store_id: params[1] || null,
          customer_id: params[2] || null, platform: "direct",
          external_order_id: params[3], external_reference: params[4],
          status: "RECEIVED", fulfilment_type: params[5],
          customer_name: params[6], customer_phone: params[7], customer_email: params[8],
          delivery_address: params[9], customer_data: params[10],
          currency: "GBP", subtotal: params[11], tax: params[12], total: params[13],
          notes: params[14], inventory_reserved: false,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        state.orders.push(order);
        return { rows: [order], rowCount: 1 };
      }

      /* INSERT INTO online_order_items */
      if (/^INSERT INTO online_order_items \(/.test(s)) {
        const item = {
          id: `oi-${state.orderItems.length + 1}`, order_id: params[0], product_id: params[1],
          product_name: params[2], quantity: params[3], unit_price: params[4],
          vat_rate: params[5], tax: params[6], total: params[7], mapping_status: params[8],
          created_at: new Date().toISOString(),
        };
        state.orderItems.push(item);
        return { rows: [item], rowCount: 1 };
      }

      /* SELECT from product_store_stock */
      if (/SELECT quantity FROM product_store_stock WHERE company_id = \$1 AND store_id = \$2 AND product_id = \$3/.test(s)) {
        const ps = state.pss.find((x) => x.company_id === params[0] && x.store_id === params[1] && x.product_id === params[2]);
        return { rows: ps ? [{ quantity: ps.quantity }] : [] };
      }

      /* UPDATE product_store_stock */
      if (/^UPDATE product_store_stock SET quantity = quantity - \$1, updated_at = NOW\(\) WHERE company_id = \$2 AND store_id = \$3 AND product_id = \$4/.test(s)) {
        const ps = state.pss.find((x) => x.company_id === params[1] && x.store_id === params[2] && x.product_id === params[3]);
        if (ps) ps.quantity -= params[0];
        return { rows: [], rowCount: ps ? 1 : 0 };
      }

      /* INSERT INTO product_store_stock */
      if (/^INSERT INTO product_store_stock \(company_id, store_id, product_id, quantity, updated_at\)/.test(s)) {
        const newRow = {
          company_id: params[0], store_id: params[1], product_id: params[2],
          quantity: -params[3], updated_at: new Date().toISOString(),
        };
        state.pss.push(newRow);
        return { rows: [{ quantity: -params[3] }], rowCount: 1 };
      }

      /* INSERT INTO inventory_movements */
      if (/^INSERT INTO inventory_movements \(/.test(s)) {
        const movement = {
          id: `mv-${state.movements.length + 1}`, company_id: params[0], product_id: params[1],
          store_id: params[2], movement_type: "ONLINE_RESERVE", quantity_change: -params[3],
          balance_after: null, reference_type: "ONLINE_ORDER", reference_id: params[4],
          reason: params[5], created_by: params[6], created_at: new Date().toISOString(),
        };
        state.movements.push(movement);
        return { rows: [movement], rowCount: 1 };
      }

      /* UPDATE online_orders SET inventory_reserved = TRUE */
      if (/^UPDATE online_orders SET inventory_reserved = TRUE WHERE id = \$1/.test(s)) {
        const order = state.orders.find((o) => o.id === params[0]);
        if (order) order.inventory_reserved = true;
        return { rows: [], rowCount: order ? 1 : 0 };
      }

      /* UPDATE online_orders SET inventory_reserved = FALSE, inventory_released = TRUE */
      if (
        /^UPDATE online_orders SET inventory_reserved = FALSE, inventory_released = TRUE WHERE id = \$1/.test(s)
      ) {
        const order = state.orders.find((o) => o.id === params[0]);
        if (order) {
          order.inventory_reserved = false;
          order.inventory_released = true;
        }
        return { rows: [], rowCount: order ? 1 : 0 };
      }

      /* UPDATE online_orders SET status, timestamp cols */
      if (/^UPDATE online_orders SET status = \$1/.test(s)) {
        const toStatus = params[0];
        const orderId = params[1];
        const order = state.orders.find((o) => o.id === orderId);
        if (order) {
          order.status = toStatus;
          order.updated_at = new Date().toISOString();
          const tsColMatch = s.match(/(preparing_at|ready_at|completed_at|cancelled_at) = NOW\(\)/);
          if (tsColMatch) order[tsColMatch[1]] = new Date().toISOString();
          if (s.includes("cancel_reason = $")) {
            const reasonParamIdx = params.length - 2;
            order.cancel_reason = params[reasonParamIdx];
          }
        }
        return { rows: [], rowCount: order ? 1 : 0 };
      }

      /* INSERT INTO online_order_events */
      if (/^INSERT INTO online_order_events \(/.test(s)) {
        const event = {
          id: `oe-${state.orderEvents.length + 1}`, order_id: params[0],
          event_type: params[1], from_status: params[2] || null, to_status: params[3],
          message: params[4], actor_user_id: params[5] || null,
          created_at: new Date().toISOString(),
        };
        state.orderEvents.push(event);
        return { rows: [event], rowCount: 1 };
      }

      /* loadOrderItems: current production projection, plus product stock flags */
      if (/i\.quantity, i\.unit_price, i\.tax, i\.total, i\.mapping_status, p\.track_stock, p\.batch_tracking FROM online_order_items i/.test(s)) {
        const orderItems = state.orderItems
          .filter((i) => i.order_id === params[0])
          .map((i) => {
            const p = state.products.find((x) => x.id === i.product_id) || {};
            return { ...i, track_stock: p.track_stock, batch_tracking: p.batch_tracking };
          })
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return { rows: orderItems, rowCount: orderItems.length };
      }

      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = { connect: async () => client };

  return { state, db, pool, client, genId };
}

/* ------------------------------------------------------------- type tests */

describe("generic order types", () => {
  test("FULFILMENT_TYPES has SELF_PICKUP and DELIVERY", () => {
    assert.equal(FULFILMENT_TYPES.SELF_PICKUP, "SELF_PICKUP");
    assert.equal(FULFILMENT_TYPES.DELIVERY, "DELIVERY");
  });

  test("GENERIC_ORDER_STATUSES covers all 9 statuses", () => {
    assert.equal(GENERIC_ORDER_STATUSES.RECEIVED, "RECEIVED");
    assert.equal(GENERIC_ORDER_STATUSES.PREPARING, "PREPARING");
    assert.equal(GENERIC_ORDER_STATUSES.READY, "READY");
    assert.equal(GENERIC_ORDER_STATUSES.READY_FOR_PICKUP, "READY_FOR_PICKUP");
    assert.equal(GENERIC_ORDER_STATUSES.READY_FOR_DELIVERY, "READY_FOR_DELIVERY");
    assert.equal(GENERIC_ORDER_STATUSES.COLLECTED, "COLLECTED");
    assert.equal(GENERIC_ORDER_STATUSES.COMPLETED, "COMPLETED");
    assert.equal(GENERIC_ORDER_STATUSES.REJECTED, "REJECTED");
    assert.equal(GENERIC_ORDER_STATUSES.CANCELLED, "CANCELLED");
  });

  test("canTransition rejects invalid transitions", () => {
    assert.equal(canTransition(FULFILMENT_TYPES.DELIVERY, "RECEIVED", "COMPLETED"), false);
    assert.equal(canTransition(FULFILMENT_TYPES.DELIVERY, "COMPLETED", "CANCELLED"), false);
  });

  test("canTransition allows valid transitions", () => {
    assert.equal(canTransition(FULFILMENT_TYPES.DELIVERY, "RECEIVED", "PREPARING"), true);
    assert.equal(canTransition(FULFILMENT_TYPES.DELIVERY, "RECEIVED", "REJECTED"), true);
    assert.equal(canTransition(FULFILMENT_TYPES.SELF_PICKUP, "READY_FOR_PICKUP", "COLLECTED"), true);
  });

  test("resolveNextStatus returns correct next for DELIVERY", () => {
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.DELIVERY, "RECEIVED"), "PREPARING");
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.DELIVERY, "PREPARING"), "READY_FOR_DELIVERY");
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.DELIVERY, "READY_FOR_DELIVERY"), "COMPLETED");
  });

  test("resolveNextStatus returns correct next for SELF_PICKUP", () => {
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.SELF_PICKUP, "RECEIVED"), "PREPARING");
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.SELF_PICKUP, "PREPARING"), "READY_FOR_PICKUP");
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.SELF_PICKUP, "READY_FOR_PICKUP"), "COLLECTED");
    assert.equal(resolveNextStatus(FULFILMENT_TYPES.SELF_PICKUP, "COLLECTED"), "COMPLETED");
  });
});

/* --------------------------------------------------------- service tests */

describe("createGenericOrder", () => {
  test("creates a DELIVERY order with resolved server pricing", async () => {
    const { db, pool } = makeCtx();
    const items = [{ productId: PRODUCT_A, quantity: 2, price: 99.99, vatRate: 15 }];
    const result = await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-001", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items, customer: { name: "Alice", phone: "555", email: "a@b.co" }, notes: "test", payment: {},
    });
    assert.equal(result.duplicate, false);
    assert.ok(result.order.id);
    assert.equal(result.order.status, "RECEIVED");
    assert.equal(result.order.platform, "direct");
    assert.equal(result.order.subtotal, "3.00");
    assert.equal(result.order.tax, "0.60");
    assert.equal(result.order.total, "3.60");
    assert.equal(result.order.customer_id, null);
    assert.equal(result.order.customer_name, "Alice");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].unitPrice, 1.5);
    assert.equal(result.items[0].vatRate, 20);
    assert.equal(result.items[0].total, 3.0);
  });

  test("creates a SELF_PICKUP order with store stock reservation", async () => {
    const { db, pool, state } = makeCtx();
    const items = [{ productId: PRODUCT_A, quantity: 2 }];
    const result = await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-002", fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
      items, payment: {},
    });

    assert.equal(result.duplicate, false);
    assert.equal(result.order.status, "RECEIVED");
    assert.equal(result.order.store_id, STORE_A);
    assert.equal(result.order.inventory_reserved, true);
    const ps = state.pss.find((x) => x.product_id === PRODUCT_A && x.store_id === STORE_A);
    assert.equal(ps.quantity, 23);
    assert.ok(state.movements.length > 0);
    assert.equal(state.movements[0].movement_type, "ONLINE_RESERVE");
  });

  test("persists an existing Customer Core reference without creating a customer", async () => {
    const { db, pool } = makeCtx();
    const customerId = " cust-1";
    const result = await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-CUSTOMER", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }],
      customer: { id: customerId, name: "Alice" },
    });
    assert.equal(result.order.customer_id, customerId);
    assert.equal(JSON.parse(result.order.customer_data).id, customerId);
  });

  test("rejects missing externalOrderId", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: null, fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /externalOrderId/);
    }
  });

  test("rejects invalid fulfilment type", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-003", fulfilmentType: "AIR_DRONE",
        items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Invalid fulfilment type/);
    }
  });

  test("rejects empty items", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-004", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /At least one order item/);
    }
  });

  test("rejects product not found", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-005", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [{ productId: "nonexistent", quantity: 1 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Product not found/);
    }
  });

  test("rejects product from different company (cross-company isolation)", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-006", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [{ productId: PRODUCT_CROSS, quantity: 1 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Product not found/);
    }
  });

  test("rejects inactive product", async () => {
    const { db, pool, state } = makeCtx();
    state.products[0].active = false;
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-007", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Product not found/);
    }
  });

  test("rejects insufficient store stock", async () => {
    const { db, pool, state } = makeCtx();
    state.pss[0].quantity = 1;
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
        externalOrderId: "EXT-008", fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
        items: [{ productId: PRODUCT_A, quantity: 5 }], payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Insufficient stock/);
    }
  });

  test("duplicate externalOrderId returns duplicate flag", async () => {
    const { db, pool } = makeCtx();
    const items = [{ productId: PRODUCT_A, quantity: 1 }];
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-DUP", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items, payment: {},
    });
    const result = await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-DUP", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items, payment: {},
    });
    assert.equal(result.duplicate, true);
    assert.ok(result.orderId);
    assert.equal(result.status, "RECEIVED");
  });

  test("customer not owned by company is rejected", async () => {
    const { db, pool } = makeCtx();
    try {
      await createGenericOrder({
        db, pool, companyId: COMPANY, userId: USER, storeId: null,
        externalOrderId: "EXT-010", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
        items: [{ productId: PRODUCT_A, quantity: 1 }],
        customer: { id: "foreign-cust", name: "Bob", phone: "555" },
        payment: {},
      });
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /Customer not found/);
    }
  });
});

describe("getGenericOrder", () => {
  test("returns order for existing order in same company", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-GET", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const order = await getGenericOrder(db, COMPANY, ORDER_ID);
    assert.ok(order);
    assert.equal(order.external_order_id, "EXT-GET");
  });

  test("returns null for non-existent order", async () => {
    const { db } = makeCtx();
    const order = await getGenericOrder(db, COMPANY, "nonexistent-id");
    assert.equal(order, null);
  });

  test("returns null for order from different company", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-ISO", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const order = await getGenericOrder(db, COMPANY_B, ORDER_ID);
    assert.equal(order, null);
  });
});

describe("listGenericOrders", () => {
  test("returns orders filtered by status", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-L1", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const orders = await listGenericOrders(db, COMPANY, { status: "RECEIVED" });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, "RECEIVED");
  });

  test("excludes orders from different company", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-L2", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const orders = await listGenericOrders(db, COMPANY_B, {});
    assert.equal(orders.length, 0);
  });

  test("excludes non-direct platform orders", async () => {
    const { db, pool, state } = makeCtx();
    state.orders.push({
      id: "fake-uber", company_id: COMPANY, store_id: null, platform: "uber",
      external_order_id: "UBER-1", status: "RECEIVED", created_at: new Date().toISOString(),
    });
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-L3", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const orders = await listGenericOrders(db, COMPANY, {});
    assert.equal(orders.length, 1);
    assert.equal(orders[0].platform, "direct");
  });
});

describe("transitionGenericOrder", () => {
  test("transitions RECEIVED -> PREPARING for DELIVERY", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-T1", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const result = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING",
    });
    assert.equal(result.success, true);
  });

  test("rejects invalid transition DELIVERY READY_FOR_DELIVERY -> PREPARING", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-T2", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    const r1 = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING",
    });
    assert.equal(r1.success, true);
    const r2 = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING",
    });
    assert.equal(r2.success, false);
    assert.match(r2.error, /Invalid transition/);
  });

  test("full SELF_PICKUP lifecycle", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-T3", fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    let r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "READY_FOR_PICKUP" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "COLLECTED" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "COMPLETED" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "CANCELLED" });
    assert.equal(r.success, false);
  });

  test("cancelled order cannot be transitioned further", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-T4", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING",
    });
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "CANCELLED",
    });
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "COMPLETED",
    });
    assert.equal(r.success, false);
  });

  test("completed order cannot be transitioned further", async () => {
    const { db, pool } = makeCtx();
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-T5", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {},
    });
    let r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "PREPARING" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "READY_FOR_DELIVERY" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "COMPLETED" });
    assert.equal(r.success, true);
    r = await transitionGenericOrder({ pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER, toStatus: "CANCELLED" });
    assert.equal(r.success, false);
  });

  test("returns error for non-existent order", async () => {
    const { pool } = makeCtx();
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: "nonexistent", userId: USER, toStatus: "PREPARING",
    });
    assert.equal(r.success, false);
    assert.equal(r.error, "Order not found");
  });
});

describe("generic order inventory / sale integration", () => {
  /*
   * These tests exercise the optional createSale / createInventoryMovement
   * hooks wired in by the generic routes: completion becomes a POS sale (no
   * extra stock movement), and cancellation releases the reserved stock.
   */
  const makeMovement = (state) => (client, movement) => {
    const key = `${movement.companyId}:${movement.productId}:${movement.storeId || "_noshop"}`;
    const before = state.inventory.get(key) ?? 0;
    const after = Math.round((before + Number(movement.quantityChange)) * 100) / 100;
    state.inventory.set(key, after);
    state.movements.push({
      id: `mv-${state.movements.length + 1}`,
      company_id: movement.companyId,
      product_id: movement.productId,
      store_id: movement.storeId,
      movement_type: movement.movementType,
      quantity_change: Number(movement.quantityChange),
      balance_after: after,
      reference_type: movement.referenceType,
      reference_id: movement.referenceId,
      reason: movement.reason,
      created_by: movement.createdBy,
      created_at: new Date().toISOString(),
    });
    return { id: `mv-${state.movements.length}`, balance_after: after };
  };

  const makeSaleStub = (state) => (client, ctx) => {
    const existing = state.sales.find((s) => s.online_order_id === ctx.order.id);
    if (existing) {
      state.saleCalls++;
      return { sale: existing, unmappedExcluded: 0, alreadyExisted: true };
    }
    const sale = {
      id: `sale-${state.sales.length + 1}`,
      online_order_id: ctx.order.id,
      receipt_number: `GEN-${ctx.order.external_order_id}`,
      subtotal: 0,
      tax: 0,
      total: 0,
      status: "completed",
    };
    state.sales.push(sale);
    state.saleCalls++;
    return { sale, unmappedExcluded: 0, alreadyExisted: false };
  };

  test("collecting a pickup order records a POS sale without moving stock", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);
    const createSale = makeSaleStub(state);

    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-S1", fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {}, createInventoryMovement: movement,
    });

    const stockBefore = state.inventory.get(`${COMPANY}:${PRODUCT_A}:${STORE_A}`);
    assert.equal(stockBefore, -1); // 1 reserved

    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "PREPARING", createSale, createInventoryMovement: movement,
    });
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "READY_FOR_PICKUP", createSale, createInventoryMovement: movement,
    });
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "COLLECTED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r.success, true);
    assert.equal(r.sale, state.sales[0]);
    assert.equal(state.saleCalls, 1);

    // A retry to COMPLETED must not create a second sale (saleCreator idempotency).
    const r2 = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "COMPLETED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r2.success, true);
    assert.equal(state.sales.length, 1);
    assert.equal(state.saleCalls, 2); // second call found it already existed

    // Stock only moved once (the reservation); collection created no movement.
    const reserveMovements = state.movements.filter((m) => m.movement_type === "ONLINE_RESERVE");
    const releaseMovements = state.movements.filter((m) => m.movement_type === "ONLINE_RELEASE");
    assert.equal(reserveMovements.length, 1);
    assert.equal(releaseMovements.length, 0);
    assert.equal(state.inventory.get(`${COMPANY}:${PRODUCT_A}:${STORE_A}`), -1);
  });

  test("cancelling a reserved order releases stock (ONLINE_RELEASE)", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);
    const createSale = makeSaleStub(state);

    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-S2", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 3 }], payment: {}, createInventoryMovement: movement,
    });
    assert.equal(state.inventory.get(`${COMPANY}:${PRODUCT_A}:${STORE_A}`), -3);

    // Release before completion: PREPARING -> CANCELLED.
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "PREPARING", createSale, createInventoryMovement: movement,
    });
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "CANCELLED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r.success, true);
    assert.equal(r.inventoryReleased, true);
    assert.equal(r.sale, null);
    assert.equal(state.inventory.get(`${COMPANY}:${PRODUCT_A}:${STORE_A}`), 0);

    const order = state.orders[0];
    assert.equal(order.inventory_reserved, false);
    assert.equal(order.inventory_released, true);
    const releases = state.movements.filter((m) => m.movement_type === "ONLINE_RELEASE");
    assert.equal(releases.length, 1);
    assert.equal(releases[0].quantity_change, 3);
  });

  test("cancelling a non-reserved order does not attempt a release", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);
    const createSale = makeSaleStub(state);

    // storeId is null -> no reservation.
    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: null,
      externalOrderId: "EXT-S3", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {}, createInventoryMovement: movement,
    });

    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "PREPARING", createSale, createInventoryMovement: movement,
    });
    assert.equal(r.success, true);
    const r2 = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "CANCELLED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r2.success, true);
    assert.equal(r2.inventoryReleased, false);
    assert.equal(state.movements.length, 0);
  });

  test("rejecting a reserved order releases stock", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);

    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-REJECT", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 2 }], payment: {}, createInventoryMovement: movement,
    });
    const result = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "REJECTED", createInventoryMovement: movement,
    });

    assert.equal(result.success, true);
    assert.equal(result.inventoryReleased, true);
    assert.equal(state.orders[0].inventory_released, true);
    assert.equal(state.inventory.get(`${COMPANY}:${PRODUCT_A}:${STORE_A}`), 0);
    assert.equal(state.movements.filter((movementEntry) => movementEntry.movement_type === "ONLINE_RELEASE").length, 1);
  });

  test("a sale-creation failure rolls the completion back", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);
    let callCount = 0;
    const createSale = (client, ctx) => {
      callCount++;
      throw new Error("boom");
    };

    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-S4", fulfilmentType: FULFILMENT_TYPES.DELIVERY,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {}, createInventoryMovement: movement,
    });
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "PREPARING", createSale, createInventoryMovement: movement,
    });
    await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "READY_FOR_DELIVERY", createSale, createInventoryMovement: movement,
    });
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "COMPLETED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r.success, false);
    assert.match(r.error, /POS sale could not be created/);
    assert.equal(callCount, 1);
  });

  test("cannot collect an order that is not yet ready", async () => {
    const { db, pool, state } = makeCtx();
    state.inventory = new Map();
    state.sales = [];
    state.saleCalls = 0;
    const movement = makeMovement(state);
    const createSale = makeSaleStub(state);

    await createGenericOrder({
      db, pool, companyId: COMPANY, userId: USER, storeId: STORE_A,
      externalOrderId: "EXT-S5", fulfilmentType: FULFILMENT_TYPES.SELF_PICKUP,
      items: [{ productId: PRODUCT_A, quantity: 1 }], payment: {}, createInventoryMovement: movement,
    });
    const r = await transitionGenericOrder({
      pool, companyId: COMPANY, orderId: ORDER_ID, userId: USER,
      toStatus: "COLLECTED", createSale, createInventoryMovement: movement,
    });
    assert.equal(r.success, false);
    assert.match(r.error, /Invalid transition/);
  });
});
