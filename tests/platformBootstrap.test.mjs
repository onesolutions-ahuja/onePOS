import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { initializePlatformMetadata, platformSchema } from "../services/platformMetadata.js";
import createPlatformRouter from "../routes/platform.js";

const CORE = ["customer", "employee", "product", "sale", "store", "supplier"];

function metadataDatabase() {
  const objects = new Map(), fields = new Map();
  let sequence = 0;
  const nextId = () => `metadata-${++sequence}`;
  const query = async (sql, params = []) => {
    if (sql === platformSchema) return { rows: [] };
    if (sql.includes("INSERT INTO platform_modules")) return { rows: [{ id: "retail-module" }] };
    if (sql.includes("INSERT INTO platform_objects")) {
      const [module_id, object_key, label, plural_label, source_table] = params;
      const existing = objects.get(object_key);
      if (existing) {
        const guarded = sql.includes("WHERE platform_objects.company_id IS NULL AND platform_objects.module_id=EXCLUDED.module_id");
        if (guarded && (existing.company_id !== null || existing.module_id !== module_id)) return { rows: [] };
        Object.assign(existing, { label, plural_label, source_table });
        if (sql.includes("active=TRUE")) existing.active = true;
        return { rows: [{ id: existing.id }] };
      }
      const object = { id: nextId(), module_id, object_key, label, plural_label, source_table, active: true, company_id: null, company_scoped: true, store_scoped: false };
      objects.set(object_key, object);
      return { rows: [{ id: object.id }] };
    }
    if (sql.includes("INSERT INTO platform_fields")) {
      const [object_id, api_name, label, field_type, source_column, required, display_order] = params;
      const key = `${object_id}:${api_name}`;
      fields.set(key, { id: fields.get(key)?.id || nextId(), ...fields.get(key), object_id, api_name, label, field_type, source_column, required, display_order, active: true });
      return { rows: [] };
    }
    if (sql.startsWith("SELECT * FROM platform_objects o")) return { rows: [...objects.values()].filter(o => o.active && (o.company_id === null || o.company_id === params[0])) };
    if (sql.startsWith("SELECT * FROM platform_modules")) return { rows: [{ id: "retail-module", module_key: "retail_pos" }] };
    if (sql.startsWith("SELECT f.* FROM platform_fields")) return { rows: [...fields.values()] };
    if (/SELECT .*FROM platform_(relationships|layouts|rules)/.test(sql)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query, objects, fields };
}

async function metadataApi(t, db, companyId = "company-a") {
  const app = express();
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId }; next(); }, authorize: code => (req, res, next) => { assert.equal(code, "settings.manage"); next(); } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return async () => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/metadata`);
    assert.equal(response.status, 200);
    return (await response.json()).data.objects;
  };
}

test("inactive Customer reproduces the five-object API response and bootstrap restores the same row", async t => {
  const db = metadataDatabase();
  await initializePlatformMetadata(db);
  const customer = db.objects.get("customer");
  const originalId = customer.id;
  const fieldIds = [...db.fields.values()].map(field => field.id);
  customer.active = false;
  const objects = await metadataApi(t, db.query);
  assert.deepEqual((await objects()).map(o => o.object_key).sort(), CORE.filter(key => key !== "customer"));
  await initializePlatformMetadata(db);
  await initializePlatformMetadata(db);
  assert.deepEqual((await objects()).map(o => o.object_key).sort(), CORE);
  assert.equal(db.objects.get("customer").id, originalId);
  assert.equal(db.objects.get("customer").source_table, "customers");
  assert.equal(db.objects.get("customer").company_scoped, true);
  assert.equal(db.objects.get("customer").company_id, null);
  assert.equal(db.objects.size, 6);
  assert.deepEqual([...db.fields.values()].map(field => field.id), fieldIds);
});

test("bootstrap preserves tenant-owned key collisions and their fields", async t => {
  const db = metadataDatabase();
  db.objects.set("customer", { id: "tenant-customer", module_id: "retail-module", company_id: "company-b", object_key: "customer", label: "Private Customer", source_table: "private_customers", active: false });
  const before = structuredClone(db.objects.get("customer"));
  await initializePlatformMetadata(db);
  await initializePlatformMetadata(db);
  assert.deepEqual(db.objects.get("customer"), before);
  assert.equal([...db.fields.values()].some(field => field.object_id === "tenant-customer"), false);
  db.objects.get("customer").active = true;
  const objects = await metadataApi(t, db.query, "company-a");
  assert.equal((await objects()).some(o => o.object_key === "customer"), false);
});

test("bootstrap restores other inactive core mappings but leaves other modules and custom objects unchanged", async () => {
  const db = metadataDatabase();
  await initializePlatformMetadata(db);
  db.objects.get("product").active = false;
  db.objects.get("supplier").module_id = "another-module";
  db.objects.get("supplier").active = false;
  db.objects.set("custom_object", { id: "custom", object_key: "custom_object", active: false, company_id: null });
  await initializePlatformMetadata(db);
  assert.equal(db.objects.get("product").active, true);
  assert.equal(db.objects.get("supplier").active, false);
  assert.equal(db.objects.get("custom_object").active, false);
});

test("PostgreSQL: Customer restoration and repeated bootstrap preserve IDs and custom fields", { skip: process.env.PLATFORM_BOOTSTRAP_DB_TEST !== "1" }, async t => {
  await import("dotenv/config");
  const { default: pg } = await import("pg");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required for explicit PostgreSQL test");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000, statement_timeout: 15000, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // All DDL and seed writes resolve to disposable temporary tables. Business
    // and public metadata rows are never mutated by this integration test.
    for (const table of ["platform_modules", "platform_objects", "platform_fields", "platform_relationships", "platform_layouts", "platform_rules"]) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    await client.query("SET LOCAL search_path TO pg_temp, public");
    await initializePlatformMetadata(client);
    const before = await client.query("SELECT id,object_key FROM platform_objects ORDER BY object_key");
    assert.deepEqual(before.rows.map(o => o.object_key), CORE);
    const customerId = before.rows.find(o => o.object_key === "customer").id;
    await client.query("UPDATE platform_objects SET active=false WHERE id=$1", [customerId]);
    await client.query("INSERT INTO platform_fields (object_id,api_name,label,field_type) VALUES ($1,'custom_note','Custom Note','text')", [customerId]);
    const objects = await metadataApi(t, (sql, params) => client.query(sql, params), "00000000-0000-4000-8000-000000000001");
    assert.equal((await objects()).length, 5);
    await initializePlatformMetadata(client);
    await initializePlatformMetadata(client);
    assert.deepEqual((await objects()).map(o => o.object_key).sort(), CORE);
    assert.deepEqual((await client.query("SELECT id,object_key FROM platform_objects ORDER BY object_key")).rows, before.rows);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM platform_objects WHERE object_key='customer'")).rows[0].count, 1);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM platform_fields WHERE object_id=$1 AND api_name='custom_note'", [customerId])).rows[0].count, 1);
    await client.query("UPDATE platform_objects SET company_id='00000000-0000-4000-8000-000000000002',active=false,label='Private Customer' WHERE id=$1", [customerId]);
    await initializePlatformMetadata(client);
    const tenantRow = (await client.query("SELECT company_id,active,label FROM platform_objects WHERE id=$1", [customerId])).rows[0];
    assert.equal(tenantRow.active, false);
    assert.equal(tenantRow.label, "Private Customer");
    assert.equal(tenantRow.company_id, "00000000-0000-4000-8000-000000000002");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
});
