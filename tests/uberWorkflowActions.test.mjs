import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import { executeWorkflowAction } from "../services/platformWorkflow.js";

const COMPANY = "company-uber-action-test";
const STORE = "store-uber-action-test";
const PRODUCT = {
  id: "product-1",
  name: "Coffee",
  description: null,
  price: 3,
  vat_rate: 20,
  active: true,
  uber_item_id: null,
  available_on_uber: true,
  category_name: "Drinks",
};

function makeDb({ integration = null, products = [PRODUCT], order = null } = {}) {
  const queries = [];
  const db = async (text, values = []) => {
    queries.push({ text, values });
    const query = text.replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT active, configuration FROM integrations")) {
      return { rows: integration ? [{ active: integration.active, configuration: integration.configuration }] : [] };
    }
    if (query.startsWith("SELECT p.id, p.name, p.description, p.price")) {
      return { rows: products.map((product) => ({ ...product })) };
    }
    if (query.startsWith("SELECT p.id, p.company_id, p.uber_item_id")) {
      const product = products.find((item) =>
        item.company_id === undefined || item.company_id === values[0]
          ? String(item.id) === String(values[1]) || String(item.uber_item_id || "") === String(values[1])
          : false
      );
      return { rows: product ? [{ ...product, company_id: values[0] }] : [] };
    }
    if (query.startsWith("SELECT id, company_id, store_id, platform, external_order_id, status") &&
        query.includes("FROM online_orders")) {
      return {
        rows: order && order.id === values[0] && order.company_id === values[1] && order.platform === "uber"
          ? [{ ...order }]
          : [],
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  return { db, queries };
}

function context(db, companyId = COMPANY) {
  return { db, companyId, req: { user: { companyId } } };
}

test("Uber upload action is dispatched and reports missing connector credentials", async () => {
  const { db, queries } = makeDb({
    integration: { active: true, configuration: { environment: "sandbox" } },
  });
  const result = await executeWorkflowAction({
    ...context(db),
    action: { type: "UBER_UPLOAD_MENU" },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "NOT_CONFIGURED");
  assert.equal(result.productCount, 1);
  assert.equal(queries[1].values[0], COMPANY);
});

test("Uber connection action handles an absent integration as a disabled connector", async () => {
  const { db } = makeDb({ integration: null });
  const result = await executeWorkflowAction({
    ...context(db),
    action: { type: "UBER_TEST_CONNECTION" },
  });

  assert.equal(result.success, false);
  assert.equal(result.code, "PLATFORM_DISABLED");
  assert.deepEqual(result.attempts, []);
});

test("Uber actions reject mismatched tenant context before loading configuration", async () => {
  const { db, queries } = makeDb();
  await assert.rejects(
    executeWorkflowAction({
      db,
      companyId: "another-company",
      req: { user: { companyId: COMPANY } },
      action: { type: "UBER_UPLOAD_MENU" },
    }),
    /company context is invalid/
  );
  assert.equal(queries.length, 0);
});

function configuredIntegration() {
  return {
    active: true,
    configuration: {
      environment: "sandbox",
      client_id: `client-${crypto.randomUUID()}`,
      client_secret: "secret",
      store_id: "uber-store",
    },
  };
}

function orderRecord(overrides = {}) {
  return {
    id: "internal-order-id",
    company_id: COMPANY,
    store_id: STORE,
    platform: "uber",
    external_order_id: "uber-external-order-id",
    status: "RECEIVED",
    ...overrides,
  };
}

async function withUberFetch(response, callback) {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/oauth/v2/token")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "access-token", expires_in: 3600 }) };
    }

    if (String(url).includes("/v1/delivery/order/")) return response;
    return previousFetch(url, options);
  };
  try {
    return await callback(calls);
  } finally {
    global.fetch = previousFetch;
  }
}

async function withUberItemFetch(response, callback) {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/oauth/v2/token")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: "access-token", expires_in: 3600 }) };
    }
    if (String(url).includes("/v2/eats/stores/uber-store/menus/items/")) return response;
    return previousFetch(url, options);
  };
  try {
    return await callback(calls);
  } finally {
    global.fetch = previousFetch;
  }
}

test("Uber item actions send minor-unit price and sparse availability bodies", async () => {
  const { db } = makeDb({ integration: configuredIntegration(), products: [{ ...PRODUCT, uber_item_id: "uber-item-1" }] });
  await withUberItemFetch(
    { ok: true, status: 200, text: async () => JSON.stringify({ updated: true }) },
    async (calls) => {
      const price = await executeWorkflowAction({
        ...context(db),
        action: { type: "UBER_UPDATE_ITEM_PRICE", productId: PRODUCT.id, price: 3.5 },
      });
      const unavailable = await executeWorkflowAction({
        ...context(db),
        action: { type: "UBER_SET_ITEM_UNAVAILABLE", productId: PRODUCT.id, suspendUntil: Math.floor(Date.now() / 1000) + 3600 },
      });
      const available = await executeWorkflowAction({
        ...context(db),
        action: { type: "UBER_SET_ITEM_AVAILABLE", productId: PRODUCT.id },
      });
      assert.equal(price.success, true);
      assert.deepEqual(JSON.parse(calls[1].options.body), { price_info: { price: 350, overrides: [] } });
      assert.deepEqual(JSON.parse(calls[2].options.body).suspension_info.suspension.reason, "Out of stock");
      assert.equal(JSON.parse(calls[3].options.body).suspension_info.suspension.suspend_until, null);
      assert.ok(calls.slice(1).every(({ url }) => url.endsWith("/menus/items/uber-item-1")));
    }
  );
});

test("Uber price action defaults to the current onePOS product selling price", async () => {
  const { db } = makeDb({
    integration: configuredIntegration(),
    products: [{ ...PRODUCT, uber_item_id: "uber-item-1", price: 4.75 }],
  });
  await withUberItemFetch(
    { ok: true, status: 204, text: async () => "" },
    async (calls) => {
      const result = await executeWorkflowAction({
        ...context(db),
        recordId: PRODUCT.id,
        action: { type: "UBER_UPDATE_ITEM_PRICE" },
      });
      assert.equal(result.success, true);
      const updateCall = calls.find(({ url }) => url.includes("/menus/items/"));
      assert.deepEqual(JSON.parse(updateCall.options.body), { price_info: { price: 475, overrides: [] } });
    }
  );
});

test("Uber item actions surface provider failures and reject missing mappings", async () => {
  const { db } = makeDb({ integration: configuredIntegration(), products: [{ ...PRODUCT, company_id: COMPANY }] });
  await withUberItemFetch(
    { ok: false, status: 404, text: async () => JSON.stringify({ message: "menu not uploaded" }) },
    async () => {
      const result = await executeWorkflowAction({
        ...context(db),
        action: { type: "UBER_UPDATE_ITEM_PRICE", productId: PRODUCT.id, price: 2 },
      });
      assert.equal(result.success, false);
      assert.equal(result.httpStatus, 404);
    }
  );
  const other = await executeWorkflowAction({
    ...context(db, "other-company"),
    action: { type: "UBER_UPDATE_ITEM_PRICE", productId: PRODUCT.id, price: 2 },
  });
  assert.equal(other.code, "PRODUCT_NOT_FOUND");
});

test("Uber accept action dispatches the provider call using the persisted external order identity", async () => {
  const { db } = makeDb({ integration: configuredIntegration(), order: orderRecord() });
  await withUberFetch(
    { ok: true, status: 200, text: async () => JSON.stringify({ accepted: true }) },
    async (calls) => {
      const result = await executeWorkflowAction({
        ...context(db),
        recordId: "internal-order-id",
        action: { type: "UBER_ACCEPT_ORDER", orderId: "internal-order-id" },
      });
      assert.equal(result.success, true);
      assert.ok(calls.some(({ url }) => url.endsWith("/v1/delivery/order/uber-external-order-id/accept")));
    }
  );
});

test("Uber deny action dispatches supported provider denial and surfaces rejection", async () => {
  const { db } = makeDb({ integration: configuredIntegration(), order: orderRecord({ status: "ACCEPTED" }) });
  await withUberFetch(
    { ok: false, status: 422, text: async () => JSON.stringify({ message: "denial rejected" }) },
    async (calls) => {
      const result = await executeWorkflowAction({
        ...context(db),
        recordId: "internal-order-id",
        action: { type: "UBER_DENY_ORDER", orderId: "internal-order-id", reason: "Out of stock" },
      });
      assert.equal(result.success, false);
      assert.equal(result.httpStatus, 422);
      assert.ok(calls.some(({ url, options }) =>
        url.endsWith("/v1/delivery/order/uber-external-order-id/deny") &&
        JSON.parse(options.body).deny_reason.info === "Out of stock" &&
        JSON.parse(options.body).deny_reason.type === "OTHER"
      ));
    }
  );
});

test("Uber order actions enforce persisted store scope and lifecycle status before provider dispatch", async () => {
  const { db } = makeDb({
    integration: configuredIntegration(),
    order: orderRecord({ store_id: "another-store", status: "PREPARING" }),
  });
  await withUberFetch(
    { ok: true, status: 200, text: async () => "{}" },
    async (calls) => {
      const storeResult = await executeWorkflowAction({
        ...context(db),
        req: { user: { companyId: COMPANY, storeId: STORE } },
        recordId: "internal-order-id",
        action: { type: "UBER_ACCEPT_ORDER" },
      });
      assert.equal(storeResult.code, "STORE_SCOPE_MISMATCH");
      assert.equal(calls.length, 0);
    }
  );

  const preparingOrder = orderRecord({ status: "PREPARING" });
  const statusCtx = makeDb({ integration: configuredIntegration(), order: preparingOrder });
  const statusResult = await executeWorkflowAction({
    ...context(statusCtx.db),
    req: { user: { companyId: COMPANY, storeId: STORE } },
    recordId: preparingOrder.id,
    action: { type: "UBER_ACCEPT_ORDER" },
  });
  assert.equal(statusResult.code, "INVALID_STATUS");
  assert.equal(statusCtx.queries.some(({ text }) => text.includes("online_orders")), true);
});

async function buildOrderLifecycleApp(initialOrder) {
  const state = { order: { ...initialOrder }, events: [] };
  const db = async (text, values = []) => {
    const query = text.replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT active, configuration FROM integrations")) {
      return { rows: [{ active: true, configuration: configuredIntegration().configuration }] };
    }
    if (query.startsWith("SELECT id, company_id, store_id, platform, external_order_id, status") &&
        query.includes("FROM online_orders")) {
      return state.order.id === values[0] && state.order.company_id === values[1]
        ? { rows: [{ ...state.order }] }
        : { rows: [] };
    }
    if (query.startsWith("SELECT * FROM online_orders")) return { rows: [{ ...state.order }] };
    if (query.startsWith("SELECT i.*, p.track_stock")) return { rows: [] };
    return { rows: [] };
  };

  const client = {
    async query(text, values = []) {
      const query = text.replace(/\s+/g, " ").trim();
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };
      if (query.startsWith("SELECT * FROM online_orders")) return { rows: [{ ...state.order }] };
      if (query.startsWith("SELECT id, company_id, store_id, platform, external_order_id, status")) {
        return { rows: [{ ...state.order }] };
      }
      if (query.startsWith("INSERT INTO online_order_events")) {
        state.events.push({ eventType: values[1], fromStatus: values[2], toStatus: values[3] });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("UPDATE online_orders SET accepted_at = NOW()")) {
        state.order.accepted_at = "set";
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("UPDATE online_orders SET status = $2")) {
        state.order.status = values[1];
        if (query.includes("preparing_at")) state.order.preparing_at = "set";
        if (query.includes("inventory_released = TRUE")) {
          state.order.inventory_reserved = false;
          state.order.inventory_released = true;
        }
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected lifecycle SQL: ${query}`);
    },
    release() {},
  };
  const app = express();
  app.use(express.json());
  const { default: createOnlineRouter } = await import("../routes/online.js");
  app.use("/api", createOnlineRouter({
    authenticate: (req, _res, next) => {
      req.user = { id: "user-1", companyId: COMPANY, storeId: STORE };
      next();
    },
    authorize: () => (_req, _res, next) => next(),
    db,
    pool: { connect: async () => client },
    writeAudit: async () => {},
    createInventoryMovement: async () => {},
  }));
  return { app, state };
}

async function postOrderLifecycleAction(app, path, body = {}) {
  const server = http.createServer(app);
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Uber action dispatch preserves onePOS accepted and denied lifecycle mapping", async () => {
  const baseOrder = orderRecord({ inventory_reserved: false, inventory_released: false });
  const accepted = await buildOrderLifecycleApp(baseOrder);
  await withUberFetch(
    { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) },
    async (calls) => {
      const response = await postOrderLifecycleAction(accepted.app, `/api/online/orders/${baseOrder.id}/accept`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      assert.equal(accepted.state.order.status, "PREPARING");
      assert.ok(accepted.state.order.accepted_at);
      assert.ok(accepted.state.order.preparing_at);
      assert.ok(accepted.state.events.some((event) => event.eventType === "ACKED_ACCEPTED" && event.toStatus === "ACCEPTED"));
      assert.ok(calls.some(({ url }) => url.endsWith(`/v1/delivery/order/${baseOrder.external_order_id}/accept`)));
    }
  );

  const denied = await buildOrderLifecycleApp({ ...baseOrder, status: "ACCEPTED" });
  await withUberFetch(
    { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) },
    async (calls) => {
      const response = await postOrderLifecycleAction(
        denied.app,
        `/api/online/orders/${baseOrder.id}/reject`,
        { reason: "Out of stock" }
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).success, true);
      assert.equal(denied.state.order.status, "REJECTED");
      assert.ok(denied.state.order.inventory_released);
      assert.ok(calls.some(({ url, options }) =>
        url.endsWith(`/v1/delivery/order/${baseOrder.external_order_id}/deny`) &&
        JSON.parse(options.body).deny_reason.info === "Out of stock" &&
        JSON.parse(options.body).deny_reason.type === "OTHER"
      ));
    }
  );
});
