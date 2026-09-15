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
    order_acceptance: configuration.order_acceptance === "auto" ? "auto" : "manual",
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
  runtime.notes = configuration.notes || null;
  runtime.client_secret = decryptSecret(configuration.client_secret);
  runtime.api_key = decryptSecret(configuration.api_key);
  runtime.webhook_secret = decryptSecret(configuration.webhook_secret);
  runtime.configured = Boolean(runtime.client_id || runtime.client_secret || runtime.api_key);

  /*
   * Internal handles for the platform services (request/response auditing in
   * platform_api_logs via services/onlineOrders/platformLogger.js). Never
   * serialized to the frontend - every response builder picks explicit fields.
   */
  runtime.company_id = companyId;
  runtime.db = db;

  return runtime;
}
