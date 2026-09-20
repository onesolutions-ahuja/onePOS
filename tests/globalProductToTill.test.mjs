/*
 * GLOBAL PRODUCT MASTER → COMPANY PRODUCTS → TILL — focused regression
 *
 *   node --test tests/globalProductToTill.test.mjs
 *
 * ROOT CAUSE (regressed here):
 *   Adding a product from the Global Product Database runs the shared
 *   ProductFormModal against POST /api/products. The preset carries NO SKU,
 *   so the row is created with sku IS NULL — while POST returns 201
 *   "Product created" (hence the UI reports success).
 *
 *   GET /api/products — the single data source behind BOTH the admin
 *   Products page and the till grid (POS.jsx loadProducts → ProductGrid) —
 *   used to end its WHERE clause with:
 *
 *       AND p.sku <> 'MISC'
 *
 *   In Postgres three-valued logic, NULL <> 'MISC' evaluates to NULL (not
 *   TRUE), so every SKU-less product was silently excluded from the
 *   Products page and the till. The fix uses the NULL-safe
 *   `p.sku IS DISTINCT FROM 'MISC'`, which still hides the Misc Item
 *   placeholder but keeps SKU-less products visible.
 *
 * The fake db below REPLAYS Postgres three-valued logic for both SQL
 * shapes (`<> 'MISC'` drops NULL rows; `IS DISTINCT FROM 'MISC'` keeps
 * them), so these tests fail against the old route and pass against the
 * fixed one — the mock cannot be fooled by the JS-truthiness bug that
 * masked the regression in earlier mocks.
 *
 * Also covers:
 *   - Identity preservation: EAN/barcode, price, VAT rate + applicability
 *     survive the add; the shared ean_product_master catalogue is NEVER
 *     written to (the global master stays reference-only).
 *   - existsInMaster flips per company: true for the adding company,
 *     still false for another company.
 *   - Cross-company isolation: company B's Products/Till list never
 *     returns company A's product.
 *   - The MISC placeholder stays hidden from the till list.
 *   - The till rendering path (normaliseProduct + POS grid filter)
 *     accepts the returned row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import createGlobalProductsRouter from "../routes/globalProducts.js";
import createProductsRouter from "../routes/products.js";
import { normaliseProduct } from "../src/utils/formatters.js";

/* ---------------------------------------------------------------- seeds */

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const ADMIN_ROLE = "r0000000-0000-4000-8000-00000000000a";
const USER_A = "u0000000-0000-4000-8000-00000000000a";
const USER_B = "u0000000-0000-4000-8000-00000000000b";

const SAMPLE_GLOBAL = [
  {
    id: "g-01",
    ean: "05449000000996",
    product_name: "Coca Cola 500ml",
    brand: "Coca-Cola",
    category: "Soft Drinks",
    subcategory: "Cola",
    unit_description: "500ml bottle",
    image_url: "https://cdn.example.com/coca-cola-500.jpg",
    source: "tesco",
  },
  {
    id: "g-02",
    ean: "05017726100001",
    product_name: "Pepsi Max 500ml",
    brand: "Pepsi",
    category: "Soft Drinks",
    subcategory: "Cola",
    unit_description: "500ml bottle",
    image_url: null,
    source: "tesco",
  },
];

const SAMPLE_CATEGORIES = [
  { id: "cat-sd", company_id: COMPANY_A, name: "Soft Drinks", display_order: 1, active: true },
  { id: "cat-tn", company_id: COMPANY_B, name: "Tinned Food", display_order: 2, active: true },
];

/*
 * The EXACT payload ProductFormModal.submit() sends when GlobalProductsAdmin
 * opens the form from a global catalogue row (preset: no sku, ean preset as
 * barcode, user-entered pricing, defaults elsewhere).
 */
function globalPresetPayload(overrides = {}) {
  return {
    name: "Coca Cola 500ml",
    sku: null,
    barcode: "05449000000996",
    categoryId: null,
    price: 1.99,
    costPrice: 0.5,
    lowStockLevel: 0,
    vatRate: 20,
    vatApplicable: true,
    ageRestricted: false,
    trackStock: true,
    openingStock: 0,
    stockQuantity: 0,
    availableOnUber: false,
    availableOnDeliveroo: false,
    uberItemId: null,
    deliverooItemId: null,
    imageUrl: "https://cdn.example.com/coca-cola-500.jpg",
    ...overrides,
  };
}

/* ------------------------------------------------------------- fake db */

function makeDb() {
  const state = {
    global: SAMPLE_GLOBAL.map((r) => ({ ...r })),
    products: [],
    categories: SAMPLE_CATEGORIES.map((c) => ({ ...c })),
    roles: new Map([
      [ADMIN_ROLE, { id: ADMIN_ROLE, company_id: COMPANY_A, name: "Administrator" }],
    ]),
    calls: [],
  };

  const db = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.calls.push({ sql: s, params: [...params] });

    /* --------- global-products list + count queries (WHERE shape) --------- */
    if (/FROM ean_product_master gpm/.test(s)) {
      const companyId = params[params.length - 3];
      const likeParams = params.filter(
        (p) => typeof p === "string" && p.startsWith("%") && p.endsWith("%")
      );
      const searchClause = s.includes("LOWER(gpm.product_name)") ? likeParams.shift() || null : null;
      const eanClause = s.includes("gpm.ean LIKE")
        ? params.find((p) => typeof p === "string" && !p.startsWith("%") && p.endsWith("%")) || null
        : null;
      const brandClause = s.includes("LOWER(gpm.brand)") ? likeParams.shift() || null : null;
      const catClause = s.includes("LOWER(gpm.category)") ? likeParams.shift() || null : null;

      const rows = state.global
        .filter((r) => {
          if (searchClause) {
            const q = searchClause.slice(1, -1).toLowerCase();
            if (!String(r.product_name).toLowerCase().includes(q)) return false;
          }
          if (eanClause) {
            if (!String(r.ean).startsWith(eanClause.slice(0, -1))) return false;
          }
          if (brandClause) {
            const q = brandClause.slice(1, -1).toLowerCase();
            if (!String(r.brand || "").toLowerCase().includes(q)) return false;
          }
          if (catClause) {
            const q = catClause.slice(1, -1).toLowerCase();
            if (!String(r.category || "").toLowerCase().includes(q)) return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            (a.brand || "").localeCompare(b.brand || "") ||
            a.product_name.localeCompare(b.product_name)
        );

      if (s.startsWith("SELECT COUNT(*)::int AS total")) {
        return { rows: [{ total: rows.length }] };
      }

      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const paged = rows.slice(offset, offset + limit);

      return {
        rows: paged.map((r) => ({
          ...r,
          name: r.product_name,
          existsInMaster: state.products.some(
            (p) =>
              p.company_id === companyId &&
              p.active &&
              (p.barcode === r.ean ||
                p.barcode?.padStart(14, "0") === String(r.ean).padStart(14, "0"))
          ),
        })),
      };
    }

    /* ------------------- global-products brands aggregate ---------------- */
    if (/FROM ean_product_master.*GROUP BY brand/.test(s)) {
      const counts = new Map();
      for (const r of state.global) {
        if (!r.brand) continue;
        counts.set(r.brand, (counts.get(r.brand) || 0) + 1);
      }
      return {
        rows: [...counts.entries()].map(([name, product_count]) => ({ name, product_count })),
      };
    }

    /* ----------------- global-products categories aggregate --------------- */
    if (/FROM ean_product_master.*GROUP BY category/.test(s)) {
      const counts = new Map();
      for (const r of state.global) {
        if (!r.category) continue;
        counts.set(r.category, (counts.get(r.category) || 0) + 1);
      }
      return {
        rows: [...counts.entries()].map(([name, product_count]) => ({ name, product_count })),
      };
    }

    /* -------------------- roles / admin-authorize check ------------------- */
    if (/SELECT 1 FROM roles WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const role = state.roles.get(params[0]);
      return {
        rows:
          role &&
          role.company_id === params[1] &&
          /administrator|admin|owner/.test(String(role.name).toLowerCase())
            ? [{ ok: 1 }]
            : [],
      };
    }

    /* ------------------ categories listing (products router) -------------- */
    if (/FROM categories c LEFT JOIN products p/.test(s)) {
      const companyId = params[0];
      return {
        rows: state.categories
          .filter((c) => c.company_id === companyId && c.active)
          .map((c) => ({ id: c.id, name: c.name, display_order: c.display_order, active: c.active })),
      };
    }

    /* ---- GET /api/products (Products page + till grid data source) ----
     * Faithful Postgres semantics for the MISC exclusion:
     *   `sku IS DISTINCT FROM 'MISC'` → NULL-sku rows are KEPT.
     *   `sku <> 'MISC'` (legacy/regression) → NULL-sku rows are DROPPED. */
    if (
      /FROM products p LEFT JOIN categories c ON c\.id = p\.category_id WHERE p\.company_id = \$1 AND p\.active = true/.test(
        s
      )
    ) {
      const nullSafeMisc = /p\.sku\s+IS\s+DISTINCT\s+FROM\s+'MISC'/.test(s);
      const legacyMisc = /p\.sku\s*<>\s*'MISC'/.test(s);
      const list = state.products.filter((p) => {
        if (p.company_id !== params[0]) return false;
        if (!p.active) return false;
        if (nullSafeMisc) return p.sku !== "MISC";
        if (legacyMisc) return p.sku != null && p.sku !== "MISC"; /* 3VL: NULL <> 'MISC' is NULL */
        return true;
      });
      return {
        rows: list.map((p) => ({
          ...p,
          category_name: state.categories.find((c) => c.id === p.category_id)?.name || null,
        })),
      };
    }

    /* ---- GET /api/products/most-selling (no sales in this suite) ---- */
    if (/FROM sale_items si/.test(s)) {
      return { rows: [] };
    }

    /* -------------- POST /api/products duplicate checks --------------- */
    if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(sku\)/.test(s)) {
      const hit = state.products.find(
        (p) =>
          p.company_id === params[0] &&
          p.active &&
          String(p.sku || "").toLowerCase() === String(params[1] || "").toLowerCase()
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (/SELECT id FROM products WHERE company_id = \$1 AND barcode = \$2.*LIMIT 1/.test(s)) {
      const hit = state.products.find(
        (p) =>
          p.company_id === params[0] &&
          p.active &&
          String(p.barcode || "") === String(params[1] || "")
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }

    /* ---- POST /api/products/misc-line (MISC placeholder find-or-create) ---- */
    if (/INSERT INTO products \(/.test(s) && /ON CONFLICT \(company_id\) WHERE sku = 'MISC'/.test(s)) {
      let misc = state.products.find((p) => p.company_id === params[0] && p.sku === "MISC");
      if (!misc) {
        misc = {
          id: `p-misc-${state.products.length + 1}`,
          company_id: params[0],
          category_id: null,
          name: "Misc Item",
          sku: "MISC",
          barcode: null,
          description: null,
          price: 0,
          cost_price: 0,
          vat_rate: 20,
          vat_applicable: false,
          age_restricted: false,
          stock_quantity: 0,
          low_stock_level: 0,
          track_stock: false,
          active: false,
          available_on_uber: false,
          available_on_deliveroo: false,
          uber_item_id: null,
          deliveroo_item_id: null,
          image_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        state.products.push(misc);
      }
      return { rows: [{ id: misc.id }] };
    }

    /* -------------------- POST /api/products (create) -------------------
     * Parameter layout of the real route:
     * $1 company, $2 category, $3 name, $4 sku, $5 barcode, $6 description,
     * $7 price, $8 cost, $9 vatRate, $10 vatApplicable, $11 lowStockLevel,
     * $12 trackStock, $13 uberOn, $14 deliverooOn, $15 uberItemId,
     * $16 deliverooItemId, $17 ageRestricted, $18 imageUrl
     * (stock_quantity=0 and active=true are literals in the VALUES clause). */
    if (/INSERT INTO products \(/.test(s)) {
      const created = {
        id: `prod-${state.products.length + 1}`,
        company_id: params[0],
        category_id: params[1] || null,
        name: params[2],
        sku: params[3] || null,
        barcode: params[4] || null,
        description: params[5] || null,
        price: Number(params[6]) || 0,
        cost_price: Number(params[7]) || 0,
        vat_rate: Number(params[8] ?? 20) || 0,
        vat_applicable: params[9] !== false,
        stock_quantity: 0,
        low_stock_level: Number(params[10]) || 0,
        track_stock: Boolean(params[11]),
        active: true,
        available_on_uber: Boolean(params[12]),
        available_on_deliveroo: Boolean(params[13]),
        uber_item_id: params[14] || null,
        deliveroo_item_id: params[15] || null,
        age_restricted: Boolean(params[16]),
        image_url: params[17] || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.products.push(created);
      return { rows: [{ ...created }] };
    }

    return { rows: [] };
  };

  db.calls = state.calls;
  db.state = state;
  return db;
}

/* ------------------------------------------------------------- harness */

function buildApp() {
  const db = makeDb();
  const authenticate = (req, res, next) => {
    const auth = req.header("Authorization") || "";
    if (auth === "Bearer company-a") {
      req.user = { id: USER_A, companyId: COMPANY_A, storeId: "st-a", roleId: ADMIN_ROLE };
      return next();
    }
    if (auth === "Bearer company-b") {
      req.user = { id: USER_B, companyId: COMPANY_B, storeId: "st-b", roleId: "rb-admin" };
      db.state.roles.set("rb-admin", { id: "rb-admin", company_id: COMPANY_B, name: "Owner" });
      return next();
    }
    res.status(401).json({ success: false, message: "Unauthorised" });
  };

  async function getRolePermissionCodes() {
    return [];
  }
  function authorize(...codes) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }
      try {
        const result = await db(
          `SELECT 1 FROM roles WHERE id = $1 AND company_id = $2 AND LOWER(name) IN ('administrator', 'admin', 'owner') LIMIT 1`,
          [req.user.roleId, req.user.companyId]
        );
        if (result.rows.length) return next();
        const held = await getRolePermissionCodes(req.user.roleId);
        if (codes.some((code) => held.includes(code))) return next();
        return res.status(403).json({ success: false, message: "You do not have permission" });
      } catch (err) {
        return res.status(500).json({ success: false, message: "Authorization failed" });
      }
    };
  }

  async function createInventoryMovement(_client, { productId, quantityChange }) {
    const product = db.state.products.find((p) => p.id === productId);
    if (product) product.stock_quantity = Number(product.stock_quantity || 0) + Number(quantityChange || 0);
    return {
      balance: product ? product.stock_quantity : 0,
      movement: { id: `mv-${Math.random()}`, movement_type: "OPENING" },
    };
  }

  const pool = {
    async connect() {
      const client = {};
      client.query = async (...args) => {
        const s = typeof args[0] === "string" ? args[0] : "";
        if (s === "BEGIN") return db("BEGIN");
        if (s === "COMMIT") return db("COMMIT");
        if (s === "ROLLBACK") return db("ROLLBACK");
        return db(...args);
      };
      client.release = () => {};
      return client;
    },
  };

  const writeAudit = () => {};

  const app = express();
  app.use(express.json());
  app.use("/api", createGlobalProductsRouter({ authenticate, authorize, db }));
  app.use(
    "/api",
    createProductsRouter({ authenticate, authorize, db, pool, createInventoryMovement, writeAudit })
  );

  return { app, db };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

async function req(port, method, path, body, identity = "A") {
  const headers = { "Content-Type": "application/json" };
  if (identity === "A") headers.Authorization = "Bearer company-a";
  else if (identity === "B") headers.Authorization = "Bearer company-b";
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { status: res.status, body: json };
}

/* -------------------------------------------------- till rendering path */

/* Mirror of POS.jsx filtered (category "All" + search + product.active). */
function tillWouldShow(product, { category = "All", search = "" } = {}) {
  const p = normaliseProduct(product);
  const query = search.toLowerCase().trim();
  const categoryMatch = category === "All" || p.category === category;
  const searchMatch =
    !query ||
    p.name.toLowerCase().includes(query) ||
    p.sku?.toLowerCase().includes(query) ||
    p.barcode?.toLowerCase().includes(query);
  return categoryMatch && searchMatch && p.active;
}

/* ----------------------------------------------------------------- run */

test("add from Global Product Master (no SKU) appears in GET /api/products with identity preserved", async () => {
  const { app, db } = buildApp();
  const { server, port } = await listen(app);
  try {
    const created = await req(port, "POST", "/api/products", globalPresetPayload());
    assert.equal(created.status, 201);
    assert.equal(created.body.success, true);

    const list = await req(port, "GET", "/api/products");
    assert.equal(list.status, 200);
    const row = list.body.data.find((p) => p.barcode === "05449000000996");
    assert.ok(row, "SKU-less global add MUST be visible in the Products list (regression: `sku <> 'MISC'` dropped NULL rows)");
    assert.equal(row.name, "Coca Cola 500ml");
    assert.equal(row.sku, null);
    assert.equal(row.active, true);
    /* Identity preserved: user-entered pricing + VAT defaults, not global pricing. */
    assert.equal(Number(row.price), 1.99);
    assert.equal(Number(row.vat_rate), 20);
    assert.equal(row.vat_applicable, true);
    assert.equal(row.image_url, "https://cdn.example.com/coca-cola-500.jpg");

    /* The create touched ONLY the company's products table — the shared
     * global catalogue (ean_product_master) is reference-only. */
    const masterWrites = db.calls.filter(
      (c) =>
        /ean_product_master/.test(c.sql) &&
        /INSERT|UPDATE|DELETE/.test(c.sql)
    );
    assert.equal(masterWrites.length, 0, "Global Product Master rows must never be written by an add");
  } finally {
    server.close();
  }
});

test("second global add (matched category, no SKU) also appears, still no global-master writes", async () => {
  const { app, db } = buildApp();
  const { server, port } = await listen(app);
  try {
    const created = await req(
      port,
      "POST",
      "/api/products",
      globalPresetPayload({
        name: "Pepsi Max 500ml",
        barcode: "05017726100001",
        price: 2.49,
        costPrice: 0.8,
        imageUrl: null,
        categoryId: "cat-sd", // matched from the company's categories by the form
      })
    );
    assert.equal(created.status, 201);

    const list = await req(port, "GET", "/api/products");
    const row = list.body.data.find((p) => p.barcode === "05017726100001");
    assert.ok(row, "second SKU-less global add must be visible");
    assert.equal(row.category_id, "cat-sd");
    assert.equal(row.category_name, "Soft Drinks");
    assert.equal(row.sku, null);

    const masterWrites = db.calls.filter(
      (c) => /ean_product_master/.test(c.sql) && /INSERT|UPDATE|DELETE/.test(c.sql)
    );
    assert.equal(masterWrites.length, 0);
  } finally {
    server.close();
  }
});

test("added product renders through the till data path (normaliseProduct + grid filter)", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    await req(port, "POST", "/api/products", globalPresetPayload());

    /* POS.jsx loads the grid from GET /api/products, normalises each row and
     * filters by category/search/active before ProductGrid renders it. */
    const list = await req(port, "GET", "/api/products");
    const row = list.body.data.find((p) => p.barcode === "05449000000996");
    assert.ok(row, "product must reach the till data source");

    assert.ok(tillWouldShow(row), "product must pass the till grid filter on the All tab");
    assert.ok(
      tillWouldShow(row, { search: "05449000000996" }),
      "scanning the EAN in the till search must find the product"
    );
    const normalised = normaliseProduct(row);
    assert.equal(normalised.barcode, "05449000000996");
    assert.equal(Number(normalised.price), 1.99);
    assert.equal(normalised.vatApplicable, true);
    assert.equal(normalised.active, true);
  } finally {
    server.close();
  }
});

test("MISC placeholder stays hidden from the Products/Till list", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    await req(port, "POST", "/api/products", globalPresetPayload());
    const misc = await req(port, "POST", "/api/products/misc-line");
    assert.equal(misc.status, 201);

    const list = await req(port, "GET", "/api/products");
    assert.equal(list.body.data.some((p) => p.sku === "MISC"), false, "MISC placeholder must stay excluded");
    assert.ok(list.body.data.some((p) => p.barcode === "05449000000996"), "real product still visible");
  } finally {
    server.close();
  }
});

test("company isolation: another company never sees the added product", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    await req(port, "POST", "/api/products", globalPresetPayload()); // added by company A

    const listB = await req(port, "GET", "/api/products", undefined, "B");
    assert.equal(listB.status, 200);
    assert.equal(
      listB.body.data.some((p) => p.barcode === "05449000000996"),
      false,
      "company B must not see company A's product"
    );

    /* existsInMaster is per-company: true for A, still false for B. */
    const forA = await req(port, "GET", "/api/global-products?ean=05449000000996");
    const rowA = forA.body.data.find((r) => r.ean === "05449000000996");
    assert.equal(rowA.existsInMaster, true);

    const forB = await req(port, "GET", "/api/global-products?ean=05449000000996", undefined, "B");
    const rowB = forB.body.data.find((r) => r.ean === "05449000000996");
    assert.equal(rowB.existsInMaster, false, "company B must NOT be told the EAN is already in ITS master");
  } finally {
    server.close();
  }
});

test("static SQL pin: products list + most-selling exclude MISC with the NULL-safe form only", () => {
  const src = fs.readFileSync(new URL("../routes/products.js", import.meta.url), "utf8");

  assert.match(
    src,
    /AND p\.sku IS DISTINCT FROM 'MISC'/,
    "GET /api/products must use the NULL-safe `IS DISTINCT FROM 'MISC'` so SKU-less (global-master) products stay visible"
  );
  assert.doesNotMatch(
    src,
    /p\.sku\s*<>\s*'MISC'/,
    "the legacy `sku <> 'MISC'` shape silently drops NULL-sku rows (Postgres 3VL) and must not come back"
  );
});
