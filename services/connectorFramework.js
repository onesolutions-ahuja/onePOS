import dns from "node:dns/promises";
import net from "node:net";
import {
  decryptCredentials,
  encryptCredentials,
  redactValue,
} from "./integrationCredentials.js";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const AUTH_TYPES = new Set(["none", "api_key", "bearer", "basic"]);
const MAX_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS = 5;

function parseJson(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getPath(object, path) {
  const parts = String(path || "")
    .replace(/^\$?(input|response|credentials)\.?/, "")
    .split(".")
    .filter(Boolean);
  let value = object;
  for (const part of parts) {
    if (value === null || value === undefined || !/^[\w-]+$/.test(part)) {
      return undefined;
    }
    value = value[part];
  }
  return value;
}

function resolveValue(spec, { input, credentials, response }) {
  if (
    spec &&
    typeof spec === "object" &&
    !Array.isArray(spec) &&
    typeof spec.source === "string"
  ) {
    const [scope, ...pathParts] = spec.source.split(".");
    const roots = { input, credentials, response };
    return getPath(roots[scope], pathParts.join("."));
  }
  if (typeof spec === "string") {
    const exact = spec.match(/^\{\{\s*(input|credentials|response)\.([\w.-]+)\s*\}\}$/);
    if (exact) {
      return getPath(
        { input, credentials, response }[exact[1]],
        exact[2]
      );
    }
    return spec.replace(
      /\{\{\s*(input|credentials|response)\.([\w.-]+)\s*\}\}/g,
      (_match, scope, path) => {
        const value = getPath({ input, credentials, response }[scope], path);
        return value === undefined || value === null ? "" : String(value);
      }
    );
  }
  if (Array.isArray(spec)) {
    return spec.map((item) => resolveValue(item, { input, credentials, response }));
  }
  if (spec && typeof spec === "object") {
    return Object.fromEntries(
      Object.entries(spec).map(([key, value]) => [
        key,
        resolveValue(value, { input, credentials, response }),
      ])
    );
  }
  return spec;
}

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      return net.isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
    }
    return false;
  }
  return true;
}

/**
 * Reject non-HTTP(S), credential-bearing URLs, local/private IPs, and
 * hostnames that resolve to private addresses. Redirects are checked again.
 */
export async function isAllowedConnectorTarget(value, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    return false;
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata"
  ) {
    return false;
  }
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => !isPrivateIp(address))
    );
  } catch {
    return false;
  }
}

function mapFields(mapping, context) {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return {};
  return Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => [
      key,
      resolveValue(value, context),
    ])
  );
}

function safeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) ||
      /^(host|content-length|connection|transfer-encoding)$/i.test(key) ||
      value === undefined ||
      value === null
    ) {
      continue;
    }
    const stringValue = String(value);
    if (/[\r\n]/.test(stringValue)) {
      throw new Error("Invalid newline in request header");
    }
    result[key] = stringValue;
  }
  return result;
}

function buildAuthHeaders(authType, credentials) {
  switch (authType) {
    case "bearer":
      if (!credentials?.token) throw new Error("Bearer token is missing");
      return { Authorization: `Bearer ${credentials.token}` };
    case "basic":
      if (credentials?.username === undefined || credentials?.password === undefined) {
        throw new Error("Basic auth username or password is missing");
      }
      return {
        Authorization: `Basic ${Buffer.from(
          `${credentials.username}:${credentials.password}`
        ).toString("base64")}`,
      };
    case "api_key": {
      const key = credentials?.apiKey ?? credentials?.api_key ?? credentials?.key;
      if (!key) throw new Error("API key is missing");
      return { [credentials?.headerName || "X-API-Key"]: String(key) };
    }
    case "none":
      return {};
    default:
      throw new Error(`Unsupported connector auth type: ${authType}`);
  }
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(Math.max(number, min), max) : fallback;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function redactError(error) {
  return String(error?.message || "Connector request failed")
    .replace(/(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function redactCredentialEchoes(value, credentials) {
  const sensitiveValues = [];
  const collectSecrets = (item) => {
    if (typeof item === "string" && item.length > 0) sensitiveValues.push(item);
    else if (typeof item === "number") {
      sensitiveValues.push(String(item));
    } else if (Array.isArray(item)) item.forEach(collectSecrets);
    else if (item && typeof item === "object") {
      Object.values(item).forEach(collectSecrets);
    }
  };
  collectSecrets(credentials);
  sensitiveValues.sort((a, b) => b.length - a.length);
  const embeddedSecrets = sensitiveValues.filter((secret) => secret.length >= 4);
  const scrub = (item) => {
    if (typeof item === "string") {
      if (sensitiveValues.includes(item)) return "[REDACTED]";
      return embeddedSecrets.reduce(
        (text, secret) => text.split(secret).join("[REDACTED]"),
        item
      );
    }
    if (Array.isArray(item)) return item.map(scrub);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, scrub(child)])
      );
    }
    return item;
  };
  return scrub(redactValue(value));
}

/** Store an encrypted tenant credential. Secret values never enter metadata. */
export async function saveConnectorCredential({
  db,
  companyId,
  connectorId,
  credentialKey,
  name,
  secrets,
  metadata = {},
  userId = null,
  id = null,
}) {
  if (!companyId || !connectorId || !credentialKey || !name) {
    throw new Error("companyId, connectorId, credentialKey, and name are required");
  }
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    throw new Error("secrets must be an object");
  }
  const ciphertext = encryptCredentials(secrets);
  const safeMetadata = {
    ...((metadata && typeof metadata === "object" && !Array.isArray(metadata))
      ? metadata
      : {}),
    fieldNames: Object.keys(secrets),
  };
  const result = id
    ? await db(
        `UPDATE platform_credentials
         SET name = $1, ciphertext = $2, metadata = $3::jsonb, active = TRUE,
             rotated_at = NOW(), updated_at = NOW()
         WHERE id = $4 AND company_id = $5 AND connector_id = $6
         RETURNING id, company_id, connector_id, credential_key, name, metadata,
                   active, rotated_at, created_at, updated_at`,
        [name, ciphertext, JSON.stringify(safeMetadata), id, companyId, connectorId]
      )
    : await db(
        `INSERT INTO platform_credentials
           (company_id, connector_id, credential_key, name, ciphertext, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         RETURNING id, company_id, connector_id, credential_key, name, metadata,
                   active, rotated_at, created_at, updated_at`,
        [
          companyId,
          connectorId,
          credentialKey,
          name,
          ciphertext,
          JSON.stringify(safeMetadata),
          userId,
        ]
      );
  if (!result.rows[0]) return null;
  return toPublicCredential(result.rows[0]);
}

export function toPublicCredential(row) {
  if (!row) return null;
  const metadata = parseJson(row.metadata, {});
  return {
    id: row.id,
    companyId: row.company_id,
    connectorId: row.connector_id,
    credentialKey: row.credential_key,
    name: row.name,
    active: row.active,
    hasSecrets: Array.isArray(metadata.fieldNames) && metadata.fieldNames.length > 0,
    fields: (metadata.fieldNames || []).map((key) => ({ key, value: "[REDACTED]" })),
    rotatedAt: row.rotated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Internal-only credential resolver. Platform credentials require explicit
 * platformCredentialAccess=true; callers must establish the superadmin gate.
 */
export async function resolveConnectorCredential({
  db,
  credentialId,
  companyId,
  connectorId,
  platformCredentialAccess = false,
  actorUserId = null,
}) {
  if (platformCredentialAccess === true) {
    if (!actorUserId) return null;
    const gate = await db(
      "SELECT is_superadmin FROM users WHERE id = $1 AND active = TRUE",
      [actorUserId]
    );
    if (gate.rows[0]?.is_superadmin !== true) return null;
  }
  const result = await db(
    `SELECT id, company_id, connector_id, ciphertext, active
     FROM platform_credentials
     WHERE id = $1 AND connector_id = $2 AND active = TRUE
       AND (company_id = $3 OR (company_id IS NULL AND $4 = TRUE))
     LIMIT 1`,
    [credentialId, connectorId, companyId, platformCredentialAccess === true]
  );
  const row = result.rows[0];
  if (!row) return null;
  return decryptCredentials(row.ciphertext);
}

/**
 * Generic action executor for parent Action Registry wiring.
 *
 * Operation mappings accept literal values, { source: "input.path" }, or
 * "{{input.path}}" strings. `operation.request` may contain `headers`,
 * `query`, and `body`; response mappings map output keys to response paths.
 */
export function createConnectorActionExecutor({ db, fetchImpl = fetch, sleep = delay }) {
  if (typeof db !== "function") throw new Error("db query function is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  return async function executeConnectorAction({
    companyId,
    connectionId,
    operation: operationKey,
    input = {},
    platformCredentialAccess = false,
    actorUserId = null,
  }) {
    if (!companyId || !connectionId || !operationKey) {
      throw new Error("companyId, connectionId, and operation are required");
    }
    const connectionResult = await db(
      `SELECT c.id, c.company_id, c.connector_definition_id, c.credential_id,
              c.timeout_ms AS connection_timeout_ms, c.retry_policy AS connection_retry_policy,
              d.connector_key, d.auth_type, d.base_url, d.operations,
              d.timeout_ms AS definition_timeout_ms, d.retry_policy AS definition_retry_policy,
              d.status AS definition_status
       FROM integration_connections c
       JOIN platform_connector_definitions d ON d.id = c.connector_definition_id
       WHERE c.id = $1 AND c.company_id = $2 AND c.enabled = TRUE
       LIMIT 1`,
      [connectionId, companyId]
    );
    const connection = connectionResult.rows[0];
    if (!connection || connection.definition_status !== "ACTIVE") {
      throw new Error("Connector connection is unavailable");
    }

    const operations = parseJson(connection.operations, []);
    const definition = Array.isArray(operations)
      ? operations.find((item) => item?.key === operationKey || item?.name === operationKey)
      : operations?.[operationKey];
    if (!definition) throw new Error("Connector operation is not defined");
    const method = String(definition.method || "GET").toUpperCase();
    if (!HTTP_METHODS.has(method)) throw new Error("Unsupported connector HTTP method");
    const authType = String(connection.auth_type || "none").toLowerCase();
    if (!AUTH_TYPES.has(authType)) throw new Error("Unsupported connector auth type");

    const baseUrl = new URL(connection.base_url);
    if (!(await isAllowedConnectorTarget(baseUrl.href))) {
      throw new Error("Connector base URL target is not allowed");
    }
    const relativePath = String(definition.path || "");
    if (/^[a-z][a-z\d+.-]*:/i.test(relativePath) || relativePath.startsWith("//")) {
      throw new Error("Connector operation path must be relative");
    }
    const url = new URL(relativePath.replace(/^\/+/, ""), `${baseUrl.href.replace(/\/+$/, "")}/`);
    if (url.origin !== baseUrl.origin || !(await isAllowedConnectorTarget(url.href))) {
      throw new Error("Connector operation target is not allowed");
    }

    const credentials = connection.credential_id
      ? await resolveConnectorCredential({
          db,
          credentialId: connection.credential_id,
          companyId,
          connectorId: connection.connector_definition_id,
          platformCredentialAccess,
          actorUserId,
        })
      : {};
    if (connection.credential_id && !credentials) {
      throw new Error("Connector credential is unavailable");
    }
    const context = { input, credentials, response: undefined };
    const requestMapping = definition.requestMapping || definition.request || {};
    const headers = safeHeaders({
      Accept: "application/json",
      ...mapFields(definition.headers, context),
      ...mapFields(requestMapping.headers, context),
    });
    url.search = new URLSearchParams({
      ...Object.fromEntries(url.searchParams.entries()),
      ...mapFields(definition.params, context),
      ...mapFields(requestMapping.query, context),
    }).toString();
    const authHeaders = buildAuthHeaders(authType, credentials || {});
    const bodyMapping =
      requestMapping.body !== undefined ? requestMapping.body : definition.body;
    const body =
      bodyMapping === undefined ? undefined : resolveValue(bodyMapping, context);
    const requestHeaders = { ...headers };
    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      if (!Object.keys(requestHeaders).some((key) => key.toLowerCase() === "content-type")) {
        requestHeaders["Content-Type"] = "application/json";
      }
    }
    for (const [key, value] of Object.entries(safeHeaders(authHeaders))) {
      for (const existing of Object.keys(requestHeaders)) {
        if (existing.toLowerCase() === key.toLowerCase()) delete requestHeaders[existing];
      }
      requestHeaders[key] = value;
    }
    const timeoutMs = boundedInteger(
      definition.timeoutMs ??
        definition.timeout ??
        connection.connection_timeout_ms ??
        connection.definition_timeout_ms,
      15000,
      100,
      MAX_TIMEOUT_MS
    );
    const retryPolicy = parseJson(
      definition.retryPolicy ??
        definition.retries ??
        connection.connection_retry_policy ??
        connection.definition_retry_policy,
      {}
    );
    const retryConfig =
      typeof retryPolicy === "number" ? { maxAttempts: retryPolicy } : retryPolicy;
    const attempts = boundedInteger(retryConfig?.maxAttempts, 1, 1, MAX_ATTEMPTS);
    const backoffMs = boundedInteger(retryConfig?.backoffMs, 250, 0, 30000);
    const retryStatuses = Array.isArray(retryConfig?.statuses)
      ? retryConfig.statuses.filter((status) => Number.isInteger(status))
      : [408, 425, 429, 500, 502, 503, 504];

    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method,
          headers: requestHeaders,
          body: body === undefined || method === "GET" || method === "DELETE"
            ? undefined
            : JSON.stringify(body),
          signal: controller.signal,
          redirect: "manual",
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (location) {
            const redirectUrl = new URL(location, url);
            if (
              redirectUrl.origin !== url.origin ||
              !(await isAllowedConnectorTarget(redirectUrl.href))
            ) {
              throw new Error("Connector redirect target is not allowed");
            }
            throw new Error("Connector redirects are not supported");
          }
        }
        const text = await response.text();
        let payload = null;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = text;
          }
        }
        if (!response.ok) {
          const error = new Error(`Connector returned HTTP ${response.status}`);
          error.retryable = retryStatuses.includes(response.status);
          throw error;
        }
        const mapping = definition.responseMapping || definition.response || {};
        const output =
          mapping && typeof mapping === "object" && !Array.isArray(mapping)
            ? Object.fromEntries(
                Object.entries(mapping).map(([key, path]) => [
                  key,
                  resolveValue(
                    typeof path === "string" && path.startsWith("response.")
                      ? { source: path }
                      : path,
                    { input, credentials: undefined, response: payload }
                  ),
                ])
              )
            : payload;
        return {
          success: true,
          connectorKey: connection.connector_key,
          operation: operationKey,
          status: response.status,
          data: redactCredentialEchoes(output, credentials),
          attempts: attempt,
        };
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || error?.retryable === false) break;
        if (error?.retryable !== true && error?.name === "Error" && /not allowed|not supported/.test(error.message)) {
          break;
        }
        await sleep(Math.min(backoffMs * 2 ** (attempt - 1), 30000));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(redactError(lastError));
  };
}
