/*
 * T10-UBER-MENU - Uber Eats Menu Sync tests (permanent).
 *
 * Two layers:
 *   1. Pure payload-builder tests (buildMenuPayload): mapping fidelity for
 *      categories/items/prices/availability, idempotent identity, inactive
 *      skipping, input immutability.
 *   2. Route-level tests over the REAL routes/online.js POST
 *      /api/online/uber/sync-menu over HTTP against a stateful fake db
 *      (same pattern as tests/uberWebhook.test.mjs): isolation, failure
 *      handling, status persistence and the guarantee that the sync NEVER
 *      mutates onePOS product/inventory state.
 *
 *   node --test tests/uberMenuSync.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const COMPANY = "b0a67538-0000-4000-8000-0000000menu1";
const OTHER_COMPANY = "c0a67538-0000-4000-8000-0000000menu1";
const STORE_1 = "s1000000-0000-4000-8000-00000000menu";
const STORE_2 = "s2000000-0000-4000-8000-00000000menu";
const UBER_STORE = "8d9de573-1a84-4efe-ab25-b323315ac0af";
const SECRET = "test-only-client-secret-" + crypto.randomBytes(8).toString("hex");

/* ----------------------- payload builder tests ----------------------- */

test("menu payload: product -> uber item mapping (category, price minor units, availability)", async () => {
  const { buildMenuPayload } = await import("../services/onlineOrders/uber.js");
  const products = [
    { id: "p1", name: "Latte", description: "Hot coffee", price: 3.5, vat_rate: 20, active: true, category_name: "Coffee", uber_item_id: "uber-777", available_on_uber: true },
  ];
  const payload = buildMenuPayload(products, { storeId: UBER_STORE });

  assert.equal(payload.menus.length, 1);
  const category = payload.menus[0].categories[0];
  assert.equal(category.id, "onepos-cat-coffee");
  assert.equal(category.title, "Coffee");

  const item = category.items[0];
  assert.equal(item.id, "uber-777"); // existing external id wins
  assert.equal(item.title, "Latte");
  assert.equal(item.price, 350); // minor units (pence)
  assert.equal(item.is_available, true);
  assert.equal(item.external_data, "onepos:p1");
  assert.equal(payload._meta.publishedCount, 1);
  // VAT is preserved internally on the product row and never mangled into the menu item.
});

test("menu payload: items without a saved uber id fall back to the stable product UUID (idempotent identity)", async () => {
  const { buildMenuPayload } = await import("../services/onlineOrders/uber.js");
  const products = [{ id: "uuid-abc", name: "Tea", price: 2, active: true, category_name: "Coffee", uber_item_id: null, available_on_uber: true }];
  const payload = buildMenuPayload(products, { storeId: UBER_STORE });
  assert.equal(payload.menus[0].categories[0].items[0].id, "uuid-abc");

  // Repeated sync -> identical item ids (idempotency at the identity level).
  const again = buildMenuPayload(products, { storeId: UBER_STORE });
  assert.deepEqual(again.menus[0].categories[0].items[0], payload.menus[0].categories[0].items[0]);
});

test("menu payload: active-but-not-offered is published unavailable; inactive products are skipped", async () => {
  const { buildMenuPayload } = await import("../services/onlineOrders/uber.js");
  const products = [
    { id: "p-on", name: "Latte", price: 3, active: true, category_name: "C", uber_item_id: null, available_on_uber: true },
    { id: "p-hidden", name: "Secret item", price: 5, active: true, category_name: "C", uber_item_id: "keep-1", available_on_uber: false },
    { id: "p-inactive", name: "Old cake", price: 1, active: false, category_name: "C", uber_item_id: "old-1", available_on_uber: true },
  ];
  const payload = buildMenuPayload(products, { storeId: UBER_STORE });
  const items = payload.menus[0].categories[0].items;
  assert.equal(items.length, 2);
  const hidden = items.find((i) => i.id === "keep-1");
  assert.equal(hidden.is_available, false); // mapped but switched off on Uber
  assert.equal(payload._meta.skippedInactiveCount, 1);
  assert.ok(!payload._meta.publishedItemIds.includes("old-1"));
});

test("menu payload: never mutates the onePOS product rows it is given", async () => {
  const { buildMenuPayload } = await import("../services/onlineOrders/uber.js");
  const products = [
    { id: "p1", name: "Latte", description: "x", price: 3.5, vat_rate: 20, active: true, category_name: "Coffee", uber_item_id: "uber-777", available_on_uber: true },
  ];
  const snapshot = JSON.stringify(products);
  buildMenuPayload(products, { storeId: UBER_STORE });
  assert.equal(JSON.stringify(products), snapshot);
});

/* ------------------------- fake db + app ------------------------- */

const SAMPLE_PRODUCTS = [
  { id: "prod-latte", name: "Latte", description: "Hot", price: 3.5, vat_rate: 20, active: true, uber_item_id: "uber-777", available_on_uber: true, category_name: "Coffee", category_display_order: 1 },
  { id: "prod-tea", name: "Tea", description: null, price: 2, vat_rate: 20, active: true, uber_item_id: null, available_on_uber: true, category_name: "Coffee", category_display_order: 1 },
];

function makeFake() {
  const state = {
    integrations: [
      {
        company_id: COMPANY,
        active: true,
        configuration: { environment: "sandbox", client_id: "cid", store_id: UBER_STORE, store_location_id: UBER_STORE },
      },
      {
        company_id: OTHER_COMPANY,
        active: true,
        configuration: { environment: "sandbox", store_id: STORE_2 },
      },
    ],
    products: {
      [COMPANY]: SAMPLE_PRODUCTS.map((p) => ({ ...p })),
      [OTHER_COMPANY]: [{ id: "other-prod", name: "Other Latte", price: 9, active: true, uber_item_id: null, available_on_uber: true, category_name: "Coffee", category_display_order: 1 }],
    },
    // The fake Uber host: captures the last PUT menu body per store.
    uberMenuPuts: [],
    platformLogs: [],
  };

  const db = async (text, values = []) => {
    const q = text.replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT p.id, p.name, p.description, p.price")) {
      /* Mirror the route's WHERE clause: available_on_uber = true OR
       * uber_item_id IS NOT NULL (plus company scoping). */
      const rows = (state.products[values[0]] || []).filter(
        (p) => p.available_on_uber === true || p.uber_item_id != null
      );
      return { rows: rows.map((p) => ({ ...p })) };
    }

    if (q.startsWith("UPDATE integrations SET configuration = configuration ||")) {
      const row = state.integrations.find((r) => r.company_id === values[0]);
      if (row) row.configuration = { ...row.configuration, ...JSON.parse(values[1]) };
      return { rows: [] };
    }

    if (q.startsWith("SELECT active, configuration FROM integrations WHERE company_id")) {
      const row = state.integrations.find((r) => r.company_id === values[0]);
      return { rows: row ? [{ active: row.active, configuration: { ...row.configuration } }] : [] };
    }

    if (q.startsWith("INSERT INTO platform_api_logs") || q.startsWith("UPDATE platform_api_logs")) {
      state.platformLogs.push(values);
      return { rows: [] };
    }

    throw new Error("UNMATCHED QUERY: " + q.slice(0, 90));
  };

  return { state, db };
}

async function buildApp({ uberResponse } = {}) {
  const { default: createOnlineRouter } = await import("../routes/online.js");
  const express_ = express;
  const configModule = await import("../services/onlineOrders/platformConfig.js");
  const fake = makeFake();

  /* Encrypt the fake client secret with the REAL encryptSecret so
   * loadPlatformConfig decrypts it exactly like production. */
  const { encryptSecret } = configModule;
  fake.state.integrations[0].configuration.client_secret = encryptSecret(SECRET);

  const app = express_();
  app.use(express_.json({ limit: "10mb" }));

  /* Intercept the Uber HTTP client at the network boundary: uberRequest
   * calls global fetch. We capture the menu PUT and return a controlled
   * Uber response; the OAuth token endpoint is answered locally so no real
   * network call is ever made - the service/client code under test is fully
   * real. */
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);

    if (target.includes("/oauth/v2/token")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }),
      };
    }

    if (target.includes("/v1/eats/stores/") && options.method === "PUT") {
      fake.state.uberMenuPuts.push({ url: target, body: JSON.parse(options.body) });
      return (
        uberResponse || {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ menu_id: "uber-menu-1" }),
        }
      );
    }

    return originalFetch(url, options);
  };

  const fakePool = {
    connect: async () => ({
      query: async (text, values) => {
        if (["BEGIN", "COMMIT", "ROLLBACK"].includes(text)) return { rows: [] };
        return fake.db(text, values);
      },
      release: () => {},
    }),
  };

  app.use(
    "/api",
    createOnlineRouter({
      authenticate: (req, _res, next) => {
        req.user = { id: "user-1", companyId: COMPANY, storeId: STORE_1 };
        next();
      },
      authorize: () => (_req, _res, next) => next(),
      db: fake.db,
      pool: fakePool,
      writeAudit: async () => {},
      createInventoryMovement: async () => {},
    })
  );

  const restore = () => {
    global.fetch = originalFetch;
  };

  return { app, fake, restore };
}

async function postSync(app, body = {}) {
  const server = http.createServer(app);
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  try {
    return await fetch(`http://127.0.0.1:${port}/api/online/uber/sync-menu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/* --------------------------- route tests --------------------------- */

test("menu sync route: builds the Uber PUT from the onePOS Product Master and reports counts", async () => {
  const { app, fake, restore } = await buildApp();
  try {
    const res = await postSync(app);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.published, 2);
    assert.equal(body.data.categories, 1);

    assert.equal(fake.state.uberMenuPuts.length, 1);
    const put = fake.state.uberMenuPuts[0];
    assert.ok(put.url.includes(`/v1/eats/stores/${UBER_STORE}/menus`)); // sandbox host
    const category = put.body.menus[0].categories[0];
    assert.equal(category.id, "onepos-cat-coffee");
    assert.equal(category.items.find((i) => i.id === "uber-777").price, 350);
    assert.equal(category.items.find((i) => i.id === "prod-tea").id, "prod-tea");
  } finally {
    restore();
  }
});

test("menu sync is idempotent: repeated syncs PUT identical item ids (update, never duplicate)", async () => {
  const { app, fake, restore } = await buildApp();
  try {
    await postSync(app);
    await postSync(app);

    assert.equal(fake.state.uberMenuPuts.length, 2);
    const ids1 = fake.state.uberMenuPuts[0].body.menus[0].categories.flatMap((c) => c.items.map((i) => i.id)).sort();
    const ids2 = fake.state.uberMenuPuts[1].body.menus[0].categories.flatMap((c) => c.items.map((i) => i.id)).sort();
    assert.deepEqual(ids2, ids1);

    // onePOS products untouched by both syncs (same rows as before).
    const rows = fake.state.products[COMPANY];
    assert.equal(rows.find((p) => p.id === "prod-latte").price, 3.5);
    assert.equal(rows.find((p) => p.id === "prod-latte").vat_rate, 20);
    assert.equal(rows.find((p) => p.id === "prod-latte").uber_item_id, "uber-777");
    assert.equal(rows.find((p) => p.id === "prod-tea").uber_item_id, null); // never auto-assigned
    assert.deepEqual(fake.state.platformLogs.filter((v) => v[0] && String(v[0]).includes("products")), []);
  } finally {
    restore();
  }
});

test("menu sync: company isolation - only the caller's company products are sent", async () => {
  const { app, fake, restore } = await buildApp();
  try {
    await postSync(app);
    const put = fake.state.uberMenuPuts[0];
    const titles = put.body.menus[0].categories.flatMap((c) => c.items.map((i) => i.title));
    assert.ok(titles.includes("Latte"));
    assert.ok(!titles.includes("Other Latte"));
    assert.equal(fake.state.products[OTHER_COMPANY][0].uber_item_id, null);
  } finally {
    restore();
  }
});

test("menu sync: nothing marked Available on Uber -> NOTHING_TO_SYNC, no Uber call", async () => {
  const { app, fake, restore } = await buildApp();
  fake.state.products[COMPANY] = [{ id: "p-off", name: "X", price: 1, active: true, uber_item_id: null, available_on_uber: false }];
  try {
    const res = await postSync(app);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "NOTHING_TO_SYNC");
    assert.equal(fake.state.uberMenuPuts.length, 0);
  } finally {
    restore();
  }
});

test("menu sync: Uber API failure -> success:false, error message surfaced, status persisted", async () => {
  const { app, fake, restore } = await buildApp({
    uberResponse: { ok: false, status: 422, text: async () => JSON.stringify({ message: "invalid item price" }) },
  });
  try {
    const res = await postSync(app);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, false);
    assert.ok(body.message.includes("invalid item price"));

    const config = fake.state.integrations[0].configuration;
    assert.equal(config.menu_sync_last_success, null);
    assert.ok(config.menu_sync_last_error.includes("invalid item price"));
    assert.ok(config.menu_sync_last_attempt);
  } finally {
    restore();
  }
});

test("menu sync: success persists last-success timestamp and count on the integration config", async () => {
  const { app, fake, restore } = await buildApp();
  try {
    await postSync(app);
    const config = fake.state.integrations[0].configuration;
    assert.ok(config.menu_sync_last_success);
    assert.equal(config.menu_sync_last_error, null);
    assert.equal(config.menu_sync_last_count, 2);
  } finally {
    restore();
  }
});

test("menu sync: store isolation - PUT targets the company's own configured store", async () => {
  const { app, fake, restore } = await buildApp();
  try {
    await postSync(app);
    assert.ok(fake.state.uberMenuPuts[0].url.includes(UBER_STORE));
    assert.ok(!fake.state.uberMenuPuts[0].url.includes(STORE_2));
  } finally {
    restore();
  }
});

test("menu sync route: disabled integration is rejected (409)", async () => {
  const { app, fake, restore } = await buildApp();
  fake.state.integrations[0].active = false;
  try {
    const res = await postSync(app);
    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, "PLATFORM_DISABLED");
  } finally {
    restore();
  }
});

test("menu sync source contract: route never writes to products/inventory tables", () => {
  const src = fs.readFileSync(new URL("../routes/online.js", import.meta.url), "utf8");
  const syncSection = src.slice(src.indexOf("POST /api/online/uber/sync-menu"), src.indexOf("GET /api/online/uber/test-connection"));
  assert.ok(syncSection.includes("SELECT p.id, p.name, p.description"));
  assert.ok(!/INSERT INTO products|UPDATE products|DELETE FROM products/.test(syncSection));
  assert.ok(!/INSERT INTO inventory_movements|UPDATE inventory/.test(syncSection));
  // And the underlying uberRequest is fired for the menu endpoint only via the service.
  assert.ok(src.includes("service.syncMenu(products, runtime)"));
});
