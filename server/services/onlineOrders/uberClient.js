import { logPlatformApiCall } from "./platformLogger.js";

/*
 * Uber Eats HTTP client.
 *
 * ALL Uber-specific API access lives here - POS, Products, Reports and
 * AdminLayout never touch this module. Credentials come exclusively from the
 * Settings configuration (integrations table, decrypted by platformConfig.js);
 * nothing is hard-coded:
 *   - api_key                  -> pre-issued OAuth access token (eats.order
 *                                 scope; the sandbox token already obtained can
 *                                 be pasted into Settings "API key / access token")
 *   - client_id+client_secret  -> OAuth client_credentials token fetch (cached
 *                                 until expiry, scope eats.order)
 *
 * Sandbox domains per the official Uber Eats "Sandbox & Testing" guide -
 * testing applications MUST use the sandbox domains (mixing domains causes
 * authentication failures: "token domain must match API domain"):
 *   sandbox:    API https://test-api.uber.com  + OAuth https://sandbox-login.uber.com
 *   production: API https://api.uber.com       + OAuth https://auth.uber.com
 *
 * Every request/response (including the OAuth token exchange) is written to
 * platform_api_logs with secrets redacted (see platformLogger.js).
 */

const OAUTH_TOKEN_PATH = "/oauth/v2/token";
const OAUTH_SCOPE = "eats.order";
const REQUEST_TIMEOUT_MS = 15000;

/* In-memory access-token cache keyed by company+environment. */
const tokenCache = new Map();

function baseUrls(config) {
  const production = (config && config.environment) === "production";

  return {
    api: production
      ? process.env.ONLINE_UBER_API_BASE_URL || "https://api.uber.com"
      : process.env.ONLINE_UBER_SANDBOX_API_BASE_URL || "https://test-api.uber.com",
    oauth: production
      ? process.env.ONLINE_UBER_OAUTH_BASE_URL || "https://auth.uber.com"
      : process.env.ONLINE_UBER_SANDBOX_OAUTH_BASE_URL || "https://sandbox-login.uber.com",
  };
}

/* Settings "API key / access token" holds a pre-issued OAuth access token. */
export function hasAccessToken(config) {
  return Boolean(config && String(config.api_key || "").trim());
}

export function hasAppCredentials(config) {
  return Boolean(
    config && String(config.client_id || "").trim() && String(config.client_secret || "").trim()
  );
}

/*
 * Real API mode: the platform is enabled in Settings AND at least one usable
 * credential form exists. Otherwise callers fall back to the stub service.
 */
export function isRealApiMode(config) {
  return Boolean(
    config && config.enabled !== false && (hasAccessToken(config) || hasAppCredentials(config))
  );
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchAccessToken(config, scope = OAUTH_SCOPE) {
  const { oauth } = baseUrls(config);
  const url = `${oauth}${OAUTH_TOKEN_PATH}`;
  const started = Date.now();

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.client_id,
        client_secret: config.client_secret,
        scope,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    await logPlatformApiCall(config.db, {
      companyId: config.company_id,
      platform: "uber",
      environment: config.environment,
      action: "OAUTH_TOKEN",
      endpoint: url,
      httpMethod: "POST",
      requestPayload: { grant_type: "client_credentials", scope },
      success: false,
      errorMessage: error.message,
      durationMs: Date.now() - started,
    });
    throw new Error(`Uber OAuth token request failed: ${error.message}`);
  }

  const body = await parseBody(response);

  // client_secret and access_token are redacted by the logger before insert.
  await logPlatformApiCall(config.db, {
    companyId: config.company_id,
    platform: "uber",
    environment: config.environment,
    action: "OAUTH_TOKEN",
    endpoint: url,
    httpMethod: "POST",
    requestPayload: { grant_type: "client_credentials", scope },
    responseBody: body,
    responseStatus: response.status,
    success: response.ok,
    durationMs: Date.now() - started,
  });

  if (!response.ok || !body || !body.access_token) {
    throw new Error(`Uber OAuth token request failed (${response.status})`);
  }

  return body;
}

/*
 * Resolves the Bearer token for API calls: the pre-issued access token from
 * Settings when present, otherwise a client_credentials token (cached until
 * shortly before its expires_in; Uber client-credentials tokens last 30 days
 * and token requests are rate limited, so caching is mandatory).
 */
export async function getAccessToken(config, scope = OAUTH_SCOPE) {
  if (hasAccessToken(config)) {
    return String(config.api_key).trim();
  }

  if (!hasAppCredentials(config)) {
    throw new Error("Uber credentials are not configured");
  }

  const cacheKey = `${config.company_id || "company"}:${config.environment || "sandbox"}:${scope}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const body = await fetchAccessToken(config, scope);
  const expiresIn = Number(body.expires_in) || 2592000;
  const entry = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1000,
  };
  tokenCache.set(cacheKey, entry);

  return entry.token;
}

/*
 * Single HTTP entry point for every Uber Eats API call. Returns
 * { success, httpStatus, data, code?, message? } and always writes one
 * platform_api_logs row (secrets redacted) whichever way the call goes.
 */
export async function uberRequest({
  config,
  method = "POST",
  path,
  body = null,
  action,
  scope,
  orderId = null,
  productId = null,
}) {
  const { api } = baseUrls(config);
  const url = `${api}${path}`;
  const started = Date.now();

  let accessToken;
  try {
    accessToken = await getAccessToken(config, scope);
  } catch (error) {
    await logPlatformApiCall(config.db, {
      companyId: config.company_id,
      platform: "uber",
      environment: config.environment,
      action,
      endpoint: url,
      httpMethod: method,
      requestPayload: body,
      success: false,
      errorMessage: error.message,
      durationMs: Date.now() - started,
      orderId,
      productId,
    });
    return { success: false, code: "AUTH_FAILED", message: error.message, httpStatus: null, data: null };
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    await logPlatformApiCall(config.db, {
      companyId: config.company_id,
      platform: "uber",
      environment: config.environment,
      action,
      endpoint: url,
      httpMethod: method,
      requestPayload: body,
      success: false,
      errorMessage: error.message,
      durationMs: Date.now() - started,
      orderId,
      productId,
    });
    return {
      success: false,
      code: "NETWORK_ERROR",
      message: `Uber API request failed: ${error.message}`,
      httpStatus: null,
      data: null,
    };
  }

  const data = await parseBody(response);

  // The Authorization header is never passed to the logger.
  await logPlatformApiCall(config.db, {
    companyId: config.company_id,
    platform: "uber",
    environment: config.environment,
    action,
    endpoint: url,
    httpMethod: method,
    requestPayload: body,
    requestHeaders: { "Content-Type": "application/json", Accept: "application/json" },
    responseBody: data,
    responseStatus: response.status,
    success: response.ok,
    durationMs: Date.now() - started,
    orderId,
    productId,
  });

  return { success: response.ok, httpStatus: response.status, data };
}