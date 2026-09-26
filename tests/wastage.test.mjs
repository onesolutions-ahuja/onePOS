import crypto from "node:crypto";
import pg from "pg";
import bcrypt from "bcryptjs";
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import inventoryRt from "../routes/inventory.js";
import { requireTestDatabaseUrl } from "./testDatabaseEnv.mjs";
import reportsRt from "../routes/reports.js";
import { resolveAdjustmentReason, classifyAdjustmentReason, ADJUSTMENT_REASONS } from "../services/adjustmentReasons.js";

/*
 * T10R - Wastage / Breakage / Other stock adjustments.
 *
 * Uses the EXISTING inventory_movements ledger and createInventoryMovement
 * path. No new tables, no new ledger, no new permissions, no separate
 * inventory system. Decreases require a canonical reason (Wastage /
 * Breakage / Other); increases keep the existing free-text/optional
 * behaviour.
 *
 *   node --test tests/wastage.test.mjs
 */
const createTestDb = async () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  const db = (q, p) => pool.query(q, p);
  const tag = crypto.randomUUID().slice(0, 8);
  const company = await db(`INSERT INTO companies(name) VALUES($1) RETURNING id`, [`lowstock-${tag}`]);
  const companyId = company.rows[0].id;
  const store = await db(`INSERT INTO stores(company_id, name) VALUES($1, $2) RETURNING id`, [companyId, `lowstock-store-${tag}`]);
  const storeId = store.rows[0].id;
  const role = await db(`INSERT INTO roles(company_id,name) VALUES($1,$2) RETURNING id`, [companyId, `operator-${tag}`]);
  const adminRole = await db(`INSERT INTO roles(company_id,name) VALUES($1,$2) RETURNING id`, [companyId, `admin-${tag}`]);
  const user = await db(
    `INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,company_id,store_id,role_id`,
    [companyId, storeId, role.rows[0].id, `op-${tag}`, `Operator ${tag}`, await bcrypt.hash("pass", 10)]
  );
  const adminUser = await db(
    `INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,company_id,store_id,role_id`,
    [companyId, storeId, adminRole.rows[0].id, `admin-${tag}`, `Admin ${tag}`, await bcrypt.hash("pass", 10)]
  );
  const cat = await db(`INSERT INTO categories(company_id,name) VALUES($1,$2) RETURNING id`, [companyId, `WastageTest-${tag}`]);
  const products = await Promise.all(
    [
      { name: "Below threshold", stock: 3, low: 5, tracked: true },
      { name: "Above threshold", stock: 7, low: 5, tracked: true },
      { name: "At threshold", stock: 5, low: 5, tracked: true },
      { name: "Track off", stock: 0, low: 5, tracked: false },
      { name: "Track off zero threshold", stock: 0, low: 0, tracked: false },
    ].map(({ name, stock, low, tracked }) =>
      db(
        `INSERT INTO products(company_id,category_id,name,sku,price,cost_price,vat_rate,vat_applicable,stock_quantity,low_stock_level,track_stock,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id,name,stock_quantity,low_stock_level,track_stock`,
        [companyId, cat.rows[0].id, name, `SKU-${crypto.randomUUID().slice(0, 8)}`, 10, 4, 20, true, stock, low, tracked]
      )
    )
  );
  return { pool, db, role, adminRole, user, adminUser, cat, products, companyId, storeId, company, store };
};

const releaseTestDb = async ({ db, products, cat, user, adminUser, role, adminRole, company, store, pool }) => {
  for (const row of products.map((p) => p.rows[0])) {
    await db(`DELETE FROM inventory_movements WHERE product_id = $1`, [row.id]);
    await db(`DELETE FROM products WHERE id = $1`, [row.id]);
  }
  if (cat) await db(`DELETE FROM categories WHERE id = $1`, [cat.rows[0].id]);
  if (user) await db(`DELETE FROM users WHERE id = $1`, [user.rows[0].id]);
  if (adminUser) await db(`DELETE FROM users WHERE id = $1`, [adminUser.rows[0].id]);
  if (role) await db(`DELETE FROM roles WHERE id = $1`, [role.rows[0].id]);
  if (adminRole) await db(`DELETE FROM roles WHERE id = $1`, [adminRole.rows[0].id]);
  if (store) await db(`DELETE FROM stores WHERE id = $1`, [store.rows[0].id]);
  if (company) await db(`DELETE FROM companies WHERE id = $1`, [company.rows[0].id]);
  await pool.end();
};

/* Mirrors the customers-suite harness: router mounted under /api, real HTTP. */
const buildApp = (ctx, router) => {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, res, next) => {
    req.user = { id: ctx.user.rows[0].id, companyId: ctx.companyId, storeId: ctx.storeId, username: "tester" };
    router(req, res, next);
  });
  return app;
};

const listen = (app) =>
  new Promise((resolve) => {
    const server = app.listen(0);
    server.once("listening", () => resolve({ server, port: server.address().port }));
  });

const req = async (port, method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("low stock products are identified using tracked stock and threshold", async () => {
  const ctx = await createTestDb();
  const { db, products, cat, user, pool, storeId, company, store, role, adminRole, adminUser } = ctx;
  const { server, port } = await listen(buildApp(ctx, inventoryRt({
      authenticate: (_req, _res, next) => next(),
      authorize: () => async (_, res, next) => next(),
      db,
      pool,
      createInventoryMovement: async (client, params) => {
        const quantity = Number(params.quantityChange || 0);
        const product = await client.query(
          `SELECT id, name, price, vat_rate, track_stock, stock_quantity FROM products WHERE id = $1 AND company_id = $2 AND active = true FOR UPDATE`,
          [params.productId, params.companyId]
        );
        assert.equal(product.rows.length, 1, "product not found");
        const currentBalance = Number(product.rows[0].stock_quantity);
        const newBalance = Math.max(0, currentBalance + quantity);
        await client.query(`UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`, [newBalance, params.productId, params.companyId]);
        const movement = await client.query(
          `INSERT INTO inventory_movements(company_id,product_id,store_id,movement_type,quantity_change,balance_after,reason,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,product_id,store_id,movement_type,quantity_change,balance_after,reason,notes,created_by,created_at`,
          [params.companyId, params.productId, params.storeId || null, params.movementType, quantity, newBalance, params.reason || null, null, params.createdBy || null]
        );
        return { product: product.rows[0], balance: newBalance, movement: movement.rows[0] };
      },
      inventoryMovementTypes: new Set(["OPENING", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
      canViewCompanyCustomers: async () => false,
    })));
    try {
    const lowStock = await req(port, "GET", "/api/inventory/low-stock");
    assert.equal(lowStock.body.success, true);
    assert.ok(lowStock.body.data.length >= 2, "at least below + at threshold should appear");

    const names = lowStock.body.data.map((p) => p.name);
    assert.ok(names.includes("Below threshold"));
    assert.ok(names.includes("At threshold"));
    assert.ok(!names.includes("Above threshold"));
    assert.ok(!names.includes("Track off"));
    assert.ok(!names.includes("Track off zero threshold"));

    await req(port, "POST", "/api/inventory/adjustments", { productId: products[0].rows[0].id, adjustmentQuantity: 3, reason: "Stock received" });
    const after = await req(port, "GET", "/api/inventory/low-stock");
    assert.ok(!after.body.data.some((p) => p.name === "Below threshold"));
    assert.ok(after.body.data.some((p) => p.name === "At threshold"));
  } finally { server.close(); await releaseTestDb({ db, products, cat, user, pool, adminUser, adminRole, role, company, store }); }
});


test("adjustment writes a movement and returns balance", async () => {
  const ctx = await createTestDb();
  const { db, products, cat, user, pool, storeId, company, store, role, adminRole, adminUser } = ctx;
  const { server, port } = await listen(buildApp(ctx, inventoryRt({
      authenticate: (_req, _res, next) => next(),
      authorize: () => async (_, res, next) => next(),
      db,
      pool,
      createInventoryMovement: async (client, params) => {
        const quantity = Number(params.quantityChange || 0);
        const product = await client.query(
          `SELECT id, name, price, vat_rate, track_stock, stock_quantity FROM products WHERE id = $1 AND company_id = $2 AND active = true FOR UPDATE`,
          [params.productId, params.companyId]
        );
        assert.equal(product.rows.length, 1);
        const currentBalance = Number(product.rows[0].stock_quantity);
        const newBalance = Math.max(0, currentBalance + quantity);
        await client.query(`UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`, [newBalance, params.productId, params.companyId]);
        const movement = await client.query(
          `INSERT INTO inventory_movements(company_id,product_id,store_id,movement_type,quantity_change,balance_after,reason,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,product_id,store_id,movement_type,quantity_change,balance_after,reason,notes,created_by,created_at`,
          [params.companyId, params.productId, params.storeId || null, params.movementType, quantity, newBalance, params.reason || null, null, params.createdBy || null]
        );
        return { product: product.rows[0], balance: newBalance, movement: movement.rows[0] };
      },
      inventoryMovementTypes: new Set(["OPENING", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"]),
      canViewCompanyCustomers: async () => false,
    })));
    try {
    const movement = await req(port, "POST", "/api/inventory/adjustments", { productId: products[0].rows[0].id, adjustmentQuantity: -3, reason: "Damaged" });
    assert.equal(movement.body.success, true);
    assert.equal(movement.body.data.movement.movement_type, "ADJUSTMENT_OUT");
    assert.equal(movement.body.data.balance, 0);
    assert.equal(movement.body.data.movement.reason, "Breakage");

    const history = await req(port, "GET", "/api/inventory/movements");
    assert.equal(history.body.success, true);
    assert.ok(history.body.data.some((m) => m.product_name === "Below threshold" && Number(m.quantity_change) === -3));
  } finally { server.close(); await releaseTestDb({ db, products, cat, user, pool, adminUser, adminRole, role, company, store }); }
});
