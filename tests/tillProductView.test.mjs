/*
 * TILL PRODUCT VIEW — permanent suite (image/compact views, DB categories,
 * Most Selling frequency ranking).
 *
 * Backend: drives the REAL routes/products.js (categories, most-selling,
 * products list) and routes/settings.js (product_view persistence) over
 * HTTP against a stateful fake db. Frontend: static contract tests over
 * the real ProductGrid.jsx/POS.jsx/SettingsAdmin.jsx sources pin the view
 * switching, the removal of the hardcoded category list, and that both
 * views share one basket flow.
 *
 *   node --test tests/tillProductView.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

/* ------------------------------------------------------------ fake db */

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const CAT_DRINKS = "cat-dd0000-0000-4000-8000-000000000001";
const CAT_FOOD = "cat-ff0000-0000-4000-8000-000000000001";

function makeDb() {
  const state = {
    categories: [
      { id: CAT_DRINKS, company_id: COMPANY_A, name: "Drinks", display_order: 1, active: true },
      { id: CAT_FOOD, company_id: COMPANY_A, name: "Food", display_order: 2, active: true },
      { id: "cat-b0000-0000-4000-8000-000000000001", company_id: COMPANY_B, name: "B-Only Category", display_order: 1, active: true },
    ],
    products: [
      { id: "p-cola", company_id: COMPANY_A, name: "Cola", sku: "SKU-COLA", barcode: "5001", price: 1.5, category_id: CAT_DRINKS, active: true, image_url: "data:image/png;base64,AAA" },
      { id: "p-pepsi", company_id: COMPANY_A, name: "Pepsi", sku: "SKU-PEPSI", barcode: "5002", price: 1.5, category_id: CAT_DRINKS, active: true, image_url: null },
      { id: "p-crisps", company_id: COMPANY_A, name: "Crisps", sku: "SKU-CRISPS", barcode: "5003", price: 0.8, category_id: CAT_FOOD, active: true, image_url: null },
      { id: "p-inactive", company_id: COMPANY_A, name: "Inactive Thing", sku: "SKU-X", barcode: "5004", price: 2, category_id: CAT_FOOD, active: false, image_url: null },
      { id: "p-b", company_id: COMPANY_B, name: "Foreign Product", sku: "SKU-B", barcode: "9999", price: 9, category_id: "cat-b0000-0000-4000-8000-000000000001", active: true, image_url: null },
    ],
    /* Frequency data: cola in 4 distinct sales, pepsi in 2, crisps in 1 —
       but crisps has the HIGHEST total quantity (1 sale × 30 units), so a
       quantity-ranked endpoint would put it first. Frequency must not. */
    sales: [
      { id: "s1", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: "2026-09-01T10:00:00Z" },
      { id: "s2", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: "2026-09-02T10:00:00Z" },
      { id: "s3", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: "2026-09-03T10:00:00Z" },
      { id: "s4", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: "2026-09-04T10:00:00Z" },
      { id: "s5", company_id: COMPANY_A, store_id: "store-other", status: "completed", created_at: "2026-09-05T10:00:00Z" }, // other store
      { id: "s6", company_id: COMPANY_B, store_id: STORE_1, status: "completed", created_at: "2026-09-05T10:00:00Z" }, // foreign company
    ],
    saleItems: [
      { sale_id: "s1", product_id: "p-cola", quantity: 2 },
      { sale_id: "s2", product_id: "p-cola", quantity: 1 },
      { sale_id: "s3", product_id: "p-cola", quantity: 1 },
      { sale_id: "s4", product_id: "p-cola", quantity: 1 },
      { sale_id: "s2", product_id: "p-pepsi", quantity: 1 },
      { sale_id: "s3", product_id: "p-pepsi", quantity: 1 },
      { sale_id: "s4", product_id: "p-crisps", quantity: 30 }, // huge quantity, ONE sale
      { sale_id: "s5", product_id: "p-cola", quantity: 5 }, // other-store sale — must be excluded when store-scoped
      { sale_id: "s6", product_id: "p-pepsi", quantity: 5 }, // foreign-company sale — always excluded
    ],
    settings: new Map(), // company_id -> product_view
    dock: new Map(), // company_id -> dock_quick_access array (T10W)
    customerDisplay: new Map(), // company_id -> boolean (Customer Display switch)
    sqlLog: [],
  };

  const rows = (sql, params) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    state.sqlLog.push({ sql: s, params });

    /* ---- GET /api/categories ---- */
    if (/SELECT c\.id, c\.name, c\.display_order, c\.active, COUNT\(p\.id\) AS product_count FROM categories c/.test(s)) {
      const list = state.categories
        .filter((c) => c.company_id === params[0])
        .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
        .map((c) => ({ ...c, product_count: 0 }));
      return { rows: list };
    }

    /* ---- GET /api/products/most-selling ----
       The fake mirrors the route's aggregate semantics: COUNT(DISTINCT
       sale_id) over scoped, completed, in-window sales joined to ACTIVE
       products of the SAME company. */
    if (/COUNT\(DISTINCT si\.sale_id\)::int AS sale_frequency/.test(s)) {
      const companyId = params[0];
      const storeScoped = params.length >= 4;
      const storeId = storeScoped ? params[1] : null;
      const days = Number(params[storeScoped ? 2 : 1]);
      const limit = Number(params[storeScoped ? 3 : 2]);
      const cutoff = Date.now() - days * 86400000;

      const freq = new Map();
      for (const item of state.saleItems) {
        const sale = state.sales.find((s2) => s2.id === item.sale_id);
        if (!sale || sale.company_id !== companyId || sale.status !== "completed") continue;
        if (storeScoped && sale.store_id !== storeId) continue;
        if (new Date(sale.created_at).getTime() < cutoff) continue;
        const product = state.products.find((p) => p.id === item.product_id);
        if (!product || product.company_id !== companyId || !product.active) continue;
        const entry = freq.get(item.product_id) || { sales: new Set(), last: null };
        entry.sales.add(item.sale_id);
        if (!entry.last || sale.created_at > entry.last) entry.last = sale.created_at;
        freq.set(item.product_id, entry);
      }
      const ranked = [...freq.entries()]
        .map(([id, e]) => ({ id, name: state.products.find((p) => p.id === id).name, sale_frequency: e.sales.size, last_sold_at: e.last }))
        .sort((a, b) => b.sale_frequency - a.sale_frequency || (b.last_sold_at || "").localeCompare(a.last_sold_at || "") || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map((r) => ({ ...r }));
      return { rows: ranked };
    }

    /* ---- GET /api/products (list) ---- */
    if (/FROM products p LEFT JOIN categories c ON c\.id = p\.category_id/.test(s) && /p\.active/.test(s) === false) {
      return { rows: state.products.filter((p) => p.company_id === params[0]) };
    }
    if (/FROM products p LEFT JOIN categories c ON c\.id = p\.category_id/.test(s)) {
      return { rows: state.products.filter((p) => p.company_id === params[0]) };
    }

    /* ---- settings GET/PUT ---- */
    if (/FROM companies c LEFT JOIN company_settings cs ON cs\.company_id = c\.id/.test(s)) {
      const view = state.settings.get(params[0]) || "image";
      const dock = state.dock.get(params[0]) || null;
      const cd = state.customerDisplay.get(params[0]);
      return { rows: [{ company_id: params[0], company_name: "Co", product_view: view, dock_quick_access: dock, customer_display_enabled: cd === undefined ? null : cd, store_id: STORE_1, store_name: "London", till_id: null, till_name: null, terminal_number: null }] };
    }
    if (/INSERT INTO company_settings \(company_id, date_format/.test(s)) {
      /* Mirror the route's COALESCE: null keeps the stored value. */
      const next = params[7] == null ? (state.settings.get(params[0]) || "image") : params[7];
      state.settings.set(params[0], next);
      /* dock_quick_access is params[8]: array → JSON string, null → keep. */
      const nextDock = params[8] == null ? (state.dock.get(params[0]) || null) : JSON.parse(params[8]);
      state.dock.set(params[0], nextDock);
      /* customer_display_enabled is params[9]: boolean | null (keep). */
      if (typeof params[9] === "boolean") state.customerDisplay.set(params[0], params[9]);
      return { rows: [] };
    }
    if (/INSERT INTO audit_logs/.test(s)) {
      return { rows: [] };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => rows(sql, params);
  const client = { async query(sql, params = []) { return rows(sql, params); } };

  return { state, db, client };
}

/* --------------------------------------------------------- app builder */

function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, userId = "u1" } = {}) {
  const productsMod = import("../routes/products.js");
  const settingsMod = import("../routes/settings.js");
  const app = express();
  app.use(express.json());
  let productsRouter = null;
  let settingsRouter = null;
  app.use("/api", (req, res, next) => {
    req.user = { id: userId, companyId, storeId, roleId: "role-1", username: "till" };
    if (productsRouter && (req.path.startsWith("/products") || req.path.startsWith("/categories"))) return productsRouter(req, res, next);
    if (settingsRouter && req.path.startsWith("/settings")) return settingsRouter(req, res, next);
    next();
  });
  return (async () => {
    const [pMod, sMod] = await Promise.all([productsMod, settingsMod]);
    productsRouter = pMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.client.query, release() {} }; } },
      writeAudit: async () => {},
    });
    settingsRouter = sMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.client.query, release() {} }; } },
      writeAudit: async () => {},
    });
    return app;
  })();
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const req = async (port, method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ------------------------------------------------------ backend tests */

describe("Most Selling endpoint (frequency ranking)", () => {
  test("ranks by COUNT(DISTINCT sale_id), NOT quantity", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/products/most-selling");
      assert.equal(r.status, 200);
      const ids = r.body.data.map((p) => p.id);
      // cola: 4 distinct sales; pepsi: 2; crisps: 1 sale but 30 units —
      // crisps must rank LAST despite the highest quantity.
      assert.deepEqual(ids, ["p-cola", "p-pepsi", "p-crisps"]);
      assert.equal(r.body.data[0].sale_frequency, 4);
      assert.equal(r.body.data[2].sale_frequency, 1);
    } finally {
      server.close();
    }
  });

  test("company isolation: foreign-company sales never count", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/products/most-selling");
      // p-pepsi's s6 sale belongs to company B — excluded. Still 2 sales from A.
      const pepsi = r.body.data.find((p) => p.id === "p-pepsi");
      assert.equal(pepsi.sale_frequency, 2);
      // No foreign products appear.
      assert.ok(!r.body.data.some((p) => p.id === "p-b"));
    } finally {
      server.close();
    }
  });

  test("store isolation: store-scoped till excludes other stores' sales", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx, { storeId: STORE_1 });
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/products/most-selling");
      // s5 (other store) sold cola 5 units — excluded from STORE_1 scoping.
      const cola = r.body.data.find((p) => p.id === "p-cola");
      assert.equal(cola.sale_frequency, 4);
      // Verify the SQL carries the store predicate.
      const logged = ctx.state.sqlLog.find((e) => /COUNT\(DISTINCT si\.sale_id\)/.test(e.sql));
      assert.match(logged.sql, /s\.store_id = \$2/);
    } finally {
      server.close();
    }
  });

  test("inactive products are excluded", async () => {
    const ctx = makeDb();
    ctx.state.sales.push({ id: "s7", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: new Date().toISOString() });
    ctx.state.saleItems.push({ sale_id: "s7", product_id: "p-inactive", quantity: 1 });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/products/most-selling");
      assert.ok(!r.body.data.some((p) => p.id === "p-inactive"));
    } finally {
      server.close();
    }
  });

  test("days parameter: default 30, window respected, capped at 365", async () => {
    const ctx = makeDb();
    // Old sale (60 days ago) — outside the default 30-day window.
    ctx.state.sales.push({ id: "s-old", company_id: COMPANY_A, store_id: STORE_1, status: "completed", created_at: new Date(Date.now() - 60 * 86400000).toISOString() });
    ctx.state.saleItems.push({ sale_id: "s-old", product_id: "p-pepsi", quantity: 1 });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const def = await req(port, "GET", "/api/products/most-selling");
      assert.equal(def.body.days, 30);
      assert.equal(def.body.data.find((p) => p.id === "p-pepsi").sale_frequency, 2);

      const wide = await req(port, "GET", "/api/products/most-selling?days=90");
      assert.equal(wide.body.data.find((p) => p.id === "p-pepsi").sale_frequency, 3);

      const capped = await req(port, "GET", "/api/products/most-selling?days=99999");
      assert.equal(capped.body.days, 365);
    } finally {
      server.close();
    }
  });
});

describe("categories endpoint scoping", () => {
  test("returns only the caller's company categories in display order", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "GET", "/api/categories");
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.data.map((c) => c.name), ["Drinks", "Food"]); // no "B-Only Category"
    } finally {
      server.close();
    }
  });
});

describe("product_view setting persistence", () => {
  /* The settings PUT is a whole-form contract (companyName + VAT required),
     exactly what the settings UI sends. */
  const validForm = (productView) => ({
    companyName: "Co",
    dateFormat: "DD/MM/YYYY",
    vatEnabled: true,
    defaultVatRate: 20,
    loyaltyEnabled: false,
    loyaltyEarningRate: 0.01,
    scanGoEnabled: false,
    onlineOrderingEnabled: false,
    ...(productView !== undefined ? { productView } : {}),
  });

  test("defaults to image; PUT persists compact; GET round-trips", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const initial = await req(port, "GET", "/api/settings");
      assert.equal(initial.body.data.till.productView, "image"); // default

      const put = await req(port, "PUT", "/api/settings", validForm("compact"));
      assert.equal(put.status, 200);

      const updated = await req(port, "GET", "/api/settings");
      assert.equal(updated.body.data.till.productView, "compact");
    } finally {
      server.close();
    }
  });

  test("invalid product_view value rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/settings", validForm("gallery"));
      assert.equal(put.status, 400);
      assert.match(put.body.message, /image.*compact|compact.*image/i);
    } finally {
      server.close();
    }
  });

  test("omitting productView keeps the stored value (no accidental reset)", async () => {
    const ctx = makeDb();
    ctx.state.settings.set(COMPANY_A, "compact");
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const put = await req(port, "PUT", "/api/settings", validForm()); // no productView field
      assert.equal(put.status, 200);
      const get = await req(port, "GET", "/api/settings");
      assert.equal(get.body.data.till.productView, "compact");
    } finally {
      server.close();
    }
  });
});

/* ---------------------------------------------- frontend contract tests */

const GRID_SRC = fs.readFileSync(new URL("../src/pages/pos/ProductGrid.jsx", import.meta.url), "utf8");
const POS_SRC = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
const SETTINGS_SRC = fs.readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");

/*
 * T10U — Allow Negative Inventory Billing must actually reach the till.
 * The setting existed server-side (sale transaction re-checks stock), but
 * the till's client-side caps in add()/updateQuantity() blocked any basket
 * that exceeded recorded stock BEFORE checkout — so the enabled setting
 * never took effect for the operator. These contracts pin the fix.
 */
describe("T10U negative-billing reaches the till", () => {
  test("till reads the setting from the settings payload (live + cached)", () => {
    assert.ok(POS_SRC.includes("inventory.allowNegativeInventoryBilling"), "till reads inventory.allowNegativeInventoryBilling");
    assert.ok(POS_SRC.includes("setAllowNegativeBilling("), "till stores it in state");
    assert.ok(POS_SRC.includes("cached?.inventory"), "offline settings cache also restores it");
  });

  test("add() and updateQuantity() only cap stock when negative billing is OFF", () => {
    const addBlock = POS_SRC.split("const add = (product) => {")[1].split("setBasket((current) => {")[0];
    assert.ok(addBlock.includes("!allowNegativeBilling &&"), "add() stock cap is gated on !allowNegativeBilling");
    const updateBlock = POS_SRC.split("const stockLimit =")[2]?.split("setSaleError")[0] || "";
    assert.ok(POS_SRC.split("const updateQuantity =")[1].includes("!allowNegativeBilling &&"), "updateQuantity() cap is gated the same way");
  });

  test("the checkout pre-flight warning only fires when the setting is ON", () => {
    const warningBlock = POS_SRC.split("stockShortfalls.length > 0")[1] || "";
    assert.ok(
      POS_SRC.includes("stockShortfalls.length > 0 && allowNegativeBilling && !options.skipStockWarning"),
      "pre-flight Insufficient Inventory modal is gated on allowNegativeBilling"
    );
  });

  test("server-side enforcement is untouched (authoritative)", () => {
    const SALES_SRC = fs.readFileSync(new URL("../routes/sales.js", import.meta.url), "utf8");
    assert.ok(SALES_SRC.includes("allow_negative_inventory_billing"), "sale engine still reads the company setting");
    assert.ok(SALES_SRC.includes("p.track_stock &&") && SALES_SRC.includes("Number(p.stock_quantity) < Number(item.quantity)"), "sale engine still detects insufficient stock");
    assert.ok(SALES_SRC.includes("insufficientStockLines"), "sale engine records insufficient-stock lines for audit");
  });
});

describe("Till frontend contracts", () => {
  test("hardcoded category list is gone; categories come from the API", () => {
    assert.ok(!/const categories = \[\s*"All"/.test(GRID_SRC), "hardcoded categories array must be removed");
    assert.ok(GRID_SRC.includes('apiRequest("/api/categories"'), "category pane must load from /api/categories");
    assert.ok(GRID_SRC.includes("MOST_SELLING"), "Most Selling pseudo-category must exist");
  });

  test("both views render the same list and call the same onAddProduct", () => {
    const addCalls = GRID_SRC.match(/onAddProduct\(product\)/g) || [];
    assert.equal(addCalls.length, 2, "image + compact views each call onAddProduct once");
    assert.ok(GRID_SRC.includes("displayProducts.map"), "both views render displayProducts");
    assert.ok(!/img[\s\S]*compact/i.test(GRID_SRC.split("COMPACT VIEW")[1]?.split("IMAGE VIEW")[0] || ""), "compact view must render no <img>");
    const compactSection = GRID_SRC.split("COMPACT VIEW")[1].split("IMAGE VIEW")[0];
    assert.ok(!compactSection.includes("<img"), "compact view has no image element");
    assert.ok(compactSection.includes("product.name"), "compact rows show product name");
    assert.ok(compactSection.includes("product.price"), "compact rows show price");
  });

  test("view comes from the productView prop and defaults to image", () => {
    assert.ok(GRID_SRC.includes('productView = "image"'), "default view is image");
    assert.ok(GRID_SRC.includes('productView === "compact"'), "compact branch keyed off the prop");
    assert.ok(POS_SRC.includes("setProductView("), "POS reads the setting into productView");
    assert.ok(POS_SRC.includes("productView={productView}"), "POS passes productView to the grid");
    assert.ok(POS_SRC.includes('till.productView === "compact"'), "POS maps the settings payload");
  });

  test("most-selling UI ordering is presentation-only and search still applies", () => {
    assert.ok(GRID_SRC.includes("/api/products/most-selling"), "grid fetches the frequency ranking");
    // The ranking only re-sorts the already-search-filtered list:
    const sortBlock = GRID_SRC.split("const displayProducts = useMemo")[1].split("}, [category, mostSellingIds, filtered]);")[0];
    assert.ok(sortBlock.includes("filtered"), "displayProducts derives from the existing filtered list (search/active preserved)");
  });

  test("settings page exposes the Till Product View selector", () => {
    assert.ok(SETTINGS_SRC.includes("TillProductViewSetting"), "settings component exists");
    assert.ok(SETTINGS_SRC.includes("Till Product View"), "settings section titled Till Product View");
    assert.ok(SETTINGS_SRC.includes('"compact"'), "compact option offered");
    assert.ok(SETTINGS_SRC.includes('body: JSON.stringify({ ...form, productView: next })'), "saves through the existing settings PUT");
  });
});

/*
 * T10W — configurable dock quick access. The bottom dock's primary icons
 * become a per-company setting (order preserved, max 8); the launcher keeps
 * showing every permitted page and Open Till stays fixed on the dock.
 */
const DOCK_SRC = fs.readFileSync(new URL("../src/components/AdminNavDock.jsx", import.meta.url), "utf8");
const LAYOUT_SRC = fs.readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");

describe("T10W dock quick-access setting (backend)", () => {
  const validForm = (dockQuickAccess) => ({
    companyName: "Co",
    dateFormat: "DD/MM/YYYY",
    vatEnabled: true,
    defaultVatRate: 20,
    loyaltyEnabled: false,
    loyaltyEarningRate: 0.01,
    scanGoEnabled: false,
    onlineOrderingEnabled: false,
    ...(dockQuickAccess !== undefined ? { dockQuickAccess } : {}),
  });

  test("defaults to the original dock layout; PUT persists a custom list in order", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const initial = await req(port, "GET", "/api/settings");
      assert.deepEqual(initial.body.data.dock.quickAccess,
        ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]);

      const put = await req(port, "PUT", "/api/settings", validForm(["Sales", "Customers"]));
      assert.equal(put.status, 200);

      const updated = await req(port, "GET", "/api/settings");
      assert.deepEqual(updated.body.data.dock.quickAccess, ["Sales", "Customers"]); // order preserved
    } finally {
      server.close();
    }
  });

  test("rejects unknown pages, duplicates, more than 8, and non-arrays", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      for (const bad of [
        ["Not A Page"],
        ["Sales", "Sales"],
        ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports", "Stores", "Employees", "Payments"],
        "Sales",
      ]) {
        const put = await req(port, "PUT", "/api/settings", validForm(bad));
        assert.equal(put.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
      }
      /* valid edge: exactly 8 unique known pages */
      const ok = await req(port, "PUT", "/api/settings",
        validForm(["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports", "Stores", "Employees"]));
      assert.equal(ok.status, 200);
    } finally {
      server.close();
    }
  });

  test("omitting dockQuickAccess keeps the stored list (no accidental reset)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await req(port, "PUT", "/api/settings", validForm(["Reports", "Payments"]));
      const put = await req(port, "PUT", "/api/settings", validForm()); // whole-form save without the field
      assert.equal(put.status, 200);
      const get = await req(port, "GET", "/api/settings");
      assert.deepEqual(get.body.data.dock.quickAccess, ["Reports", "Payments"]);
    } finally {
      server.close();
    }
  });

  test("company isolation: company B never sees company A's dock list", async () => {
    const ctx = makeDb();
    const appA = await buildApp(ctx, { companyId: COMPANY_A });
    const { server: serverA, port: portA } = await listen(appA);
    const appB = await buildApp(ctx, { companyId: COMPANY_B });
    const { server: serverB, port: portB } = await listen(appB);
    try {
      await req(portA, "PUT", "/api/settings", validForm(["Purchases"]));
      const forB = await req(portB, "GET", "/api/settings");
      assert.deepEqual(forB.body.data.dock.quickAccess,
        ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]); // default, not A's
    } finally {
      serverA.close();
      serverB.close();
    }
  });
});

describe("T10W dock frontend contracts", () => {
  test("dock renders configured pages; launcher stays centred; Open Till fixed", () => {
    assert.ok(DOCK_SRC.includes("quickAccess"), "dock accepts the quickAccess prop");
    assert.ok(/configured\.slice\(0, mid\)[\s\S]*"LEFT"[\s\S]*configured\.slice\(mid\)/.test(DOCK_SRC),
      "launcher slot sits between the two halves of the configured list");
    assert.ok(/\.slice\(mid\),\s*\n?\s*"Open Till"/.test(DOCK_SRC), "Open Till stays fixed after the configured pages");
    assert.ok(DOCK_SRC.includes("MAX_QUICK_ACCESS = 8"), "dock caps quick access at 8");
  });

  test("empty/unset configuration falls back to the default layout", () => {
    assert.ok(/Array\.isArray\(quickAccess\) && quickAccess\.length\s*\?/.test(DOCK_SRC),
      "unset/empty quickAccess falls back to DOCK_PRIMARY");
  });

  test("permission filtering is unchanged: unavailable pages still skip", () => {
    assert.ok(DOCK_SRC.includes("byName.get(slot)"), "icons resolve from the permission-filtered items list");
    assert.ok(DOCK_SRC.includes("if (!Icon) return null"), "unavailable pages do not render");
  });

  test("AdminLayout fetches settings and passes dock.quickAccess to the dock", () => {
    assert.ok(LAYOUT_SRC.includes('apiRequest("/api/settings")'), "layout loads settings");
    assert.ok(LAYOUT_SRC.includes("quickAccess={dockQuickAccess}"), "dock receives the configured list");
  });

  test("settings UI offers the Dock Quick Access picker (add/remove/reorder)", () => {
    assert.ok(SETTINGS_SRC.includes("DockQuickAccessSetting"), "picker component exists");
    assert.ok(SETTINGS_SRC.includes('tab === "Store & Till" && <DockQuickAccessSetting'), "rendered on Store & Till");
    assert.ok(SETTINGS_SRC.includes("dockQuickAccess: next"), "saves through the existing settings PUT");
    assert.ok(SETTINGS_SRC.includes("ArrowUp") && SETTINGS_SRC.includes("ArrowDown"), "reorder controls exist");
  });
});

/*
 * Customer Display switch + Self-Checkout device pairing (Settings → Store
 * & Till). The till header carries neither button: Customer Display is
 * toggled/opened from Settings; Self-Checkout starts from the login screen
 * with a paired device key.
 */
describe("Customer Display setting + Self-Checkout pairing", () => {
  const validForm = (customerDisplayEnabled) => ({
    companyName: "Co",
    dateFormat: "DD/MM/YYYY",
    vatEnabled: true,
    defaultVatRate: 20,
    loyaltyEnabled: false,
    loyaltyEarningRate: 0.01,
    scanGoEnabled: false,
    onlineOrderingEnabled: false,
    ...(customerDisplayEnabled !== undefined ? { customerDisplayEnabled } : {}),
  });

  test("defaults OFF; PUT round-trips; omitting keeps the stored value", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const initial = await req(port, "GET", "/api/settings");
      assert.equal(initial.body.data.customerDisplay.enabled, false);

      const put = await req(port, "PUT", "/api/settings", validForm(true));
      assert.equal(put.status, 200);
      assert.equal((await req(port, "GET", "/api/settings")).body.data.customerDisplay.enabled, true);

      await req(port, "PUT", "/api/settings", validForm()); /* whole-form save without the field */
      assert.equal((await req(port, "GET", "/api/settings")).body.data.customerDisplay.enabled, true, "no accidental reset");

      const bad = await req(port, "PUT", "/api/settings", { ...validForm(false), customerDisplayEnabled: "yes" });
      assert.equal(bad.status, 400, "non-boolean rejected");
    } finally {
      server.close();
    }
  });

  test("header carries neither button; both live in Settings instead", () => {
    const headerSrc = fs.readFileSync(new URL("../src/pages/pos/POSHeader.jsx", import.meta.url), "utf8");
    assert.ok(!headerSrc.includes("Self-Checkout") && !headerSrc.includes("Customer Display"), "no till-header entry points");
    assert.ok(SETTINGS_SRC.includes("CustomerDisplaySetting"), "Customer Display card in Settings");
    assert.ok(SETTINGS_SRC.includes("SelfCheckoutKeysSetting"), "Self-Checkout pairing card in Settings");
    assert.ok(SETTINGS_SRC.includes("/customer-display"), "Settings can open the display window");
  });

  test("login screen hosts the Self-Checkout device entry", () => {
    const loginSrc = fs.readFileSync(new URL("../src/pages/auth/Login.jsx", import.meta.url), "utf8");
    assert.ok(loginSrc.includes("onStartSelfCheckout"), "login accepts the SCO entry action");
    assert.ok(loginSrc.includes("deviceKey"), "login asks for the device key");
    assert.ok(loginSrc.includes("Self-Checkout"), "Self-Checkout entry visible before staff sign-in");
  });
});
