import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";

const object = { id: "contact-obj", object_key: "contact", source_table: "contacts", active: true, company_id: "company-a", company_scoped: true, store_scoped: false };
const fields = [
  { id: "contact-name", object_id: object.id, api_name: "name", field_type: "text", source_column: "name", readable: true, active: true },
  { id: "contact-status", object_id: object.id, api_name: "status", field_type: "text", source_column: "status", readable: true, active: true },
  { id: "contact-amount", object_id: object.id, api_name: "amount", field_type: "currency", source_column: "amount", readable: true, active: true },
];
const records = [
  { id: "a0000000-0000-4000-8000-000000000001", company_id: "company-a", name: "Acme", status: "paid", amount: "20" },
  { id: "a0000000-0000-4000-8000-000000000002", company_id: "company-a", name: "Beta", status: "open", amount: "10" },
];

test("platform CSV export emits readable field columns for the object", async t => {
  const app = express();
  app.use(express.json());
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: fields };
    if (sql.startsWith("SELECT id, \"name\" AS \"name\"")) return { rows: records };
    return { rows: [] };
  };
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/export`, {
    headers: { Authorization: "allowed" },
  });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /text\/csv/i);
  assert.match(text, /^name,status,amount/);
  assert.match(text, /Acme,paid,20/);
  server.close();
});

test("platform CSV import validates and creates records from object metadata", async t => {
  const state = { records: [...records] };
  const app = express();
  app.use(express.json());
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: fields };
    if (sql.startsWith("INSERT INTO \"contacts\"")) {
      const id = `c${state.records.length + 1}`;
      const row = { id, company_id: params[params.length - 1] ?? object.company_id };
      for (let i = 0; i < fields.length; i += 1) {
        row[fields[i].api_name] = params[i];
      }
      state.records.push(row);
      return { rows: [{ id }] };
    }
    if (sql.startsWith("UPDATE \"contacts\"")) {
      const recordId = params[params.length - 2];
      const target = state.records.find((entry) => entry.id === recordId);
      if (!target) return { rows: [] };
      for (let i = 0; i < fields.length; i += 1) {
        if (fields[i].api_name in target) target[fields[i].api_name] = params[i];
      }
      return { rows: [target] };
    }
    return { rows: [] };
  };
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const validateResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ csv: "name,status,amount\nGamma,paid,25\n" }),
  });
  const validateBody = await validateResp.json();
  assert.equal(validateResp.status, 200);
  assert.equal(validateBody.data.preview.length, 1);

  const importResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ csv: `id,name,status,amount\n${records[0].id},Acme,paid,30\n` }),
  });
  const importBody = await importResp.json();
  assert.equal(importResp.status, 200);
  assert.equal(importBody.data.results[0].action, "update");
  assert.equal(importBody.data.results.length, 1);
  server.close();
});
