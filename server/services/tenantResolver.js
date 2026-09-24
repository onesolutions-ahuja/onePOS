import pg from "pg";

const { Pool } = pg;

export function normalizeHostname(hostname = "localhost") {
  const value = String(hostname || "localhost").trim().toLowerCase();
  if (!value) return "localhost";
  return value.split(",")[0].replace(/\.$/, "").replace(/\[|\]/g, "");
}

export function stripPort(hostname) {
  const value = normalizeHostname(hostname);
  if (value.includes(":")) {
    return value.replace(/:\d+$/, "");
  }
  return value;
}

export function getRequestHostname(req) {
  if (!req) return "localhost";
  const forwardedHost = req.headers?.["x-forwarded-host"] || req.headers?.["x-forwarded-server"];
  if (forwardedHost) return stripPort(forwardedHost);
  const hostHeader = req.headers?.host || req.hostname || req.headers?.[":authority"] || "localhost";
  return stripPort(hostHeader);
}

export function resolveDatabaseMode(mode, env = process.env) {
  const candidate = String(mode ?? env?.ONEPOS_DATABASE_MODE ?? env?.DATABASE_MODE ?? "ONEPOS_MANAGED")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");

  if (["ONEPOS_MANAGED", "MANAGED", "ONEPOS_MANAGED_MODE", "HOSTED"].includes(candidate)) {
    return "ONEPOS_MANAGED";
  }

  if (["CUSTOMER_MANAGED", "CUSTOMER_MANAGED_MODE", "CLIENT_MANAGED", "CUSTOMER", "TENANT_MANAGED"].includes(candidate)) {
    return "CUSTOMER_MANAGED";
  }

  return "ONEPOS_MANAGED";
}

export function isCustomerManagedDatabaseMode(mode, env = process.env) {
  return resolveDatabaseMode(mode, env) === "CUSTOMER_MANAGED";
}

export function loadTenantDirectory(env = process.env) {
  const directory = {
    tenants: {},
    hostMap: {},
  };

  const rawValues = [
    env.TENANT_DIRECTORY_JSON,
    env.TENANT_DIRECTORY,
    env.TENANT_DATABASE_URLS,
    env.TENANT_DB_MAP,
    env.TENANT_HOST_MAP,
  ].filter(Boolean);

  for (const raw of rawValues) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object") {
        if (parsed.tenants) {
          Object.assign(directory.tenants, parsed.tenants);
        }
        if (parsed.hostMap) {
          Object.assign(directory.hostMap, parsed.hostMap);
        }
        if (parsed.hosts) {
          Object.assign(directory.hostMap, parsed.hosts);
        }
        if (parsed.databaseUrls) {
          Object.assign(directory.tenants, parsed.databaseUrls);
        }
        for (const [key, value] of Object.entries(parsed)) {
          if (value && typeof value === "object" && ("databaseUrl" in value || "connectionString" in value || "dsn" in value || "databaseMode" in value || "mode" in value)) {
            const databaseUrl = value.databaseUrl || value.connectionString || value.dsn;
            if (databaseUrl || value.databaseMode || value.mode) {
              directory.tenants[key] = {
                ...(typeof directory.tenants[key] === "object" ? directory.tenants[key] : {}),
                tenantKey: key,
                databaseUrl: databaseUrl || null,
                hostname: value.hostname || value.host || null,
                status: value.status || "active",
                databaseMode: resolveDatabaseMode(value.databaseMode || value.mode || "ONEPOS_MANAGED", env),
              };
            }
          }
        }
      }
    } catch {
      // Ignore malformed JSON config and continue reading line-based definitions.
    }
  }

  const envEntries = Object.entries(env || {}).filter(([key]) => key.startsWith("TENANT_") && (key.endsWith("_DATABASE_URL") || key.endsWith("_DB_URL") || key.endsWith("_DSN")));
  for (const [key, value] of envEntries) {
    const tenantKey = key.replace(/^TENANT_/, "").replace(/_(DATABASE_URL|DB_URL|DSN)$/i, "").toLowerCase();
    if (tenantKey && value) {
      directory.tenants[tenantKey] = {
        ...(typeof directory.tenants[tenantKey] === "object" ? directory.tenants[tenantKey] : {}),
        tenantKey,
        databaseUrl: value,
        status: "active",
        databaseMode: resolveDatabaseMode(env[`${tenantKey.toUpperCase()}_DATABASE_MODE`] || env.DATABASE_MODE || env.ONEPOS_DATABASE_MODE || "ONEPOS_MANAGED", env),
      };
    }
  }

  const hostEntries = Object.entries(env || {}).filter(([key]) => key.startsWith("TENANT_HOST_") || key.startsWith("TENANT_HOSTNAME_"));
  for (const [key, value] of hostEntries) {
    const host = normalizeHostname(value);
    const tenantKey = key.replace(/^TENANT_HOSTNAME_/, "").replace(/^TENANT_HOST_/, "").toLowerCase();
    if (host && tenantKey) {
      directory.hostMap[host] = tenantKey;
    }
  }

  if (env.TENANT_HOST_MAP) {
    try {
      const parsed = JSON.parse(env.TENANT_HOST_MAP);
      if (parsed && typeof parsed === "object") {
        Object.assign(directory.hostMap, Object.fromEntries(Object.entries(parsed).map(([host, tenantKey]) => [normalizeHostname(host), String(tenantKey).toLowerCase()])));
      }
    } catch {
      // Ignore malformed host map.
    }
  }

  return directory;
}

export function parseTenantHostname(hostname, env = process.env) {
  const host = stripPort(normalizeHostname(hostname || "localhost"));

  if (!host || host === "localhost") {
    return {
      tenantKey: null,
      hostname: host,
      kind: "default",
      isLocalhost: true,
      isDefault: true,
      status: "default",
    };
  }

  if (host.endsWith(".localhost")) {
    const tenantKey = host.slice(0, -".localhost".length);
    return {
      tenantKey: tenantKey || null,
      hostname: host,
      kind: "localhost-subdomain",
      isLocalhost: true,
      isDefault: false,
      status: tenantKey ? "tenant" : "default",
    };
  }

  const firstLabel = host.split(".")[0];
  const directory = loadTenantDirectory(env);
  const hostMap = directory.hostMap || {};
  if (hostMap[host]) {
    return {
      tenantKey: String(hostMap[host]).toLowerCase(),
      hostname: host,
      kind: "explicit-host",
      isLocalhost: false,
      isDefault: false,
      status: "tenant",
    };
  }

  if (firstLabel && firstLabel !== "www") {
    return {
      tenantKey: firstLabel,
      hostname: host,
      kind: "tenant-subdomain",
      isLocalhost: false,
      isDefault: false,
      status: "tenant",
    };
  }

  return {
    tenantKey: null,
    hostname: host,
    kind: "unknown",
    isLocalhost: false,
    isDefault: false,
    status: "unknown",
  };
}

export function resolveTenantFromHostname(hostname, env = process.env, options = {}) {
  const directory = loadTenantDirectory(env);
  const host = stripPort(normalizeHostname(hostname || "localhost"));
  const explicitTenantFromHostMap = directory.hostMap[host];
  if (explicitTenantFromHostMap) {
    const tenantKey = String(explicitTenantFromHostMap).toLowerCase();
    const tenant = directory.tenants[tenantKey] || null;
    const databaseUrl = tenant?.databaseUrl || env[`${tenantKey.toUpperCase()}_DATABASE_URL`] || null;
    const databaseMode = resolveDatabaseMode(tenant?.databaseMode || env[`${tenantKey.toUpperCase()}_DATABASE_MODE`] || env.DATABASE_MODE || env.ONEPOS_DATABASE_MODE || "ONEPOS_MANAGED", env);
    return {
      ...parseTenantHostname(host, env),
      tenantKey,
      hostname: host,
      isLocalhost: host.endsWith(".localhost") || host === "localhost",
      databaseUrl,
      databaseMode,
      credentialSource: databaseUrl ? (tenant?.databaseUrl ? "tenant-directory" : "tenant-env") : "none",
      status: tenant?.status === "disabled" ? "disabled" : (databaseUrl ? "active" : "unknown"),
    };
  }

  const parsed = parseTenantHostname(host, env);
  const tenantKey = parsed.tenantKey;
  const tenantEntry = tenantKey ? (directory.tenants[tenantKey] || null) : null;
  const tenantEnvUrl = tenantKey ? env[`${tenantKey.toUpperCase()}_DATABASE_URL`] || null : null;

  if (host === "localhost" || host === "127.0.0.1") {
    const defaultMode = resolveDatabaseMode(env.ONEPOS_DATABASE_MODE || env.DATABASE_MODE || "ONEPOS_MANAGED", env);
    return {
      ...parsed,
      tenantKey: options.defaultTenantKey || null,
      hostname: host,
      databaseUrl: env.DATABASE_URL || null,
      databaseMode: defaultMode,
      credentialSource: env.DATABASE_URL ? "fallback-default" : "none",
      status: env.DATABASE_URL ? "default" : "unknown",
    };
  }

  if (!tenantKey) {
    return {
      ...parsed,
      tenantKey: null,
      databaseUrl: null,
      databaseMode: resolveDatabaseMode(env.ONEPOS_DATABASE_MODE || env.DATABASE_MODE || "ONEPOS_MANAGED", env),
      credentialSource: "none",
      status: "unknown",
    };
  }

  if (tenantEntry?.status === "disabled") {
    return {
      ...parsed,
      tenantKey,
      hostname: host,
      databaseUrl: tenantEntry.databaseUrl || null,
      databaseMode: resolveDatabaseMode(tenantEntry?.databaseMode || env[`${tenantKey.toUpperCase()}_DATABASE_MODE`] || env.DATABASE_MODE || env.ONEPOS_DATABASE_MODE || "ONEPOS_MANAGED", env),
      credentialSource: tenantEntry.databaseUrl ? "tenant-directory" : "none",
      status: "disabled",
    };
  }

  const databaseUrl = tenantEntry?.databaseUrl || tenantEnvUrl || null;
  return {
    ...parsed,
    tenantKey,
    hostname: host,
    databaseUrl,
    databaseMode: resolveDatabaseMode(tenantEntry?.databaseMode || env[`${tenantKey.toUpperCase()}_DATABASE_MODE`] || env.DATABASE_MODE || env.ONEPOS_DATABASE_MODE || "ONEPOS_MANAGED", env),
    credentialSource: tenantEntry?.databaseUrl ? "tenant-directory" : (tenantEnvUrl ? "tenant-env" : "none"),
    status: databaseUrl ? "active" : "unknown",
  };
}

export function createTenantPoolManager(options = {}) {
  const env = options.env || process.env;
  const PoolFactory = options.PoolFactory || Pool;
  const poolOptions = options.poolOptions || {};
  const cache = new Map();

  function defaultResolver(tenantKey) {
    if (!tenantKey || tenantKey === "default") return env.DATABASE_URL || null;
    const directory = loadTenantDirectory(env);
    const tenant = directory.tenants[tenantKey];
    if (tenant?.status === "disabled") return null;
    if (tenant?.databaseUrl) return tenant.databaseUrl;
    const envKey = `${tenantKey.toUpperCase()}_DATABASE_URL`;
    if (env[envKey]) return env[envKey];
    return null;
  }

  function resolveDatabaseUrl(tenantKey) {
    if (typeof options.resolveDatabaseUrl === "function") {
      return options.resolveDatabaseUrl(tenantKey, env);
    }
    return defaultResolver(tenantKey);
  }

  function buildPool(connectionString) {
    if (!connectionString) return null;
    return new PoolFactory({
      ...poolOptions,
      connectionString,
      ssl: connectionString.includes("://localhost") || connectionString.includes("://127.0.0.1") ? false : { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
      idle_in_transaction_session_timeout: 30000,
      lock_timeout: 15000,
      statement_timeout: 120000,
    });
  }

  function getPoolForTenant(tenantKey, databaseUrlOverride = null) {
    const key = String(tenantKey || "default").trim().toLowerCase() || "default";
    if (cache.has(key)) return cache.get(key);
    const databaseUrl = databaseUrlOverride || resolveDatabaseUrl(key);
    if (!databaseUrl) return null;
    const pool = buildPool(databaseUrl);
    if (!pool) return null;
    cache.set(key, pool);
    pool.on?.("error", (error) => {
      console.error(`Tenant pool error for ${key}:`, error.message);
    });
    return pool;
  }

  function hostIsLocalDefault(hostname) {
    const host = stripPort(normalizeHostname(hostname || "localhost"));
    return host === "localhost" || host === "127.0.0.1";
  }

  function getPoolForHostname(hostname) {
    const tenant = resolveTenantFromHostname(hostname, env, { defaultTenantKey: "default" });
    if (hostIsLocalDefault(hostname)) {
      return env.DATABASE_URL ? getPoolForTenant("default", env.DATABASE_URL) : null;
    }
    if (!tenant || !tenant.tenantKey || tenant.status === "unknown" || tenant.status === "disabled") {
      return null;
    }
    return getPoolForTenant(tenant.tenantKey, tenant.databaseUrl || resolveDatabaseUrl(tenant.tenantKey));
  }

  function getPoolForRequest(req) {
    const host = getRequestHostname(req);
    return getPoolForHostname(host);
  }

  function clearPool(tenantKey) {
    const key = String(tenantKey || "default").trim().toLowerCase() || "default";
    const pool = cache.get(key);
    if (pool) {
      pool.end?.();
      cache.delete(key);
    }
  }

  async function closeAll() {
    const pools = [...cache.values()];
    await Promise.allSettled(pools.map((pool) => pool.end?.()));
    cache.clear();
  }

  return {
    cache,
    getPoolForTenant,
    getPoolForHostname,
    getPoolForRequest,
    clearPool,
    closeAll,
    resolveDatabaseUrl,
  };
}

export function createTenantAwareDatabase(options = {}) {
  const { defaultPool = null, tenantPoolManager = null } = options;

  return async function tenantDb(query, params = [], req = null) {
    const provider = req && tenantPoolManager ? tenantPoolManager.getPoolForRequest(req) : null;
    const candidate = provider || defaultPool;
    if (!candidate) {
      throw new Error("DATABASE_URL is not configured");
    }
    return candidate.query(query, params);
  };
}
