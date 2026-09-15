/*
 * Platform API request/response logging (Uber Eats / Deliveroo)
 *
 * Every outbound platform API request and its response is stored in the
 * platform_api_logs table for debugging/auditing. Secrets (client secrets,
 * access tokens, API keys, webhook secrets, Authorization headers and
 * JWT-shaped strings) are REDACTED before anything touches the database -
 * client secrets and access tokens are never stored in plaintext logs.
 *
 * Logging is best-effort: a logging failure must never break the online-order
 * flow, so logPlatformApiCall catches its own errors.
 */

const SECRET_KEY_PATTERN =
  /(client[_-]?secret|clientsecret|access[_-]?token|accesstoken|refresh[_-]?token|api[_-]?key|apikey|webhook[_-]?secret|webhooksecret|authorization|password|bearer)/i;

const REDACTED = "***REDACTED***";
const MAX_TEXT_LENGTH = 10000;
const MAX_DEPTH = 12;

function looksLikeJwt(value) {
  return typeof value === "string" && value.startsWith("eyJ") && value.split(".").length >= 3;
}

function redactNode(value, depth) {
  if (value === null || value === undefined) return value;
  if (looksLikeJwt(value)) return REDACTED;
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return "[TRUNCATED]";
    return value.map((item) => redactNode(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[TRUNCATED]";
    const redacted = {};
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactNode(item, depth + 1);
    }
    return redacted;
  }
  if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
    return `${value.slice(0, MAX_TEXT_LENGTH)}...[TRUNCATED]`;
  }
  return value;
}

/* Deep clone of a payload with every secret key/JWT replaced by REDACTED. */
export function redactPayload(value) {
  if (value === undefined || value === null) return null;
  return redactNode(value, 0);
}

/* Headers safe for storage: Authorization/Cookie presence kept, value dropped. */
export function redactHeaders(headers = {}) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers || {})) {
    redacted[key] = /authorization|cookie/i.test(key) ? REDACTED : value;
  }
  return redacted;
}

/*
 * Writes one platform_api_logs row. Never throws - logging problems are
 * reported to the server console only.
 */
export async function logPlatformApiCall(db, entry = {}) {
  try {
    if (!db || !entry.platform) {
      return;
    }

    await db(
      `
      INSERT INTO platform_api_logs (
        company_id, platform, environment, action, endpoint, http_method,
        request_payload, request_headers, response_status, response_body,
        success, error_message, duration_ms, order_id, product_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      `,
      [
        entry.companyId || null,
        entry.platform,
        entry.environment || null,
        entry.action || "UNKNOWN",
        entry.endpoint || null,
        entry.httpMethod || null,
        JSON.stringify(redactPayload(entry.requestPayload)),
        entry.requestHeaders ? JSON.stringify(redactHeaders(entry.requestHeaders)) : null,
        Number.isFinite(entry.responseStatus) ? entry.responseStatus : null,
        JSON.stringify(redactPayload(entry.responseBody)),
        entry.success === true,
        entry.errorMessage || null,
        Number.isFinite(entry.durationMs) ? Math.round(entry.durationMs) : null,
        entry.orderId || null,
        entry.productId || null,
      ]
    );
  } catch (error) {
    console.error("platform_api_logs write failed:", error.message);
  }
}