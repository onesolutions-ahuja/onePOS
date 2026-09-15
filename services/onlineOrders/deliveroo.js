/*
 * Deliveroo integration service.
 *
 * Placeholder for the Deliveroo Order API (all platform calls remain stubs -
 * see platformServiceBase.js). Deliveroo-specific code that IS implemented:
 *   - webhook event verification/parsing used by
 *     POST /api/online/deliveroo/webhook (routes/online.js), including
 *     HMAC-SHA256 signature verification with the webhook secret stored in
 *     Settings -> Online Platforms -> Deliveroo.
 *
 * No Deliveroo API endpoints are called or invented - outbound calls stay
 * stubbed until the Deliveroo Order API is connected.
 */

import crypto from "crypto";
import { createPlatformService } from "./platformServiceBase.js";

const base = createPlatformService({ platform: "deliveroo", displayName: "Deliveroo" });

/*
 * Verifies a Deliveroo webhook signature: HMAC-SHA256 over the RAW request
 * body using the partner webhook secret, delivered in the
 * "X-Deliveroo-Signature" header (hex; a "sha256=" prefix is tolerated).
 * Uses a timing-safe comparison. NOTE: the exact header name/format should
 * be confirmed against the first real sandbox events - every webhook request
 * is stored in platform_api_logs, and this is the only place to adjust.
 */
export function verifyWebhookSignature(rawBody, signatureHeader, webhookSecret) {
  if (!webhookSecret || !signatureHeader) {
    return false;
  }

  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const provided = String(signatureHeader).trim();
  const normalized = provided.toLowerCase().startsWith("sha256=") ? provided.slice(7) : provided;

  let actual;
  try {
    actual = Buffer.from(normalized, "hex");
  } catch {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

/*
 * Verifies a CURRENT Deliveroo webhook signature (Order Events / Rider Events
 * and every non-legacy callback). Deliveroo sends two headers:
 *
 *   X-Deliveroo-Sequence-Guid  -> sequential GUID
 *   X-Deliveroo-Hmac-Sha256    -> signature (lowercase hex)
 *
 * and computes the signature, per Deliveroo's "Securing Webhooks" guide, as
 *
 *   HMAC-SHA256(webhook_secret, sequenceGuid + " " + <raw request body bytes>)
 *
 * The legacy POS (new_order / cancel_order) callbacks use the same scheme with
 * " \n " (space, newline, space) as the separator, so both variants are tried.
 * The RAW body bytes are used directly - never a re-serialised object.
 *
 * Returns the matched variant ("guid_space" | "guid_newline") or null. The
 * secret itself is never returned or logged.
 */
export function verifySequenceGuidSignature(rawBody, sequenceGuid, hmacHeader, webhookSecret) {
  if (!webhookSecret || !sequenceGuid || !hmacHeader) {
    return null;
  }

  const provided = String(hmacHeader).trim();
  const normalized = provided.toLowerCase().startsWith("sha256=") ? provided.slice(7) : provided;

  const actual = Buffer.from(normalized, "hex");
  if (!actual.length) {
    return null;
  }

  const guid = String(sequenceGuid);

  for (const [variant, separator] of [
    ["guid_space", " "],
    ["guid_newline", " \n "],
  ]) {
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(guid)
      .update(separator)
      .update(rawBody)
      .digest();

    if (expected.length === actual.length && crypto.timingSafeEqual(actual, expected)) {
      return variant;
    }
  }

  return null;
}

/*
 * Extracts the event type and external order id from a Deliveroo webhook
 * payload WITHOUT inventing a fixed schema. The first real sandbox events
 * are stored verbatim in platform_api_logs / online_order_events; field
 * mapping is refined from those, never guessed ahead of time.
 */
export function parseWebhookEvent(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const rawEvent =
    rawPayload.event ??
    rawPayload.event_type ??
    rawPayload.eventType ??
    rawPayload.type ??
    (rawPayload.data && typeof rawPayload.data === "object"
      ? rawPayload.data.event ?? rawPayload.data.event_type
      : undefined) ??
    null;

  const orderSource =
    rawPayload.order && typeof rawPayload.order === "object"
      ? rawPayload.order
      : rawPayload.data && typeof rawPayload.data === "object"
        ? rawPayload.data
        : rawPayload;

  const rawOrderId =
    orderSource.order_id ??
    orderSource.orderId ??
    orderSource.id ??
    rawPayload.order_id ??
    rawPayload.orderId ??
    null;

  const eventType = rawEvent === undefined || rawEvent === null ? null : String(rawEvent);
  const externalOrderId = rawOrderId === undefined || rawOrderId === null ? null : String(rawOrderId);

  if (!eventType && !externalOrderId) {
    return null;
  }

  return { eventType, externalOrderId };
}

const deliverooService = {
  ...base,

  verifyWebhookSignature,

  verifySequenceGuidSignature,

  parseWebhookEvent,

  /*
   * Stable interface hook (platformServiceBase contract): maps a raw webhook
   * payload into the onePOS online-order shape. Returns null when the payload
   * is not recognised as an order event - only the fields actually present in
   * the payload are returned; nothing is invented.
   */
  normalizeIncomingOrder(rawWebhookPayload) {
    const event = parseWebhookEvent(rawWebhookPayload);

    if (!event || !event.externalOrderId) {
      return null;
    }

    return {
      platform: "deliveroo",
      externalOrderId: event.externalOrderId,
      eventType: event.eventType,
      rawWebhookPayload,
    };
  },
};

export default deliverooService;
