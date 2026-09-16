/*
 * Online platform service base (Uber Eats / Deliveroo)
 *
 * Defines the contract every delivery-platform integration implements.
 * NO real external API calls are made yet - every method is a clearly-marked
 * stub that simulates the platform response so the online-order lifecycle can
 * run end-to-end before credentials/webhooks exist.
 *
 * STABLE INTERFACE (positional arguments):
 *   publishProduct(product, config)              -> platformResponse
 *   updateProduct(product, config)               -> platformResponse
 *   unpublishProduct(product, config)            -> platformResponse
 *   normalizeIncomingOrder(rawWebhookPayload)    -> normalized order | null
 *   acceptOrder(order, config)                   -> platformResponse
 *   rejectOrder(order, reason, config)           -> platformResponse
 *   cancelOrder(order, reason, config)           -> platformResponse
 *   markPreparing(order, config)                 -> platformResponse
 *   markReady(order, config)                     -> platformResponse
 *   completeOrder(order, otp, config)            -> platformResponse
 *
 * `config` is the decrypted Settings configuration for the company+platform
 * (see platformConfig.js): { platform, enabled, environment, client_id,
 * client_secret, store_location_id, api_key, webhook_secret, notes }.
 *
 * platformResponse contract:
 *   { success: boolean, platform, action, simulated: boolean,
 *     code?: string, message?: string, ... }
 *
 * IMPORTANT: the ORDER LIFECYCLE never decides validity itself - it only
 * trusts platformResponse.success. In particular the completion OTP is
 * validated BY THE PLATFORM (the stub simulates that validation today; the
 * real Uber API will do it tomorrow) without changing any signature above.
 */

export function stubResponse(platform, action, extra = {}) {
  return {
    success: true,
    platform,
    action,
    simulated: true, // Marks this as a stub until real API integration is added
    mode: "STUB_NO_REAL_API",
    ...extra,
  };
}

export function stubFailure(platform, action, code, message) {
  return {
    success: false,
    platform,
    action,
    simulated: true,
    code,
    message,
  };
}

/* Configuration gate: a disabled platform never confirms platform actions. */
export function checkEnabled(platform, action, config) {
  if (config && config.enabled === false) {
    return stubFailure(
      platform,
      action,
      "PLATFORM_DISABLED",
      `${platform} integration is disabled in Settings`
    );
  }

  return null;
}

export function createPlatformService({ platform, displayName }) {
  return {
    platform,
    displayName,

    /*
     * Whether the stored Settings configuration holds enough credentials for
     * a real integration (checked against the decrypted runtime config).
     */
    isConfigured(config) {
      return Boolean(config && config.configured);
    },

    /* -------- Product catalogue (publish / update / unpublish) -------- */

    async publishProduct(product, config) {
      const disabled = checkEnabled(platform, "PUBLISH_PRODUCT", config);
      if (disabled) return disabled;

      // TODO: real API - create/update menu item using config.client_id etc.
      return stubResponse(platform, "PUBLISH_PRODUCT", {
        externalItemId: `${platform.toUpperCase()}_ITEM_STUB_${product.id}`,
        environment: config ? config.environment : null,
        storeLocationId: config ? config.store_location_id : null,
        product: { id: product.id, name: product.name, price: product.price },
        availability: {
          uber: product.availableOnUber === true,
          deliveroo: product.availableOnDeliveroo === true,
        },
      });
    },

    async updateProduct(product, config) {
      const disabled = checkEnabled(platform, "UPDATE_PRODUCT", config);
      if (disabled) return disabled;

      // TODO: real API - push price/availability changes
      return stubResponse(platform, "UPDATE_PRODUCT", {
        product: { id: product.id, name: product.name, price: product.price },
        environment: config ? config.environment : null,
      });
    },

    async unpublishProduct(product, config) {
      const disabled = checkEnabled(platform, "UNPUBLISH_PRODUCT", config);
      if (disabled) return disabled;

      // TODO: real API - remove/mark item unavailable
      return stubResponse(platform, "UNPUBLISH_PRODUCT", {
        product: { id: product.id, name: product.name },
        environment: config ? config.environment : null,
      });
    },

    /*
     * Order acceptance mode sync - ARCHITECTURE PLACEHOLDER ONLY.
     *
     * The acceptance mode ("manual" | "auto") is stored locally today
     * (Settings -> Online Platforms) and applied by the online-order receive
     * flow. When Uber exposes an OFFICIAL configuration API for order
     * acceptance, the platform-specific sync is implemented here (uber.js /
     * deliveroo.js override). No Uber endpoint is called or invented yet.
     */
    async syncOrderAcceptanceMode(mode /* "manual" | "auto" */, config) {
      return stubResponse(platform, "SYNC_ORDER_ACCEPTANCE", {
        mode: mode === "auto" ? "auto" : "manual",
        synced: false,
        note: "Local-only setting; platform sync pending an official Uber configuration API",
        environment: config ? config.environment : null,
      });
    },

    /* ------------------------- Incoming orders ------------------------ */

    /*
     * Maps a raw platform webhook payload into the onePOS online-order shape:
     * { externalOrderId, platform, customer, otp,
     *   items: [{ externalItemId, productId, quantity, unitPrice }], totals }
     * Returns null when the payload is not recognised.
     */
    normalizeIncomingOrder(/* rawWebhookPayload */) {
      // TODO: real API - parse webhook payload (signature verified with
      // config.webhook_secret) and map items via external item ids.
      return null;
    },

    /* ------------------------- Order lifecycle ------------------------ */

    async acceptOrder(order, config) {
      const disabled = checkEnabled(platform, "ACCEPT_ORDER", config);
      if (disabled) return disabled;

      // TODO: real API - accept order on the platform
      return stubResponse(platform, "ACCEPT_ORDER", {
        externalOrderId: order.external_order_id,
        environment: config ? config.environment : null,
      });
    },

    async rejectOrder(order, reason, config) {
      const disabled = checkEnabled(platform, "REJECT_ORDER", config);
      if (disabled) return disabled;

      // TODO: real API - reject order on the platform
      return stubResponse(platform, "REJECT_ORDER", {
        externalOrderId: order.external_order_id,
        reason: reason || null,
        environment: config ? config.environment : null,
      });
    },

    async cancelOrder(order, reason, config) {
      const disabled = checkEnabled(platform, "CANCEL_ORDER", config);
      if (disabled) return disabled;

      // TODO: real API - cancel order on the platform
      return stubResponse(platform, "CANCEL_ORDER", {
        externalOrderId: order.external_order_id,
        reason: reason || null,
        environment: config ? config.environment : null,
      });
    },

    async markPreparing(order, config) {
      const disabled = checkEnabled(platform, "MARK_PREPARING", config);
      if (disabled) return disabled;

      // TODO: real API - update order preparation state
      return stubResponse(platform, "MARK_PREPARING", {
        externalOrderId: order.external_order_id,
        environment: config ? config.environment : null,
      });
    },

    async markReady(order, config) {
      const disabled = checkEnabled(platform, "MARK_READY", config);
      if (disabled) return disabled;

      // TODO: real API - mark order ready for handover
      return stubResponse(platform, "MARK_READY", {
        externalOrderId: order.external_order_id,
        environment: config ? config.environment : null,
      });
    },

    /*
     * Completion / OTP.
     *
     * Signature (stable): completeOrder(order, otp, config).
     *
     * The REAL implementation will send the handover OTP to the platform API
     * and map its response: platform confirms -> success: true; platform
     * rejects -> success: false with code "INVALID_OTP". onePOS never decides
     * on its own whether an OTP is correct.
     *
     * The STUB simulates that platform-side validation using the OTP that was
     * recorded on the order when it was received (order.otp_code):
     *   - no OTP provided              -> OTP_REQUIRED
     *   - order has a known code and
     *     it does not match            -> INVALID_OTP
     *   - otherwise (incl. orders
     *     received without an OTP)     -> confirmed
     */
    async completeOrder(order, otp, config) {
      const disabled = checkEnabled(platform, "COMPLETE_ORDER", config);
      if (disabled) return disabled;

      const providedOtp = String(otp === undefined || otp === null ? "" : otp).trim();

      /*
       * OTP handling mirrors the real platform contract:
       *   - order has no OTP recorded AND none provided -> nothing to verify,
       *     completion confirms ("Require customer OTP" = NO flow)
       *   - order has an OTP recorded but none provided -> OTP_REQUIRED
       *   - provided OTP does not match the recorded one -> INVALID_OTP
       */
      if (!providedOtp && !order.otp_code) {
        return stubResponse(platform, "COMPLETE_ORDER", {
          externalOrderId: order.external_order_id,
          otpVerified: false,
          environment: config ? config.environment : null,
        });
      }

      if (!providedOtp) {
        return stubFailure(platform, "COMPLETE_ORDER", "OTP_REQUIRED", "The platform requires the handover OTP to complete this order");
      }

      if (order.otp_code && providedOtp !== order.otp_code) {
        return stubFailure(platform, "COMPLETE_ORDER", "INVALID_OTP", "The platform rejected the OTP for this order");
      }

      // TODO: real API - confirm handover/completion with the OTP
      return stubResponse(platform, "COMPLETE_ORDER", {
        externalOrderId: order.external_order_id,
        otpVerified: true,
        environment: config ? config.environment : null,
      });
    },
  };
}
