import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import pg from "pg";
import createLayawaysRouter from "../routes/layaways.js";
import { createInventoryMovement } from "../services/inventory.js";
import { requireTestDatabaseUrl } from "./testDatabaseEnv.mjs";

const { Pool } = pg;
let DATABASE_URL;

try {
  DATABASE_URL = requireTestDatabaseUrl();
} catch (error) {
  test("PostgreSQL layaway integration requires DATABASE_URL", () => {
    assert.fail(error.message);
  });
}

if (DATABASE_URL) {
  const ids = {
    companyA: "11000000-0000-4000-8000-000000000001",
    companyB: "11000000-0000-4000-8000-000000000002",
    storeA: "22000000-0000-4000-8000-000000000001",
    storeA2: "22000000-0000-4000-8000-000000000002",
    storeB: "22000000-0000-4000-8000-000000000003",
    userA: "33000000-0000-4000-8000-000000000001",
    userA2: "33000000-0000-4000-8000-000000000002",
    userB: "33000000-0000-4000-8000-000000000003",
    customerA: "44000000-0000-4000-8000-000000000001",
    customerB: "44000000-0000-4000-8000-000000000002",
    productStock: "55000000-0000-4000-8000-000000000001",
    productNoStock: "55000000-0000-4000-8000-000000000002",
    productB: "55000000-0000-4000-8000-000000000003",
  };
  const schema = `onepos_layaway_${process.pid}_${Date.now()}`;
  let pool;
  let adminPool;
  let movementFailure = false;

  const users = {
    A: { id: ids.userA, companyId: ids.companyA, storeId: ids.storeA },
    A2: { id: ids.userA2, companyId: ids.companyA, storeId: ids.storeA2 },
    B: { id: ids.userB, companyId: ids.companyB, storeId: ids.storeB },
  };

  async function query(sql, params = []) {
    return pool.query(sql, params);
  }

  function makeApp({ failMovement = false } = {}) {
    movementFailure = failMovement;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = users[req.headers["x-test-user"] || "A"];
      next();
    });
    const authenticate = (_req, _res, next) => next();
    const authorize = (...required) => (req, res, next) => {
      if (required.some((code) => ["layaway.view", "layaway.create", "layaway.payment", "layaway.complete", "layaway.cancel"].includes(code))) return next();
      return res.status(403).json({ success: false, message: "Forbidden" });
    };
    const inventory = async (client, args) => {
      if (movementFailure) throw new Error("forced inventory failure");
      return createInventoryMovement(client, args);
    };
    app.use("/api", createLayawaysRouter({
      authenticate,
      authorize,
      db: (sql, params) => pool.query(sql, params),
      pool,
      createInventoryMovement: inventory,
    }));
    return app;
  }

  async function request(app, path, options = {}, user = "A") {
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      return await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        ...options,
        headers: { "content-type": "application/json", "x-test-user": user, ...(options.headers || {}) },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  async function createLayaway(app, body, user = "A") {
    const response = await request(app, "/api/layaways", {
      method: "POST",
      body: JSON.stringify(body),
    }, user);
    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    return payload.data;
  }

  async function seed() {
    const schemaSql = await fs.readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`SET search_path TO "${schema}", public`);
    await pool.query(schemaSql);
    await query(
      `INSERT INTO companies (id, name, timezone) VALUES
       ($1, 'Layaway A', 'UTC'), ($2, 'Layaway B', 'UTC')`,
      [ids.companyA, ids.companyB]
    );
    await query(
      `INSERT INTO stores (id, company_id, name) VALUES
       ($1, $3, 'Store A'), ($2, $3, 'Store A2'), ($4, $5, 'Store B')`,
      [ids.storeA, ids.storeA2, ids.companyA, ids.storeB, ids.companyB]
    );
    await query(
      `INSERT INTO users (id, company_id, store_id, username, password_hash, full_name)
       VALUES ($1,$4,$5,'layaway-a','x','Layaway A'),
              ($2,$4,$6,'layaway-a2','x','Layaway A2'),
              ($3,$7,$8,'layaway-b','x','Layaway B')`,
      [ids.userA, ids.userA2, ids.userB, ids.companyA, ids.storeA, ids.storeA2, ids.companyB, ids.storeB]
    );
    await query(
      `INSERT INTO customers (id, company_id, name, active) VALUES
       ($1,$3,'Customer A',true), ($2,$4,'Customer B',true)`,
      [ids.customerA, ids.customerB, ids.companyA, ids.companyB]
    );
    await query(
      `INSERT INTO products (id, company_id, name, price, vat_rate, track_stock, stock_quantity, active)
       VALUES ($1,$3,'Stock Product',100,20,true,10,true),
              ($2,$3,'Service Product',50,20,false,0,true),
              ($4,$5,'Company B Product',25,20,true,10,true)`,
      [ids.productStock, ids.productNoStock, ids.companyA, ids.productB, ids.companyB]
    );
    await query(
      `INSERT INTO company_settings (company_id, till_invoice_prefix)
       VALUES ($1, 'LY'), ($2, 'BX')`,
      [ids.companyA, ids.companyB]
    );
    await query(
      `INSERT INTO product_store_stock (company_id, store_id, product_id, quantity)
       VALUES ($1,$2,$3,10)`,
      [ids.companyA, ids.storeA, ids.productStock]
    );
  }

  before(async () => {
    const connection = {
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    };
    adminPool = new Pool(connection);
    pool = new Pool({ ...connection, options: `-c search_path=${schema},public` });
    await seed();
  });

  after(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await adminPool.end();
    }
  });

  describe("real PostgreSQL layaways", () => {
    test("creates with scoped ownership, snapshots and server totals", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, {
        customerId: ids.customerA,
        items: [{ productId: ids.productStock, quantity: 2, unitPrice: 1, taxRate: 0 }],
      });
      assert.equal(layaway.status, "OPEN");
      assert.equal(Number(layaway.total), 240);
      assert.equal(Number(layaway.paid_amount), 0);
      assert.equal(Number(layaway.balance), 240);
      const row = await query("SELECT l.*, li.product_name, li.unit_price, li.tax FROM layaways l JOIN layaway_items li ON li.layaway_id=l.id WHERE l.id=$1", [layaway.id]);
      assert.equal(row.rows[0].company_id, ids.companyA);
      assert.equal(row.rows[0].store_id, ids.storeA);
      assert.equal(row.rows[0].customer_id, ids.customerA);
      assert.equal(Number(row.rows[0].unit_price), 100);
      assert.equal(Number(row.rows[0].tax), 40);
    });

    test("records multiple payments and rejects invalid or excessive payments", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { customerId: ids.customerA, items: [{ productId: ids.productStock, quantity: 1 }] });
      for (const [amount, method] of [[40, "cash"], [30, "card"]]) {
        const response = await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount, paymentMethod: method }) });
        assert.equal(response.status, 201);
      }
      const invalid = await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 1, paymentMethod: "bitcoin" }) });
      assert.equal(invalid.status, 400);
      const excessive = await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 100, paymentMethod: "cash" }) });
      assert.equal(excessive.status, 400);
      const row = await query("SELECT paid_amount, balance FROM layaways WHERE id=$1", [layaway.id]);
      const payments = await query("SELECT COUNT(*)::int AS count, SUM(amount) AS total FROM layaway_payments WHERE layaway_id=$1", [layaway.id]);
      assert.equal(Number(row.rows[0].paid_amount), 70);
      assert.equal(Number(row.rows[0].balance), 50);
      assert.equal(payments.rows[0].count, 2);
      assert.equal(Number(payments.rows[0].total), 70);
    });

    test("rejects invalid customers and products from another company", async () => {
      const app = makeApp();
      const invalidCustomer = await request(app, "/api/layaways", {
        method: "POST",
        body: JSON.stringify({ customerId: ids.customerB, items: [{ productId: ids.productStock, quantity: 1 }] }),
      });
      assert.equal(invalidCustomer.status, 400);
      const invalidProduct = await request(app, "/api/layaways", {
        method: "POST",
        body: JSON.stringify({ customerId: ids.customerA, items: [{ productId: ids.productB, quantity: 1 }] }),
      });
      assert.equal(invalidProduct.status, 400);
    });

    test("concurrent payments cannot exceed the outstanding balance", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { items: [{ productId: ids.productStock, quantity: 1 }] });
      const responses = await Promise.all([50, 50, 50].map((amount) => request(app, `/api/layaways/${layaway.id}/payments`, {
        method: "POST", body: JSON.stringify({ amount, paymentMethod: "cash" }),
      })));
      assert.equal(responses.filter((response) => response.status === 201).length, 2);
      const row = await query("SELECT paid_amount, balance FROM layaways WHERE id=$1", [layaway.id]);
      assert.equal(Number(row.rows[0].paid_amount), 100);
      assert.equal(Number(row.rows[0].balance), 20);
    });

    test("completes once, copies payments, receipt and stock movement", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { customerId: ids.customerA, items: [{ productId: ids.productStock, quantity: 1 }] });
      await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 120, paymentMethod: "cash" }) });
      const response = await request(app, `/api/layaways/${layaway.id}/complete`, { method: "POST" });
      assert.equal(response.status, 200, await response.text());
      const persisted = await query(`SELECT l.status, l.completed_sale_id, l.completed_at, l.completed_by,
        s.receipt_number, s.total, (SELECT COUNT(*) FROM sale_items WHERE sale_id=s.id) AS items,
        (SELECT COUNT(*) FROM payments WHERE sale_id=s.id) AS payments
        FROM layaways l JOIN sales s ON s.id=l.completed_sale_id WHERE l.id=$1`, [layaway.id]);
      assert.equal(persisted.rows[0].status, "COMPLETED");
      assert.equal(persisted.rows[0].completed_by, ids.userA);
      assert.ok(persisted.rows[0].completed_at);
      assert.match(persisted.rows[0].receipt_number, /^LY-\d{8}-\d{4}$/);
      assert.equal(Number(persisted.rows[0].items), 1);
      assert.equal(Number(persisted.rows[0].payments), 1);
      const movements = await query("SELECT COUNT(*)::int AS count FROM inventory_movements WHERE reference_id=$1", [persisted.rows[0].completed_sale_id]);
      const stock = await query("SELECT quantity FROM product_store_stock WHERE store_id=$1 AND product_id=$2", [ids.storeA, ids.productStock]);
      assert.equal(movements.rows[0].count, 1);
      assert.equal(Number(stock.rows[0].quantity), 9);
      const afterCompletionPayment = await request(app, `/api/layaways/${layaway.id}/payments`, {
        method: "POST", body: JSON.stringify({ amount: 1, paymentMethod: "cash" }),
      });
      assert.equal(afterCompletionPayment.status, 409);
    });

    test("concurrent completion creates one sale and one movement", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { items: [{ productId: ids.productStock, quantity: 1 }] });
      await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 120, paymentMethod: "cash" }) });
      const responses = await Promise.all([1, 2].map(() => request(app, `/api/layaways/${layaway.id}/complete`, { method: "POST" })));
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      const row = await query("SELECT completed_sale_id FROM layaways WHERE id=$1", [layaway.id]);
      const sales = await query("SELECT COUNT(*)::int AS count FROM sales WHERE id=$1", [row.rows[0].completed_sale_id]);
      const movements = await query("SELECT COUNT(*)::int AS count FROM inventory_movements WHERE reference_id=$1", [row.rows[0].completed_sale_id]);
      assert.equal(sales.rows[0].count, 1);
      assert.equal(movements.rows[0].count, 1);
    });

    test("rolls back completion after an inventory failure", async () => {
      const app = makeApp({ failMovement: true });
      const layaway = await createLayaway(app, { items: [{ productId: ids.productStock, quantity: 1 }] });
      const beforeSales = (await query("SELECT COUNT(*)::int AS count FROM sales WHERE company_id=$1", [ids.companyA])).rows[0].count;
      await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 120, paymentMethod: "cash" }) });
      const response = await request(app, `/api/layaways/${layaway.id}/complete`, { method: "POST" });
      assert.equal(response.status, 500);
      const row = await query("SELECT status, completed_sale_id FROM layaways WHERE id=$1", [layaway.id]);
      assert.equal(row.rows[0].status, "OPEN");
      assert.equal(row.rows[0].completed_sale_id, null);
      assert.equal((await query("SELECT COUNT(*)::int AS count FROM sales WHERE company_id=$1", [ids.companyA])).rows[0].count, beforeSales);
      assert.equal((await query("SELECT COUNT(*)::int AS count FROM layaway_payments WHERE layaway_id=$1", [layaway.id])).rows[0].count, 1);
      movementFailure = false;
    });

    test("non-stock products do not create inventory movements", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { items: [{ productId: ids.productNoStock, quantity: 1 }] });
      await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 60, paymentMethod: "cash" }) });
      assert.equal((await request(app, `/api/layaways/${layaway.id}/complete`, { method: "POST" })).status, 200);
      const sale = await query("SELECT completed_sale_id FROM layaways WHERE id=$1", [layaway.id]);
      assert.equal((await query("SELECT COUNT(*)::int AS count FROM inventory_movements WHERE reference_id=$1", [sale.rows[0].completed_sale_id])).rows[0].count, 0);
    });

    test("cancellation preserves payments and blocks completion", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { items: [{ productId: ids.productStock, quantity: 1 }] });
      const beforeSales = (await query("SELECT COUNT(*)::int AS count FROM sales WHERE company_id=$1", [ids.companyA])).rows[0].count;
      await request(app, `/api/layaways/${layaway.id}/payments`, { method: "POST", body: JSON.stringify({ amount: 20, paymentMethod: "cash" }) });
      assert.equal((await request(app, `/api/layaways/${layaway.id}/cancel`, { method: "POST" })).status, 200);
      assert.equal((await request(app, `/api/layaways/${layaway.id}/complete`, { method: "POST" })).status, 409);
      const row = await query("SELECT status FROM layaways WHERE id=$1", [layaway.id]);
      assert.equal(row.rows[0].status, "CANCELLED");
      assert.equal((await query("SELECT COUNT(*)::int AS count FROM layaway_payments WHERE layaway_id=$1", [layaway.id])).rows[0].count, 1);
      assert.equal((await query("SELECT COUNT(*)::int AS count FROM sales WHERE company_id=$1", [ids.companyA])).rows[0].count, beforeSales);
    });

    test("company and store isolation applies to every mutation", async () => {
      const app = makeApp();
      const layaway = await createLayaway(app, { items: [{ productId: ids.productStock, quantity: 1 }] });
      for (const user of ["A2", "B"]) {
        for (const [path, method] of [
          [`/api/layaways/${layaway.id}`, "GET"],
          [`/api/layaways/${layaway.id}/payments`, "POST"],
          [`/api/layaways/${layaway.id}/complete`, "POST"],
          [`/api/layaways/${layaway.id}/cancel`, "POST"],
        ]) {
          const response = await request(app, path, { method, body: method === "POST" && path.endsWith("payments") ? JSON.stringify({ amount: 1, paymentMethod: "cash" }) : undefined }, user);
          assert.equal(response.status, 404);
        }
      }
      const otherCompanyList = await request(app, "/api/layaways", {}, "B");
      assert.equal(otherCompanyList.status, 200);
      assert.equal((await otherCompanyList.json()).data.length, 0);
    });
  });
}
