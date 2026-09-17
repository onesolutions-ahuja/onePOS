/*
 * T9Q-NEXT - WhatsApp invoice delivery service (async, never-throw).
 *
 * Hooks the existing completed-sale event: routes/sales.js calls
 * dispatchWhatsAppInvoiceDelivery fire-and-forget AFTER the sale commits
 * (mirroring the T9G integration-dispatch precedent), so a WhatsApp failure
 * can never block or fail the POS sale.
 *
 * Modes (per-company settings):
 *  - delivery_mode "link" (default): sends the T9P secure invoice link
 *    (createInvoiceDeliveryLink + buildInvoiceDeliveryMessage).
 *  - delivery_mode "pdf": renders the receipt PDF (utils/invoicePdf.js),
 *    uploads it to WhatsApp media (POST /{phone-number-id}/media) and sends
 *    it as a document message - no public URL required. Falls back to link
 *    mode if the upload fails.
 *
 * Tenant safety & privacy:
 *  - Everything is scoped by companyId (+ storeId when present).
 *  - The internal sale ID NEVER appears in a customer-facing URL: links are
 *    always the opaque /i/<token> form; the PDF is uploaded to WhatsApp.
 *  - Logging uses the existing audit_logs: outcome, mode, HTTP status,
 *    duration, masked recipient, short error - never the access token,
 *    never the message body, never the full phone number.
 */
import { createInvoiceDeliveryLink, buildInvoiceDeliveryMessage } from "./secureInvoiceLinks.js";
import { buildInvoicePdf } from "../utils/invoicePdf.js";
import { decryptSecret } from "./onlineOrders/platformConfig.js";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const GRAPH_TIMEOUT_MS = 10000;

/**
 * Normalise a phone number to the digits-only E.164 form WhatsApp expects.
 * Deterministic rules:
 *   - strip everything except digits and a leading "+"
 *   - a leading "00" international prefix is dropped
 *   - a leading national "0" is replaced with the default country code
 *   - without "+" or "0", a <=10-digit number gets the country code prepended
 * Returns null for anything unusable.
 */
export function normalizeWhatsAppPhone(rawPhone, defaultCountryCode = null) {
  const raw = String(rawPhone || "").trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  const countryCode = String(defaultCountryCode || "").replace(/\D/g, "");
  if (countryCode) {
    if (digits.startsWith("0")) {
      digits = countryCode + digits.slice(1);
    } else if (!hasPlus && digits.length <= 10 && !digits.startsWith(countryCode)) {
      digits = countryCode + digits;
    }
  }
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Masked recipient for logging - never the full number. */
function maskPhone(phone) {
  return phone && phone.length > 4 ? `.....${phone.slice(-4)}` : ".....";
}

/** Load + decrypt the WhatsApp runtime config for one company (or null). */
async function loadWhatsAppRuntime(db, companyId) {
  const result = await db(
    `SELECT active, configuration FROM integrations
     WHERE company_id = $1 AND provider = 'whatsapp' LIMIT 1`,
    [companyId]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  const configuration = row.configuration || {};
  return {
    enabled: row.active === true,
    configuration,
    accessToken: decryptSecret(configuration.access_token),
    phoneNumberId: configuration.phone_number_id || null,
  };
}

/** One WhatsApp Cloud API JSON POST. Returns { ok, httpStatus, body?, errorText? }. */
async function graphPostJson({ path, accessToken, payload }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const response = await fetch(`${GRAPH_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        httpStatus: response.status,
        errorText: body?.error?.message || `WhatsApp API returned HTTP ${response.status}`,
      };
    }
    return { ok: true, httpStatus: response.status, body };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      errorText:
        error && error.name === "AbortError"
          ? "WhatsApp API request timed out"
          : "WhatsApp API request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upload a PDF to WhatsApp media (POST /{phone-number-id}/media).
 * Uses Node's built-in FormData/Blob - no new dependencies.
 * Returns { ok, mediaId?, httpStatus, errorText? }.
 */
async function uploadWhatsAppMedia({ phoneNumberId, accessToken, pdfBytes, filename }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" }), filename);
    const response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body?.id) {
      return {
        ok: false,
        httpStatus: response.status,
        errorText: body?.error?.message || `WhatsApp media upload failed (HTTP ${response.status})`,
      };
    }
    return { ok: true, httpStatus: response.status, mediaId: body.id };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      errorText:
        error && error.name === "AbortError"
          ? "WhatsApp media upload timed out"
          : "WhatsApp media upload failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Tenant-scoped sale + customer + company load for delivery. Returns null when not found/not owned. */
async function loadSaleForDelivery(db, { saleId, companyId, storeId }) {
  const saleResult = await db(
    `SELECT s.id, s.receipt_number, s.subtotal, s.tax, s.discount, s.total,
            s.created_at, s.completed_at, s.customer_id,
            c.currency AS company_currency, c.timezone AS company_timezone
     FROM sales s
     INNER JOIN companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.company_id = $2 ${storeId ? "AND s.store_id = $3" : ""}
     LIMIT 1`,
    storeId ? [saleId, companyId, storeId] : [saleId, companyId]
  );
  const sale = saleResult.rows[0];
  if (!sale) return null;

  const itemsResult = await db(
    `SELECT product_name, quantity, unit_price, tax, total
     FROM sale_items WHERE sale_id = $1 ORDER BY id ASC`,
    [sale.id]
  );
  const paymentsResult = await db(
    `SELECT payment_method, amount FROM payments WHERE sale_id = $1 ORDER BY created_at ASC`,
    [sale.id]
  );

  let customer = null;
  if (sale.customer_id) {
    const customerResult = await db(
      `SELECT name, phone FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [sale.customer_id, companyId]
    );
    customer = customerResult.rows[0] || null;
  }

  const companyResult = await db(
    `SELECT name, email, phone, currency, timezone FROM companies WHERE id = $1 LIMIT 1`,
    [companyId]
  );

  return {
    sale: {
      id: sale.id,
      receiptNumber: sale.receipt_number,
      createdAt: sale.created_at,
      completedAt: sale.completed_at,
      subtotal: Number(sale.subtotal) || 0,
      tax: Number(sale.tax) || 0,
      discount: Number(sale.discount) || 0,
      total: Number(sale.total) || 0,
      companyCurrency: sale.company_currency,
      companyTimezone: sale.company_timezone,
      items: itemsResult.rows.map((item) => ({
        name: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        tax: Number(item.tax),
        total: Number(item.total),
      })),
      payments: paymentsResult.rows.map((payment) => ({
        method: payment.payment_method,
        amount: Number(payment.amount),
      })),
    },
    customer,
    company: companyResult.rows[0] || null,
  };
}

/** Best-effort audit logging - delivery must survive logging failures too. Never logs secrets or message bodies. */
async function logDeliveryOutcome(
  db,
  {
    companyId,
    userId,
    saleId,
    outcome,
    trigger, // "auto" | "manual_resend" | "test_send"
    deliveryMode,
    httpStatus,
    durationMs,
    recipientMasked,
    providerMessageId,
    reason,
    error,
  }
) {
  try {
    await db(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'sale', $4, $5)`,
      [
        companyId,
        userId ?? null,
        "whatsapp_invoice_delivery",
        saleId,
        JSON.stringify({
          outcome,
          trigger: trigger ?? "auto",
          trigger: trigger ?? "auto",
          delivery_mode: deliveryMode ?? null,
          http_status: httpStatus ?? null,
          duration_ms: durationMs ?? null,
          recipient_masked: recipientMasked ?? null,
          provider_message_id: providerMessageId ?? null,
          reason: reason ?? null,
          error: error ?? null,
        }),
      ]
    );
  } catch {
    /* logging is best-effort by design */
  }
}

/**
 * Build the link-mode message payload via the T9P delivery contract.
 * The URL is always the opaque /i/<token> form - never a sale ID.
 */
async function buildLinkSendPayload(db, { saleData, saleId, companyId, storeId, userId, phone, testMode }) {
  const link = await createInvoiceDeliveryLink({
    db,
    saleId,
    companyId,
    storeId,
    createdBy: userId,
    expiryDays: testMode ? 1 : undefined, // test links expire after one day
  });
  if (!link.ok) {
    return { ok: false, errorText: link.message || "secure link creation failed" };
  }
  const baseMessage = buildInvoiceDeliveryMessage({
    url: link.url,
    invoiceNumber: saleData.sale.receiptNumber || undefined,
    expiresAt: link.expiresAt,
  });
  const message = testMode ? `[TEST - demo delivery]\n${baseMessage}` : baseMessage;
  return {
    ok: true,
    url: link.url,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { preview_url: true, body: message },
    },
  };
}

/**
 * Send the invoice through WhatsApp in the requested mode. PDF uploads that
 * fail fall back to link mode automatically. Never throws.
 *
 * @returns {Promise<{ok: boolean, outcome: "sent"|"failed", deliveryMode: string,
 *   providerMessageId: string|null, errorText: string|null, durationMs: number,
 *   pdfFallback: boolean, linkUrl: string|null>}
 */
async function deliverInvoiceViaWhatsApp(db, { saleData, runtime, phone, deliveryMode, testMode, saleId, companyId, storeId, userId, trigger }) {
  const startedAt = Date.now();
  let sendOutcome = null;
  let effectiveMode = "link";
  let pdfFallback = false;
  let linkUrl = null;

  if (deliveryMode === "pdf") {
    const pdfBytes = buildInvoicePdf({
      sale: saleData.sale,
      company: saleData.company
        ? { name: saleData.company.name, email: saleData.company.email, phone: saleData.company.phone }
        : null,
      store: null,
    });
    const filename = `Receipt-${String(saleData.sale.receiptNumber || saleId).replace(/[^\w.-]/g, "")}.pdf`;
    const upload = await uploadWhatsAppMedia({
      phoneNumberId: runtime.phoneNumberId,
      accessToken: runtime.accessToken,
      pdfBytes,
      filename,
    });
    if (upload.ok) {
      effectiveMode = "pdf";
      const caption = testMode
        ? `[TEST] Your receipt from ${saleData.company?.name || "our store"}. Thank you for your purchase.`
        : `Your receipt from ${saleData.company?.name || "our store"}. Thank you for your purchase.`;
      sendOutcome = await graphPostJson({
        path: `/${runtime.phoneNumberId}/messages`,
        accessToken: runtime.accessToken,
        payload: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: phone,
          type: "document",
          document: { id: upload.mediaId, filename, caption },
        },
      });
    } else {
      // PDF upload failed - fall back to the secure link so delivery survives.
      pdfFallback = true;
    }
  }

  if (!sendOutcome) {
    const built = await buildLinkSendPayload(db, {
      saleData,
      saleId,
      companyId,
      storeId,
      userId,
      phone,
      testMode,
    });
    if (!built.ok) {
      return {
        ok: false,
        outcome: "failed",
        deliveryMode: deliveryMode === "pdf" && pdfFallback ? "link" : deliveryMode,
        providerMessageId: null,
        errorText: built.errorText,
        durationMs: Date.now() - startedAt,
        pdfFallback,
        linkUrl: null,
      };
    }
    linkUrl = built.url;
    sendOutcome = await graphPostJson({
      path: `/${runtime.phoneNumberId}/messages`,
      accessToken: runtime.accessToken,
      payload: built.payload,
    });
    effectiveMode = "link";
  }

  const providerMessageId = sendOutcome.ok ? sendOutcome.body?.messages?.[0]?.id ?? null : null;
  return {
    ok: sendOutcome.ok,
    outcome: sendOutcome.ok ? "sent" : "failed",
    deliveryMode: effectiveMode,
    providerMessageId,
    errorText: sendOutcome.errorText ?? null,
    durationMs: Date.now() - startedAt,
    pdfFallback,
    linkUrl,
  };
}

/**
 * Fire-and-forget WhatsApp invoice delivery for a completed sale.
 * Called by routes/sales.js AFTER the sale commits. NEVER throws; never
 * blocks the caller. WhatsApp problems can never fail the POS sale.
 *
 * @returns {Promise<{ok: boolean, outcome: "sent"|"skipped"|"failed", reason?}>}
 */
export async function dispatchWhatsAppInvoiceDelivery({ db, saleId, companyId, storeId = null, userId = null }) {
  const startedAt = Date.now();
  const logContext = { companyId, userId, saleId };
  try {
    const runtime = await loadWhatsAppRuntime(db, companyId);
    if (!runtime) {
      return { ok: false, outcome: "skipped", reason: "not_configured" };
    }
    if (!runtime.enabled) {
      return { ok: false, outcome: "skipped", reason: "disabled" };
    }
    if (runtime.configuration.auto_send_enabled !== true) {
      return { ok: false, outcome: "skipped", reason: "auto_send_disabled" };
    }
    if (!runtime.accessToken || !runtime.phoneNumberId) {
      await logDeliveryOutcome(db, { ...logContext, outcome: "skipped", reason: "not_configured" });
      return { ok: false, outcome: "skipped", reason: "not_configured" };
    }

    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) {
      return { ok: false, outcome: "skipped", reason: "sale_not_found" };
    }

    const customerPhone = normalizeWhatsAppPhone(
      saleData.customer?.phone,
      runtime.configuration.default_country_code || null
    );
    if (!customerPhone) {
      await logDeliveryOutcome(db, { ...logContext, outcome: "skipped", reason: "no_customer_phone" });
      return { ok: false, outcome: "skipped", reason: "no_customer_phone" };
    }

    const deliveryMode = runtime.configuration.delivery_mode === "pdf" ? "pdf" : "link";
    const result = await deliverInvoiceViaWhatsApp(db, {
      saleData,
      runtime,
      phone: customerPhone,
      deliveryMode,
      testMode: false,
      saleId,
      companyId,
      storeId,
      userId,
    });

    await logDeliveryOutcome(db, {
      ...logContext,
      outcome: result.ok ? "sent" : "failed",
      deliveryMode: result.deliveryMode,
      durationMs: result.durationMs,
      recipientMasked: maskPhone(customerPhone),
      providerMessageId: result.providerMessageId,
      reason: result.ok ? null : result.errorText,
      error: result.ok ? null : result.errorText,
    });
    return { ok: result.ok, outcome: result.outcome, reason: result.ok ? undefined : result.errorText, deliveryMode: result.deliveryMode, pdfFallback: result.pdfFallback };
  } catch (error) {
    // Absolute rule: a WhatsApp problem can never break the POS sale.
    try {
      await logDeliveryOutcome(db, {
        ...logContext,
        outcome: "failed",
        reason: "unexpected",
        error: (error && error.message) || "unexpected",
        durationMs: Date.now() - startedAt,
      });
    } catch {
      /* even logging must not throw here */
    }
    return { ok: false, outcome: "failed", reason: "unexpected" };
  }
}

/**
 * Send a test invoice to an admin-provided (demo) number through the exact
 * same pipeline as automatic delivery. The recipient is ALWAYS the
 * admin-supplied test number - never a customer's stored number.
 * Used by the WhatsApp settings page once real sending exists.
 */
export async function sendWhatsAppTestInvoice({ db, companyId, storeId = null, userId = null, saleId, recipientPhone, deliveryMode = null }) {
  const startedAt = Date.now();
  const logContext = { companyId, userId, saleId };
  try {
    const runtime = await loadWhatsAppRuntime(db, companyId);
    if (!runtime || !runtime.enabled || !runtime.accessToken || !runtime.phoneNumberId) {
      return { ok: false, outcome: "skipped", reason: "not_configured" };
    }
    const testPhone = normalizeWhatsAppPhone(
      recipientPhone,
      runtime.configuration.default_country_code || null
    );
    if (!testPhone) {
      return { ok: false, outcome: "skipped", reason: "invalid_recipient" };
    }
    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) {
      return { ok: false, outcome: "skipped", reason: "sale_not_found" };
    }

    const mode =
      deliveryMode || (runtime.configuration.delivery_mode === "pdf" ? "pdf" : "link");
    const result = await deliverInvoiceViaWhatsApp(db, {
      saleData,
      runtime,
      phone: testPhone,
      deliveryMode: mode,
      testMode: true,
      saleId,
      companyId,
      storeId,
      userId,
    });

    await logDeliveryOutcome(db, {
      ...logContext,
      outcome: result.ok ? "sent" : "failed",
      deliveryMode: result.deliveryMode,
      durationMs: result.durationMs,
      recipientMasked: maskPhone(testPhone),
      providerMessageId: result.providerMessageId,
      reason: result.ok ? "test_send" : result.errorText,
      error: result.ok ? null : result.errorText,
    });
    return { ...result, url: result.linkUrl ?? null };
  } catch (error) {
    return {
      ok: false,
      outcome: "failed",
      reason: "unexpected",
      error: (error && error.message) || "unexpected",
    };
  }
}

/**
 * Manual "Resend invoice via WhatsApp" for an existing sale, initiated by
 * an authorised staff member (e.g. from the sale detail view). Reuses the
 * EXACT automatic-delivery pipeline (same loader, same mode selection, same
 * PDF -> link fallback, same audit logging) with two deliberate differences:
 *   - the auto_send_enabled gate is NOT applied (the staff action IS the
 *     authorisation to send - this is not automatic sending);
 *   - the customer must be resolvable on the sale, as for automatic sending.
 * The sale is strictly company/store scoped. Never throws.
 */
export async function resendWhatsAppInvoice({ db, saleId, companyId, storeId = null, userId = null }) {
  const startedAt = Date.now();
  const logContext = { companyId, userId, saleId, trigger: "manual_resend" };
  try {
    const runtime = await loadWhatsAppRuntime(db, companyId);
    if (!runtime || !runtime.enabled || !runtime.accessToken || !runtime.phoneNumberId) {
      return { ok: false, outcome: "skipped", reason: "not_configured" };
    }

    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) {
      return { ok: false, outcome: "skipped", reason: "sale_not_found" };
    }

    const customerPhone = normalizeWhatsAppPhone(
      saleData.customer?.phone,
      runtime.configuration.default_country_code || null
    );
    if (!customerPhone) {
      await logDeliveryOutcome(db, { ...logContext, outcome: "skipped", reason: "no_customer_phone" });
      return { ok: false, outcome: "skipped", reason: "no_customer_phone" };
    }

    const deliveryMode = runtime.configuration.delivery_mode === "pdf" ? "pdf" : "link";
    const result = await deliverInvoiceViaWhatsApp(db, {
      saleData,
      runtime,
      phone: customerPhone,
      deliveryMode,
      testMode: false,
      saleId,
      companyId,
      storeId,
      userId,
      trigger: "manual_resend",
    });

    await logDeliveryOutcome(db, {
      ...logContext,
      outcome: result.ok ? "sent" : "failed",
      deliveryMode: result.deliveryMode,
      durationMs: result.durationMs,
      recipientMasked: maskPhone(customerPhone),
      providerMessageId: result.providerMessageId,
      reason: result.ok ? null : result.errorText,
      error: result.ok ? null : result.errorText,
    });
    return {
      ok: result.ok,
      outcome: result.outcome,
      reason: result.ok ? undefined : result.errorText,
      deliveryMode: result.deliveryMode,
      pdfFallback: result.pdfFallback,
      error: result.ok ? undefined : result.errorText,
    };
  } catch (error) {
    try {
      await logDeliveryOutcome(db, {
        ...logContext,
        outcome: "failed",
        reason: "unexpected",
        error: (error && error.message) || "unexpected",
        durationMs: Date.now() - startedAt,
      });
    } catch {
      /* even logging must not throw here */
    }
    return { ok: false, outcome: "failed", reason: "unexpected", error: (error && error.message) || "unexpected" };
  }
}
