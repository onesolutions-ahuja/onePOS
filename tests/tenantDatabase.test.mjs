import test from "node:test";
import assert from "node:assert/strict";
import {
  createTenantDatabaseRouter,
  createRequestDatabaseMiddleware,
  decryptDatabaseSecret,
  encryptDatabaseSecret,
  TENANT_DATABASE_UNAVAILABLE,
  validateTenantSchema,
  getRequestPool,
} from "../services/tenantDatabase.js";

class FakePool {
  constructor(options) {
    this.options = options;
    this.queries = [];
    this.ended = false;
    this.rows = [];
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql.includes("to_regclass")) {
      return { rows: [{ companies: "companies", products: "products", sales: "sales", migrations: null }] };
    }
    return { rows: this.rows, rowCount: this.rows.length };
  }

  async connect() {
    return {
      queries: this.queries,
      query: async (sql, params = []) => {
        this.queries.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
  }

  async end() {
    this.ended = true;
  }
}

function createControlPool(configs) {
  return {
    queries: [],
    async query(sql, params = []) {
      this.queries.push({ sql, params });
      if (sql.includes("tenant_database_configs")) {
        return { rows: [configs[params[0]]].filter(Boolean) };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

test("database secrets are encrypted and never equal to plaintext", () => {
  const env = { ONEPOS_DB_ENCRYPTION_KEY: "test-encryption-key" };
  const encrypted = encryptDatabaseSecret("super-secret", env);
  assert.notEqual(encrypted, "super-secret");
  assert.equal(decryptDatabaseSecret(encrypted, env), "super-secret");
});

test("managed companies use shared pool and customer companies use isolated external pools concurrently", async () => {
  const env = { ONEPOS_DB_ENCRYPTION_KEY: "test-encryption-key" };
  const password = encryptDatabaseSecret("secret", env);
  const control = createControlPool({
    a: { company_id: "a", database_mode: "ONEPOS_MANAGED", active: true },
    b: {
      company_id: "b", database_mode: "CUSTOMER_MANAGED", host: "db-b", port: 5432,
      database: "tenant_b", username: "tenant_b", password_ciphertext: password, ssl_mode: "require",
      active: true, schema_state: "COMPATIBLE",
    },
  });
  const shared = new FakePool({ connectionString: "postgres://shared" });
  const externalPools = [];
  const router = createTenantDatabaseRouter({
    controlPool: control,
    sharedPool: shared,
    env,
    PoolFactory: class extends FakePool {
      constructor(options) {
        super(options);
        externalPools.push(this);
      }
    },
  });

  const [a, b] = await Promise.all([router.resolveForCompany("a"), router.resolveForCompany("b")]);
  assert.equal(a.pool, shared);
  assert.notEqual(b.pool, shared);
  assert.equal(externalPools.length, 1);
  assert.match(externalPools[0].options.connectionString, /tenant_b/);

  await Promise.all([
    a.pool.query("SELECT products WHERE company_id=$1", ["a"]),
    b.pool.query("SELECT products WHERE company_id=$1", ["b"]),
    a.pool.query("SELECT customers WHERE company_id=$1", ["a"]),
    b.pool.query("SELECT customers WHERE company_id=$1", ["b"]),
  ]);
  assert.equal(shared.queries.length, 2);
  assert.equal(externalPools[0].queries.length, 3);
});

test("customer database outage fails without falling back to shared pool", async () => {
  const env = { ONEPOS_DB_ENCRYPTION_KEY: "test-encryption-key" };
  const control = createControlPool({
    b: {
      company_id: "b", database_mode: "CUSTOMER_MANAGED", host: "unavailable", port: 5432,
      database: "tenant_b", username: "tenant_b", password_ciphertext: encryptDatabaseSecret("secret", env),
      ssl_mode: "require", active: true,
    },
  });
  const shared = new FakePool({ connectionString: "postgres://shared" });
  const router = createTenantDatabaseRouter({
    controlPool: control,
    sharedPool: shared,
    env,
    PoolFactory: class {
      constructor() {}
      async query() { throw new Error("connection refused"); }
      async end() {}
    },
  });

  await assert.rejects(router.resolveForCompany("b"), (error) => error.code === TENANT_DATABASE_UNAVAILABLE);
  assert.equal(shared.queries.length, 0);
});

test("schema validation identifies a compatible customer database", async () => {
  const pool = new FakePool({});
  assert.equal(await validateTenantSchema(pool), "COMPATIBLE");
});

test("request database context remains isolated across concurrent authenticated requests", async () => {
  const env = { ONEPOS_DB_ENCRYPTION_KEY: "test-encryption-key" };
  const password = encryptDatabaseSecret("secret", env);
  const control = createControlPool({
    a: { company_id: "a", database_mode: "CUSTOMER_MANAGED", host: "db-a", database: "a", username: "a", password_ciphertext: password, active: true },
    b: { company_id: "b", database_mode: "CUSTOMER_MANAGED", host: "db-b", database: "b", username: "b", password_ciphertext: password, active: true },
  });
  const shared = new FakePool({});
  const pools = [];
  const router = createTenantDatabaseRouter({
    controlPool: control,
    sharedPool: shared,
    env,
    PoolFactory: class extends FakePool {
      constructor(options) {
        super(options);
        pools.push(this);
      }
    },
  });
  const middleware = createRequestDatabaseMiddleware({ router });
  const run = (companyId, sql) => new Promise((resolve, reject) => {
    middleware({ user: { companyId } }, {}, async (error) => {
      if (error) return reject(error);
      await new Promise((done) => setTimeout(done, companyId === "a" ? 10 : 1));
      const pool = getRequestPool();
      await pool.query(sql);
      resolve(pool.options.connectionString);
    });
  });
  const [a, b] = await Promise.all([run("a", "A products"), run("b", "B customers")]);
  assert.match(a, /db-a/);
  assert.match(b, /db-b/);
  assert.notEqual(a, b);
});
