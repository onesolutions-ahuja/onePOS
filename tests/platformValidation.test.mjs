import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";
import { validationRuleError, evaluateValidationRules } from "../services/platformValidation.js";

const id = "a0000000-0000-4000-8000-000000000001";
const fields = [
  { api_name: "amount", source_column: "amount", field_type: "decimal", label: "Amount", active: true },
  { api_name: "name", source_column: "name", field_type: "text", label: "Name", active: true },
  { api_name: "enabled", source_column: "enabled", field_type: "boolean", label: "Enabled", active: true },
  { api_name: "due", source_column: "due", field_type: "date", label: "Due", active: true },
  { api_name: "parent_record_id", source_column: "parent_record_id", field_type: "lookup", label: "Parent Record", active: true, config: { relatedObjectKey: "sample", preventSelfReference: true } },
];
const rule = (extra = {}) => ({ id: "rule-a", name: "Positive amount", object_id: "object-a", company_id: "company-a", active: true,
  trigger_key: "before_save", conditions: [{ field: "amount", operator: "less_than", value: "0" }],
  action: { type: "validation", message: "Amount must not be negative", match: "all" }, ...extra });

test("typed declarative comparisons, empty values, all and any", () => {
  assert.equal(evaluateValidationRules([rule()], fields, { amount: "-1" }).length, 1);
  assert.equal(evaluateValidationRules([rule()], fields, { amount: null }).length, 0);
  for (const [field, operator, value, actual] of [
    ["enabled", "equals", "false", false], ["due", "greater_than", "2026-01-01", "2026-02-01"],
    ["name", "contains", "bad", "bad input"], ["name", "is_empty", "", null],
    ["name", "is_not_empty", "", "ok"], ["amount", "equals", "10", 10],
    ["name", "not_equals", "ok", "bad"],
  ]) assert.equal(evaluateValidationRules([rule({ conditions: [{ field, operator, value }] })], fields, { [field]: actual }).length, 1);
  const combined = rule({ conditions: [...rule().conditions, { field: "name", operator: "equals", value: "blocked" }] });
  assert.equal(evaluateValidationRules([combined], fields, { amount: -1, name: "ok" }).length, 0);
  combined.action.match = "any";
  assert.equal(evaluateValidationRules([combined], fields, { amount: -1, name: "ok" }).length, 1);
});

test("invalid definitions rejected without executing expressions", () => {
  for (const invalid of [
    { object_id: null }, { trigger_key: "after_create" }, { conditions: [] },
    { conditions: Array(51).fill(rule().conditions[0]) },
    { conditions: [{ field: "amount", operator: "eval", value: "process.exit()" }] },
    { conditions: [{ field: "missing", operator: "equals", value: 1 }] },
    { conditions: [{ field: "amount", operator: "less_than", value: "oops" }] },
    { conditions: [{ field: "name", operator: "greater_than", value: "x" }] },
    { action: { type: "validation", message: "" } },
    { action: { type: "validation", message: "Error", match: "javascript" } },
  ]) assert.ok(validationRuleError(rule(invalid), fields));
  assert.throws(() => evaluateValidationRules([rule()], fields.map(f => ({ ...f, active: false })), {}));
  assert.equal(validationRuleError(rule({ conditions: [{ field: "name", operator: "equals", value: "process.exit()" }] }), fields), null);
});

async function fixture(t, options = {}) {
  const object = { id: "object-a", object_key: "sample", source_table: "sample_records", company_id: null, company_scoped: true, active: true, store_scoped: !!options.storeScoped };
  const state = { rules: options.rules || [rule()], current: { amount: -2, name: "Existing", enabled: false, __validation_version: "7" }, writes: [], queries: [] };
  async function db(sql, params = []) {
    state.queries.push({ sql, params });
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: params[0] === "foreign-object" ? [] : [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: fields };
    if (sql.startsWith("SELECT * FROM platform_rules WHERE object_id=")) {
      assert.match(sql, /company_id IS NULL OR company_id=\$2/);
      assert.match(sql, /active=true/);
      return { rows: state.rules.filter(r => r.object_id === params[0] && r.active && (r.company_id === null || r.company_id === params[1]) && [params[2], "before_save"].includes(r.trigger_key) && r.action.type === "validation") };
    }
    if (sql.startsWith("SELECT * FROM platform_rules WHERE id=")) return { rows: state.rules.filter(r => r.id === params[0] && r.company_id === params[1]) };
    if (sql.startsWith("SELECT company_id FROM")) return { rows: [{ company_id: options.foreignRecord ? "company-b" : "company-a" }] };
    if (sql.startsWith('SELECT id FROM "sample_records"')) return { rows: [{ id: params[0] }] };
    if (sql.includes('xmin::text AS "__validation_version"')) {
      assert.match(sql, /company_id=\$2/);
      assert.equal(params[1], "company-a");
      if (object.store_scoped) { assert.match(sql, /store_id=\$3/); assert.equal(params[2], "store-a"); }
      return { rows: options.missingRecord || options.foreignStore ? [] : [state.current] };
    }
    if (sql.startsWith("INSERT INTO platform_rules")) {
      state.writes.push({ sql, params });
      const saved = rule({ object_id: params[0], name: params[1], trigger_key: params[2], conditions: JSON.parse(params[3]), action: JSON.parse(params[4]), active: params[5], company_id: params[6] });
      state.rules.push(saved);
      return { rows: [saved] };
    }
    if (sql.startsWith("UPDATE platform_rules")) { state.writes.push({ sql, params }); return { rows: [state.rules[0]] }; }
    if (sql.startsWith('INSERT INTO "sample_records"') || sql.startsWith('UPDATE "sample_records"')) {
      state.writes.push({ sql, params });
      if (sql.startsWith("UPDATE") && !options.rules) { assert.match(sql, /xmin::text=/); assert.equal(params.at(-1), "7"); }
      return { rows: options.concurrentEdit ? [] : [{ id, name: "Saved" }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db,
    authenticate: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { companyId: "company-a", storeId: options.noStore ? null : "store-a" }; next(); },
    authorize: code => (req, res, next) => { assert.equal(code, "settings.manage"); return req.headers.authorization === "denied" ? res.sendStatus(403) : next(); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  async function request(method, path, body, auth = "allowed") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text.startsWith("{") ? JSON.parse(text) : text };
  }
  return { state, request };
}
const records = "/platform/objects/sample/records";
const payload = () => ({ objectId: "object-a", name: "Positive", triggerKey: "before_save", conditions: rule().conditions, action: rule().action, active: true });

test("create rejects invalid records without writing and permits valid records", async t => {
  const { request, state } = await fixture(t);
  const rejected = await request("POST", records, { data: { amount: -1 } });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.code, "VALIDATION_RULE_FAILED");
  assert.equal(rejected.data.errors[0].message, "Amount must not be negative");
  assert.equal(state.writes.length, 0);
  assert.equal((await request("POST", records, { amount: 2 })).status, 201);
  assert.equal(state.writes[0].params.at(-1), "company-a");
});

test("partial updates validate stored values, successful edits use an optimistic version guard", async t => {
  const { request, state } = await fixture(t);
  assert.equal((await request("PUT", `${records}/${id}`, { name: "Rename" })).status, 422);
  assert.equal(state.writes.length, 0);
  assert.equal((await request("PUT", `${records}/${id}`, { amount: 2 })).status, 200);
});

test("metadata can prevent a record from being its own lookup parent", async t => {
  const { request, state } = await fixture(t);
  const response = await request("PUT", `${records}/${id}`, { parent_record_id: id });
  assert.equal(response.status, 422);
  assert.equal(response.data.code, "SELF_REFERENCE_NOT_ALLOWED");
  assert.equal(state.writes.length, 0);
});

test("concurrent update returns 409 instead of accepting a stale validation snapshot", async t => {
  const { request } = await fixture(t, { concurrentEdit: true });
  assert.equal((await request("PUT", `${records}/${id}`, { amount: 2 })).status, 409);
});

test("tenant, object, trigger, inactive and workflow rules are excluded; global validation applies", async t => {
  const ignored = [rule({ company_id: "company-b" }), rule({ object_id: "other" }), rule({ active: false }), rule({ trigger_key: "before_update" }), rule({ action: { type: "validate" } })];
  const { request, state } = await fixture(t, { rules: ignored });
  assert.equal((await request("POST", records, { amount: -1 })).status, 201);
  state.rules.push(rule({ company_id: null }));
  assert.equal((await request("POST", records, { amount: -1 })).status, 422);
});

test("rule configuration uses existing permissions and server tenant, validates edits and references", async t => {
  const { request, state } = await fixture(t);
  assert.equal((await request("POST", "/platform/rules", payload(), "")).status, 401);
  assert.equal((await request("POST", "/platform/rules", payload(), "denied")).status, 403);
  assert.equal((await request("POST", "/platform/rules", { ...payload(), objectId: "foreign-object" })).status, 400);
  assert.equal((await request("PUT", "/platform/rules/rule-a", { conditions: [] })).status, 400);
  assert.equal((await request("PUT", "/platform/rules/foreign-rule", { active: true })).status, 404);
  assert.equal(state.writes.length, 0);
  const saved = await request("POST", "/platform/rules", { ...payload(), companyId: "company-b" });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.data.company_id, "company-a");
  assert.equal((await request("PUT", "/platform/rules/rule-a", { active: false })).status, 200);
});

test("record authentication, permissions, company ownership and reserved scope fields cannot bypass rules", async t => {
  const { request, state } = await fixture(t, { foreignRecord: true });
  assert.equal((await request("POST", records, { amount: 2 }, "")).status, 401);
  assert.equal((await request("PUT", `${records}/${id}`, { amount: 2 }, "denied")).status, 403);
  assert.equal((await request("PUT", `${records}/${id}`, { amount: 2 })).status, 403);
  assert.equal((await request("POST", records, { amount: 2, company_id: "company-b" })).status, 400);
  assert.equal(state.writes.length, 0);
});

test("store-scoped record creation uses session store and partial update reads stay scoped", async t => {
  const { request, state } = await fixture(t, { storeScoped: true });
  assert.equal((await request("POST", records, { amount: 2 })).status, 201);
  assert.equal(state.writes[0].params.at(-1), "store-a");
  assert.equal((await request("PUT", `${records}/${id}`, { amount: 3 })).status, 200);
  assert.match(state.writes[1].sql, /store_id=/);
});

test("other-store records and absent store sessions are rejected", async t => {
  const foreign = await fixture(t, { storeScoped: true, foreignStore: true });
  assert.equal((await foreign.request("PUT", `${records}/${id}`, { amount: 3 })).status, 404);
  assert.equal(foreign.state.writes.length, 0);
  const missing = await fixture(t, { storeScoped: true, noStore: true });
  assert.equal((await missing.request("POST", records, { amount: 3 })).status, 403);
});

test("invalid stored rules fail closed and missing update records return 404", async t => {
  const invalid = await fixture(t, { rules: [rule({ conditions: [{ field: "removed", operator: "equals", value: 1 }] })] });
  assert.equal((await invalid.request("POST", records, { amount: 2 })).data.code, "VALIDATION_RULE_INVALID");
  assert.equal(invalid.state.writes.length, 0);
  const missing = await fixture(t, { missingRecord: true });
  assert.equal((await missing.request("PUT", `${records}/${id}`, { amount: 2 })).status, 404);
});
