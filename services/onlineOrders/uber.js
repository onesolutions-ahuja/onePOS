/*
 * Uber Eats integration service.
 *
 * Two modes:
 *   - REAL: Settings holds either a pre-issued OAuth access token (eats.order
 *     scope, stored in the "API key / access token" field) or a client_id +
 *     client_secret pair. Order lifecycle actions then call the real Uber
 *     Eats API through uberClient.js (sandbox or production depending on the
 *     configured environment). Every HTTP exchange is logged to
 *     platform_api_logs by the client.
 *   - STUB: no usable credentials (or platform disabled) -> falls back to the
 *     shared platform-service stubs so the whole lifecycle still runs
 *     end-to-end (platform-side OTP validation simulated).
 *
 * Menu publishing and store discovery are exposed as registered workflow
 * actions; the online routes invoke those same actions rather than making
 * provider calls independently.
 *
 * All Uber API specifics stay in this file + uberClient.js; POS, Products,
 * Reports and AdminLayout never call Uber directly.
 */

import crypto from "crypto";
import { createPlatformService, stubFailure } from "./platformServiceBase.js";
import { isRealApiMode, uberRequest } from "./uberClient.js";

const base = createPlatformService({ platform: "uber", displayName: "Uber Eats" });

/*
 * ---------------------------------------------------------------------------
 * Primary Webhook support (developer.uber.com/docs/eats/guides/webhooks)
 *
 * Same pattern as the Deliveroo service: signature verification + event
 * parsing + order normalisation live on the service; the transport endpoint
 * (POST /api/online/uber/webhook) lives in routes/online.js and reuses the
 * existing platform_api_logs / online_order_events audit structure.
 *
 * Uber signs each delivery with `X-Uber-Signature: HMAC-SHA256(client_secret,
 * raw_body)` (hex). The primary webhook delivers store lifecycle events
 * (store.provisioned / store.deprovisioned) and order events
 * (orders.notification) for the Client ID; Uber requires an HTTP 200 with an
 * empty body to acknowledge receipt.
 * ---------------------------------------------------------------------------
 */

function safeHexEqual(expectedHex, actualHeader) {
  if (typeof actualHeader !== "string") return false;
  const provided = actualHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[0-9a-f]+$/.test(provided) || provided.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(provided, "hex"));
}

/**
 * Verifies `X-Uber-Signature` over the RAW request body using the configured
 * secret (Uber's client secret; the dedicated webhook secret field is also
 * accepted so a future key rotation does not need a code change).
 */
function verifyUberWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto.createHmac("sha256", String(secret)).update(body).digest("hex");
  return safeHexEqual(expected, signatureHeader);
}

/**
 * Extracts the event envelope from a primary-webhook payload. Uber delivers
 * both flat envelopes ({ event_type, store_id, order_id, ... }) and resource
 * envelopes ({ event_type, payload|order|resource: {...} }); both are
 * recognised, nothing is invented for unknown shapes.
 */
function parseUberWebhookEvent(payload) {
  if (!payload || typeof payload !== "object") return null;

  const eventType = payload.event_type || payload.eventType || payload.type || null;
  if (!eventType) return null;

  const resource =
    payload.payload && typeof payload.payload === "object"
      ? payload.payload
      : payload.order && typeof payload.order === "object"
        ? payload.order
        : payload.resource && typeof payload.resource === "object"
          ? payload.resource
          : payload;

  const externalOrderId =
    resource.order_id ??
    resource.orderId ??
    resource.resource_id ??
    resource.resourceId ??
    resource.uuid ??
    payload.order_id ??
    payload.orderId ??
    payload.resource_id ??
    payload.resourceId ??
    null;
  const storeId = resource.store_id ?? resource.storeId ?? payload.store_id ?? payload.storeId ?? null;
  const userId = resource.user_id ?? resource.userId ?? payload.user_id ?? payload.userId ?? null;
  const resourceHref = payload.resource_href || payload.resourceHref || resource.resource_href || null;

  let eventKind = "unknown";
  const normalizedType = String(eventType).toLowerCase();
  if (normalizedType === "store.provisioned") eventKind = "store_provisioned";
  else if (normalizedType === "store.deprovisioned") eventKind = "store_deprovisioned";
  // Uber documents these exact cancellation notifications: orders.failure
  // for API v1.0 stores and orders.cancel for other store configurations.
  else if (normalizedType === "orders.cancel" || normalizedType === "orders.failure")
    eventKind = "order_cancelled";
  else if (
    normalizedType === "orders.notification" ||
    normalizedType === "orders.scheduled.notification"
  )
    eventKind = externalOrderId ? "order_new" : "order_event";
  else if (normalizedType.startsWith("orders.")) eventKind = "order_event";

  return {
    eventType: String(eventType),
    eventKind,
    externalOrderId: externalOrderId ? String(externalOrderId) : null,
    storeId: storeId ? String(storeId) : null,
    userId: userId ? String(userId) : null,
    resourceHref: resourceHref ? String(resourceHref) : null,
  };
}

function uberMoneyToNumber(money) {
  if (money === null || money === undefined) return 0;
  if (typeof money === "number") return Number.isFinite(money) ? money : 0;
  if (typeof money === "string") {
    const parsed = Number(money);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof money === "object") {
    // Uber Money objects: { amount: 1090, currency_code: "USD" } (minor
    // units) or { amount: "10.90", currency_code: "GBP" }.
    if (money.amount === undefined || money.amount === null) return 0;
    const amount = Number(money.amount);
    if (!Number.isFinite(amount)) return 0;
    // Heuristic used consistently with the Money spec: integer minor-unit
    // amounts carry an explicit currency and no decimals field.
    if (money.currency_code && Number.isInteger(amount)) return amount / 100;
    return amount;
  }
  return 0;
}

function normalizeUberItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") return null;

  const quantity = Number(
    rawItem.quantity ?? rawItem.qty ?? (rawItem.quantity_quantity && rawItem.quantity_quantity.quantity) ?? 1
  );

  const unitPrice = uberMoneyToNumber(
    rawItem.unit_price ?? rawItem.price ?? (rawItem.price_item && rawItem.price_item.total_price)
  );
  const totalPrice = uberMoneyToNumber(rawItem.total_price ?? rawItem.price) || unitPrice * quantity;

  const modifiers = Array.isArray(rawItem.selected_modifiers)
    ? rawItem.selected_modifiers.map((modifier) => ({
        id: modifier.id ?? null,
        name: modifier.name ?? (modifier.selected_modifier_group_details && modifier.selected_modifier_group_details.name) ?? null,
        options: (modifier.selected_options || []).map((option) => ({
          id: option.id ?? null,
          name: option.name ?? null,
          quantity: option.quantity ?? 1,
          price: uberMoneyToNumber(option.client_price ?? option.price),
        })),
      }))
    : undefined;

  return {
    externalItemId:
      rawItem.pos_item_id ??
      rawItem.posItemId ??
      rawItem.id ??
      (rawItem.item && rawItem.item.id) ??
      null,
    name: rawItem.title ?? rawItem.name ?? rawItem.display_name ?? null,
    operationalName: rawItem.display_name ?? rawItem.title ?? null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitPrice,
    totalPrice,
    specialRequests: rawItem.special_instructions ?? rawItem.special_requests ?? null,
    modifiers,
    raw: rawItem,
  };
}

/*
 * ---------------------------------------------------------------------------
 * T10-UBER-MENU - Menu Sync (OnePOS -> Uber Eats)
 *
 * OnePOS is the SOURCE OF TRUTH: the payload is built from the existing
 * Product Master (and nothing is ever read back into it). Deterministic and
 * idempotent by identity: the Uber item id IS the stable external mapping -
 * the saved products.uber_item_id when present, otherwise the onePOS product
 * UUID - so repeated syncs UPDATE the same Uber items instead of creating
 * duplicates. Uber item ids echo back as pos_item_id on orders, which the
 * existing webhook intake already resolves against products.uber_item_id.
 *
 * Price: integer minor units (pence) computed from the onePOS selling price.
 * Availability: active+available_on_uber -> is_available true; active but not
 * offered on Uber -> published but is_available false; inactive products are
 * excluded entirely (counted as skipped). Modifiers: none published (no
 * modifier data exists in the onePOS product model today).
 * ---------------------------------------------------------------------------
 */

function uberMenuCategoryId(categoryName) {
  const slug = String(categoryName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `onepos-cat-${slug || "uncategorised"}`;
}

/**
 * Pure payload builder (exported for tests). NEVER mutates its inputs.
 *
 * @param {Array<{id,name,description,price,vat_rate,active,category_name,uber_item_id,available_on_uber}>} products
 * @param {{storeId: string, currency?: string}} meta
 */
export function buildMenuPayload(products, { storeId, currency = "GBP" } = {}) {
  void currency; // Uber menu items carry prices only; store currency is fixed by the store

  const groups = new Map();
  const published = [];
  const validationErrors = [];
  let skippedInactive = 0;
  let missingPrice = 0;

  for (const product of products || []) {
    if (!product || product.active === false) {
      skippedInactive += 1;
      continue;
    }

    const priceMinor = Math.round((Number(product.price) || 0) * 100);
    const invalidFields = [];
    if (!(Number(product.price) > 0)) {
      missingPrice += 1;
      invalidFields.push("price");
    }

    const uberItemId = String(product.uber_item_id || product.id);
    if (!String(product.name || "").trim()) invalidFields.push("title");
    if (!product.id) invalidFields.push("product_id");
    if (invalidFields.length) validationErrors.push({ productId: product.id || null, fields: invalidFields });
    const category = product.category_name || "Uncategorised";
    const categoryId = uberMenuCategoryId(category);

    if (!groups.has(categoryId)) {
      groups.set(categoryId, { id: categoryId, title: category, items: [] });
    }

    const item = {
      id: uberItemId,
      title: product.name || uberItemId,
      description: product.description || "",
      price: Math.max(priceMinor, 0),
      is_available: product.available_on_uber !== false,
      external_data: `onepos:${product.id}`,
    };

    groups.get(categoryId).items.push(item);
    published.push(item);
  }

  return {
    menus: [
      {
        id: `onepos-menu-${storeId || "store"}`,
        title: "onePOS Menu",
        service_availability: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
          day_of_week: day,
          time_periods: [{ start_time: "00:00", end_time: "23:59" }],
        })),
        categories: [...groups.values()],
      },
    ],
    _meta: {
      storeId: storeId || null,
      publishedCount: published.length,
      categoryCount: groups.size,
      skippedInactiveCount: skippedInactive,
      missingPriceCount: missingPrice,
      publishedItemIds: published.map((item) => item.id),
      validationErrors,
    },
  };
}

/*
 * Uber Eats order endpoints (Order API). NOTE: endpoint paths come from the
 * current Uber developer docs (Order API suite) - re-verify while testing in
 * the sandbox and adjust here only; nothing else in the codebase knows them.
 */
export const API_ENDPOINTS = {
  stores: "/v1/eats/stores",
  menu: (storeId) => `/v2/eats/stores/${encodeURIComponent(storeId)}/menus`,
  menuItem: (storeId, itemId) =>
    `/v2/eats/stores/${encodeURIComponent(storeId)}/menus/items/${encodeURIComponent(itemId)}`,
  accept: (orderId) => `/v1/delivery/order/${encodeURIComponent(orderId)}/accept`,
  deny: (orderId) => `/v1/delivery/order/${encodeURIComponent(orderId)}/deny`,
  cancel: (orderId) => `/v1/delivery/order/${encodeURIComponent(orderId)}/cancel`,
  deliveryStatus: (orderId) => `/v1/eats/orders/${encodeURIComponent(orderId)}/restaurantdelivery/status`,
};

/*
 * The official Uber client_credentials example requests "eats.store eats.order":
 * store discovery (Get Stores) requires eats.store, order actions use eats.order.
 */
const STORES_OAUTH_SCOPE = "eats.store eats.order";

function confirmed(action, response, extra = {}) {
  return {
    success: true,
    platform: "uber",
    action,
    simulated: false,
    httpStatus: response.httpStatus,
    data: response.data,
    ...extra,
  };
}

function rejected(action, response, { invalidOtp = false } = {}) {
  let code = response.code || "PLATFORM_CALL_FAILED";

  if (!response.code) {
    // A 4xx on the completion call is treated as an OTP rejection so the
    // order stays open for retry; server errors map to PLATFORM_CALL_FAILED.
    if (invalidOtp && response.httpStatus && response.httpStatus < 500) {
      code = "INVALID_OTP";
    } else {
      code = "PLATFORM_CALL_FAILED";
    }
  }

  const platformMessage =
    response.data && (response.data.message || response.data.error_description || response.data.error);

  return {
    success: false,
    platform: "uber",
    action,
    simulated: false,
    code,
    message: response.message || platformMessage || "The Uber API did not confirm this action",
    httpStatus: response.httpStatus,
  };
}

async function setDeliveryStatus(config, order, uberStatus, action, extraBody = {}) {
  return uberRequest({
    config,
    method: "POST",
    path: API_ENDPOINTS.deliveryStatus(order.external_order_id),
    body: { status: uberStatus, ...extraBody },
    action,
    orderId: order.id,
  });
}

const uberEatsService = {
  ...base,

  /* ------------------------- Primary Webhook ------------------------- */

  verifyWebhookSignature: verifyUberWebhookSignature,

  parseWebhookEvent: parseUberWebhookEvent,

  extractUberOrder(payload) {
    if (!payload || typeof payload !== "object") return null;

    if (payload.order && typeof payload.order === "object") {
      return payload.order;
    }

    if (payload.payload && typeof payload.payload === "object") {
      // The orders.notification envelope often carries the order itself as
      // `payload` (recognised by order-like fields) - otherwise look inside.
      if (payload.payload.order_id || payload.payload.orderId || payload.payload.items || payload.payload.eater) {
        return payload.payload;
      }

      if (payload.payload.order && typeof payload.payload.order === "object") {
        return payload.payload.order;
      }
    }

    if (payload.resource && typeof payload.resource === "object") {
      return payload.resource;
    }

    return null;
  },

  /*
   * Maps a verified `orders.notification` payload into the onePOS online-order
   * shape (same contract as the Deliveroo service). Order details may be
   * inline in the payload; when only an order id / resource_href is present
   * the item/totals section is empty and the caller records the order from
   * the id (Uber's recommended pattern is to fetch details with the Order
   * API - the caller can complete enrichment once the sandbox GET is
   * validated; nothing is invented here).
   */
  normalizeIncomingOrder(rawWebhookPayload) {
    const event = parseUberWebhookEvent(rawWebhookPayload);

    if (!event || !event.externalOrderId) {
      return null;
    }

    const order = this.extractUberOrder(rawWebhookPayload) || {};
    const customer = order.eater && typeof order.eater === "object" ? order.eater : order.customer || {};
    const rawItems = Array.isArray(order.items) ? order.items : [];
    const items = rawItems.map(normalizeUberItem).filter(Boolean);

    const fulfilmentRaw = String(
      order.fulfillment_type || order.fulfilment_type || order.eating_utensils || ""
    ).toLowerCase();

    return {
      platform: "uber",
      externalOrderId: event.externalOrderId,
      eventType: event.eventType,
      eventKind: event.eventKind,
      externalReference: order.display_id ?? order.reference ?? order.uuid ?? event.externalOrderId,
      status: order.status ? String(order.status) : null,
      storeId: event.storeId,
      userId: event.userId,
      customer: {
        name:
          customer.first_name || customer.last_name
            ? [customer.first_name, customer.last_name].filter(Boolean).join(" ")
            : customer.name ?? null,
        phone: customer.phone ?? customer.contact_number ?? null,
        otp: customer.verification_code ?? customer.otp ?? null,
      },
      fulfilmentType: fulfilmentRaw.includes("collect") || fulfilmentRaw.includes("pickup") ? "COLLECTION" : "DELIVERY",
      notes: order.notes || order.special_instructions || null,
      currency: order.currency || (order.total_price && order.total_price.currency_code) || "GBP",
      subtotal: uberMoneyToNumber(order.subtotal ?? order.sub_total),
      deliveryFee: uberMoneyToNumber(order.delivery_fee ?? order.delivery_fee_total),
      total: uberMoneyToNumber(order.total_price ?? order.total ?? order.grand_total),
      items,
      resourceHref: event.resourceHref,
      order,
      rawWebhookPayload,
    };
  },

  async acceptOrder(order, config) {
    if (!isRealApiMode(config)) return base.acceptOrder(order, config);

    const response = await uberRequest({
      config,
      method: "POST",
      path: API_ENDPOINTS.accept(order.external_order_id),
      action: "ACCEPT_ORDER",
      orderId: order.id,
    });

    return response.success
      ? confirmed("ACCEPT_ORDER", response, { externalOrderId: order.external_order_id })
      : rejected("ACCEPT_ORDER", response);
  },

  async rejectOrder(order, reason, config) {
    if (!isRealApiMode(config)) return base.rejectOrder(order, reason, config);

    const response = await uberRequest({
      config,
      method: "POST",
      path: API_ENDPOINTS.deny(order.external_order_id),
      body: {
        deny_reason: {
          info: reason || "Order denied by merchant",
          type: "OTHER",
        },
      },
      action: "REJECT_ORDER",
      orderId: order.id,
    });

    return response.success
      ? confirmed("REJECT_ORDER", response, { externalOrderId: order.external_order_id, reason: reason || null })
      : rejected("REJECT_ORDER", response);
  },

  async cancelOrder(order, reason, config) {
    if (!isRealApiMode(config)) return base.cancelOrder(order, reason, config);

    const response = await uberRequest({
      config,
      method: "POST",
      path: API_ENDPOINTS.cancel(order.external_order_id),
      body: {
        cancellation_reason: {
          info: reason || "Order cancelled by merchant",
          type: "OTHER",
        },
      },
      action: "CANCEL_ORDER",
      orderId: order.id,
    });

    return response.success
      ? confirmed("CANCEL_ORDER", response, { externalOrderId: order.external_order_id, reason: reason || null })
      : rejected("CANCEL_ORDER", response);
  },

  async markPreparing(order, config) {
    if (!isRealApiMode(config)) return base.markPreparing(order, config);

    const response = await setDeliveryStatus(config, order, "PREPARING", "MARK_PREPARING");

    return response.success
      ? confirmed("MARK_PREPARING", response, { externalOrderId: order.external_order_id })
      : rejected("MARK_PREPARING", response);
  },

  async markReady(order, config) {
    if (!isRealApiMode(config)) return base.markReady(order, config);

    const response = await setDeliveryStatus(config, order, "READY", "MARK_READY");

    return response.success
      ? confirmed("MARK_READY", response, { externalOrderId: order.external_order_id })
      : rejected("MARK_READY", response);
  },

  /*
   * MENU SYNC (OnePOS -> Uber Eats): PUT the built menu payload to the Uber
   * Menu API for the configured store (sandbox or production host depending
   * on config.environment). Read-only towards onePOS: the caller passes the
   * products; this method never touches any onePOS table. Every exchange is
   * logged to platform_api_logs by uberRequest (secrets redacted).
   */
  async syncMenu(products, config) {
    if (!isRealApiMode(config)) {
      return {
        success: false,
        platform: "uber",
        action: "MENU_SYNC",
        code: "NOT_CONFIGURED",
        message: "Uber credentials are not configured in Settings - Online Platforms",
        httpStatus: null,
        data: null,
      };
    }

    const storeId = config.store_id || config.store_location_id;

    if (!storeId) {
      return {
        success: false,
        platform: "uber",
        action: "MENU_SYNC",
        code: "STORE_NOT_MAPPED",
        message: "No Uber store is mapped for this company - save the Store ID first (Test connection / Get sandbox IDs or a store.provisioned webhook)",
        httpStatus: null,
        data: null,
      };
    }

    const payload = buildMenuPayload(products, { storeId });
    if (payload._meta.validationErrors.length) {
      return {
        success: false,
        platform: "uber",
        action: "MENU_SYNC",
        code: "INVALID_MENU_PAYLOAD",
        message: "Uber menu contains products with missing required fields",
        details: { invalidItems: payload._meta.validationErrors },
        httpStatus: null,
        data: null,
        meta: payload._meta,
      };
    }

    const response = await uberRequest({
      config,
      method: "PUT",
      path: API_ENDPOINTS.menu(storeId),
      body: { menus: payload.menus },
      action: "MENU_SYNC",
      scope: STORES_OAUTH_SCOPE,
    });

    if (!response.success) {
      return {
        success: false,
        platform: "uber",
        action: "MENU_SYNC",
        code: response.code || (response.httpStatus >= 500 ? "PLATFORM_CALL_FAILED" : "UBER_REJECTED_MENU"),
        message:
          response.message ||
          (response.data && (response.data.message || response.data.error_description || response.data.error)) ||
          `Uber did not accept the menu (HTTP ${response.httpStatus ?? "?"})`,
        httpStatus: response.httpStatus,
        data: response.data,
        meta: payload._meta,
      };
    }

    return {
      success: true,
      platform: "uber",
      action: "MENU_SYNC",
      simulated: false,
      httpStatus: response.httpStatus,
      data: response.data,
      meta: payload._meta,
    };
  },

  /*
   * Updates one item after its menu has been uploaded. Uber accepts sparse
   * updates here; price is in the store currency's minor units.
   */
  async updateMenuItem(storeId, itemId, body, config) {
    if (!isRealApiMode(config)) {
      return {
        success: false,
        platform: "uber",
        action: "UPDATE_MENU_ITEM",
        code: "NOT_CONFIGURED",
        message: "Uber credentials are not configured in Settings - Online Platforms",
        httpStatus: null,
        data: null,
      };
    }
    return uberRequest({
      config,
      method: "POST",
      path: API_ENDPOINTS.menuItem(storeId, itemId),
      body,
      action: "UPDATE_MENU_ITEM",
      scope: "eats.store",
      productId: itemId,
    });
  },

  async updateItem(storeId, itemId, body, config) {
    return this.updateMenuItem(storeId, itemId, body, config);
  },

  /*
   * Connection test / sandbox discovery: calls the official Uber Eats
   * "Get Stores" endpoint (GET /v1/eats/stores, documented under the Store
   * API suite) which lists the stores/brands the authenticated application
   * can access. Returns the raw Uber response so any rejection can be
   * diagnosed exactly. Requires the eats.store scope besides eats.order.
   */
  async getStores(config) {
    if (!isRealApiMode(config)) {
      return {
        success: false,
        platform: "uber",
        action: "GET_STORES",
        code: "NOT_CONFIGURED",
        message: "Uber credentials are not configured in Settings - Online Platforms",
        httpStatus: null,
        data: null,
      };
    }

    return uberRequest({
      config,
      method: "GET",
      path: API_ENDPOINTS.stores,
      action: "GET_STORES",
      scope: STORES_OAUTH_SCOPE,
    });
  },

  /*
   * Completion with the handover OTP.
   *
   * The OTP is sent to the Uber API together with the COMPLETING delivery
   * status update; the local order is only marked COMPLETED when Uber
   * confirms (HTTP 2xx). Any platform rejection maps to INVALID_OTP so the
   * order stays open for retry with the correct code - onePOS never decides
   * OTP validity on its own.
   *
   * NOTE: verify the exact COMPLETING status value / OTP field against the
   * current Uber Eats API docs while testing in sandbox; adjust the call in
   * setDeliveryStatus only.
   */
  async completeOrder(order, otp, config) {
    if (!isRealApiMode(config)) return base.completeOrder(order, otp, config);

    const providedOtp = String(otp === undefined || otp === null ? "" : otp).trim();

    if (!providedOtp) {
      return stubFailure(
        "uber",
        "COMPLETE_ORDER",
        "OTP_REQUIRED",
        "The platform requires the handover OTP to complete this order"
      );
    }

    const response = await setDeliveryStatus(config, order, "COMPLETING", "COMPLETE_ORDER", {
      otp: providedOtp,
    });

    if (response.success) {
      return confirmed("COMPLETE_ORDER", response, {
        externalOrderId: order.external_order_id,
        otpVerified: true,
      });
    }

    return rejected("COMPLETE_ORDER", response, { invalidOtp: true });
  },
};

export default uberEatsService;
