import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import createSuperadminRouter from "../routes/superadmin.js";

function makeApp(role) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "user-1",
      is_superadmin: role === "superadmin",
      companyId: "company-1",
    };
    next();
  });
  const db = async (sql) => {
    if (sql.includes("is_superadmin")) return { rows: [{ is_superadmin: role === "superadmin" }] };
    return { rows: [] };
  };
  const tenantDatabaseRouter = {
    async loadConfig() {
      return {
        company_id: "company-1",
        database_mode: "CUSTOMER_MANAGED",
        host: "db.example",
        port: 5432,
        database: "onepos",
        username: "onepos",
        password_ciphertext: "encrypted",
        ssl_mode: "require",
        active: false,
        schema_state: "UNINITIALIZED",
      };
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

for (const role of ["admin", "ordinary"]) {
  test(`database configuration endpoints deny ${role}`, async () => {
    const result = await request(makeApp(role), "GET", "/api/superadmin/companies/company-1/database");
    assert.equal(result.status, 403);
  });
}
