import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import createSuperadminRouter from "../routes/superadmin.js";

const uiSource = readFileSync(new URL("../src/pages/superadmin/LicensingAdmin.jsx", import.meta.url), "utf8");

function makeApp(role, { testConnectionError = null } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "user-1", is_superadmin: role === "superadmin", companyId: "company-1" };
    next();
  });
  const db = async (sql) => {
    if (sql.includes("is_superadmin")) return { rows: [{ is_superadmin: role === "superadmin" }] };
    return { rows: [] };
  };
  const tenantDatabaseRouter = {
    async loadConfig() {
      return {
        company_id: "company-1", database_mode: "CUSTOMER_MANAGED", host: "db.example",
        port: 5432, database: "onepos", username: "onepos", password_ciphertext: "encrypted",
        ssl_mode: "require", active: false, schema_state: "UNINITIALIZED",
      };
    },
    async testExternalConfig(config) {
      assert.equal(config.host, "db.example");
      assert.equal(config.password_ciphertext, "encrypted");
      if (testConnectionError) throw testConnectionError;
      return true;
    },
  };
  app.use("/api", createSuperadminRouter({
    authenticate: (_req, _res, next) => next(),
    db,
    tenantDatabaseRouter,
  }));
  return app;
}

async function request(app, method, path, body) {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("database configuration endpoints allow Platform Developer Superadmin", async () => {
  const result = await request(makeApp("superadmin"), "GET", "/api/superadmin/companies/company-1/database");
  assert.equal(result.status, 200);
  assert.equal(result.body.data.credentialsConfigured, true);
  assert.equal(result.body.data.password, undefined);
});

test("Test Connection tests the saved configuration and returns an explicit success", async () => {
  const result = await request(makeApp("superadmin"), "POST", "/api/superadmin/companies/company-1/database/test", {
    host: "untrusted-unsaved-host", password: "should-not-be-used",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.status, "CONNECTED");
});

test("Test Connection returns a safe failure without exposing connection details", async () => {
  const result = await request(
    makeApp("superadmin", { testConnectionError: Object.assign(new Error("secret"), { code: "28P01", detail: "secret" }) }),
    "POST", "/api/superadmin/companies/company-1/database/test"
  );
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    success: false, code: "TENANT_DATABASE_UNAVAILABLE", message: "Unable to connect to customer database",
  });
  assert.doesNotMatch(JSON.stringify(result.body), /secret|password|connection_string/i);
});

test("provisioning a Company Admin does not change existing tenant routing state", async () => {
  const routingBefore = {
    database_mode: "CUSTOMER_MANAGED", schema_state: "COMPATIBLE", active: true, password_ciphertext: "encrypted",
  };
  const configQueries = [];
  const client = {
    async query(sql) {
      if (sql.includes("SELECT id,name FROM companies")) return { rows: [{ id: "company-1", name: "Company B" }] };
      if (sql.includes("SELECT u.id,u.email")) return { rows: [] };
      if (sql.includes("SELECT id, company_id")) return { rows: [] };
      if (sql.startsWith("BEGIN") || sql.startsWith("COMMIT") || sql.startsWith("ROLLBACK")) return { rows: [] };
      if (sql.includes("INSERT INTO roles")) return { rows: [{ id: "role-admin" }] };
      if (sql.includes("INSERT INTO users")) return { rows: [{
        id: "admin-1", company_id: "company-1", username: "admin@example.com", email: "admin@example.com",
        full_name: "Company Administrator", must_change_password: false, is_superadmin: false,
      }] };
      if (sql.includes("tenant_database_configs")) configQueries.push(sql);
      return { rows: [] };
    },
    release() {},
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: "superadmin-1", is_superadmin: true }; next(); });
  app.use("/api", createSuperadminRouter({
    authenticate: (_req, _res, next) => next(),
    db: async () => ({ rows: [{ is_superadmin: true }] }),
    pool: { connect: async () => client },
    tenantDatabaseRouter: { async loadConfig() { return routingBefore; } },
  }));
  const result = await request(app, "POST", "/api/superadmin/companies/company-1/provision-admin", { email: "Admin@Example.com" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.company_id, "company-1");
  assert.equal(result.body.data.is_superadmin, false);
  assert.deepEqual(routingBefore, {
    database_mode: "CUSTOMER_MANAGED", schema_state: "COMPATIBLE", active: true, password_ciphertext: "encrypted",
  });
  assert.deepEqual(configQueries, []);
});

test("database action buttons are explicit non-submit buttons and use distinct endpoints", () => {
  assert.match(uiSource, /type="button"[^>]*onClick=\{\(\) => runDatabaseAction\("test"/);
  assert.match(uiSource, /runDatabaseAction\("initialize"/);
  assert.match(uiSource, /runDatabaseAction\("validate-schema"/);
  assert.match(uiSource, /runDatabaseAction\("activate"/);
  assert.match(uiSource, /apiRequest\(`\/api\/superadmin\/companies\/\$\{databaseCompany\}\/database\/\$\{action\}`/);
  assert.match(uiSource, /Client Admin Email/);
  assert.match(uiSource, /provision-admin/);
  assert.match(uiSource, /finally \{\s*setDatabaseBusy\(false\);\s*\}/);
});

for (const role of ["admin", "ordinary"]) {
  test(`database configuration endpoints deny ${role}`, async () => {
    const result = await request(makeApp(role), "GET", "/api/superadmin/companies/company-1/database");
    assert.equal(result.status, 403);
  });
}
