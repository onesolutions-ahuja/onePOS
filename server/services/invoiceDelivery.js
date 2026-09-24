/*
 * T9D-NEXT - SMS + Email invoice delivery service.
 *
 * Extends the invoice-delivery foundation alongside WhatsApp (T9Q-NEXT):
 *
 *   business transaction commits
 *     -> dispatchSmsInvoiceDelivery / dispatchEmailInvoiceDelivery
 *          (fire-and-forget, never throws, never blocks the POS sale)
 *       -> tenant-scoped sale/customer load
 *       -> T9P secure invoice link (createInvoiceDeliveryLink) - the ONLY
 *          URL shape is /i/<opaque-token>; no sale/customer/internal IDs
 *       -> provider-agnostic HTTP send (generic REST contract)
 *       -> audit_logs record with SAFE metadata only
 *
 * Provider layer is deliberately replaceable: sends go through
 * sendSmsViaProvider / sendEmailViaProvider, which speak a generic
 * authenticated-HTTP contract (api_base_url + api_key/bearer). Adapting a
 * concrete provider later means changing ONLY those two functions.
 *
 * Security invariants (mirroring T9Q):
 *  - secrets live in the existing integrations configuration, enc:v1
 *    encrypted, and NEVER cross this module's boundary
 *  - logs carry provider, outcome, http status, duration, MASKED recipient,
 *    provider reference - never tokens, full phones, full emails, or the
 *    secure-link plaintext token
 *  - auto-send defaults OFF everywhere; a disabled/untested integration
 *    can never emit anything
 */
import { createInvoiceDeliveryLink, buildInvoiceDeliveryMessage } from "./secureInvoiceLinks.js";
import { normalizeWhatsAppPhone } from "./whatsappDelivery.js";
import {
  decryptSecret,
  maskEmail,
  loadInvoiceChannelConfig,
} from "./onlineOrders/platformConfig.js";

const PROVIDER_TIMEOUT_MS = 10000;
const DEFAULT_SMS_TEMPLATE = "Thank you for your purchase. Your invoice{number}: {link}";
const DEFAULT_EMAIL_SUBJECT = "Your invoice from {company}";
const DEFAULT_EMAIL_BODY =
  "Thank you for your purchase.\n\nYour invoice{number} is available here: {link}\n\nThis link is valid for a limited time.";

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Safe log entry into the existing audit_logs (best-effort, never throws). */
async function logDeliveryOutcome(db, entry) {
  try {
    await db(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'sale', $4, $5)`,
      [
        entry.companyId,
        entry.userId ?? null,
        entry.action,
        entry.saleId,
        JSON.stringify({
          outcome: entry.outcome,
          delivery_type: entry.deliveryType,
          trigger: entry.trigger ?? "auto",
          http_status: entry.httpStatus ?? null,
          duration_ms: entry.durationMs ?? null,
          recipient_masked: entry.recipientMasked ?? null,
          provider_reference: entry.providerReference ?? null,
          reason: entry.reason ?? null,
        }),
      ]
    );
  } catch {
    /* logging is best-effort by design */
  }
}

/** Load the tenant-scoped sale + customer for delivery, mirroring WhatsApp's loader shape. */
async function loadSaleForDelivery(db, { saleId, companyId, storeId }) {
  const storeClause = storeId ? "AND s.store_id = $3" : "";
  const params = storeId ? [saleId, companyId, storeId] : [saleId, companyId];
  const saleResult = await db(
    `SELECT s.id, s.receipt_number, s.total, s.created_at, s.completed_at, s.customer_id
     FROM sales s
     INNER JOIN companies c ON c.id = s.company_id
     WHERE s.id = $1 AND s.company_id = $2 ${storeClause}
     LIMIT 1`,
    params
  );
  const sale = saleResult.rows[0];
  if (!sale) return null;

  let customer = null;
  if (sale.customer_id) {
    const customerResult = await db(
      `SELECT name, phone, email FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [sale.customer_id, companyId]
    );
    customer = customerResult.rows[0] || null;
  }
  return { sale: { id: sale.id, receiptNumber: sale.receipt_number, total: Number(sale.total) || 0 }, customer, company: null };
}

/** Company display name for message templates (best-effort). */
async function loadCompanyName(db, companyId) {
  try {
    const result = await db(`SELECT name FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
    return result.rows[0]?.name || null;
  } catch {
    return null;
  }
}

/** Fill {company} {number} {link} placeholders without ever exposing internals. */
function renderTemplate(template, { company, number, link }) {
  return String(template || "")
    .replaceAll("{company}", company || "our store")
    .replaceAll("{number}", number ? ` ${number}` : "")
    .replaceAll("{link}", link);
}

/*
 * ------------------------ provider layer (replaceable) ------------------------
 * Generic authenticated-HTTP contract. A concrete provider adapter only needs
 * to replace these two functions; everything above/below stays identical.
 */

/** POST the SMS payload to the configured endpoint. Returns { ok, httpStatus, reference?, errorText? }. */
export async function sendSmsViaProvider({ endpoint, apiKey, authScheme, senderId, to, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = authScheme === "bearer" ? `Bearer ${apiKey}` : apiKey;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ to, from: senderId || undefined, message: body }),
      signal: controller.signal,
    });
    const respBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, errorText: respBody?.error?.message || `SMS provider returned HTTP ${response.status}` };
    }
    return { ok: true, httpStatus: response.status, reference: respBody?.id || respBody?.messageId || respBody?.reference || null };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      errorText: error?.name === "AbortError" ? "SMS provider request timed out" : "SMS provider request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** POST the email payload. Returns { ok, httpStatus, reference?, errorText? }. */
export async function sendEmailViaProvider({ endpoint, apiKey, authScheme, from, to, subject, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = authScheme === "bearer" ? `Bearer ${apiKey}` : apiKey;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ from, to, subject, text: body }),
      signal: controller.signal,
    });
    const respBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, errorText: respBody?.error?.message || `Email provider returned HTTP ${response.status}` };
    }
    return { ok: true, httpStatus: response.status, reference: respBody?.id || respBody?.messageId || respBody?.reference || null };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 0,
      errorText: error?.name === "AbortError" ? "Email provider request timed out" : "Email provider request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * ------------------------------ shared internals ------------------------------
 */

function resolveProviderCredential(configuration) {
  const apiKey = decryptSecret(configuration.auth_token) || decryptSecret(configuration.api_key) || null;
  const authScheme = configuration.auth_scheme === "bearer" ? "bearer" : "raw";
  return { apiKey, authScheme };
}

function isEmailUsable(email) {
  const raw = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : null;
}

/** Manual resend entry (staff action): skips the auto_send gate, keeps everything else identical. */
function channelGate(runtime, { requireAutoSend }) {
  if (!runtime || !runtime.enabled) return "not_configured";
  if (!runtime.credential || !runtime.endpoint) return "not_configured";
  if (requireAutoSend && runtime.configuration.auto_send_enabled !== true) return "auto_send_disabled";
  return null;
}

async function deliverViaChannel(db, { channel, saleData, runtime, recipient, saleId, companyId, storeId, userId, trigger, requireAutoSend }) {
  const startedAt = Date.now();
  const action = channel === "sms" ? "sms_invoice_delivery" : "email_invoice_delivery";
  const deliveryType = channel === "sms" ? "sms" : "email";
  try {
    const gate = channelGate(runtime, { requireAutoSend });
    if (gate) return { ok: false, outcome: "skipped", reason: gate };

    // T9P secure link - the only URL that ever leaves the building.
    const link = await createInvoiceDeliveryLink({
      db,
      saleId,
      companyId,
      storeId,
      createdBy: userId,
      expiryDays: trigger === "manual_resend" ? 1 : undefined,
    });
    if (!link.ok) {
      await logDeliveryOutcome(db, { companyId, userId, saleId, action, deliveryType, trigger, outcome: "skipped", reason: "link_failed", recipientMasked: channel === "sms" ? `.....${recipient.slice(-4)}` : maskEmail(recipient) });
      return { ok: false, outcome: "skipped", reason: "link_failed", error: link.message };
    }

    const companyName = await loadCompanyName(db, companyId);
    const { apiKey, authScheme } = resolveProviderCredential(runtime.configuration);
    const invoiceNumber = saleData.sale.receiptNumber || null;
    const recipientMasked = channel === "sms" ? `.....${recipient.slice(-4)}` : maskEmail(recipient);

    let sendResult;
    if (channel === "sms") {
      const body = renderTemplate(runtime.configuration.message_template || DEFAULT_SMS_TEMPLATE, { company: companyName, number: invoiceNumber, link: link.url });
      sendResult = await sendSmsViaProvider({
        endpoint: runtime.endpoint,
        apiKey,
        authScheme,
        senderId: runtime.configuration.sender_id || undefined,
        to: recipient,
        body,
      });
    } else {
      const subject = renderTemplate(runtime.configuration.subject_template || DEFAULT_EMAIL_SUBJECT, { company: companyName, number: invoiceNumber, link: link.url });
      const body = renderTemplate(runtime.configuration.message_template || DEFAULT_EMAIL_BODY, { company: companyName, number: invoiceNumber, link: link.url });
      sendResult = await sendEmailViaProvider({
        endpoint: runtime.endpoint,
        apiKey,
        authScheme,
        from: runtime.configuration.from_address || undefined,
        to: recipient,
        subject,
        body,
      });
    }

    await logDeliveryOutcome(db, {
      companyId,
      userId,
      saleId,
      action,
      deliveryType,
      trigger,
      outcome: sendResult.ok ? "sent" : "failed",
      httpStatus: sendResult.httpStatus,
      durationMs: Date.now() - startedAt,
      recipientMasked,
      providerReference: sendResult.reference ?? null,
      reason: sendResult.ok ? null : sendResult.errorText,
    });

    return {
      ok: sendResult.ok,
      outcome: sendResult.ok ? "sent" : "failed",
      deliveryType,
      httpStatus: sendResult.httpStatus,
      providerReference: sendResult.reference ?? null,
      durationMs: Date.now() - startedAt,
      url: link.url,
      error: sendResult.ok ? undefined : sendResult.errorText,
    };
  } catch (error) {
    await logDeliveryOutcome(db, {
      companyId,
      userId,
      saleId,
      action,
      deliveryType,
      trigger,
      outcome: "failed",
      reason: "unexpected",
      durationMs: Date.now() - startedAt,
    }).catch(() => {});
    return { ok: false, outcome: "failed", deliveryType, reason: "unexpected", error: (error && error.message) || "unexpected" };
  }
}

function makeRuntime(enabled, configuration) {
  const { apiKey } = resolveProviderCredential(configuration);
  return {
    enabled,
    configuration,
    credential: apiKey,
    endpoint: configuration.api_base_url || null,
  };
}

/**
 * Fire-and-forget SMS invoice delivery after sale COMMIT. Never throws,
 * never blocks the POS sale. Skips entirely unless the SMS integration is
 * enabled AND auto_send_enabled is explicitly true (default OFF).
 */
export async function dispatchSmsInvoiceDelivery({ db, saleId, companyId, storeId = null, userId = null }) {
  const startedAt = Date.now();
  try {
    const config = await loadInvoiceChannelConfig(db, companyId, "sms_invoice");
    const runtime = makeRuntime(config.enabled, config.configuration);
    if (channelGate(runtime, { requireAutoSend: true })) {
      return { ok: false, outcome: "skipped", reason: channelGate(runtime, { requireAutoSend: true }) };
    }
    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) return { ok: false, outcome: "skipped", reason: "sale_not_found" };

    const phone = normalizeWhatsAppPhone(saleData.customer?.phone, config.configuration.default_country_code || null);
    if (!phone) {
      await logDeliveryOutcome(db, { companyId, userId, saleId, action: "sms_invoice_delivery", deliveryType: "sms", trigger: "auto", outcome: "skipped", reason: "no_customer_phone" });
      return { ok: false, outcome: "skipped", reason: "no_customer_phone" };
    }
    return await deliverViaChannel(db, {
      channel: "sms", saleData, runtime, recipient: phone,
      saleId, companyId, storeId, userId, trigger: "auto", requireAutoSend: true,
    });
  } catch (error) {
    await logDeliveryOutcome(db, { companyId, userId, saleId, action: "sms_invoice_delivery", deliveryType: "sms", trigger: "auto", outcome: "failed", reason: "unexpected", durationMs: Date.now() - startedAt }).catch(() => {});
    return { ok: false, outcome: "failed", reason: "unexpected" };
  }
}

/** Fire-and-forget Email invoice delivery after sale COMMIT (same contract as SMS). */
export async function dispatchEmailInvoiceDelivery({ db, saleId, companyId, storeId = null, userId = null }) {
  const startedAt = Date.now();
  try {
    const config = await loadInvoiceChannelConfig(db, companyId, "email_invoice");
    const runtime = makeRuntime(config.enabled, config.configuration);
    if (channelGate(runtime, { requireAutoSend: true })) {
      return { ok: false, outcome: "skipped", reason: channelGate(runtime, { requireAutoSend: true }) };
    }
    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) return { ok: false, outcome: "skipped", reason: "sale_not_found" };

    const email = isEmailUsable(saleData.customer?.email);
    if (!email) {
      await logDeliveryOutcome(db, { companyId, userId, saleId, action: "email_invoice_delivery", deliveryType: "email", trigger: "auto", outcome: "skipped", reason: "no_customer_email" });
      return { ok: false, outcome: "skipped", reason: "no_customer_email" };
    }
    return await deliverViaChannel(db, {
      channel: "email", saleData, runtime, recipient: email,
      saleId, companyId, storeId, userId, trigger: "auto", requireAutoSend: true,
    });
  } catch (error) {
    await logDeliveryOutcome(db, { companyId, userId, saleId, action: "email_invoice_delivery", deliveryType: "email", trigger: "auto", outcome: "failed", reason: "unexpected", durationMs: Date.now() - startedAt }).catch(() => {});
    return { ok: false, outcome: "failed", reason: "unexpected" };
  }
}

/**
 * Manual "Send by SMS/Email" for an existing sale (authorised staff action).
 * channel: "sms" | "email". Reuses the exact pipeline; the auto_send gate is
 * not applied (the staff action is the authorisation). Never throws.
 * overrideRecipient: used ONLY by the settings test-send route - the demo
 * recipient an admin types; normal resend always targets the sale's own
 * customer contact.
 */
export async function resendInvoiceByChannel({ db, channel, saleId, companyId, storeId = null, userId = null, overrideRecipient = null }) {
  const startedAt = Date.now();
  const deliveryType = channel === "sms" ? "sms" : "email";
  try {
    const provider = channel === "sms" ? "sms_invoice" : "email_invoice";
    const config = await loadInvoiceChannelConfig(db, companyId, provider);
    const runtime = makeRuntime(config.enabled, config.configuration);
    const gate = channelGate(runtime, { requireAutoSend: false });
    if (gate === "not_configured") {
      return { ok: false, outcome: "skipped", reason: "not_configured" };
    }
    const saleData = await loadSaleForDelivery(db, { saleId, companyId, storeId });
    if (!saleData) return { ok: false, outcome: "skipped", reason: "sale_not_found" };

    let recipient = null;
    if (overrideRecipient) {
      // Test-send path: the admin-supplied demo recipient, validated but not
      // required to exist on the customer record.
      recipient = channel === "sms"
        ? normalizeWhatsAppPhone(overrideRecipient, config.configuration.default_country_code || null)
        : isEmailUsable(overrideRecipient);
      if (!recipient) return { ok: false, outcome: "skipped", reason: "invalid_recipient" };
    } else if (channel === "sms") {
      recipient = normalizeWhatsAppPhone(saleData.customer?.phone, config.configuration.default_country_code || null);
      if (!recipient) {
        await logDeliveryOutcome(db, { companyId, userId, saleId, action: "sms_invoice_delivery", deliveryType, trigger: "manual_resend", outcome: "skipped", reason: "no_customer_phone" });
        return { ok: false, outcome: "skipped", reason: "no_customer_phone" };
      }
    } else {
      recipient = isEmailUsable(saleData.customer?.email);
      if (!recipient) {
        await logDeliveryOutcome(db, { companyId, userId, saleId, action: "email_invoice_delivery", deliveryType, trigger: "manual_resend", outcome: "skipped", reason: "no_customer_email" });
        return { ok: false, outcome: "skipped", reason: "no_customer_email" };
      }
    }

    return await deliverViaChannel(db, {
      channel, saleData, runtime, recipient,
      saleId, companyId, storeId, userId, trigger: "manual_resend", requireAutoSend: false,
    });
  } catch (error) {
    return { ok: false, outcome: "failed", deliveryType, reason: "unexpected", error: (error && error.message) || "unexpected" };
  }
}

/**
 * Provider connection test used by the settings page BEFORE activation:
 * posts a harmless probe payload to the configured endpoint with the
 * candidate credentials. Nothing tenant-owned is transmitted.
 */
export async function testInvoiceChannelConnection({ db, companyId, channel, configuration }) {
  const endpoint = configuration.api_base_url || null;
  const { apiKey, authScheme } = resolveProviderCredential(configuration);
  if (!endpoint) return { ok: false, error: "An API endpoint URL is required to test the connection." };
  if (!/^https:\/\//i.test(endpoint)) return { ok: false, error: "The API endpoint must use HTTPS." };
  if (!apiKey) return { ok: false, error: "An API key or auth token is required to test the connection." };

  const startedAt = Date.now();
  const probe = channel === "sms"
    ? await sendSmsViaProvider({ endpoint, apiKey, authScheme, senderId: configuration.sender_id || undefined, to: "0000000000", body: "onePOS connection test - no message was sent to a customer." })
    : await sendEmailViaProvider({ endpoint, apiKey, authScheme, from: configuration.from_address || undefined, to: "connection-test@onepos.invalid", subject: "onePOS connection test", body: "onePOS connection test." });
  return {
    ok: probe.ok,
    httpStatus: probe.httpStatus,
    durationMs: Date.now() - startedAt,
    error: probe.ok ? null : probe.errorText,
  };
}
