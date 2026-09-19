import crypto from "crypto";

/*
 * Online platform configuration storage (Uber Eats / Deliveroo)
 *
 * Platform credentials are stored per company in the existing `integrations`
 * table (provider = 'uber' | 'deliveroo'). Secret fields are encrypted with
 * AES-256-GCM before they touch the database and are never returned to the
 * frontend - only a "configured" flag and a masked hint.
 *
 * The platform services receive a flattened, decrypted runtime config:
 *   { platform, enabled, environment, client_id, client_secret,
 *     store_location_id, api_key, webhook_secret, notes }
 * so that when the real APIs are wired up they can read credentials from
 * here instead of the stubs.
 */

const SECRET_FIELDS = ["client_secret", "api_key", "webhook_secret"];
const PLAIN_FIELDS = ["environment", "client_id", "store_location_id", "store_id", "brand_id", "order_acceptance", "notes"];
// Boolean settings stored as-is (default false).
const BOOLEAN_FIELDS = ["require_otp_on_completion"];

function encryptionKey() {
  const secret =
    process.env.ONLINE_PLATFORMS_SECRET ||
    process.env.JWT_SECRET ||
    "development-secret-change-this";

  return crypto.createHash("sha256").update(String(secret)).digest();
}

export function encryptSecret(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value).trim(), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) {
    return value || null;
  }

  try {
    const [, , ivB64, tagB64, dataB64] = value.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    console.error("Decrypt platform secret failed:", error.message);
    return null;
  }
}

/*
 * Merges incoming Settings input into the stored configuration.
 * Secret fields: provided -> re-encrypt; null -> cleared; undefined -> keep.
 */
export function buildStoredConfiguration(input = {}, existingConfiguration = {}) {
  const next = { ...(existingConfiguration || {}) };

  next.environment = input.environment === "production" ? "production" : "sandbox";

  for (const field of PLAIN_FIELDS) {
    if (input[field] !== undefined) {
      next[field] = input[field] === null || String(input[field]).trim() === "" ? null : String(input[field]).trim();
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (input[field] !== undefined) {
      next[field] = input[field] === true || input[field] === "true";
    }
  }

  for (const field of SECRET_FIELDS) {
    if (input[field] === undefined) {
      continue; // keep existing secret
    }

    next[field] = input[field] === null ? null : encryptSecret(input[field]);
  }

  return next;
}

/* Safe-for-frontend view: secrets replaced by configured/masked hints. */
export function maskConfiguration(configuration = {}) {
  const masked = {
    environment: configuration.environment || "sandbox",
    client_id: configuration.client_id || null,
    store_location_id: configuration.store_location_id || null,
    store_id: configuration.store_id || null,
    brand_id: configuration.brand_id || null,
    /* T10-UBER-MENU: non-secret sync-status passthrough. */
    menu_sync_last_attempt: configuration.menu_sync_last_attempt || null,
    menu_sync_last_success: configuration.menu_sync_last_success || null,
    menu_sync_last_error: configuration.menu_sync_last_error || null,
    menu_sync_last_count: configuration.menu_sync_last_count ?? null,
    order_acceptance: configuration.order_acceptance === "auto" ? "auto" : "manual",
    require_otp_on_completion: configuration.require_otp_on_completion === true,
    notes: configuration.notes || null,
  };

  for (const field of SECRET_FIELDS) {
    const value = decryptSecret(configuration[field]);

    masked[field] = null;
    masked[`${field}_configured`] = Boolean(value);

    if (value && value.length > 4) {
      masked[`${field}_masked`] = `••••${value.slice(-4)}`;
    }
  }

  return masked;
}

/*
 * Loads (and decrypts) the runtime config for one company + platform.
 * Returns a flattened object; enabled=false when no configuration exists.
 */
export async function loadPlatformConfig(db, companyId, platform) {
  const runtime = {
    platform,
    enabled: false,
    configured: false,
    environment: "sandbox",
    client_id: null,
    client_secret: null,
    store_location_id: null,
    store_id: null,
    brand_id: null,
    order_acceptance: "manual",
    require_otp_on_completion: false,
    api_key: null,
    webhook_secret: null,
    notes: null,
  };

  if (!["uber", "deliveroo"].includes(platform) || !companyId) {
    return runtime;
  }

  const result = await db(
    `SELECT active, configuration FROM integrations WHERE company_id = $1 AND provider = $2 LIMIT 1`,
    [companyId, platform]
  );

  if (!result.rows.length) {
    return runtime;
  }

  const row = result.rows[0];
  const configuration = row.configuration || {};

  runtime.enabled = row.active === true;
  runtime.environment = configuration.environment || "sandbox";
  runtime.client_id = configuration.client_id || null;
  runtime.store_location_id = configuration.store_location_id || null;
  // Uber Store/Brand IDs saved after store discovery (Settings). Exposed here
  // so the platform services can use them for menu/order calls.
  runtime.store_id = configuration.store_id || null;
  runtime.brand_id = configuration.brand_id || null;
  // "manual" | "auto" - used by the online-order receive flow to auto-accept.
  runtime.order_acceptance = configuration.order_acceptance === "auto" ? "auto" : "manual";
  // "Require customer OTP on completion" - default NO when unset.
  runtime.require_otp_on_completion = configuration.require_otp_on_completion === true;
  runtime.notes = configuration.notes || null;
  runtime.client_secret = decryptSecret(configuration.client_secret);
  runtime.api_key = decryptSecret(configuration.api_key);
  runtime.webhook_secret = decryptSecret(configuration.webhook_secret);
  runtime.configured = Boolean(runtime.client_id || runtime.client_secret || runtime.api_key);

  /* T10-UBER-MENU: non-secret menu-sync status (Settings display). */
  runtime.menu_sync_last_attempt = configuration.menu_sync_last_attempt || null;
  runtime.menu_sync_last_success = configuration.menu_sync_last_success || null;
  runtime.menu_sync_last_error = configuration.menu_sync_last_error || null;
  runtime.menu_sync_last_count = configuration.menu_sync_last_count ?? null;

  /*
   * Internal handles for the platform services (request/response auditing in
   * platform_api_logs via services/onlineOrders/platformLogger.js). Never
   * serialized to the frontend - every response builder picks explicit fields.
   */
  runtime.company_id = companyId;
  runtime.db = db;

  return runtime;
}

/*
 * T9Q-SMALL - WhatsApp settings (provider = 'whatsapp' in the SAME table).
 *
 * Reuses the enc:v1 AES-256-GCM secret scheme above - no second credential
 * system, no new tables. Plain fields are stored as-is; secrets are encrypted
 * before they touch the database and are only ever exposed back to the
 * frontend as configured/masked hints.
 */
const WHATSAPP_SECRET_FIELDS = ["access_token", "webhook_verify_token"];
const WHATSAPP_PLAIN_FIELDS = [
  "phone_number_id",
  "business_account_id",
  "display_name",
  "default_country_code",
  "invoice_message_template",
  "test_recipient_number",
];

/** Merge incoming WhatsApp settings into the stored configuration (same secret semantics as buildStoredConfiguration). */
export function buildWhatsAppConfiguration(input = {}, existingConfiguration = {}) {
  const next = { ...(existingConfiguration || {}) };
  for (const field of WHATSAPP_PLAIN_FIELDS) {
    if (input[field] !== undefined) {
      next[field] = input[field] === null || String(input[field]).trim() === "" ? null : String(input[field]).trim();
    }
  }
  for (const field of WHATSAPP_SECRET_FIELDS) {
    if (input[field] === undefined) continue; // keep existing secret
    next[field] = input[field] === null ? null : encryptSecret(input[field]);
  }
  // T9Q-NEXT delivery settings.
  if (input.delivery_mode !== undefined) {
    next.delivery_mode = input.delivery_mode === "pdf" ? "pdf" : "link";
  }
  if (input.auto_send_enabled !== undefined) {
    next.auto_send_enabled = input.auto_send_enabled === true || input.auto_send_enabled === "true";
  }
  return next;
}

/** Safe-for-frontend view of the WhatsApp configuration - never secrets. */
export function maskWhatsAppConfiguration(configuration = {}) {
  const masked = {};
  for (const field of WHATSAPP_PLAIN_FIELDS) {
    masked[field] = configuration[field] || null;
  }
  for (const field of WHATSAPP_SECRET_FIELDS) {
    const value = decryptSecret(configuration[field]);
    masked[field] = null;
    masked[`${field}_configured`] = Boolean(value);
    if (value && value.length > 4) {
      masked[`${field}_masked`] = `••••${value.slice(-4)}`;
    }
  }
  masked.delivery_mode = configuration.delivery_mode === "pdf" ? "pdf" : "link";
  masked.auto_send_enabled = configuration.auto_send_enabled === true;
  masked.test_recipient_number = configuration.test_recipient_number || null;
  masked.configured = Boolean(
    (configuration.phone_number_id || masked.phone_number_id) &&
      decryptSecret(configuration.access_token)
  );
  return masked;
}

/**
 * Load the raw WhatsApp row for one company (internal/backend use only -
 * configuration may contain encrypted secrets; never serialize to a response).
 */
export async function loadWhatsAppConfig(db, companyId) {
  if (!companyId) return { enabled: false, configuration: {} };
  const result = await db(
    `SELECT active, configuration FROM integrations WHERE company_id = $1 AND provider = 'whatsapp' LIMIT 1`,
    [companyId]
  );
  if (!result.rows.length) return { enabled: false, configuration: {} };
  return {
    enabled: result.rows[0].active === true,
    configuration: result.rows[0].configuration || {},
  };
}

/*
 * T9D-NEXT - SMS + Email invoice delivery configuration.
 *
 * Same architecture as WhatsApp: one row per provider in the existing
 * `integrations` table (providers 'sms_invoice' / 'email_invoice'), secrets
 * encrypted with the SAME enc:v1 AES-256-GCM scheme, never returned to any
 * client - only *_configured flags and masked suffixes. Provider-agnostic:
 * the credential fields are generic so the actual SMS/email provider can be
 * selected later without schema or config-model changes.
 */

const INVOICE_CHANNEL_SECRET_FIELDS = ["api_key", "api_secret", "auth_token"];
const SMS_PLAIN_FIELDS = [
  "sms_provider", // e.g. "generic_http" | "twilio" | "messagebird" (informational)
  "sender_id", // alphanumeric sender ID shown to recipients
  "api_base_url", // generic HTTP provider endpoint
  "default_country_code",
  "message_template", // optional custom body; {link} placeholder supported
];
const EMAIL_PLAIN_FIELDS = [
  "email_provider", // e.g. "smtp" | "generic_http" | "resend" (informational)
  "from_address",
  "from_name",
  "smtp_host",
  "smtp_port",
  "smtp_secure", // "true" | "false"
  "api_base_url",
  "subject_template",
  "message_template",
];

function buildInvoiceChannelConfiguration(input = {}, existingConfiguration = {}, plainFields) {
  const next = { ...(existingConfiguration || {}) };
  for (const field of plainFields) {
    if (input[field] !== undefined) {
      next[field] = input[field] === null || String(input[field]).trim() === "" ? null : String(input[field]).trim();
    }
  }
  for (const field of INVOICE_CHANNEL_SECRET_FIELDS) {
    if (input[field] === undefined) continue; // keep existing secret
    next[field] = input[field] === null ? null : encryptSecret(input[field]);
  }
  if (input.auto_send_enabled !== undefined) {
    next.auto_send_enabled = input.auto_send_enabled === true || input.auto_send_enabled === "true";
  }
  return next;
}

function maskInvoiceChannelConfiguration(configuration = {}, plainFields) {
  const masked = {};
  for (const field of plainFields) {
    masked[field] = configuration[field] || null;
  }
  for (const field of INVOICE_CHANNEL_SECRET_FIELDS) {
    const value = decryptSecret(configuration[field]);
    masked[field] = null;
    masked[`${field}_configured`] = Boolean(value);
    if (value && value.length > 4) {
      masked[`${field}_masked`] = `\u2022\u2022\u2022\u2022${value.slice(-4)}`;
    }
  }
  masked.auto_send_enabled = configuration.auto_send_enabled === true;
  masked.configured = Boolean(
    (masked.api_base_url || masked.smtp_host) && decryptSecret(configuration.auth_token || configuration.api_key)
  );
  return masked;
}

/** Load one invoice channel's integration row (providers: 'sms_invoice' | 'email_invoice'). */
export async function loadInvoiceChannelConfig(db, companyId, provider) {
  if (!companyId) return { enabled: false, configuration: {} };
  const result = await db(
    `SELECT active, configuration FROM integrations WHERE company_id = $1 AND provider = $2 LIMIT 1`,
    [companyId, provider]
  );
  if (!result.rows.length) return { enabled: false, configuration: {} };
  return { enabled: result.rows[0].active === true, configuration: result.rows[0].configuration || {} };
}

export function buildSmsInvoiceConfiguration(input = {}, existingConfiguration = {}) {
  return buildInvoiceChannelConfiguration(input, existingConfiguration, SMS_PLAIN_FIELDS);
}

export function maskSmsInvoiceConfiguration(configuration = {}) {
  return maskInvoiceChannelConfiguration(configuration, SMS_PLAIN_FIELDS);
}

export function buildEmailInvoiceConfiguration(input = {}, existingConfiguration = {}) {
  return buildInvoiceChannelConfiguration(input, existingConfiguration, EMAIL_PLAIN_FIELDS);
}

export function maskEmailInvoiceConfiguration(configuration = {}) {
  return maskInvoiceChannelConfiguration(configuration, EMAIL_PLAIN_FIELDS);
}

/** Mask an email address for logging: k***@d***.com - never the full address. */
export function maskEmail(email) {
  const raw = String(email || "").trim();
  if (!raw || !raw.includes("@")) return ".....";
  const [local, domain] = raw.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(4, local.length - 1)))}@${domain.slice(0, 1)}${"*".repeat(Math.max(1, Math.min(4, domain.length - 1)))}`;
}
