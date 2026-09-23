import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";
import { platformSchema, toSafeApiName } from "../services/platformMetadata.js";

const object = {
  id: "object-a",
  object_key: "sample",
  source_table: "samples",
  active: true,
  company_id: "company-a",
  company_scoped: true,
  store_scoped: false,
};

function fixture() {
  const state = {
    sets: [{ id: "set-a", value_set_key: "order_status", label: "Order Status", company_id: "company-a", active: true }],
    values: [{ id: "value-a", value_set_id: "set-a", value: "pending", label: "Pending", active: true, display_order: 0 }],
    fields: [],
    records: [],
  };
  async function db(sql, params = []) {
    if (sql.startsWith("SELECT * FROM platform_value_sets WHERE company_id")) return { rows: state.sets.filter((set) => set.company_id === params[0]) };
    if (sql.startsWith("SELECT v.* FROM platform_value_set_values")) return { rows: state.values.filter((value) => value.value_set_id === params[0]) };
    if (sql.startsWith("SELECT id FROM platform_value_sets")) return { rows: state.sets.filter((set) => set.id === params[0] && set.company_id === params[1]) };
    if (sql.startsWith("INSERT INTO platform_value_sets")) {
      if (state.sets.some((set) => set.value_set_key === params[0] && set.company_id === params[3])) throw { code: "23505" };
      const created = { id: `set-${state.sets.length + 1}`, value_set_key: params[0], label: params[1], description: params[2], company_id: params[3], active: true };
      state.sets.push(created);
      return { rows: [created] };
    }
    if (sql.startsWith("INSERT INTO platform_value_set_values")) {
      if (state.values.some((value) => value.value_set_id === params[0] && value.value === params[1])) throw { code: "23505" };
      const created = { id: `value-${state.values.length + 1}`, value_set_id: params[0], value: params[1], label: params[2], active: params[4], display_order: params[3] };
      state.values.push(created);
      return { rows: [created] };
    }
    if (sql.startsWith("SELECT * FROM platform_objects WHERE object_key") || sql.startsWith("SELECT * FROM platform_objects WHERE id")) return { rows: params[1] === "company-a" ? [object] : [] };
    if (sql.startsWith("SELECT * FROM platform_fields WHERE object_id")) return { rows: state.fields };
    if (sql.startsWith("INSERT INTO platform_fields")) {
      const field = { id: `field-${state.fields.length + 1}`, object_id: object.id, api_name: params[1], label: params[2], field_type: params[3], source_column: params[4], required: params[5], writable: params[6], options: JSON.parse(params[7]), config: JSON.parse(params[8]), active: true, readable: true };
      state.fields.push(field);
      return { rows: [field] };
    }
    if (sql.startsWith("SELECT * FROM platform_rules")) return { rows: [] };
    if (sql.startsWith('INSERT INTO "samples"')) {
      const record = { id: "record-a", status: params[0] };
      state.records.push(record);
      return { rows: [record] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db,
    authenticate: (req, res, next) => {
      req.user = { companyId: req.headers.authorization === "company-b" ? "company-b" : "company-a" };
      next();
    },
    authorize: () => (req, res, next) => next(),
  }));
  return { state, app };
}

async function request(t, app, method, path, body, auth = "company-a") {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test("picklist metadata keeps stable generated values and supports local and reusable sources", async (t) => {
  assert.equal(toSafeApiName("In Progress"), "in_progress");
  assert.equal(toSafeApiName("In Progress"), "in_progress");
  assert.match(platformSchema, /platform_value_sets/);
  assert.match(platformSchema, /platform_value_set_values/);

  const { app, state } = fixture();
  const createdSet = await request(t, app, "POST", "/platform/value-sets", { label: "Employment Status" });
  assert.equal(createdSet.status, 201);
  assert.equal(createdSet.data.data.value_set_key, "employment_status");
  assert.equal((await request(t, app, "POST", "/platform/value-sets", { label: "Employment Status" })).status, 409);
  assert.equal((await request(t, app, "POST", `/platform/value-sets/${createdSet.data.data.id}/values`, { label: "In Progress" })).status, 201);
  assert.equal((await request(t, app, "POST", `/platform/value-sets/${createdSet.data.data.id}/values`, { label: "In Progress" })).status, 409);
  const local = await request(t, app, "POST", `/platform/objects/${object.id}/fields`, {
    label: "Status", fieldType: "picklist", sourceColumn: "status", options: [{ label: "Pending", value: "pending", active: true }],
  });
  assert.equal(local.status, 201);
  const reusable = await request(t, app, "POST", `/platform/objects/${object.id}/fields`, {
    label: "Employment", fieldType: "picklist", sourceColumn: "employment", config: { valueSetId: createdSet.data.data.id },
  });
  assert.equal(reusable.status, 201);
  assert.equal(state.fields[1].config.valueSetId, createdSet.data.data.id);
});

test("picklist records persist stable values and reject invalid or cross-company metadata", async (t) => {
  const { app, state } = fixture();
  state.fields.push({ id: "field-a", object_id: object.id, api_name: "status", label: "Status", field_type: "picklist", source_column: "status", options: [{ label: "Pending", value: "pending", active: true }, { label: "Old", value: "old", active: false }], config: {}, required: false, writable: true, active: true, readable: true });
  assert.equal((await request(t, app, "POST", "/platform/objects/sample/records", { status: "pending" })).status, 201);
  assert.equal(state.records[0].status, "pending");
  assert.equal((await request(t, app, "POST", "/platform/objects/sample/records", { status: "unknown" })).status, 400);
  assert.equal((await request(t, app, "POST", "/platform/objects/sample/records", { status: "old" })).status, 400);
  assert.equal((await request(t, app, "GET", "/platform/value-sets", undefined, "company-b")).data.data.length, 0);
});
