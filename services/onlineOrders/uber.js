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
 * NOT yet connected (still stubbed, by design - endpoints to be wired after
 * sandbox validation):
 *   - Menu sync: publish/update/unpublish product (Uber menu API
 *     PUT /v1/eats/stores/{store_id}/menus and
 *     POST /v1/eats/stores/{store_id}/menus/items/{item_id})
 *   - Webhook intake: normalizeIncomingOrder (orders.notification webhook)
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
    resource.order_id ?? resource.orderId ?? resource.uuid ?? payload.order_id ?? payload.orderId ?? null;
  const storeId = resource.store_id ?? resource.storeId ?? payload.store_id ?? payload.storeId ?? null;
  const userId = resource.user_id ?? resource.userId ?? payload.user_id ?? payload.userId ?? null;
  const resourceHref = payload.resource_href || payload.resourceHref || resource.resource_href || null;

  let eventKind = "unknown";
  const normalizedType = String(eventType).toLowerCase();
  if (normalizedType === "store.provisioned") eventKind = "store_provisioned";
  else if (normalizedType === "store.deprovisioned") eventKind = "store_deprovisioned";
  else if (normalizedType === "orders.notification" || normalizedType.startsWith("orders."))
    eventKind = externalOrderId ? "order_new" : "order_event";

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
 * Uber Eats order endpoints (Order API). NOTE: endpoint paths come from the
 * current Uber developer docs (Order API suite) - re-verify while testing in
 * the sandbox and adjust here only; nothing else in the codebase knows them.
 */
const API_ENDPOINTS = {
  stores: "/v1/eats/stores",
  accept: (orderId) => `/v1/eats/orders/${encodeURIComponent(orderId)}/accept_pos_order`,
  deny: (orderId) => `/v1/eats/orders/${encodeURIComponent(orderId)}/deny_pos_order`,
  cancel: (orderId) => `/v1/eats/orders/${encodeURIComponent(orderId)}/cancel`,
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
      body: reason ? { reason } : null,
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
      body: reason ? { reason } : null,
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
