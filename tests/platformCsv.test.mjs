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
    if (sql.startsWith("SELECT id FROM \"contacts\"")) {
      const matchingId = params[0];
      if (matchingId && state.records.some((entry) => entry.id === matchingId)) return { rows: [{ id: matchingId }] };
      return { rows: [] };
    }
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
  assert.equal(importBody.data.results[0]?.action, "update");
  assert.equal(importBody.data.results.length, 1);
  server.close();
});

test("platform CSV import update keeps scoped placeholders aligned", async t => {
  const app = express();
  app.use(express.json());
  const storeObject = { ...object, store_scoped: true };
  let updateParams = null;
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [storeObject] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: fields };
    if (sql.startsWith("SELECT id FROM \"contacts\"")) {
      return { rows: [{ id: params[0] }] };
    }
    if (sql.startsWith("UPDATE \"contacts\"")) {
      updateParams = [...params];
      return { rows: [{ id: params[2] }] };
    }
    return { rows: [] };
  };
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: "store-1", isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const resp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ csv: `id,name,status,amount\n${records[1].id},Bravo,closed,15\n` }),
  });

  assert.equal(resp.status, 200);
  assert.deepEqual(updateParams, ["Bravo", "closed", 15, records[1].id, "company-a", "store-1"]);
  server.close();
});

test("platform CSV import upsert uses unique field matching and preview is zero-mutation", async t => {
  const state = { records: [...records], writes: [] };
  const upsertFields = [
    ...fields,
    { id: "contact-sku", object_id: object.id, api_name: "sku", field_type: "text", source_column: "sku", readable: true, active: true, unique: true, config: { businessKey: true }, required: true, label: "SKU" },
  ];
  const existingId = "a0000000-0000-4000-8000-000000000003";
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: upsertFields };
    if (sql.startsWith('SELECT id FROM "contacts" WHERE id=$1')) {
      const match = state.records.find((entry) => entry.id === params[0]);
      return { rows: match ? [{ id: match.id }] : [] };
    }
    if (sql.startsWith('SELECT id FROM "contacts" WHERE sku=$1')) {
      const value = params[0];
      const match = state.records.find((entry) => entry.sku === value);
      return { rows: match ? [{ id: match.id }] : [] };
    }
    if (sql.startsWith("SELECT id FROM \"contacts\" WHERE \"name\"=$1")) {
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO \"contacts\"")) {
      state.writes.push([...params]);
      const row = { id: `a0000000-0000-4000-8000-${String(state.records.length + 1).padStart(12, "0")}`, company_id: object.company_id };
      upsertFields.forEach((field) => {
        if (field.api_name === "sku") row.sku = params[0];
        if (field.api_name === "name") row.name = params[1];
        if (field.api_name === "status") row.status = params[2];
        if (field.api_name === "amount") row.amount = params[3];
      });
      state.records.push(row);
      return { rows: [{ id: row.id }] };
    }
    if (sql.startsWith("UPDATE \"contacts\"")) {
      state.writes.push([...params]);
      const match = state.records.find((entry) => entry.id === params.at(-2));
      if (match) {
        const assignment = params.slice(0, params.length - 2);
        const fieldsApplied = upsertFields.filter((field) => field.api_name !== "id");
        fieldsApplied.forEach((field, index) => {
          if (field.api_name === "sku") match.sku = assignment[index];
          if (field.api_name === "name") match.name = assignment[index];
          if (field.api_name === "status") match.status = assignment[index];
          if (field.api_name === "amount") match.amount = assignment[index];
        });
      }
      return { rows: [{ id: params.at(-2) }] };
    }
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  state.records.push({ id: existingId, company_id: "company-a", sku: "SKU-1", name: "Acme", status: "paid", amount: "20" });
  const validateResponse = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "upsert", csv: "sku,name,status,amount\nSKU-1,Acme,paid,30\n" }),
  });
  const validateBody = await validateResponse.json();
  assert.equal(validateResponse.status, 200);
  assert.equal(validateBody.data.summary.update, 1);
  const validatedRecord = state.records.find((entry) => entry.id === existingId);
  assert.equal(validatedRecord.amount, "20");

  const importResponse = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "upsert", csv: "sku,name,status,amount\nSKU-1,Acme,paid,30\n" }),
  });
  const importBody = await importResponse.json();
  assert.equal(importResponse.status, 200);
  assert.equal(importBody.data.summary.updated, 1);
  assert.equal(state.writes.length >= 1, true);
  server.close();
});

test("platform CSV import rejects duplicate values within the same file and stores original row data with errors", async t => {
  const protectedFields = [
    ...fields,
    { id: "contact-sku", object_id: object.id, api_name: "sku", field_type: "text", source_column: "sku", readable: true, active: true, unique: true, config: { businessKey: true }, required: true, label: "SKU" },
  ];
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: protectedFields };
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "create", csv: "sku,name,status,amount\nABC-100,Alpha,paid,5\nABC-100,Beta,paid,7\n" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.summary.errors, 1);
  assert.equal(body.data.errors[0]?.rowData?.sku, "ABC-100");
  assert.equal(body.data.errors[0]?.originalRow?.sku, "ABC-100");
  server.close();
});

test("platform CSV import final execution rejects duplicate CSV values before any write", async t => {
  const state = { records: [...records], writes: [] };
  const upsertFields = [
    ...fields,
    { id: "contact-sku", object_id: object.id, api_name: "sku", field_type: "text", source_column: "sku", readable: true, active: true, unique: true, config: { businessKey: true }, required: true, label: "SKU" },
  ];
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: upsertFields };
    if (sql.includes('WHERE sku=$1')) {
      const match = state.records.find((entry) => entry.sku === params[0]);
      return { rows: match ? [{ id: match.id }] : [] };
    }
    if (sql.startsWith("INSERT INTO \"contacts\"")) {
      state.writes.push([...params]);
      const row = { id: `c${state.records.length + 1}`, company_id: object.company_id };
      upsertFields.forEach((field) => {
        if (field.api_name === "sku") row.sku = params[0];
        if (field.api_name === "name") row.name = params[1];
        if (field.api_name === "status") row.status = params[2];
        if (field.api_name === "amount") row.amount = params[3];
      });
      state.records.push(row);
      return { rows: [{ id: row.id }] };
    }
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "create", csv: "sku,name,status,amount\nABC-100,Alpha,paid,5\nABC-100,Beta,paid,7\n" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.summary.failed, 1);
  assert.equal(body.data.summary.created, 1);
  assert.equal(state.writes.length, 1);
  assert.match(body.data.errors[0]?.message || "", /Duplicate.*SKU|Duplicate.*value/i);
  server.close();
});

test("platform CSV import rejects protected tenant or system fields before write", async t => {
  const protectedFields = [
    ...fields,
    { id: "contact-company", object_id: object.id, api_name: "company_id", field_type: "text", source_column: "company_id", readable: false, writable: false, active: true, protected: true, system: true, label: "Company" },
  ];
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: protectedFields };
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "create", csv: "company_id,name,status,amount\ncompany-b,Gamma,paid,25\n" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.summary.errors, 1);
  assert.match(body.data.errors[0]?.message || "", /managed by the server|protected|read-only/i);
  server.close();
});

test("platform CSV update rejects duplicate business keys on another record", async t => {
  const companyRecords = [
    { id: "a0000000-0000-4000-8000-000000000001", company_id: "company-a", name: "Acme", status: "paid", amount: "20", sku: "SKU-1" },
    { id: "a0000000-0000-4000-8000-000000000002", company_id: "company-a", name: "Beta", status: "open", amount: "10", sku: "SKU-2" },
  ];
  const uniqueFields = [
    ...fields,
    { id: "contact-sku", object_id: object.id, api_name: "sku", field_type: "text", source_column: "sku", readable: true, active: true, unique: true, config: { businessKey: true }, required: true, label: "SKU" },
  ];
  const db = async (sql, params = []) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: uniqueFields };
    if (sql.includes('WHERE sku=$1')) {
      const value = params[0];
      const match = companyRecords.find((entry) => entry.sku === value);
      return { rows: match ? [{ id: match.id }] : [] };
    }
    if (sql.startsWith('SELECT id FROM "contacts" WHERE id=$1')) {
      const match = companyRecords.find((entry) => entry.id === params[0]);
      return { rows: match ? [{ id: match.id }] : [] };
    }
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({ db, authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); }, authorize: () => (req, res, next) => next() }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/records/import/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "allowed" },
    body: JSON.stringify({ operation: "update", csv: `id,name,status,amount,sku\n${companyRecords[0].id},Acme,paid,20,SKU-2\n` }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.summary.errors, 1);
  assert.match(body.data.errors[0]?.message || "", /duplicate|different record/i);
  server.close();
});

