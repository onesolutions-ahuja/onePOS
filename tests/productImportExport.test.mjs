import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { parseCsv, validateCsvImport } from "../services/productImportExport.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_A = "c0000000-0000-4000-8000-000000000003";
const STORE_B = "c0000000-0000-4000-8000-000000000004";
const USER = "u0000000-0000-4000-8000-000000000009";

function makeCtx() {
  const state = {
    products: [],
    categories: [],
    stores: [],
    pss: [],
    movements: [],
  };

  state.stores.push(
    { id: STORE_A, company_id: COMPANY, name: "Store A", code: "STORE01", active: true },
    { id: STORE_B, company_id: COMPANY, name: "Store B", code: "STORE02", active: true }
  );
  state.categories.push(
    { id: "cat-1", company_id: COMPANY, name: "Drinks", active: true },
    { id: "cat-2", company_id: COMPANY, name: "Snacks", active: true }
  );

  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    if (/SELECT id FROM categories WHERE company_id = \$1 AND LOWER\(name\) = LOWER\(\$2\)/.test(s)) {
      const row = state.categories.find(
        (c) => c.company_id === params[0] && c.name.toLowerCase() === String(params[1]).toLowerCase() && c.active
      );
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (/SELECT id, company_id, name, sku, barcode, description, price, cost_price, vat_rate, active, category_id FROM products WHERE company_id = \$1/.test(s)) {
      return { rows: state.products.filter((p) => p.company_id === params[0]) };
    }

    if (/SELECT id, code, name, active FROM stores WHERE company_id = \$1/.test(s)) {
      return { rows: state.stores.filter((st) => st.company_id === params[0]) };
    }

    if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(sku\) = LOWER\(\$2\)/.test(s)) {
      const row = state.products.find(
        (p) => p.company_id === params[0] && p.sku && p.sku.toLowerCase() === String(params[1]).toLowerCase()
      );
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(barcode\) = LOWER\(\$2\)/.test(s)) {
      const row = state.products.find(
        (p) => p.company_id === params[0] && p.barcode && p.barcode.toLowerCase() === String(params[1]).toLowerCase()
      );
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const row = state.products.find((p) => String(p.id) === String(params[0]) && p.company_id === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }

    if (/LEFT JOIN categories c ON c\.id = p\.category_id AND c\.company_id = p\.company_id/.test(s) && /WHERE p\.company_id = \$1/.test(s)) {
      const rows = state.products.filter((p) => p.company_id === params[0] && p.active);
      return {
        rows: rows.map((p) => {
          const stock = state.pss.find((x) => x.product_id === p.id && x.company_id === params[0]);
          const store = stock ? state.stores.find((st) => st.id === stock.store_id) : null;
          return {
            product_id: p.id,
            sku: p.sku,
            barcode: p.barcode,
            name: p.name,
            description: p.description,
            category: state.categories.find((c) => c.id === p.category_id)?.name || "",
            vat_rate: p.vat_rate,
            cost_price: p.cost_price,
            price: p.price,
            active: p.active,
            store_id: store?.id || null,
            store_code: store?.code || "",
            store_enabled: store?.active ?? false,
            store_price: p.price,
            reorder_level: p.low_stock_level || 0,
            minimum_stock: stock?.quantity || 0,
          };
        }),
      };
    }

    return { rows: [], rowCount: 0 };
  };

  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();

      if (/^BEGIN$/.test(s)) return { rows: [], rowCount: 0 };
      if (/^COMMIT$/.test(s)) return { rows: [], rowCount: 0 };
      if (/^ROLLBACK$/.test(s)) return { rows: [], rowCount: 0 };

      if (/SELECT id, company_id, name, sku, barcode, description, price, cost_price, vat_rate, active FROM products WHERE company_id = \$1/.test(s)) {
        return { rows: state.products.filter((p) => p.company_id === params[0]) };
      }

      if (/SELECT id, code, name, active FROM stores WHERE company_id = \$1/.test(s)) {
        return { rows: state.stores.filter((st) => st.company_id === params[0]) };
      }

      if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(sku\) = LOWER\(\$2\)/.test(s)) {
        const row = state.products.find(
          (p) => p.company_id === params[0] && p.sku && p.sku.toLowerCase() === String(params[1]).toLowerCase()
        );
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (/SELECT id FROM products WHERE company_id = \$1 AND LOWER\(barcode\) = LOWER\(\$2\)/.test(s)) {
        const row = state.products.find(
          (p) => p.company_id === params[0] && p.barcode && p.barcode.toLowerCase() === String(params[1]).toLowerCase()
        );
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const row = state.products.find((p) => String(p.id) === String(params[0]) && p.company_id === params[1]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (/SELECT id FROM categories WHERE company_id = \$1 AND LOWER\(name\) = LOWER\(\$2\)/.test(s)) {
        const row = state.categories.find(
          (c) => c.company_id === params[0] && c.name.toLowerCase() === String(params[1]).toLowerCase() && c.active
        );
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (/SELECT id FROM stores WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const row = state.stores.find((st) => String(st.id) === String(params[0]) && st.company_id === params[1]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      if (/SELECT p\.id AS product_id, p\.sku, p\.barcode AS ean, p\.name, p\.description, COALESCE\(c\.name, ''\) AS category, p\.vat_rate, p\.cost_price, p\.price, p\.active, s\.id AS store_id, s\.code AS store_code, s\.active AS store_enabled, p\.price AS store_price, p\.low_stock_level AS reorder_level, pss\.quantity AS minimum_stock/.test(s)) {
        const rows = state.products.filter((p) => p.company_id === params[0] && p.active);
        const storeIdFilter = params[1] || null;
        return {
          rows: rows.map((p) => {
            const stock = state.pss.find((x) => x.product_id === p.id && x.company_id === params[0]);
            const store = stock ? state.stores.find((st) => st.id === stock.store_id) : null;
            if (storeIdFilter && (!store || String(store.id) !== String(storeIdFilter))) return null;
            return {
              product_id: p.id,
              sku: p.sku,
              ean: p.barcode,
              name: p.name,
              description: p.description,
              category: state.categories.find((c) => c.id === p.category_id)?.name || "",
              vat_rate: p.vat_rate,
              cost_price: p.cost_price,
              price: p.price,
              active: p.active,
              store_id: store?.id || "",
              store_code: store?.code || "",
              store_enabled: store?.active ?? false,
              store_price: p.price,
              reorder_level: p.low_stock_level || 0,
              minimum_stock: stock?.quantity || 0,
            };
          }).filter(Boolean),
        };
      }

      if (/INSERT INTO products \(/.test(s)) {
        const row = {
          id: `p-${state.products.length + 1}`,
          company_id: params[0],
          category_id: params[1],
          name: params[2],
          sku: params[3],
          barcode: params[4],
          description: params[5],
          price: Number(params[6]) || 0,
          cost_price: Number(params[7]) || 0,
          vat_rate: Number(params[8]) || 20,
          active: params[9] !== false,
          low_stock_level: 0,
          stock_quantity: 0,
        };
        state.products.push(row);
        return { rows: [{ id: row.id }] };
      }

      if (/^UPDATE products SET/.test(s)) {
        const pid = params[params.length - 2];
        const cid = params[params.length - 1];
        const row = state.products.find((p) => String(p.id) === String(pid) && p.company_id === cid);
        if (row) {
          const setMatch = s.match(/SET (.+?) WHERE/);
          if (setMatch) {
            const assignments = setMatch[1].split(",").map((a) => a.trim());
            for (const assign of assignments) {
              const eqIdx = assign.indexOf("=");
              if (eqIdx > -1) {
                const field = assign.substring(0, eqIdx).trim();
                const valuePart = assign.substring(eqIdx + 1).trim();
                const paramMatch = valuePart.match(/\$(\d+)/);
                if (paramMatch) {
                  const idx = parseInt(paramMatch[1]) - 1;
                  if (params[idx] !== undefined && params[idx] !== null) {
                    row[field] = params[idx];
                  }
                }
              }
            }
          }
          row.updated_at = new Date().toISOString();
        }
        return { rows: [{ ...row }], rowCount: row ? 1 : 0 };
      }

      if (/INSERT INTO product_store_stock/.test(s)) {
        const companyId = params[0];
        const storeId = params[1];
        const productId = params[2];
        const quantity = Number(params[3]);
        const existing = state.pss.find(
          (x) => x.company_id === companyId && x.store_id === storeId && x.product_id === productId
        );
        if (existing) {
          existing.quantity = quantity;
          existing.updated_at = new Date().toISOString();
        } else {
          state.pss.push({ company_id: companyId, store_id: storeId, product_id: productId, quantity, updated_at: new Date().toISOString() });
        }
        return { rows: [{ quantity }], rowCount: 1 };
      }

      if (/UPDATE stores SET active = \$1 WHERE id = \$2 AND company_id = \$3/.test(s)) {
        const store = state.stores.find((st) => String(st.id) === String(params[1]) && st.company_id === params[2]);
        if (store) store.active = params[0];
        return { rows: [], rowCount: store ? 1 : 0 };
      }

      if (/INSERT INTO inventory_movements/.test(s)) {
        state.movements.push({
          id: `mv-${state.movements.length + 1}`,
          company_id: params[0], product_id: params[1], store_id: params[2],
          movement_type: params[3], quantity_change: params[4],
        });
        return { rows: [{ id: `mv-${state.movements.length}` }] };
      }

      return { rows: [], rowCount: 0 };
    },
    release() {},
  };

  const pool = {
    async connect() {
      return client;
    },
  };

  return { ...state, db, client, pool };
}

async function buildApp(ctx, { companyId = COMPANY, storeId = STORE_A, admin = false } = {}) {
  const mod = await import("../routes/products.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = {
      id: USER,
      companyId,
      storeId,
      roleId: admin ? "admin-role" : "cashier-role",
      assignedStoreIds: [STORE_A, STORE_B],
    };
    next();
  });

  const canViewCompanyCustomers = async () => admin;
  const canAccessStore = async (user, target) => {
    if (await canViewCompanyCustomers(user)) return true;
    return Array.isArray(user.assignedStoreIds) && user.assignedStoreIds.includes(target);
  };

  app.use(
    "/api",
    mod.default({
      authenticate: (_q, _s, n) => n(),
      authorize: () => (_q, _s, n) => n(),
      db: ctx.db,
      pool: ctx.pool,
      createInventoryMovement: async () => ({ balance: 0, movement: { id: "mv-test" } }),
      writeAudit: () => {},
      canAccessStore,
    })
  );
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const get = async (port, path, token = "test-token") => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.headers.get("content-type")?.includes("text/csv")) {
    return { status: res.status, body: await res.text(), isCsv: true };
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const post = async (port, path, body, token = "test-token") => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

describe("Product CSV Export", () => {
  test("export returns CSV with product columns", async () => {
    const ctx = makeCtx();
    ctx.products.push({
      id: "prod-1",
      company_id: COMPANY,
      category_id: "cat-1",
      name: "Coca Cola 330ml",
      sku: "COKE330",
      barcode: "5012345678901",
      description: "Refreshing drink",
      price: 1.5,
      cost_price: 0.6,
      vat_rate: 20,
      active: true,
      low_stock_level: 10,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, "/api/products/export");
      assert.equal(res.status, 200);
      assert.equal(res.isCsv, true);
      assert.match(res.body, /product_id/);
      assert.match(res.body, /COKE330/);
      assert.match(res.body, /Coca Cola 330ml/);
    } finally {
      server.close();
    }
  });

  test("export filtered by store returns only that store", async () => {
    const ctx = makeCtx();
    ctx.products.push({
      id: "prod-1",
      company_id: COMPANY,
      category_id: "cat-1",
      name: "Coca Cola 330ml",
      sku: "COKE330",
      barcode: "5012345678901",
      price: 1.5,
      active: true,
    });
    ctx.pss.push(
      { company_id: COMPANY, store_id: STORE_A, product_id: "prod-1", quantity: 25 },
      { company_id: COMPANY, store_id: STORE_B, product_id: "prod-1", quantity: 10 }
    );
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/products/export?storeId=${STORE_A}`);
      assert.equal(res.status, 200);
      assert.match(res.body, /STORE01/);
      assert.ok(!res.body.includes("STORE02"), "should not include other store");
    } finally {
      server.close();
    }
  });
});

describe("Product CSV Import", () => {
  test("import creates a new product from SKU", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Refreshing drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25`;

      const validateRes = await post(port, "/api/products/import/validate", { csv });
      assert.equal(validateRes.status, 200);
      assert.equal(validateRes.body.success, true);
      assert.equal(validateRes.body.data.preview.summary.new, 1);

      const importRes = await post(port, "/api/products/import", { csv });
      assert.equal(importRes.status, 200);
      assert.equal(importRes.body.success, true);
      assert.equal(importRes.body.data.created.length, 1);

      const product = ctx.products.find((p) => p.sku === "COKE330");
      assert.ok(product, "Product should exist after import");
    } finally {
      server.close();
    }
  });

  test("import updates existing product using SKU", async () => {
    const ctx = makeCtx();
    ctx.products.push({
      id: "prod-1",
      company_id: COMPANY,
      category_id: "cat-1",
      name: "Old Name",
      sku: "COKE330",
      barcode: "5012345678901",
      price: 1.0,
      active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active
,COKE330,5012345678901,New Name,,Drinks,20,0.7,2.0,true`;

      const importRes = await post(port, "/api/products/import", { csv });
      assert.equal(importRes.status, 200);
      assert.equal(importRes.body.success, true);
      assert.equal(importRes.body.data.updated.length, 1);

      const product = ctx.products.find((p) => p.sku === "COKE330");
      assert.equal(product.name, "New Name");
      assert.equal(product.price, 2.0);
    } finally {
      server.close();
    }
  });

  test("import updates existing product using EAN", async () => {
    const ctx = makeCtx();
    ctx.products.push({
      id: "prod-1",
      company_id: COMPANY,
      category_id: "cat-1",
      name: "Old Name",
      sku: "COKE330",
      barcode: "5012345678901",
      price: 1.0,
      active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active
,COKE330,5012345678901,Updated via EAN,,Drinks,20,0.8,2.5,true`;

      const importRes = await post(port, "/api/products/import", { csv });
      assert.equal(importRes.status, 200);
      assert.equal(importRes.body.data.updated.length, 1);

      const product = ctx.products.find((p) => String(p.id) === "prod-1");
      assert.equal(product.name, "Updated via EAN");
    } finally {
      server.close();
    }
  });

  test("same product for two stores creates one product and two store mappings", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE02,true,1.5,8,10`;

      const importRes = await post(port, "/api/products/import", { csv });
      assert.equal(importRes.status, 200);
      assert.equal(importRes.body.success, true);

      const product = ctx.products.find((p) => p.sku === "COKE330");
      assert.ok(product, "Product should exist");
      assert.equal(ctx.products.filter((p) => p.sku === "COKE330").length, 1, "Only one product");

      const storeAStock = ctx.pss.find((x) => x.store_id === STORE_A && x.product_id === product.id);
      const storeBStock = ctx.pss.find((x) => x.store_id === STORE_B && x.product_id === product.id);
      assert.ok(storeAStock, "Store A mapping should exist");
      assert.ok(storeBStock, "Store B mapping should exist");
      assert.equal(storeAStock.quantity, 25);
      assert.equal(storeBStock.quantity, 10);
    } finally {
      server.close();
    }
  });

  test("different store prices do not create duplicate products", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.7,true,STORE02,true,1.7,8,10`;

      const importRes = await post(port, "/api/products/import", { csv });
      const productCount = ctx.products.filter((p) => p.sku === "COKE330").length;
      assert.equal(productCount, 1, "Should create only one product");
      assert.equal(importRes.body.data.created.length, 1);
    } finally {
      server.close();
    }
  });

  test("store-level stock remains store-specific", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE02,true,1.5,8,10`;

      await post(port, "/api/products/import", { csv });
      const product = ctx.products.find((p) => p.sku === "COKE330");
      const storeA = ctx.pss.find((x) => x.store_id === STORE_A && x.product_id === product.id);
      const storeB = ctx.pss.find((x) => x.store_id === STORE_B && x.product_id === product.id);
      assert.equal(storeA.quantity, 25, "Store A has its own stock");
      assert.equal(storeB.quantity, 10, "Store B has its own stock");
      assert.notEqual(storeA.quantity, storeB.quantity, "Stock is store-specific");
    } finally {
      server.close();
    }
  });

  test("duplicate SKU within CSV is rejected in validation", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25
,COKE330,5012345678902,Another Cola,Drink,Drinks,20,0.6,1.5,true,STORE02,true,1.5,8,10`;

      const res = await post(port, "/api/products/import/validate", { csv });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.validationErrors.length > 0, `Expected errors, got ${res.body.data.validationErrors.length}`);
      const skuErrors = res.body.data.validationErrors.filter((e) => e.errors.some((err) => err.field === "sku"));
      assert.ok(skuErrors.length > 0, "Should have SKU duplicate errors");
    } finally {
      server.close();
    }
  });

  test("conflicting SKU/EAN across existing products is rejected", async () => {
    const ctx = makeCtx();
    ctx.products.push({
      id: "prod-1",
      company_id: COMPANY,
      category_id: "cat-1",
      name: "Existing Product",
      sku: "COKE330",
      barcode: "5012345678901",
      price: 1.5,
      active: true,
    });
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active
,PROD-CONFLICT,COKE330,5012345678901,Conflict Product,Drinks,20,0.6,2.0,true`;

      const res = await post(port, "/api/products/import/validate", { csv });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.validationErrors.length > 0);
    } finally {
      server.close();
    }
  });

  test("invalid store code results in no store mapping", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,INVALID_CODE,true,1.5,10,25`;

      const validateRes = await post(port, "/api/products/import/validate", { csv });
      assert.equal(validateRes.status, 200);

      const importRes = await post(port, "/api/products/import", { csv });
      const product = ctx.products.find((p) => p.sku === "COKE330");
      assert.ok(product, "Product should be created");
      const storeMappings = ctx.pss.filter((x) => x.product_id === product.id);
      assert.equal(storeMappings.length, 0, "No store mapping for invalid store code");
    } finally {
      server.close();
    }
  });

  test("missing product name is rejected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active
,COKE330,5012345678901,,Drink,Drinks,20,0.6,1.5,true`;

      const res = await post(port, "/api/products/import/validate", { csv });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.validationErrors.some((e) => e.errors.some((err) => err.field === "name")));
    } finally {
      server.close();
    }
  });

  test("invalid VAT rate is rejected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active
,COKE330,5012345678901,Coca Cola,Drink,Drinks,150,0.6,1.5,true`;

      const res = await post(port, "/api/products/import/validate", { csv });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.validationErrors.some((e) => e.errors.some((err) => err.field === "vat_rate")));
    } finally {
      server.close();
    }
  });

  test("invalid boolean value is rejected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_enabled
,COKE330,5012345678901,Coca Cola,Drink,Drinks,20,0.6,1.5,maybe,maybe`;

      const res = await post(port, "/api/products/import/validate", { csv });
      assert.equal(res.status, 200);
      assert.ok(res.body.data.validationErrors.some((e) => e.errors.some((err) => err.field === "active" || err.field === "store_enabled")));
    } finally {
      server.close();
    }
  });

  test("re-importing same CSV updates without duplicates", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = `product_id,sku,ean,name,description,category,vat_rate,cost_price,price,active,store_code,store_enabled,store_price,reorder_level,minimum_stock
,COKE330,5012345678901,Coca Cola 330ml,Drink,Drinks,20,0.6,1.5,true,STORE01,true,1.5,10,25`;

      const first = await post(port, "/api/products/import", { csv });
      assert.equal(first.body.data.created.length, 1);

      const second = await post(port, "/api/products/import", { csv });
      assert.equal(second.body.data.updated.length, 1, "Re-import should update same product");

      const productCount = ctx.products.filter((p) => p.sku === "COKE330").length;
      assert.equal(productCount, 1, "Should have only one product after re-import");
    } finally {
      server.close();
    }
  });
});

describe("CSV parsing", () => {
  test("parse simple CSV", () => {
    const text = "sku,name,price\nCOKE330,Coca Cola,1.50\nPEPSI,Pepsi,1.20";
    const rows = parseCsv(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].row.sku, "COKE330");
    assert.equal(rows[1].row.name, "Pepsi");
  });

  test("parse CSV with quoted fields containing commas", () => {
    const text = 'sku,name,price\n"COKE330","Coca, Cola",1.50';
    const rows = parseCsv(text);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].row.name, "Coca, Cola");
  });

  test("parse CSV with escaped quotes", () => {
    const text = 'sku,name\n"A","Say ""Hi"""';
    const rows = parseCsv(text);
    assert.equal(rows[0].row.name, 'Say "Hi"');
  });

  test("parse CSV returns line numbers", () => {
    const text = "sku,name\nCOKE330,Coca Cola\nPEPSI,Pepsi";
    const rows = parseCsv(text);
    assert.equal(rows[0].lineNumber, 2);
    assert.equal(rows[1].lineNumber, 3);
  });
});
