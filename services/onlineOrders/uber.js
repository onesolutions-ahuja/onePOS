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

import { createPlatformService, stubFailure } from "./platformServiceBase.js";
import { isRealApiMode, uberRequest } from "./uberClient.js";

const base = createPlatformService({ platform: "uber", displayName: "Uber Eats" });

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
