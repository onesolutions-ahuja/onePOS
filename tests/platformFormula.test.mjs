import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";
import { compileFormulas, parseFormula, FormulaError, normalizeRollupConfig, effectiveFieldType } from "../services/platformFormula.js";
import { evaluateValidationRules } from "../services/platformValidation.js";
import { platformSchema } from "../services/platformMetadata.js";

const stored = [
  { id: "price-id", api_name: "price", field_type: "currency", source_column: "price", readable: true, active: true },
  { id: "qty-id", api_name: "quantity", field_type: "number", source_column: "quantity", readable: true, active: true },
  { id: "name-id", api_name: "name", field_type: "text", source_column: "name", readable: true, active: true },
];
const formula = (expression = "ROUND(price * quantity, 2)", extra = {}) => ({ id: "total-id", api_name: "total", field_type: "formula", source_column: null,
  readable: true, active: true, writable: false, required: false, config: { expression, resultType: "currency" }, ...extra });

test("arithmetic precedence, functions and numeric PostgreSQL strings", () => {
  assert.equal(compileFormulas([...stored, formula()])({ price: "1.25", quantity: 4 }).total, 5);
  for (const [expression, expected] of [["2 + 3 * 4", 14], ["(2 + 3) * 4", 20], ["-2 + +3", 1], ["ABS(-4)", 4], ["MIN(2, 5, 1)", 1], ["MAX(2, 5)", 5], ["ROUND(1.234, 2)", 1.23], ["5 % 2", 1]]) {
    assert.equal(compileFormulas([formula(expression)])({}).total, expected);
  }
});

test("typed text, boolean, IF and lazy null defaults", () => {
  const make = (expression, resultType) => formula(expression, { config: { expression, resultType } });
  assert.equal(compileFormulas([...stored, make('CONCAT(name, " x ", quantity)', "text")])({ name: "Tea", quantity: 2 }).total, "Tea x 2");
  assert.equal(compileFormulas([...stored, make('quantity > 1 && price >= 2', "boolean")])({ quantity: 2, price: 3 }).total, true);
  assert.equal(compileFormulas([...stored, make('IF(quantity == 0, 0, price / quantity)', "decimal")])({ quantity: 0, price: 3 }).total, 0);
  assert.equal(compileFormulas([...stored, formula('COALESCE(price, 0) + 1')])({}).total, 1);
});

test("blank, zero division and non-finite results are null, zero and false remain values", () => {
  for (const expression of ["price + 1", "1 / 0", "1 % 0", "1e308 * 1e308", "ROUND(2, 99)"]) {
    assert.equal(compileFormulas([...stored, formula(expression)])({ price: null }).total, null);
  }
  assert.equal(compileFormulas([...stored, formula("COALESCE(price, 9)")])({ price: 0 }).total, 0);
  const bool = formula("COALESCE(false, true)", { config: { expression: "COALESCE(false, true)", resultType: "boolean" } });
  assert.equal(compileFormulas([bool])({}).total, false);
});

test("dependency ordering and formula-backed validation rules", () => {
  const doubled = formula("total * 2", { id: "doubled-id", api_name: "doubled", config: { expression: "total * 2", resultType: "decimal" } });
  const fields = [...stored, doubled, formula()];
  const record = compileFormulas(fields)({ price: 10, quantity: 3 });
  assert.equal(record.doubled, 60);
  const rules = [{ id: "rule", object_id: "object", trigger_key: "before_save", action: { type: "validation", message: "Too large" }, conditions: [{ field: "doubled", operator: "greater_than", value: "50" }] }];
  assert.equal(evaluateValidationRules(rules, fields, record)[0].message, "Too large");
});

test("syntax, unknown functions, injection, complexity and cycles are rejected", () => {
  for (const expression of ["", "price; DROP TABLE products", "process.exit()", "price.constructor", "eval(1)", "ROUND()", "1 +", "1e999", "(1", "1 2", "constructor", "(".repeat(40) + "1" + ")".repeat(40), Array(200).fill("1").join("+")]) {
    assert.throws(() => parseFormula(expression), FormulaError, expression);
  }
  assert.throws(() => compileFormulas([formula("total + 1")]), /Circular/);
  assert.throws(() => compileFormulas([formula("other + 1"), formula("total + 1", { api_name: "other", config: { expression: "total + 1", resultType: "decimal" } })]), /Circular/);
});

test("unknown, hidden, inactive, unmapped fields and type mismatches are rejected", () => {
  for (const fields of [
    [...stored, formula("missing + 1")],
    [...stored.map(f => ({ ...f, readable: false })), formula()],
    [...stored.map(f => ({ ...f, active: false })), formula()],
    [...stored.map(f => ({ ...f, source_column: null })), formula()],
    [...stored, formula("name + 1")],
    [...stored, formula('"text"')],
    [...stored, formula("IF(true, 1, false)")],
    [...stored, formula("1", { writable: true })],
    [...stored, formula("1", { source_column: "total" })],
    [...stored, formula("1", { required: true })],
  ]) assert.throws(() => compileFormulas(fields), FormulaError);
});

test("dependency depth is bounded even when fields are supplied in dependency order", () => {
  const chain = Array.from({ length: 35 }, (_, index) => formula("1", {
    api_name: `value_${index}`, config: { expression: index ? `value_${index - 1} + 1` : "1", resultType: "decimal" },
  }));
  assert.throws(() => compileFormulas(chain), /dependency chain/);
  assert.throws(() => parseFormula('"line\nbreak"'), FormulaError);
});

test("schema includes formula and rollup types and an idempotent upgrade for existing check constraints", () => {
  assert.match(platformSchema, /'lookup','formula','rollup'/);
  assert.match(platformSchema, /pg_get_constraintdef\(oid\) NOT LIKE '%formula%'/);
  assert.match(platformSchema, /pg_get_constraintdef\(oid\) NOT LIKE '%rollup%'/);
  assert.doesNotMatch(platformSchema, /DROP TABLE/i);
});

test("rollup metadata is normalized with a stable relationship key and result type", () => {
  const field = { field_type: "rollup", config: { relationshipKey: "customer_sales", operation: "SUM", field: "total", resultType: "currency" } };
  assert.deepEqual(normalizeRollupConfig(field), { operation: "SUM", relationshipKey: "customer_sales", sourceField: "total", condition: null, resultType: "currency" });
  assert.equal(effectiveFieldType(field), "currency");
});

const recordId = "a0000000-0000-4000-8000-000000000001";
async function fixture(t, options = {}) {
  const object = { id: "object-a", object_key: "sample", source_table: "samples", active: true, company_id: options.global ? null : "company-a", company_scoped: true, store_scoped: true };
  const state = { fields: [...stored.map(f => ({ ...f, object_id: object.id })), { ...formula(), object_id: object.id }], records: [{ id: recordId, price: "2.5", quantity: 4, name: "Tea" }], writes: [], queries: [] };
  async function db(sql, params = []) {
    state.queries.push({ sql, params });
    if (sql.startsWith("SELECT * FROM platform_objects")) { assert.equal(params[1], "company-a"); return { rows: params[0] === "foreign" ? [] : [object] }; }
    if (sql.startsWith("SELECT f.*")) return { rows: params[0] === "foreign" ? [] : state.fields.filter(f => f.id === params[0]).map(f => ({ ...f, company_id: object.company_id })) };
    if (sql.startsWith("SELECT * FROM platform_fields")) {
      if (sql.includes("WHERE id=$1")) return { rows: [...state.fields, ...saleFields].filter((field) => field.id === params[0]) };
      return { rows: state.fields };
    }
    if (sql.startsWith("SELECT * FROM platform_rules")) return { rows: options.rules || [] };
    if (sql.startsWith("SELECT company_id")) return { rows: [{ company_id: options.foreignRecord ? "company-b" : "company-a" }] };
    if (sql.includes('xmin::text AS "__validation_version"')) { assert.match(sql, /store_id=/); return { rows: [{ ...state.records[0], __validation_version: "5" }] }; }
    if (sql.startsWith('SELECT COUNT(*)')) { assert.match(sql, /company_id=\$1 AND store_id=\$2/); assert.deepEqual(params.slice(0, 2), ["company-a", "store-a"]); return { rows: [{ total: 1 }] }; }
    if (sql.startsWith('SELECT id')) { assert.doesNotMatch(sql, /"total"/); return { rows: state.records }; }
    if (sql.startsWith('INSERT INTO "samples"') || sql.startsWith('UPDATE "samples"')) { assert.doesNotMatch(sql, /"total"/); state.writes.push({ sql, params }); return { rows: state.records }; }
    if (sql.startsWith("INSERT INTO platform_fields")) { state.writes.push({ sql, params }); return { rows: [{ ...formula(), api_name: params[1], config: JSON.parse(params[8]) }] }; }
    if (sql.startsWith("UPDATE platform_fields")) { state.writes.push({ sql, params }); return { rows: [state.fields[0]] }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  const app = express(); app.use(express.json());
  app.use(createPlatformRouter({ db,
    authenticate: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { companyId: "company-a", storeId: options.noStore ? null : "store-a", isSuperadmin: req.headers.authorization === "superadmin" }; next(); },
    authorize: () => (req, res, next) => req.headers.authorization === "denied" ? res.sendStatus(403) : next(),
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  async function request(method, path, body, auth = "allowed") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text(); return { status: response.status, data: raw.startsWith("{") ? JSON.parse(raw) : raw };
  }
  return { state, request };
}
const records = "/platform/objects/sample/records";
const fieldPayload = { apiName: "double_total", label: "Double total", fieldType: "formula", config: { expression: "total * 2", resultType: "currency" } };

test("rollup fields compute parent-side aggregates in generic record reads and reject writes", async t => {
  const object = { id: "contact-obj", object_key: "contact", source_table: "contacts", active: true, company_id: "company-a", company_scoped: true, store_scoped: false };
  const relationship = { id: "relationship-1", parent_object_id: object.id, child_object_id: "sale-obj", relationship_key: "contact_sales", relationship_type: "one_to_many", child_field_id: "sale-contact-id", child_source_table: "sales", child_company_scoped: true, child_store_scoped: false, active: true };
  const recordId = "a0000000-0000-4000-8000-000000000001";
  const row = { id: recordId, name: "Acme", company_id: "company-a" };
  const rollup = { id: "rollup-1", object_id: object.id, api_name: "total_sales", label: "Total sales", field_type: "rollup", source_column: null, readable: true, active: true, writable: false, required: false, config: { relationshipKey: "contact_sales", operation: "SUM", field: "amount", resultType: "currency" } };
  const saleFields = [
    { id: "sale-contact-id", object_id: "sale-obj", api_name: "contact_id", field_type: "lookup", source_column: "contact_id", readable: true, active: true },
    { id: "sale-amount", object_id: "sale-obj", api_name: "amount", field_type: "currency", source_column: "amount", readable: true, active: true },
    { id: "sale-status", object_id: "sale-obj", api_name: "status", field_type: "text", source_column: "status", readable: true, active: true },
  ];
  const state = { fields: [{ id: "contact-name", object_id: object.id, api_name: "name", field_type: "text", source_column: "name", readable: true, active: true }, rollup], childRecords: [
    { id: "b0000000-0000-4000-8000-000000000001", contact_id: recordId, amount: "10", status: "paid", company_id: "company-a" },
    { id: "b0000000-0000-4000-8000-000000000002", contact_id: recordId, amount: "20", status: "paid", company_id: "company-a" },
    { id: "b0000000-0000-4000-8000-000000000003", contact_id: "a0000000-0000-4000-8000-000000000002", amount: "50", status: "paid", company_id: "company-a" },
  ], relationships: [relationship], records: [row] };
  async function db(sql, params = []) {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: params[0] === "foreign" ? [] : [object] };
    if (sql.startsWith("SELECT f.*") || sql.startsWith("SELECT * FROM platform_fields")) {
      const allFields = [...state.fields, ...saleFields];
      if (sql.includes("WHERE id=$1") || sql.includes("WHERE id = $1") || sql.includes("WHERE id=$1 AND active=true")) {
        return { rows: allFields.filter((field) => field.id === params[0]) };
      }
      const objectId = params[0];
      return { rows: allFields.filter((field) => field.object_id === objectId || objectId === undefined || objectId === null) };
    }
    if (sql.startsWith("SELECT * FROM platform_relationships") || sql.startsWith("SELECT r.*, p.object_key AS parent_object_key")) {
      if (params.length >= 2) {
        return { rows: state.relationships.filter((relationship) => relationship.parent_object_id === params[0] && relationship.relationship_key === params[1] && relationship.active !== false) };
      }
      return { rows: state.relationships };
    }
    if (sql.startsWith("SELECT * FROM platform_rules")) return { rows: [] };
    if (sql.startsWith("SELECT COUNT(*)")) return { rows: [{ total: state.records.length }] };
    if (sql.startsWith("SELECT company_id FROM \"contacts\"")) return { rows: [{ company_id: "company-a" }] };
    if (sql.startsWith("SELECT id")) return { rows: state.records };
    if (sql.startsWith("SELECT *,") || sql.startsWith("SELECT * FROM \"contacts\"")) return { rows: state.records };
    if (sql.startsWith("SELECT * FROM \"sales\"")) return { rows: state.childRecords.filter((child) => child.contact_id === params[0] && child.company_id === params[1]) };
    if (sql.startsWith("SELECT * FROM platform_record_history")) return { rows: [] };
    if (sql.startsWith("INSERT INTO \"contacts\"") || sql.startsWith("UPDATE \"contacts\"")) return { rows: state.records };
    if (sql.startsWith("INSERT INTO platform_approval_requests") || sql.startsWith("INSERT INTO platform_approval_processes")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_fields") || sql.startsWith("UPDATE platform_fields")) return { rows: [rollup] };
    if (sql.startsWith("INSERT INTO platform_record_associations")) return { rows: [] };
    throw new Error(`Unexpected SQL in rollup test: ${sql}`);
  }
  const app = express(); app.use(express.json());
  app.use(createPlatformRouter({ db,
    authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); },
    authorize: () => (req, res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: "allowed" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, data: text.startsWith("{") ? JSON.parse(text) : text };
  };
  const list = await call("GET", "/platform/objects/contact/records");
  assert.equal(list.status, 200);
  assert.equal(list.data.data[0].total_sales, 30);
  for (const [operation, expected] of [["COUNT", 2], ["MIN", 10], ["MAX", 20], ["AVG", 15]]) {
    rollup.config = { relationshipKey: "contact_sales", operation, field: "amount", resultType: "number" };
    const aggregate = await call("GET", "/platform/objects/contact/records");
    assert.equal(aggregate.status, 200);
    assert.equal(aggregate.data.data[0].total_sales, expected);
  }
  rollup.config = { relationshipKey: "contact_sales", operation: "COUNT", field: null, condition: { match: "all", conditions: [{ field: "status", operator: "equals", value: "paid" }] } };
  const filtered = await call("GET", "/platform/objects/contact/records");
  assert.equal(filtered.data.data[0].total_sales, 2);
  state.childRecords[0].status = "draft";
  const afterFilterChange = await call("GET", "/platform/objects/contact/records");
  assert.equal(afterFilterChange.data.data[0].total_sales, 1);
  assert.equal((await call("POST", "/platform/objects/contact/records", { name: "Beta" })).status, 201);
  assert.equal((await call("PUT", `/platform/objects/contact/records/${recordId}`, { total_sales: 999 })).status, 400);
  assert.equal((await call("PUT", `/platform/objects/contact/records/${recordId}`, { name: "Updated" })).status, 200);
  const invalid = await call("POST", "/platform/objects/contact/fields", { apiName: "bad_rollup", label: "Bad rollup", fieldType: "rollup", config: { relationshipKey: "missing" } });
  assert.equal(invalid.status, 400);
  server.close();
});

test("records include formulas without treating formula names as physical SQL columns", async t => {
  const { request } = await fixture(t);
  const read = await request("GET", records);
  assert.equal(read.status, 200); assert.equal(read.data.records[0].total, 10); assert.equal(read.data.total, 1);
  const created = await request("POST", records, { price: 2.5, quantity: 4 });
  assert.equal(created.status, 201); assert.equal(created.data.data.total, 10);
  const updated = await request("PUT", `${records}/${recordId}`, { quantity: 4 });
  assert.equal(updated.status, 200); assert.equal(updated.data.data.total, 10);
  assert.equal((await request("GET", records + '?filter={"total":10}')).status, 400);
});

test("read-only values cannot be spoofed; invalid formula metadata fails before record writes", async t => {
  const { request, state } = await fixture(t);
  assert.equal((await request("POST", records, { price: 1, total: 100 })).status, 400);
  assert.equal((await request("PUT", `${records}/${recordId}`, { total: 100 })).status, 400);
  state.fields[3].config.expression = "unknown + 1";
  assert.equal((await request("POST", records, { price: 1 })).status, 422);
  assert.equal(state.writes.length, 0);
});

test("field configuration supports formulas and rejects broken references, rename and deactivation", async t => {
  const { request, state } = await fixture(t);
  assert.equal((await request("POST", "/platform/objects/object-a/fields", fieldPayload)).status, 201);
  assert.equal((await request("POST", "/platform/objects/object-a/fields", { ...fieldPayload, config: { expression: "unknown + 1", resultType: "decimal" } })).status, 400);
  assert.equal((await request("PUT", "/platform/fields/price-id", { apiName: "renamed" })).status, 400);
  assert.equal((await request("PUT", "/platform/fields/price-id", { readable: false })).status, 400);
  assert.equal((await request("DELETE", "/platform/fields/price-id")).status, 400);
  assert.equal((await request("PUT", "/platform/fields/total-id", { config: { expression: "total * 2", resultType: "decimal" } })).status, 400);
  assert.equal(state.writes.length, 1);
});

test("permissions, global metadata ownership, tenant and store context are preserved", async t => {
  const { request, state } = await fixture(t, { global: true, foreignRecord: true });
  assert.equal((await request("GET", records, undefined, "")).status, 401);
  assert.equal((await request("POST", "/platform/objects/object-a/fields", fieldPayload, "denied")).status, 403);
  assert.equal((await request("POST", "/platform/objects/object-a/fields", fieldPayload)).status, 404);
  assert.equal((await request("PUT", "/platform/fields/total-id", { label: "Changed" })).status, 404);
  assert.equal((await request("PUT", `${records}/${recordId}`, { quantity: 4 })).status, 403);
  assert.equal((await request("GET", "/platform/objects/foreign/records")).status, 404);
  assert.equal(state.writes.length, 0);
  const noStore = await fixture(t, { noStore: true });
  assert.equal((await noStore.request("GET", records)).status, 403);
});

test("validation rules can reject an update based on the merged formula result", async t => {
  const rules = [{ id: "rule", object_id: "object-a", trigger_key: "before_save", action: { type: "validation", message: "Total too high" }, conditions: [{ field: "total", operator: "greater_than", value: 20 }] }];
  const { request, state } = await fixture(t, { rules });
  const response = await request("PUT", `${records}/${recordId}`, { quantity: 100 });
  assert.equal(response.status, 422); assert.equal(response.data.code, "VALIDATION_RULE_FAILED");
  assert.equal(state.writes.length, 0);
});

test("conditional required is enforced for generic record creation", async t => {
  const { request, state } = await fixture(t);
  state.fields[2].config = { requiredCondition: { conditions: [{ field: "quantity", operator: "greater_than", value: 3 }] } };
  assert.equal((await request("POST", records, { price: 2, quantity: 4 })).status, 422);
  assert.equal((await request("POST", records, { price: 2, quantity: 3 })).status, 201);
});

test("hidden formulas are not returned and formula-only objects can return constant values", async t => {
  const { request, state } = await fixture(t);
  state.fields[3].readable = false;
  assert.equal(Object.hasOwn((await request("GET", records)).data.data[0], "total"), false);
  state.fields = [formula("2 + 3")]; state.records = [{ id: recordId }];
  const result = await request("GET", records);
  assert.equal(result.status, 200); assert.equal(result.data.data[0].total, 5);
});
