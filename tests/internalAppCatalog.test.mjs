import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { internalAppCatalog, internalAppCatalogSchema, hasCatalogPermission } from "../services/internalAppCatalog.js";
import createPlatformRouter from "../routes/platform.js";

test("internal app catalog has stable unique keys and permission metadata", () => {
  const keys = internalAppCatalog.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("retail_pos"));
  for (const entry of internalAppCatalog) {
    assert.match(entry.key, /^[a-z][a-z0-9_]+$/);
    assert.ok(entry.route.startsWith("/app/"));
    assert.ok(entry.permissions.length > 0);
  }
  assert.equal(hasCatalogPermission(internalAppCatalog[0], ["sale.view"]), true);
  assert.equal(hasCatalogPermission(internalAppCatalog[0], ["settings.manage"]), false);
  assert.equal(hasCatalogPermission(internalAppCatalog[0], [], true), true);
  assert.match(internalAppCatalogSchema, /platform_module_access/);
});

test("app catalog read and activation routes are company scoped", async (t) => {
  const modules = [
    { id: "module-a", module_key: "retail_pos", name: "POS & Sales", installed: true, metadata: {} },
    { id: "module-b", module_key: "inventory", name: "Inventory", installed: true, metadata: {} },
  ];
  const access = [];
  const db = async (sql, params = []) => {
    if (sql.includes("FROM platform_modules m") && sql.includes("platform_module_access")) {
      return { rows: modules.map((module) => ({ ...module, company_enabled: access.find((item) => item.module_id === module.id && item.company_id === params[0])?.enabled ?? null })) };
    }
    if (sql.startsWith("SELECT id FROM platform_modules")) return { rows: modules.filter((module) => module.module_key === params[0]) };
    if (sql.startsWith("INSERT INTO platform_module_access")) {
      const row = { module_id: params[0], company_id: params[1], store_id: params[2], enabled: params[3] };
      access.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT is_superadmin")) return { rows: [{ is_superadmin: false }] };
    if (sql.includes("FROM role_permissions")) return { rows: [{ code: "sale.view" }, { code: "inventory.view" }] };
    if (sql.startsWith("SELECT id FROM stores")) return { rows: [] };
    return { rows: [] };
  };

  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db,
    authenticate: (req, res, next) => { req.user = { id: "user-a", companyId: "company-a", storeId: null, roleId: "role-a" }; next(); },
    authorize: () => (req, res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;
  const catalogResponse = await fetch(`${base}/platform/app-catalog`);
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).data.length, 2);

  const toggleResponse = await fetch(`${base}/platform/app-catalog/inventory`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(toggleResponse.status, 200);
  assert.equal(access[0].company_id, "company-a");
});
