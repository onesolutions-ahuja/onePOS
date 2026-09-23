import test from "node:test";
import assert from "node:assert/strict";
import {
  createTenantAwareDatabase,
  createTenantPoolManager,
  isCustomerManagedDatabaseMode,
  parseTenantHostname,
  resolveDatabaseMode,
  resolveTenantFromHostname,
} from "../services/tenantResolver.js";

class FakePool {
  static instances = [];

  constructor(config) {
    this.config = config;
    this.queries = [];
    FakePool.instances.push(this);
  }

  query(sql, params = []) {
    this.queries.push({ sql, params });
    return Promise.resolve({ rows: [], rowCount: 0 });
  }

  end() {
    return Promise.resolve();
  }

  on() {}
}

test("parseTenantHostname resolves localhost tenant hosts and default hostname", () => {
  assert.deepEqual(parseTenantHostname("alpha.localhost:10000"), {
    tenantKey: "alpha",
    hostname: "alpha.localhost",
    kind: "localhost-subdomain",
    isLocalhost: true,
    isDefault: false,
    status: "tenant",
  });

  assert.deepEqual(parseTenantHostname("localhost:10000"), {
    tenantKey: null,
    hostname: "localhost",
    kind: "default",
    isLocalhost: true,
    isDefault: true,
    status: "default",
  });
});

test("resolveTenantFromHostname honors explicit host mappings and tenant directory config", () => {
  const env = {
    TENANT_HOST_MAP: JSON.stringify({ "pos.customercompany.com": "acme" }),
    TENANT_DIRECTORY_JSON: JSON.stringify({
      tenants: {
        acme: { tenantKey: "acme", databaseUrl: "postgres://tenant-acme.internal/app", status: "active" },
        beta: { tenantKey: "beta", databaseUrl: "postgres://tenant-beta.internal/app", status: "active" },
      },
    }),
  };

  const result = resolveTenantFromHostname("pos.customercompany.com", env);
  assert.equal(result.tenantKey, "acme");
  assert.equal(result.databaseUrl, "postgres://tenant-acme.internal/app");
  assert.equal(result.status, "active");

  const localhostResult = resolveTenantFromHostname("beta.localhost:10000", env);
  assert.equal(localhostResult.tenantKey, "beta");
  assert.equal(localhostResult.databaseUrl, "postgres://tenant-beta.internal/app");
});

test("tenant pool manager isolates per-tenant pools and resolves by request host", () => {
  const manager = createTenantPoolManager({
    env: {
      DATABASE_URL: "postgres://default.internal/app",
      TENANT_DIRECTORY_JSON: JSON.stringify({
        tenants: {
          alpha: { tenantKey: "alpha", databaseUrl: "postgres://alpha.internal/app", status: "active" },
          beta: { tenantKey: "beta", databaseUrl: "postgres://beta.internal/app", status: "active" },
        },
      }),
    },
    PoolFactory: FakePool,
  });

  const alphaPool = manager.getPoolForHostname("alpha.localhost:10000");
  const betaPool = manager.getPoolForHostname("beta.localhost:10000");
  const defaultPool = manager.getPoolForHostname("localhost:10000");

  assert.ok(alphaPool);
  assert.ok(betaPool);
  assert.notEqual(alphaPool, betaPool);
  assert.notEqual(alphaPool, defaultPool);
  assert.equal(alphaPool.config.connectionString, "postgres://alpha.internal/app");
  assert.equal(betaPool.config.connectionString, "postgres://beta.internal/app");
  assert.equal(defaultPool.config.connectionString, "postgres://default.internal/app");

  const requestPool = manager.getPoolForRequest({ headers: { host: "alpha.localhost:10000" } });
  assert.equal(requestPool, alphaPool);
});

test("tenant-aware database wrapper selects tenant pool from request and falls back to default pool", async () => {
  const defaultPool = new FakePool({ connectionString: "postgres://default.internal/app" });
  const manager = createTenantPoolManager({
    env: {
      TENANT_DIRECTORY_JSON: JSON.stringify({
        tenants: {
          alpha: { tenantKey: "alpha", databaseUrl: "postgres://alpha.internal/app", status: "active" },
        },
      }),
    },
    PoolFactory: FakePool,
  });

  const tenantDb = createTenantAwareDatabase({ defaultPool, tenantPoolManager: manager });

  await tenantDb("SELECT 1", [], { headers: { host: "alpha.localhost:10000" } });
  await tenantDb("SELECT 2", [], {});

  const alphaPool = manager.cache.get("alpha");
  assert.equal(alphaPool.queries.length, 1);
  assert.equal(alphaPool.queries[0].sql, "SELECT 1");
  assert.equal(defaultPool.queries.length, 1);
  assert.equal(defaultPool.queries[0].sql, "SELECT 2");
});

test("database modes normalize to ONEPOS_MANAGED or CUSTOMER_MANAGED", () => {
  assert.equal(resolveDatabaseMode("onepos_managed"), "ONEPOS_MANAGED");
  assert.equal(resolveDatabaseMode("CUSTOMER_MANAGED"), "CUSTOMER_MANAGED");
  assert.equal(resolveDatabaseMode("tenant-managed"), "CUSTOMER_MANAGED");
  assert.equal(resolveDatabaseMode("unknown"), "ONEPOS_MANAGED");
  assert.equal(isCustomerManagedDatabaseMode("customer_managed"), true);
  assert.equal(isCustomerManagedDatabaseMode("ONEPOS_MANAGED"), false);
});

test("tenant resolution exposes database mode for hosted and customer-managed tenants", () => {
  const env = {
    DATABASE_URL: "postgres://onepos.internal/core",
    TENANT_DIRECTORY_JSON: JSON.stringify({
      tenants: {
        alpha: { tenantKey: "alpha", databaseUrl: "postgres://alpha.internal/app", databaseMode: "CUSTOMER_MANAGED", status: "active" },
        beta: { tenantKey: "beta", databaseUrl: "postgres://beta.internal/app", status: "active" },
      },
    }),
  };

  const customerTenant = resolveTenantFromHostname("alpha.localhost:10000", env);
  const managedTenant = resolveTenantFromHostname("beta.localhost:10000", env);
  const defaultTenant = resolveTenantFromHostname("localhost:10000", env);

  assert.equal(customerTenant.databaseMode, "CUSTOMER_MANAGED");
  assert.equal(managedTenant.databaseMode, "ONEPOS_MANAGED");
  assert.equal(defaultTenant.databaseMode, "ONEPOS_MANAGED");
});
