import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import {
  buildStoredConfiguration,
  maskConfiguration,
} from "../services/onlineOrders/platformConfig.js";
import createSettingsRouter from "../routes/settings.js";
import { executeWorkflowAction } from "../services/platformWorkflow.js";

const settingsRoute = readFileSync(new URL("../routes/settings.js", import.meta.url), "utf8");
const onlineRoute = readFileSync(new URL("../routes/online.js", import.meta.url), "utf8");
const settingsUi = readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");
const mappingUi = readFileSync(new URL("../src/pages/settings/UberMenuMappingEditor.jsx", import.meta.url), "utf8");
const packageRegistry = readFileSync(new URL("../services/packageRegistry.js", import.meta.url), "utf8");
const customPageRuntime = readFileSync(new URL("../src/components/CustomPageRuntime.jsx", import.meta.url), "utf8");

test("Uber mappings are sanitized and preserved when credentials are updated", () => {
  const existing = buildStoredConfiguration({
    client_secret: "stored-secret",
    menu_mapping: {
      fields: {
        title: { same_as_source: false, override_field: "uber_menu_title" },
        price: { type: "constant", value: 5.25 },
      },
    },
  });
  const updated = buildStoredConfiguration({ client_id: "new-client" }, existing);

  assert.equal(updated.menu_mapping.fields.title.same_as_source, false);
  assert.equal(updated.menu_mapping.fields.title.override_field, "uber_menu_title");
  assert.equal(updated.menu_mapping.fields.price.value, 5.25);
  assert.equal(updated.client_secret, existing.client_secret);
  assert.match(updated.client_secret, /^enc:v1:/);
});

test("Uber per-store menu mappings are sanitized, unique, and retained in safe configuration", () => {
  const configuration = buildStoredConfiguration({
    store_menu_mappings: [
      {
        uber_store_id: " uber-store-a ",
        menu_mapping: { fields: { price: { type: "constant", value: 4.5 } } },
      },
    ],
  });
  const response = maskConfiguration(configuration);

  assert.deepEqual(response.store_menu_mappings, [{
    uber_store_id: "uber-store-a",
    menu_mapping: { fields: { price: { same_as_source: true, type: "constant", value: 4.5 } } },
  }]);
  assert.throws(
    () => buildStoredConfiguration({
      store_menu_mappings: [
        { uber_store_id: "duplicate", menu_mapping: { fields: {} } },
        { uber_store_id: "duplicate", menu_mapping: { fields: {} } },
      ],
    }),
    /more than one menu configuration/
  );
});

test("Uber mapping rejects a custom override without its required Platform field", () => {
  assert.throws(
    () => buildStoredConfiguration({ menu_mapping: { fields: { title: { same_as_source: false } } } }),
    /Platform custom override field is required/
  );
});

test("Uber settings responses mask secrets while retaining a safe mapping configuration", () => {
  const configuration = buildStoredConfiguration({
    client_secret: "never-return-this-value",
    api_key: "private-access-token",
    menu_mapping: { fields: { title: { type: "source", path: "product.name" } } },
  });
  const response = maskConfiguration(configuration);

  assert.equal(response.client_secret, null);
  assert.equal(response.api_key, null);
  assert.equal(response.client_secret_configured, true);
  assert.equal(response.api_key_configured, true);
  assert.equal(JSON.stringify(response).includes("never-return-this-value"), false);
  assert.equal(JSON.stringify(response).includes("private-access-token"), false);
  assert.equal(response.menu_mapping.fields.title.path, "product.name");
});

test("online-platform GET and PUT preserve mappings and encrypted credentials without exposing them", async (context) => {
  let configuration = buildStoredConfiguration({
    client_id: "existing-client",
    client_secret: "secret-must-remain-private",
    menu_mapping: { fields: { title: { type: "source", path: "product.name" } } },
  });
  const db = async (sql) => {
    assert.match(sql, /SELECT active, configuration FROM integrations/);
    return { rows: [{ active: true, configuration }] };
  };
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          if (/^SELECT configuration FROM integrations/.test(sql.trim())) {
            return { rows: [{ configuration }] };
          }
          if (/^INSERT INTO integrations/.test(sql.trim())) {
            configuration = JSON.parse(values[3]);
            return { rows: [{ id: 42, active: values[4] }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createSettingsRouter({
    authenticate: (req, _res, next) => { req.user = { id: 7, companyId: "tenant-a" }; next(); },
    authorize: () => (_req, _res, next) => next(),
    db,
    pool,
    writeAudit: async () => {},
  }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/settings/online-platforms`;

  const loaded = await fetch(base);
  const loadedBody = await loaded.json();
  assert.equal(loaded.status, 200);
  assert.equal(loadedBody.data.find((platform) => platform.platform === "uber").menu_mapping.fields.title.path, "product.name");
  assert.equal(JSON.stringify(loadedBody).includes("secret-must-remain-private"), false);
  assert.equal(loadedBody.data.find((platform) => platform.platform === "uber").client_secret, null);

  const saved = await fetch(`${base}/uber`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      environment: "production",
      clientId: "updated-client",
      menuMapping: { fields: { price: { type: "constant", value: 3.5 } } },
    }),
  });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(configuration.environment, "production");
  assert.equal(configuration.client_id, "updated-client");
  assert.equal(configuration.menu_mapping.fields.price.value, 3.5);
  assert.equal(configuration.client_secret.startsWith("enc:v1:"), true);
  assert.equal(JSON.stringify(savedBody).includes("secret-must-remain-private"), false);
});

test("Uber store discovery calls the registered company-scoped GET_STORES action and validates selection", () => {
  assert.match(onlineRoute, /router\.get\("\/online\/uber\/stores", authenticate, authorize\("online_orders\.configure"\)/);
  assert.match(onlineRoute, /action: \{ type: "UBER_GET_STORES" \}/);
  assert.match(settingsRoute, /action: \{ type: "UBER_GET_STORES" \}/);
  assert.match(settingsRoute, /allowedStoreIds\.has\(String\(requestedStoreId\)\)/);
  assert.match(settingsRoute, /companyId: req\.user\.companyId/);
});

test("registered Uber GET_STORES discovers stores through the configured company connector", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.ONLINE_UBER_SANDBOX_API_BASE_URL;
  const calls = [];
  process.env.ONLINE_UBER_SANDBOX_API_BASE_URL = "https://uber-test.invalid";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ stores: [{ id: "store-tenant-a", name: "Tenant A Store" }] }),
    };
  };
  try {
    const db = async (sql, values) => {
      assert.deepEqual(values, ["tenant-a", "uber"]);
      assert.match(sql, /FROM integrations WHERE company_id = \$1 AND provider = \$2/);
      return {
        rows: [{
          active: true,
          configuration: buildStoredConfiguration({ api_key: "company-access-token" }),
        }],
      };
    };
    const result = await executeWorkflowAction({
      db,
      companyId: "tenant-a",
      req: { user: { companyId: "tenant-a" } },
      action: { type: "UBER_GET_STORES" },
    });
    assert.equal(result.success, true);
    assert.equal(result.data.stores[0].id, "store-tenant-a");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://uber-test.invalid/v1/eats/stores");
    assert.equal(calls[0].options.method, "GET");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.ONLINE_UBER_SANDBOX_API_BASE_URL;
    else process.env.ONLINE_UBER_SANDBOX_API_BASE_URL = originalBase;
  }
});

test("Uber store mapping settings return company-owned stores and persist only validated mappings", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.ONLINE_UBER_SANDBOX_API_BASE_URL;
  process.env.ONLINE_UBER_SANDBOX_API_BASE_URL = "https://uber-mapping-test.invalid";
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ stores: [{ id: "uber-tenant-a" }] }),
  });

  let configuration = buildStoredConfiguration({
    api_key: "tenant-a-token",
    store_mappings: [],
  });
  const queries = [];
  const db = async (sql, values = []) => {
    queries.push({ sql, values });
    if (/SELECT active, configuration FROM integrations/.test(sql)) {
      assert.deepEqual(values, ["tenant-a", "uber"]);
      return { rows: [{ active: true, configuration }] };
    }
    if (/SELECT id, name, code FROM stores WHERE company_id=\$1/.test(sql)) {
      assert.deepEqual(values, ["tenant-a"]);
      return { rows: [{ id: "onepos-tenant-a", name: "Tenant A", code: "A" }] };
    }
    if (/SELECT id FROM stores WHERE company_id=\$1 AND active=true/.test(sql)) {
      assert.deepEqual(values, ["tenant-a"]);
      return { rows: [{ id: "onepos-tenant-a" }] };
    }
    throw new Error(`Unexpected db query: ${sql}`);
  };
  const pool = {
    async connect() {
      return {
        async query(sql, values = []) {
          if (/SELECT configuration, active FROM integrations/.test(sql)) {
            return { rows: [{ configuration, active: true }] };
          }
          if (/INSERT INTO integrations/.test(sql)) {
            configuration = JSON.parse(values[1]);
            return { rows: [{ id: "integration-a" }] };
          }
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  const app = express();
  app.use(express.json());
  const requiredPermissions = [];
  app.use("/api", createSettingsRouter({
    authenticate: (req, _res, next) => { req.user = { id: "user-a", companyId: "tenant-a" }; next(); },
    authorize: (permission) => {
      requiredPermissions.push(permission);
      return (_req, _res, next) => next();
    },
    db,
    pool,
    writeAudit: async () => {},
  }));
  assert.ok(requiredPermissions.includes("online_orders.configure"));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.ONLINE_UBER_SANDBOX_API_BASE_URL;
    else process.env.ONLINE_UBER_SANDBOX_API_BASE_URL = originalBase;
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/settings/online-platforms/uber/store-mappings`;

  const loaded = await originalFetch(base);
  const loadedBody = await loaded.json();
  assert.deepEqual(loadedBody.data.onepos_stores, [{ id: "onepos-tenant-a", name: "Tenant A", code: "A" }]);
  assert.deepEqual(loadedBody.data.mappings, []);

  const invalid = await originalFetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_mappings: [{ uber_store_id: "uber-tenant-a", onepos_store_id: "foreign-store" }] }),
  });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).message, /not an active store for this company/);

  const invalidMenuStore = await originalFetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      store_mappings: [],
      store_menu_mappings: [{
        uber_store_id: "uber-store-from-another-tenant",
        menu_mapping: { fields: {} },
      }],
    }),
  });
  assert.equal(invalidMenuStore.status, 400);
  assert.match((await invalidMenuStore.json()).message, /not available to this company connector/);

  const saved = await originalFetch(base, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      store_mappings: [{ uber_store_id: "uber-tenant-a", onepos_store_id: "onepos-tenant-a" }],
      store_menu_mappings: [{
        uber_store_id: "uber-tenant-a",
        menu_mapping: { fields: { price: { type: "constant", value: 7.25 } } },
      }],
    }),
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(configuration.store_mappings, [
    { uber_store_id: "uber-tenant-a", onepos_store_id: "onepos-tenant-a" },
  ]);
  assert.deepEqual(configuration.store_menu_mappings, [{
    uber_store_id: "uber-tenant-a",
    menu_mapping: { fields: { price: { same_as_source: true, type: "constant", value: 7.25 } } },
  }]);
  assert.ok(queries.some(({ values }) => values[0] === "tenant-a"));
});

test("Settings UI exposes schema-driven mapping modes and real Uber store selection", () => {
  assert.match(settingsUi, /apiRequest\("\/api\/online\/uber\/stores"\)/);
  assert.match(settingsUi, /id="uber-store-select"/);
  assert.match(settingsUi, /<UberMenuMappingEditor/);
  assert.match(settingsUi, /store_mappings: storeMappings/);
  assert.match(settingsUi, /store_menu_mappings: storeMenuMappings/);
  assert.match(settingsUi, /id="uber-menu-store-select"/);
  assert.match(settingsUi, /STORE_MENU_CONFIGURATION_REQUIRED|Save this store configuration/);
  assert.match(settingsUi, /uber_store_id: uberStore\.storeId, onepos_store_id: event\.target\.value/);
  assert.match(mappingUi, /Same as source/);
  assert.match(mappingUi, /Platform custom field/);
  assert.match(mappingUi, /Constant value/);
  assert.match(mappingUi, /Per-product override/);
  assert.match(mappingUi, /Required Platform custom override field/);
  assert.match(mappingUi, /generic Platform custom-value record/);
});

test("Installed Uber package page links into the existing Settings host", () => {
  assert.match(packageRegistry, /runtimeComponent: "uber_eats_settings"/);
  assert.match(customPageRuntime, /href="\/app\/settings\/uber-eats"/);
  assert.match(customPageRuntime, /Open Uber Eats settings/);
});
