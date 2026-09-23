import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { initializeTenantSchema, validateTenantSchema } from "../services/tenantDatabase.js";

const databaseUrl = process.env.TEST_EMPTY_DATABASE_URL;

test("empty PostgreSQL database accepts the complete customer schema bootstrap", {
  skip: !databaseUrl ? "Set TEST_EMPTY_DATABASE_URL to an explicitly empty disposable PostgreSQL database" : false,
}, async () => {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 15000,
    ssl: process.env.TEST_EMPTY_DATABASE_SSL === "disable" ? false : { rejectUnauthorized: false },
  });
  try {
    assert.equal(await validateTenantSchema(pool), "UNINITIALIZED");
    assert.equal(await initializeTenantSchema(pool), "COMPATIBLE");
    const result = await pool.query(`
      SELECT to_regclass('public.companies') AS companies,
             to_regclass('public.products') AS products,
             to_regclass('public.sales') AS sales,
             to_regclass('public.sale_items') AS sale_items
    `);
    assert.deepEqual(result.rows[0], {
      companies: "companies",
      products: "products",
      sales: "sales",
      sale_items: "sale_items",
    });
  } finally {
    await pool.end();
  }
});
