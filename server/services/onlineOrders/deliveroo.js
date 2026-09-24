/*
 * Deliveroo integration service.
 *
 * Placeholder for the Deliveroo Order API (all outbound platform calls remain
 * stubs - see platformServiceBase.js). Deliveroo-specific code that IS
 * implemented:
 *   - webhook event verification/parsing used by
 *     POST /api/online/deliveroo/webhook (routes/online.js), including
 *     HMAC-SHA256 signature verification with the webhook secret stored in
 *     Settings -> Online Platforms -> Deliveroo.
 *   - normalizeIncomingOrder(): maps a real "order.new" / "order.status_update"
 *     webhook (body.order shape observed in production) into the onePOS
 *     online-order shape, preserving every Deliveroo identifier, item,
 *     modifier and price. A missing onePOS product mapping never fails intake.
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
 *
 * Real Deliveroo Order Events (production, observed) are shaped
 *
 *   { "event": "order.new" | "order.status_update", "body": { "order": { "id": ... } }
 *
 * so "body.order" is inspected as well as the flatter shapes kept for the
 * legacy POS callbacks / manual test posts.
 */
export function parseWebhookEvent(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const body = rawPayload.body && typeof rawPayload.body === "object" ? rawPayload.body : null;

  const rawEvent =
    rawPayload.event ??
    (body ? body.event : undefined) ??
    rawPayload.event_type ??
    rawPayload.eventType ??
    rawPayload.type ??
    (rawPayload.data && typeof rawPayload.data === "object"
      ? rawPayload.data.event ?? rawPayload.data.event_type
      : undefined) ??
    null;

  const orderSource =
    body && body.order && typeof body.order === "object"
      ? body.order
      : rawPayload.order && typeof rawPayload.order === "object"
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

  return {
    eventType,
    externalOrderId,
    eventKind: classifyDeliverooEvent(eventType),
  };
}

/*
 * Classifies a Deliveroo event name into one of the event kinds the
 * webhook intake acts on. Deliveroo sends dotted event names such as
 * "order.new" / "order.status_update"; the legacy POS callbacks use
 * "new_order" / "status_update". Anything unrecognised is "other" and is
 * only recorded, never acted on.
 */
export function classifyDeliverooEvent(eventType) {
  const normalized = String(eventType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "other";
  }

  if (normalized === "order_new" || normalized === "new_order") {
    return "order_new";
  }

  if (normalized === "order_status_update" || normalized === "status_update") {
    return "order_status_update";
  }

  return "other";
}

/*
 * Returns the Deliveroo order object from a webhook payload, whatever shape
 * it arrived in (body.order for real Order Events, order/data for the
 * legacy callbacks). Returns null when no order object is present.
 */
export function extractDeliverooOrder(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    return null;
  }

  const candidates = [
    rawPayload.body && rawPayload.body.order,
    rawPayload.order,
    rawPayload.data && rawPayload.data.order,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

/*
 * Deliveroo amounts are Money objects: { fractional, currency_code } where
 * fractional is the amount in the currency's minor unit (pence for GBP).
 * Converts to a major-unit number; falls back to a plain numeric value or 0
 * so a malformed amount never breaks order intake.
 */
export function deliverooMoneyToNumber(money) {
  if (money === null || money === undefined) {
    return 0;
  }

  if (typeof money === "number") {
    return Number.isFinite(money) ? money : 0;
  }

  if (typeof money === "string") {
    const parsed = Number(money);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof money === "object") {
    if (money.fractional !== undefined && money.fractional !== null) {
      const fractional = Number(money.fractional);
      return Number.isFinite(fractional) ? fractional / 100 : 0;
    }

    if (money.amount !== undefined) {
      return deliverooMoneyToNumber(money.amount);
    }

    if (money.value !== undefined) {
      return deliverooMoneyToNumber(money.value);
    }
  }

  return 0;
}

/*
 * Normalises a single Deliveroo order item, preserving EVERY Deliveroo
 * identifier (pos_item_id / PLU), display name, operational name, quantity,
 * modifiers and prices so nothing is discarded and the mapping UI can be
 * built later. Modifiers are stored verbatim (name, pos_item_id, quantity,
 * prices).
 */
function normalizeDeliverooItem(rawItem) {
  if (!rawItem || typeof rawItem !== "object") {
    return null;
  }

  const quantity = Number(rawItem.quantity);
  const unitPrice = deliverooMoneyToNumber(rawItem.unit_price ?? rawItem.menu_unit_price);
  const totalPrice = deliverooMoneyToNumber(rawItem.total_price);

  const modifiers = Array.isArray(rawItem.modifiers)
    ? rawItem.modifiers
        .filter((modifier) => modifier && typeof modifier === "object")
        .map((modifier) => ({
          name: modifier.name ?? null,
          operationalName: modifier.operational_name ?? null,
          posItemId: modifier.pos_item_id ?? modifier.posItemId ?? modifier.item_id ?? null,
          quantity: modifier.quantity === undefined || modifier.quantity === null ? 1 : Number(modifier.quantity),
          unitPrice: deliverooMoneyToNumber(modifier.unit_price),
          totalPrice: deliverooMoneyToNumber(modifier.total_price),
          raw: modifier,
        }))
    : [];

  return {
    name: rawItem.name ?? rawItem.operational_name ?? null,
    operationalName: rawItem.operational_name ?? null,
    posItemId:
      rawItem.pos_item_id ?? rawItem.posItemId ?? rawItem.item_id ?? rawItem.plu ?? rawItem.sku ?? null,
    plu: rawItem.plu ?? null,
    sku: rawItem.sku ?? null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitPrice,
    totalPrice: totalPrice || Number((unitPrice * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1)).toFixed(2)),
    discountAmount: deliverooMoneyToNumber(rawItem.discount_amount),
    currency: (rawItem.unit_price && rawItem.unit_price.currency_code) || null,
    modifiers,
    raw: rawItem,
  };
}

const deliverooService = {
  ...base,

  verifyWebhookSignature,

  verifySequenceGuidSignature,

  parseWebhookEvent,

  classifyDeliverooEvent,

  extractDeliverooOrder,

  deliverooMoneyToNumber,

  /*
   * Stable interface hook (platformServiceBase contract): maps a raw webhook
   * payload into the onePOS online-order shape. Returns null when the payload
   * is not recognised as an order event - only the fields actually present in
   * the payload are returned; nothing is invented.
   *
   * Items are mapped ONE-TO-ONE from the Deliveroo payload. A missing onePOS
   * product mapping is NOT a failure: the item is still returned, carrying its
   * Deliveroo identifiers, and flagged so the caller can record it as unmapped
   * instead of discarding it.
   */
  normalizeIncomingOrder(rawWebhookPayload) {
    const event = parseWebhookEvent(rawWebhookPayload);

    if (!event || !event.externalOrderId) {
      return null;
    }

    const order = extractDeliverooOrder(rawWebhookPayload);
    const customer = order && order.customer && typeof order.customer === "object" ? order.customer : {};

    const rawItems = order && Array.isArray(order.items) ? order.items : [];
    const items = rawItems.map(normalizeDeliverooItem).filter(Boolean);

    const currency =
      (order && order.total_price && order.total_price.currency_code) ||
      (order && order.subtotal && order.subtotal.currency_code) ||
      "GBP";

    return {
      platform: "deliveroo",
      externalOrderId: event.externalOrderId,
      eventType: event.eventType,
      eventKind: event.eventKind,
      externalReference:
        order && (order.display_id ?? order.order_number) !== undefined &&
        (order.display_id ?? order.order_number) !== null
          ? String(order.display_id ?? order.order_number)
          : null,
      status: order && order.status ? String(order.status) : null,
      locationId: order && order.location_id ? String(order.location_id) : null,
      customer: {
        name: customer.name ?? customer.first_name ?? null,
        phone: customer.contact_number ?? customer.phone ?? null,
        // Deliveroo sends the handover/access code on the customer object; the
        // existing online-order model stores it in otp_code and onePOS NEVER
        // validates the OTP itself (the platform does, at completion time).
        otp: customer.contact_access_code ?? null,
        accessCode: customer.contact_access_code ?? null,
      },
      fulfilmentType:
        order && order.fulfillment_type
          ? String(order.fulfillment_type).toLowerCase() === "collection"
            ? "COLLECTION"
            : "DELIVERY"
          : "DELIVERY",
      notes:
        order && (order.order_notes || order.cutlery_notes)
          ? [order.order_notes, order.cutlery_notes].filter(Boolean).join(" | ")
          : null,
      currency,
      subtotal: deliverooMoneyToNumber(order && order.subtotal),
      deliveryFee: deliverooMoneyToNumber(order && order.delivery_fee),
      total: deliverooMoneyToNumber(order && order.total_price),
      items,
      order,
      rawWebhookPayload,
    };
  },
};

export default deliverooService;
