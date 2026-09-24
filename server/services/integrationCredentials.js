/*
 * T9A - integration credential protection.
 *
 * Credentials are encrypted at rest with AES-256-GCM (key derived from the
 * server's JWT_SECRET via scrypt) and are NEVER returned to any client:
 * API responses replace them with a redaction marker, and both request and
 * response payloads are redacted before being written to integration_api_logs.
 *
 * No new dependencies - Node's built-in crypto module only.
 */
import crypto from "crypto";

const REDACTED = "[REDACTED]";

let cachedKey = null;
let cachedKeySource = null;

function getEncryptionKey() {
  const secret =
    process.env.JWT_SECRET ||
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.DATABASE_URL; // deterministic last-resort source
  if (!secret) {
    throw new Error(
      "No secret available for integration credential encryption (set JWT_SECRET)."
    );
  }
  if (cachedKey && cachedKeySource === secret) return cachedKey;
  // scrypt derives a stable 32-byte key from whatever secret is configured.
  cachedKey = crypto.scryptSync(secret, "onepos:integration-credentials:v1", 32);
  cachedKeySource = secret;
  return cachedKey;
}

/** Encrypt a JSON-serialisable credentials object to a storage string. */
export function encryptCredentials(credentials) {
  if (credentials === undefined || credentials === null) return null;
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/** Decrypt a storage string back into the credentials object. */
export function decryptCredentials(stored) {
  if (!stored) return null;
  const parts = String(stored).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unrecognised credential ciphertext format");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

/*
 * Header/auth-value redaction. Any string that looks like a credential
 * value (api key, token, password, secret) is replaced with [REDACTED].
 */
function looksSensitiveKey(key) {
  return /secret|token|password|passwd|api[-_]?key|authorization|auth|credential/i.test(
    String(key || "")
  );
}

/** Deeply redact sensitive values inside a JSON-able structure. */
export function redactValue(value, parentKey = "") {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, parentKey));
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] =
        looksSensitiveKey(key) && val !== null && val !== undefined
          ? REDACTED
          : redactValue(val, key);
    }
    return out;
  }
  // Values passed under an obviously sensitive key are redacted wholesale.
  if (looksSensitiveKey(parentKey) && typeof value !== "object") return REDACTED;
  return value;
}

/** Redact an Authorization header value while keeping its scheme visible. */
export function redactAuthHeader(value) {
  if (!value) return value;
  const str = String(value);
  const schemeMatch = str.match(/^(\w+)\s+/);
  return schemeMatch ? `${schemeMatch[1]} ${REDACTED}` : REDACTED;
}

/** Redact the header object captured for logging. */
export function redactHeadersForLog(headers) {
  if (!headers || typeof headers !== "object") return headers || null;
  const out = {};
  for (const [key, val] of Object.entries(headers)) {
    if (/^authorization$/i.test(key)) {
      out[key] = redactAuthHeader(val);
    } else if (looksSensitiveKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** Redact a JSON-ish body (string or object) for storage in logs. */
export function redactBodyForLog(body) {
  if (body === undefined || body === null) return null;
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not JSON: redact credential-shaped substrings defensively.
      return body.replace(
        /("(?:secret|token|password|api[_-]?key|authorization)"\s*:\s*)"[^"]*"/gi,
        `$1"${REDACTED}"`
      );
    }
  }
  return JSON.stringify(redactValue(parsed));
}

/** Public (client-safe) shape of an integration row - never credentials. */
export function toPublicIntegration(row) {
  if (!row) return null;
  let hasCredentials = false;
  try {
    hasCredentials = Boolean(decryptCredentials(row.credentials_encrypted));
  } catch {
    hasCredentials = Boolean(row.credentials_encrypted);
  }
  return {
    id: row.id,
    companyId: row.company_id,
    storeId: row.store_id,
    name: row.name,
    providerName: row.provider_name,
    integrationType: row.integration_type,
    baseUrl: row.base_url,
    authType: row.auth_type,
    hasCredentials,
    credentialsPreview: hasCredentials ? { [REDACTED]: REDACTED } : null,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
