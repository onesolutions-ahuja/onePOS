import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { initializeDatabase } from "../database/init.js";
import { resolveDatabaseMode } from "./tenantResolver.js";

export const TENANT_DATABASE_UNAVAILABLE = "TENANT_DATABASE_UNAVAILABLE";
export const TENANT_SCHEMA_STATES = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  COMPATIBLE: "COMPATIBLE",
  MIGRATION_REQUIRED: "MIGRATION_REQUIRED",
  UNSUPPORTED: "UNSUPPORTED",
});

const requestStore = new AsyncLocalStorage();

function createHashKey(value) {
  return createHash("sha256").update(String(value)).digest();
}

export function encryptDatabaseSecret(value, env = process.env) {
  if (value === null || value === undefined || value === "") return null;
  const key = createHashKey(env.ONEPOS_DB_ENCRYPTION_KEY || "");
  if (!env.ONEPOS_DB_ENCRYPTION_KEY) throw new Error("ONEPOS_DB_ENCRYPTION_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptDatabaseSecret(value, env = process.env) {
  if (!value) return null;
  const key = createHashKey(env.ONEPOS_DB_ENCRYPTION_KEY || "");
  if (!env.ONEPOS_DB_ENCRYPTION_KEY) throw new Error("ONEPOS_DB_ENCRYPTION_KEY is not configured");
  const [ivText, tagText, ciphertextText] = String(value).split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted database secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function sanitizeTenantDatabaseError(error) {
  const result = new Error("Tenant database is unavailable");
  result.code = TENANT_DATABASE_UNAVAILABLE;
  result.cause = error;
  return result;
}

export function tenantDatabaseDiagnostic(error) {
  const cause = error?.cause || error;
  const relationMatch = String(cause?.message || "").match(/relation "([^"]+)" does not exist/i);
  const diagnostic = {
    code: cause?.code || "UNKNOWN",
    category: cause?.category || (cause?.code ? "postgresql" : "connection"),
  };
  if (cause?.errno) diagnostic.errno = cause.errno;
  if (cause?.syscall) diagnostic.syscall = cause.syscall;
  if (relationMatch?.[1]) diagnostic.relation = relationMatch[1];
  if (error?.step) diagnostic.step = error.step;
  return diagnostic;
}

function connectionString(config, env = process.env) {
  if (config.connection_string) return config.connection_string;
  const url = new URL(`postgresql://${encodeURIComponent(config.username)}:${encodeURIComponent(decryptDatabaseSecret(config.password_ciphertext, env))}@${config.host}:${config.port || 5432}/${config.database}`);
  if (config.ssl_mode === "disable") return url.toString();
  return url.toString();
}

function poolOptions(connection, config = {}) {
  return {
    connectionString: connection,
    max: Math.min(Math.max(Number(config.pool_max || 5), 1), 20),
    min: 0,
    idleTimeoutMillis: Math.min(Math.max(Number(config.idle_timeout_ms || 30000), 1000), 300000),
    connectionTimeoutMillis: 15000,
    idle_in_transaction_session_timeout: 30000,
    lock_timeout: 15000,
    statement_timeout: 120000,
    ssl: config.ssl_mode === "disable" ? false : { rejectUnauthorized: config.ssl_mode === "verify-full" },
  };
}

export function createTenantDatabaseRouter({ controlPool, sharedPool, PoolFactory, env = process.env, maxCachedPools = 100 } = {}) {
  if (!controlPool) throw new Error("A control-plane pool is required");
  if (!sharedPool) throw new Error("A shared onePOS pool is required");
  const cache = new Map();
  const factory = PoolFactory || sharedPool.constructor;

  async function loadConfig(companyId) {
    const result = await controlPool.query(
      `SELECT company_id, database_mode, host, port, database_name AS database, username,
              password_ciphertext, ssl_mode, active, schema_state, updated_at
       FROM tenant_database_configs WHERE company_id=$1`,
      [companyId]
    );
    return result.rows[0] || { company_id: companyId, database_mode: "ONEPOS_MANAGED", active: true };
  }

  async function getExternalPool(config, { cachePool = true, operation = "connect" } = {}) {
    const key = `${config.company_id}:${config.updated_at || config.password_ciphertext || config.host || "managed"}`;
    if (cachePool && cache.has(key)) return cache.get(key);
    let pool;
    try {
      pool = new factory(poolOptions(connectionString(config, env), config));
      await pool.query("SELECT 1");
    } catch (error) {
      try { await pool?.end?.(); } catch { /* preserve the sanitized connection error */ }
      const sanitized = sanitizeTenantDatabaseError(error);
      sanitized.operation = operation;
      sanitized.companyId = config.company_id;
      throw sanitized;
    }
    pool.on?.("error", (error) => {
      console.error("Tenant database pool error:", error.code || "connection failure");
    });
    if (!cachePool) return pool;
    cache.set(key, pool);
    while (cache.size > maxCachedPools) {
      const firstKey = cache.keys().next().value;
      const firstPool = cache.get(firstKey);
      cache.delete(firstKey);
      try { await firstPool?.end?.(); } catch { /* eviction must not affect another tenant */ }
    }
    return pool;
  }

  async function testExternalConfig(config) {
    const pool = await getExternalPool(config, { cachePool: false, operation: "test_connection" });
    try {
      await pool.query("SELECT 1");
      return true;
    } finally {
      try { await pool.end?.(); } catch { /* test cleanup must not mask the result */ }
    }
  }

  async function resolveForCompany(companyId) {
    if (!companyId) throw sanitizeTenantDatabaseError(new Error("Company context is missing"));
    const config = await loadConfig(companyId);
    const mode = resolveDatabaseMode(config.database_mode, env);
    if (mode === "ONEPOS_MANAGED") {
      return { companyId, mode, pool: sharedPool, config };
    }
    if (!config.active || !config.host || !config.database || !config.username || !config.password_ciphertext) {
      throw sanitizeTenantDatabaseError(new Error("Customer database is not active"));
    }
    return { companyId, mode, pool: await getExternalPool(config), config };
  }

  async function getPoolForConfig(config) {
    if (!config || resolveDatabaseMode(config.database_mode, env) !== "CUSTOMER_MANAGED") {
      return sharedPool;
    }
    if (!config.host || !config.database || !config.username || !config.password_ciphertext) {
      throw sanitizeTenantDatabaseError(new Error("Customer database is not configured"));
    }
    return getExternalPool(config, { operation: "resolve_customer_database" });
  }

  async function closeAll() {
    await Promise.all([...cache.values()].map((pool) => pool.end?.()));
    cache.clear();
  }

  return { cache, loadConfig, resolveForCompany, getPoolForConfig, testExternalConfig, closeAll };
}

export function createRequestDatabaseMiddleware({ router }) {
  return async function requestDatabaseContext(req, res, next) {
    if (!req.user?.companyId) return next();
    try {
      const context = await router.resolveForCompany(req.user.companyId);
      req.tenantDatabase = context;
      req.tenantPool = context.pool;
      req.db = (query, params = []) => context.pool.query(query, params);
      return requestStore.run(context, next);
    } catch (error) {
      if (error?.code === TENANT_DATABASE_UNAVAILABLE) {
        return res.status(503).json({ success: false, code: TENANT_DATABASE_UNAVAILABLE, message: "Company database is unavailable" });
      }
      return next(error);
    }
  };
}

export function getRequestDatabaseContext() {
  return requestStore.getStore() || null;
}

export function getRequestPool(fallback = null) {
  return getRequestDatabaseContext()?.pool || fallback;
}

export async function validateTenantSchema(pool) {
  try {
    const result = await pool.query(
      `SELECT to_regclass('public.companies') AS companies,
              to_regclass('public.products') AS products,
              to_regclass('public.sales') AS sales,
              to_regclass('public.schema_migrations') AS migrations`
    );
    const row = result.rows[0] || {};
    if (!row.companies && !row.products && !row.sales) return TENANT_SCHEMA_STATES.UNINITIALIZED;
    if (!row.companies || !row.products || !row.sales) return TENANT_SCHEMA_STATES.MIGRATION_REQUIRED;
    return TENANT_SCHEMA_STATES.COMPATIBLE;
  } catch {
    return TENANT_SCHEMA_STATES.UNSUPPORTED;
  }
}

export async function initializeTenantSchema(pool) {
  const state = await validateTenantSchema(pool);
  if (![TENANT_SCHEMA_STATES.UNINITIALIZED, TENANT_SCHEMA_STATES.MIGRATION_REQUIRED].includes(state)) return state;
  const schemaPath = fileURLToPath(new URL("../database/schema.sql", import.meta.url));
  try {
    const canonicalSchema = await readFile(schemaPath, "utf8");
    await pool.query(canonicalSchema);
  } catch (error) {
    const wrapped = sanitizeTenantDatabaseError(error);
    wrapped.operation = "initialize_schema";
    wrapped.step = "canonical_schema";
    throw wrapped;
  }
  try {
    await initializeDatabase(pool);
  } catch (error) {
    const wrapped = sanitizeTenantDatabaseError(error);
    wrapped.operation = "initialize_schema";
    wrapped.step = "compatibility_migrations";
    throw wrapped;
  }
  return validateTenantSchema(pool);
}
