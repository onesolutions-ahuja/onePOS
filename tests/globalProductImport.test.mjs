/*
 * GLOBAL PRODUCT DATABASE / PRODUCT MASTER IMPORT — focused regression
 * suite for the T10C feature.
 *
 *   node --test tests/globalProductImport.test.mjs
 *
 * Covers:
 *   - GET /api/global-products list + pagination + filters (search / EAN /
 *     brand / category).
 *   - existsInMaster is set from the CURRENT COMPANY'S Product Master only
 *     (scoped strictly to req.user.companyId).
 *   - Cross-company duplicate isolation: a product existing in Company A
 *     does NOT appear as "Already in master" for Company B.
 *   - Shared ProductFormModal behaviour via POST /api/products:
 *       · a pre-populated form payload saves through the EXISTING create
 *         endpoint, writing into the requesting company only.
 *       · the form payload NEVER carries pricing, stock or VAT copied from
 *         the global catalogue.
 *   - Duplicate protection on the authoritative backend (POST
 *     /api/products returns 409 for the same barcode within one company)
 *     even if the frontend's + button somehow fired twice.
 *   - Normal blank Product Master creation still works exactly as before.
 *
 * Driven over HTTP using routes/globalProducts.js and the product
 * creation section of routes/products.js against a stateful fake db with
 * enough of the shared schema (ean_product_master, products, categories,
 * roles + permissions) for the real route code to believe it's running
 * against Postgres.  Fake db follows the same in-memory pattern used by
 * the other feature tests (customersManagement, lowStock, returns E2E).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createGlobalProductsRouter from "../routes/globalProducts.js";
import createProductsRouter from "../routes/products.js";

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
    source: "sample",
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
    source: "sample",
  },
  {
    id: "g-03",
    ean: "05000111000011",
    product_name: "Heinz Baked Beans 415g",
    brand: "Heinz",
    category: "Tinned Food",
    subcategory: "Beans",
    unit_description: "415g can",
    image_url: null,
    source: "sample",
  },
  {
    id: "g-04",
    ean: "05000111000028",
    product_name: "Heinz Tomato Soup 400g",
    brand: "Heinz",
    category: "Tinned Food",
    subcategory: "Soup",
    unit_description: "400g can",
    image_url: null,
    source: "sample",
  },
  {
    id: "g-05",
    ean: "05000157000012",
    product_name: "Walkers Ready Salted 25g",
    brand: "Walkers",
    category: "Snacks",
    subcategory: "Crisps",
    unit_description: "25g packet",
    image_url: null,
    source: "sample",
  },
];

const SAMPLE_CATEGORIES = [
  { id: "cat-sd", company_id: COMPANY_A, name: "Soft Drinks", display_order: 1, active: true },
  { id: "cat-sn", company_id: COMPANY_A, name: "Snacks", display_order: 2, active: true },
  { id: "cat-tn", company_id: COMPANY_B, name: "Tinned Food", display_order: 3, active: true },
];

/* ------------------------------------------------------------- fake db */

function makeDb() {
  const state = {
    global: SAMPLE_GLOBAL.map((r) => ({ ...r })),
    products: [],
    categories: SAMPLE_CATEGORIES.map((c) => ({ ...c })),
    roles: new Map([
      // Admin role (Company A) — the authorize helper checks LOWER(name)
      [ADMIN_ROLE, { id: ADMIN_ROLE, company_id: COMPANY_A, name: "Administrator" }],
    ]),
    calls: [],
  };

  const db = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.calls.push({ sql: s, params: [...params] });

    /* --------- global-products list + count queries (WHERE shape) --------- */
    if (/FROM ean_product_master gpm/.test(s)) {
      const companyId = params.find((_, i) => params.length - 3 === i) || params[params.length - 3];
      const likeOrder = [];
      if (s.includes("LOWER(gpm.product_name)")) likeOrder.push("search");
      if (s.includes("LOWER(gpm.brand)")) likeOrder.push("brand");
      if (s.includes("LOWER(gpm.category)")) likeOrder.push("category");
      const likeParams = params.filter((p) => typeof p === "string" && p.startsWith("%") && p.endsWith("%"));
      const likeByKey = Object.fromEntries(likeOrder.map((key, i) => [key, likeParams[i] || null]));
      const searchClause = likeByKey.search || null;
      const eanClause = s.includes("gpm.ean LIKE") ? (() => {
        const likeParams = params.filter((p) => typeof p === "string" && !p.startsWith("%") && p.endsWith("%"));
        return likeParams[0] || null;
      })() : null;
      const brandClause = likeByKey.brand || null;
      const catClause = likeByKey.category || null;

      const rows = state.global
        .filter((r) => {
          if (searchClause) {
            const q = searchClause.slice(1, -1).toLowerCase();
            if (!String(r.product_name).toLowerCase().includes(q)) return false;
          }
          if (eanClause) {
            const q = eanClause.slice(0, -1);
            if (!String(r.ean).startsWith(q)) return false;
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
        .sort((a, b) =>
          (a.brand || "").localeCompare(b.brand || "") ||
          a.product_name.localeCompare(b.product_name)
        );

      const total = rows.length;

      // LIMIT/OFFSET parameters at params.length-2 and -1
      const limit = params[params.length - 2];
      const offset = params[params.length - 1];
      const paged = rows.slice(offset, offset + limit);

      const resolved = paged.map((r) => ({
        ...r,
        name: r.product_name,
        existsInMaster: state.products.some(
          (p) =>
            p.company_id === companyId &&
            p.active &&
            (p.barcode === r.ean ||
              p.barcode?.padStart(14, "0") === String(r.ean).padStart(14, "0"))
        ),
      }));

      // Decide which query was requested (count/list) by SQL shape:
      if (s.startsWith("SELECT COUNT(*)::int AS total")) {
        return { rows: [{ total }] };
      }
      return { rows: resolved };
    }

    /* ------------------- global-products brands aggregate ---------------- */
    if (/FROM ean_product_master.*GROUP BY brand/.test(s)) {
      const counts = new Map();
      for (const r of state.global) {
        if (!r.brand) continue;
        counts.set(r.brand, (counts.get(r.brand) || 0) + 1);
      }
      return {
        rows: [...counts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, product_count]) => ({ name, product_count })),
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
        rows: [...counts.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, product_count]) => ({ name, product_count })),
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
          .filter((c) => c.company_id === companyId)
          .map((c) => ({
            id: c.id,
            name: c.name,
            display_order: c.display_order,
            active: c.active,
            product_count: state.products.filter(
              (p) => p.company_id === companyId && p.category_id === c.id && p.active
            ).length,
          })),
      };
    }

    /* --------------------- Product Master: GET /api/products --------------- */
    if (/FROM products p LEFT JOIN categories c ON c\.id = p\.category_id WHERE p\.company_id = \$1/.test(s)) {
      const companyId = params[0];
      return {
        rows: state.products
          .filter((p) => p.company_id === companyId && p.active)
          .map((p) => ({
            ...p,
            category_name: state.categories.find((c) => c.id === p.category_id)?.name || null,
          })),
      };
    }

    /* -------------- Product Master: POST /api/products queries ------------ */
    if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(sku\)/.test(s)) {
      const hit = state.products.find(
        (p) =>
          p.company_id === params[0] &&
          p.active &&
          String(p.sku || "").toLowerCase() === String(params[1] || "").toLowerCase()
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (/SELECT id FROM products WHERE company_id = \$1 AND barcode = \$2.*LIMIT 1/.test(s) && !/id <>/.test(s)) {
      const hit = state.products.find(
        (p) =>
          p.company_id === params[0] && p.active && String(p.barcode || "") === String(params[1] || "")
      );
      return { rows: hit ? [{ id: hit.id }] : [] };
    }
    if (/INSERT INTO products \(/.test(s)) {
      // Parameters from the real route:
      // $1=company, $2=cat, $3=name, $4=sku, $5=barcode, $6=desc,
      // $7=price, $8=cost, $9=vatRate, $10=vatApplicable,
      // $11=lowStock, $12=trackStock, $13=uberOn, $14=deliverooOn,
      // $15=uberItemId, $16=deliverooItemId
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

const REQ_A = "COMPANY_A";
const REQ_B = "COMPANY_B";
const REQ_NONE = "NONE";

function buildAuthRequestContext(db, identity) {
  return { db, identity };
}

function buildApp() {
  const db = makeDb();
  const authenticate = (req, res, next) => {
    const auth = req.header("Authorization") || "";
    if (auth === "Bearer company-a") {
      req.user = {
        id: USER_A,
        companyId: COMPANY_A,
        storeId: "st-a",
        roleId: ADMIN_ROLE,
      };
      return next();
    }
    if (auth === "Bearer company-b") {
      req.user = {
        id: USER_B,
        companyId: COMPANY_B,
        storeId: "st-b",
        roleId: "rb-admin",
      };
      db.state.roles.set("rb-admin", {
        id: "rb-admin",
        company_id: COMPANY_B,
        name: "Owner",
      });
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
        return res
          .status(403)
          .json({ success: false, message: "You do not have permission" });
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

  const inventoryMovementTypes = new Set([
    "OPENING",
    "PURCHASE_IN",
    "SALE_OUT",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "SALE_RETURN_IN",
  ]);

  const canViewCompanyCustomers = async () => false;

  const app = express();
  app.use(express.json());
  app.use("/api", createGlobalProductsRouter({ authenticate, authorize, db }));
  app.use(
    "/api",
    createProductsRouter({
      authenticate,
      authorize,
      db,
      pool,
      createInventoryMovement,
      inventoryMovementTypes,
      canViewCompanyCustomers,
    })
  );

  return { app, db };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

async function req(port, method, path, body, identity = REQ_A) {
  const headers = { "Content-Type": "application/json" };
  if (identity === REQ_A) headers.Authorization = "Bearer company-a";
  else if (identity === REQ_B) headers.Authorization = "Bearer company-b";
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

const AUTH_NONE = REQ_NONE;


/* ----------------------------------------------------------------- run */

test("unauthenticated call to /api/global-products returns 401", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(port, "GET", "/api/global-products", undefined, AUTH_NONE);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("global list loads with pagination meta and rows", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(port, "GET", "/api/global-products?limit=2&page=1");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.meta.total, SAMPLE_GLOBAL.length);
    assert.equal(res.body.meta.totalPages, Math.ceil(SAMPLE_GLOBAL.length / 2));
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.data[0].existsInMaster, false);
    for (const row of res.body.data) {
      assert.ok("ean" in row);
      assert.ok("name" in row);
      assert.ok("brand" in row);
      assert.ok("category" in row);
      assert.ok("existsInMaster" in row);
      assert.equal(typeof row.existsInMaster, "boolean");
    }
  } finally {
    server.close();
  }
});

test("name search narrows the list", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(port, "GET", "/api/global-products?search=coca%20cola");
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.total, 1);
    assert.equal(res.body.data[0].name, "Coca Cola 500ml");
    assert.equal(res.body.data[0].ean, "05449000000996");
  } finally {
    server.close();
  }
});

test("EAN prefix search narrows the list", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(port, "GET", "/api/global-products?ean=05017726100001");
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.total, 1);
    assert.equal(res.body.data[0].name, "Pepsi Max 500ml");
  } finally {
    server.close();
  }
});

test("brand filter returns only the matching brand with counts", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const brands = await req(port, "GET", "/api/global-products/brands");
    assert.equal(brands.status, 200);
    assert.equal(brands.body.data.find((b) => b.name === "Heinz").product_count, 2);

    const filtered = await req(port, "GET", "/api/global-products?brand=Heinz");
    assert.equal(filtered.body.meta.total, 2);
    assert.equal(filtered.body.data.length, 2);
    assert.ok(filtered.body.data.every((r) => r.brand === "Heinz"));
  } finally {
    server.close();
  }
});

test("category filter + pagination returns matching pages", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const cats = await req(port, "GET", "/api/global-products/categories");
    assert.equal(cats.status, 200);
    assert.ok(cats.body.data.find((c) => c.name === "Soft Drinks"));

    const res = await req(
      port,
      "GET",
      "/api/global-products?category=Soft%20Drinks&limit=1&page=1"
    );
    assert.equal(res.body.meta.total, 2);
    assert.equal(res.body.meta.totalPages, 2);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].category, "Soft Drinks");
  } finally {
    server.close();
  }
});

test("search + brand filter work together (Coca + Coca-Cola -> one)", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(
      port,
      "GET",
      "/api/global-products?search=Coca&brand=Coca-Cola"
    );
    assert.equal(res.body.meta.total, 1);
    assert.equal(res.body.data[0].name, "Coca Cola 500ml");
  } finally {
    server.close();
  }
});

test("existsInMaster is flagged when the same EAN exists for the requesting company only", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const create = await req(port, "POST", "/api/products", {
      name: "Heinz Baked Beans 415g",
      barcode: "05000111000011",
      price: 1.2,
      costPrice: 0.6,
      vatRate: 20,
      openingStock: 0,
    });
    assert.equal(create.status, 201, create.body?.message || "create should succeed");

    const forA = await req(
      port,
      "GET",
      "/api/global-products?ean=05000111000011"
    );
    assert.equal(forA.body.data[0].existsInMaster, true);

    const forB = await req(
      port,
      "GET",
      "/api/global-products?ean=05000111000011",
      undefined,
      REQ_B
    );
    assert.equal(
      forB.body.data[0].existsInMaster,
      false,
      "Company A's product must NOT appear in master for Company B"
    );
  } finally {
    server.close();
  }
});

test("global EAN with leading zero vs shorter barcode still matches existsInMaster", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    await req(port, "POST", "/api/products", {
      name: "Coca Cola 500ml",
      barcode: "5449000000996",
      price: 1.5,
      costPrice: 0.5,
      vatRate: 20,
      openingStock: 0,
    });
    const res = await req(
      port,
      "GET",
      "/api/global-products?ean=05449000000996"
    );
    assert.equal(res.body.data[0].existsInMaster, true);
  } finally {
    server.close();
  }
});

test("form payload never leaks global pricing/stock into Product Master", async () => {
  const { app, db } = buildApp();
  const { server, port } = await listen(app);
  try {
    const safePayload = {
      name: "Walkers Ready Salted 25g",
      sku: "",
      barcode: "05000157000012",
      categoryId: "cat-sn",
      price: 0.8,
      costPrice: 0.3,
      vatRate: 20,
      vatApplicable: true,
      openingStock: 0,
      lowStockLevel: 0,
      trackStock: true,
      availableOnUber: false,
      availableOnDeliveroo: false,
    };

    const res = await req(port, "POST", "/api/products", safePayload);

    assert.equal(res.status, 201);
    const created = res.body.data;
    assert.equal(created.name, "Walkers Ready Salted 25g");
    assert.equal(created.barcode, "05000157000012");
    assert.equal(Number(created.price), 0.8);
    assert.equal(Number(created.cost_price), 0.3);
    const listB = await req(
      port,
      "GET",
      "/api/products",
      undefined,
      REQ_B
    );
    assert.equal(listB.body.data.length, 0);
    const insertCall = [...db.calls].reverse().find((c) =>
      /INSERT INTO products \(/.test(c.sql)
    );
    assert.equal(insertCall.params[6], 0.8);
    assert.equal(insertCall.params[7], 0.3);
  } finally {
    server.close();
  }
});

test("duplicate barcode within a company is rejected by the existing authoritative products API", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const payload = {
      name: "Coca Cola 500ml",
      barcode: "05449000000996",
      price: 1.5,
      costPrice: 0.5,
      vatRate: 20,
      openingStock: 0,
    };
    const first = await req(port, "POST", "/api/products", payload);
    assert.equal(first.status, 201);

    const duplicate = await req(port, "POST", "/api/products", {
      ...payload,
      name: "Coca Cola 500ml (copy)",
      price: 1.99,
    });
    assert.equal(
      duplicate.status,
      409,
      "duplicate EAN must be rejected by the products route"
    );
    assert.match(duplicate.body.message, /barcode/i);

    const forB = await req(
      port,
      "POST",
      "/api/products",
      payload,
      REQ_B
    );
    assert.equal(forB.status, 201);
  } finally {
    server.close();
  }
});

test("normal blank Product Master creation still works exactly as before", async () => {
  const { app } = buildApp();
  const { server, port } = await listen(app);
  try {
    const res = await req(port, "POST", "/api/products", {
      name: "My Private Product",
      sku: "MY-001",
      price: 9.99,
      costPrice: 4.99,
      vatRate: 0,
      vatApplicable: false,
      openingStock: 10,
      trackStock: true,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.name, "My Private Product");
    assert.equal(res.body.data.sku, "MY-001");
    assert.equal(Number(res.body.data.vat_rate), 0);
    assert.equal(res.body.data.vat_applicable, false);
    assert.equal(Number(res.body.data.stock_quantity), 10);
  } finally {
    server.close();
  }
});
