import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowAction } from "../services/platformWorkflow.js";
import { buildMenuPayload } from "../services/onlineOrders/uber.js";
import {
  resolveUberMenuProducts,
  UberMenuMappingError,
} from "../services/onlineOrders/uberMenuMapping.js";

const COMPANY = "company-menu-mapping";
const OTHER_COMPANY = "company-menu-mapping-other";
const STORE = "uber-store-menu-mapping";
const PRODUCT = {
  id: "product-menu-mapping",
  name: "Source name",
  description: "Source description",
  price: 4.25,
  vat_rate: 20,
  active: true,
  uber_item_id: null,
  available_on_uber: true,
  category_id: "category-1",
  category_name: "Drinks",
};

function makeActionDb({ menuMapping, storeMenuMappings, storeMappings, products = [PRODUCT], associations = [] } = {}) {
  const queries = [];
  const integration = {
    active: true,
    configuration: {
      environment: "sandbox",
      api_key: "test-access-token",
      store_id: STORE,
      menu_mapping: menuMapping,
      store_menu_mappings: storeMenuMappings,
      store_mappings: storeMappings,
    },
  };
  const db = async (text, values = []) => {
    queries.push({ text, values });
    const query = text.replace(/\s+/g, " ").trim();
    if (query.startsWith("SELECT active, configuration FROM integrations")) {
      return { rows: [{ active: integration.active, configuration: integration.configuration }] };
    }
    if (query.startsWith("SELECT p.id, p.name, p.description, p.price")) {
      return { rows: products.map((product) => ({ ...product })) };
    }
    if (query.startsWith("SELECT f.api_name FROM platform_fields")) {
      return { rows: [{ api_name: "provider_title" }, { api_name: "menu_description" }] };
    }
    if (query.startsWith("SELECT a.record_id, a.custom_values")) {
      const [companyId, productIds] = values;
      return {
        rows: associations
          .filter((row) => row.company_id === companyId && productIds.includes(row.record_id))
          .map(({ record_id, custom_values }) => ({ record_id, custom_values })),
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  return { db, queries };
}

function actionContext(db, companyId = COMPANY, storeId = undefined) {
  return {
    db,
    companyId,
    req: { user: { companyId } },
    action: { type: "UBER_UPLOAD_MENU", ...(storeId ? { storeId } : {}) },
  };
}

test("Uber menu mapping resolves standard and related source values, constants, and keeps stable identity", () => {
  const { products } = resolveUberMenuProducts(
    [{ ...PRODUCT }],
    {
      fields: {
        title: { type: "source", path: "product.name" },
        description: { mapping_type: "direct", onepos_source_path: "category.name" },
        category: { type: "constant", value: "Cafe" },
      },
    }
  );
  const payload = buildMenuPayload(products, { storeId: STORE });
  const item = payload.menus[0].categories[0].items[0];

  assert.equal(item.id, PRODUCT.id);
  assert.equal(item.external_data, `onepos:${PRODUCT.id}`);
  assert.equal(item.title, "Source name");
  assert.equal(item.description, "Drinks");
  assert.equal(payload.menus[0].categories[0].title, "Cafe");
  assert.equal(item.price, 425);
});

test("Uber menu mapping applies per-product generic custom override values", () => {
  const { products } = resolveUberMenuProducts(
    [{ ...PRODUCT, custom_values: { provider_title: "Uber title", menu_description: "Custom description" } }],
    {
      fields: {
        title: { same_as_source: false, override_field: "provider_title" },
        description: { type: "custom", field: "menu_description" },
        price: { type: "source", path: "product.price" },
      },
    }
  );
  const payload = buildMenuPayload(products, { storeId: STORE });

  assert.equal(payload.menus[0].categories[0].items[0].title, "Uber title");
  assert.equal(payload.menus[0].categories[0].items[0].description, "Custom description");
  assert.equal(payload.menus[0].categories[0].items[0].id, PRODUCT.id);
});

test("registered Uber upload sends the mapped payload with stable product identity", async () => {
  const { db } = makeActionDb({
    menuMapping: {
      fields: {
        title: { same_as_source: false, override_field: "provider_title" },
        price: { type: "constant", value: 5.25 },
      },
    },
    associations: [
      { company_id: COMPANY, record_id: PRODUCT.id, custom_values: { provider_title: "Uber title" } },
    ],
  });
  const originalFetch = global.fetch;
  const providerCalls = [];
  global.fetch = async (url, options) => {
    providerCalls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ accepted: true }) };
  };
  try {
    const result = await executeWorkflowAction(actionContext(db));
    assert.equal(result.success, true);
    assert.equal(providerCalls.length, 1);
    assert.ok(providerCalls[0].url.includes(`/v2/eats/stores/${STORE}/menus`));
    const sent = JSON.parse(providerCalls[0].options.body);
    const item = sent.menus[0].categories[0].items[0];
    assert.equal(item.id, PRODUCT.id);
    assert.equal(item.external_data, `onepos:${PRODUCT.id}`);
    assert.equal(item.title, "Uber title");
    assert.equal(item.price, 525);
  } finally {
    global.fetch = originalFetch;
  }
});

test("registered Uber upload uses the selected store's independent menu mapping", async () => {
  const storeB = "uber-store-b";
  const { db } = makeActionDb({
    storeMappings: [
      { uber_store_id: STORE, onepos_store_id: "onepos-a" },
      { uber_store_id: storeB, onepos_store_id: "onepos-b" },
    ],
    storeMenuMappings: [
      { uber_store_id: STORE, menu_mapping: { fields: { title: { type: "constant", value: "Store A item" } } } },
      { uber_store_id: storeB, menu_mapping: { fields: { title: { type: "constant", value: "Store B item" } } } },
    ],
  });
  const originalFetch = global.fetch;
  const providerCalls = [];
  global.fetch = async (url, options) => {
    providerCalls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => JSON.stringify({ accepted: true }) };
  };
  try {
    const result = await executeWorkflowAction(actionContext(db, COMPANY, storeB));
    assert.equal(result.success, true);
    assert.ok(providerCalls[0].url.includes(`/v2/eats/stores/${storeB}/menus`));
    const sent = JSON.parse(providerCalls[0].options.body);
    assert.equal(sent.menus[0].categories[0].items[0].title, "Store B item");
  } finally {
    global.fetch = originalFetch;
  }
});

test("registered Uber upload refuses to reuse another store's menu mapping", async () => {
  const storeB = "uber-store-b";
  const { db } = makeActionDb({
    storeMappings: [
      { uber_store_id: STORE, onepos_store_id: "onepos-a" },
      { uber_store_id: storeB, onepos_store_id: "onepos-b" },
    ],
    storeMenuMappings: [
      { uber_store_id: STORE, menu_mapping: { fields: {} } },
    ],
  });
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeWorkflowAction(actionContext(db, COMPANY, storeB));
    assert.equal(result.success, false);
    assert.equal(result.code, "STORE_MENU_CONFIGURATION_REQUIRED");
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Uber upload rejects a missing required override before any provider request", async () => {
  const { db } = makeActionDb({
    menuMapping: { fields: { title: { same_as_source: false, override_field: "provider_title" } } },
    associations: [{ company_id: COMPANY, record_id: PRODUCT.id, custom_values: {} }],
  });
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeWorkflowAction(actionContext(db));
    assert.equal(result.success, false);
    assert.equal(result.code, "MISSING_REQUIRED_OVERRIDE");
    assert.deepEqual(result.details.missingOverrides, [{ productId: PRODUCT.id, field: "title" }]);
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Uber upload rejects unknown source fields before any provider request", async () => {
  const { db } = makeActionDb({
    menuMapping: { fields: { title: { type: "source", path: "product.internal_cost" } } },
  });
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeWorkflowAction(actionContext(db));
    assert.equal(result.success, false);
    assert.equal(result.code, "INVALID_MENU_MAPPING");
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Uber upload rejects custom fields absent from Product Platform metadata", async () => {
  const { db } = makeActionDb({
    menuMapping: { fields: { title: { type: "custom", field: "unregistered_field" } } },
  });
  const originalFetch = global.fetch;
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    throw new Error("provider must not be called");
  };
  try {
    const result = await executeWorkflowAction(actionContext(db));
    assert.equal(result.success, false);
    assert.equal(result.code, "INVALID_MENU_MAPPING");
    assert.match(result.message, /Unknown Platform custom field/);
    assert.equal(providerCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Uber override loading is scoped to the action company", async () => {
  const { db, queries } = makeActionDb({
    menuMapping: { fields: { title: { same_as_source: false, override_field: "provider_title" } } },
    associations: [
      { company_id: OTHER_COMPANY, record_id: PRODUCT.id, custom_values: { provider_title: "Other company's title" } },
    ],
  });
  const result = await executeWorkflowAction(actionContext(db));
  const overrideQuery = queries.find(({ text }) => text.includes("FROM platform_record_associations"));
  const productQuery = queries.find(({ text }) => text.includes("FROM products p"));

  assert.equal(result.code, "MISSING_REQUIRED_OVERRIDE");
  assert.equal(productQuery.values[0], COMPANY);
  assert.equal(overrideQuery.values[0], COMPANY);
  assert.deepEqual(overrideQuery.values[1], [PRODUCT.id]);
});

test("Uber mapping rejects unsupported target fields", () => {
  assert.throws(
    () => resolveUberMenuProducts([PRODUCT], { fields: { id: { type: "constant", value: "changed" } } }),
    (error) => error instanceof UberMenuMappingError && error.code === "INVALID_MENU_MAPPING"
  );
});
