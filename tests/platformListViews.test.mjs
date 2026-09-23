import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";

test("metadata-driven list views limit columns, apply filters, and sort in generic record listing", async t => {
  const object = { id: "contact-obj", object_key: "contact", source_table: "contacts", active: true, company_id: "company-a", company_scoped: true, store_scoped: false };
  const fields = [
    { id: "contact-name", object_id: object.id, api_name: "name", field_type: "text", source_column: "name", readable: true, active: true },
    { id: "contact-status", object_id: object.id, api_name: "status", field_type: "text", source_column: "status", readable: true, active: true },
    { id: "contact-amount", object_id: object.id, api_name: "amount", field_type: "currency", source_column: "amount", readable: true, active: true },
    { id: "contact-hidden", object_id: object.id, api_name: "internal_note", field_type: "text", source_column: "internal_note", readable: true, active: false },
  ];
  const state = {
    records: [
      { id: "a0000000-0000-4000-8000-000000000001", company_id: "company-a", name: "Acme", status: "paid", amount: "20" },
      { id: "a0000000-0000-4000-8000-000000000002", company_id: "company-a", name: "Beta", status: "paid", amount: "10" },
      { id: "a0000000-0000-4000-8000-000000000003", company_id: "company-a", name: "Gamma", status: "open", amount: "30" },
    ],
    listViews: [],
  };

  async function db(sql, params = []) {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) {
      if (sql.includes("WHERE object_id=$1 AND active=true") || sql.includes("WHERE object_id=$1 ORDER BY display_order")) {
        return { rows: fields.filter((field) => field.active === true) };
      }
      return { rows: fields };
    }
    if (sql.startsWith("SELECT * FROM platform_list_views")) {
      const id = params[0];
      const objectId = params[1];
      if (id && objectId === undefined) {
        return { rows: state.listViews.filter((view) => view.id === id && view.active !== false) };
      }
      return { rows: state.listViews.filter((view) => view.object_id === objectId && view.company_id === params[2] && view.active !== false) };
    }
    if (sql.startsWith("SELECT COUNT(*)")) return { rows: [{ total: state.records.length }] };
    if (sql.includes(' FROM "contacts"')) {
      const rows = state.records.filter((row) => {
        if (params[0] !== undefined && params[0] !== row.company_id) return false;
        if (params[1] !== undefined && params[1] !== row.status) return false;
        return true;
      });
      return { rows };
    }
    if (sql.startsWith("INSERT INTO platform_list_views")) {
      const row = {
        id: `view-${state.listViews.length + 1}`,
        object_id: params[0],
        company_id: params[1],
        view_key: params[2],
        label: params[3],
        description: params[4],
        active: true,
        columns: JSON.parse(params[5]),
        filters: JSON.parse(params[6]),
        sort: JSON.parse(params[7]),
        page_size: Number(params[8]),
        is_default: params[9],
      };
      state.listViews.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith("UPDATE platform_list_views")) {
      const viewId = params[params.length - 1];
      const target = state.listViews.find((view) => view.id === viewId);
      if (!target) return { rows: [] };
      Object.assign(target, {
        view_key: params[0] ?? target.view_key,
        label: params[1] ?? target.label,
        description: params[2] ?? target.description,
        active: params[3] ?? target.active,
        columns: params[4] !== null ? JSON.parse(params[4]) : target.columns,
        filters: params[5] !== null ? JSON.parse(params[5]) : target.filters,
        sort: params[6] !== null ? JSON.parse(params[6]) : target.sort,
        page_size: params[7] !== null ? Number(params[7]) : target.page_size,
        is_default: params[8] ?? target.is_default,
      });
      return { rows: [target] };
    }
    if (sql.startsWith("UPDATE platform_list_views SET active=false")) {
      const view = state.listViews.find((entry) => entry.id === params[0] && entry.company_id === params[1]);
      if (view) view.active = false;
      return { rows: view ? [view] : [] };
    }
    if (sql.startsWith("SELECT * FROM \"contacts\" WHERE")) {
      const where = sql.match(/WHERE (.*) ORDER BY/i)?.[1] || sql.match(/WHERE (.*)$/)?.[1] || "";
      const rows = state.records.filter((row) => {
        if (where.includes("company_id=$1")) return row.company_id === params[0];
        return true;
      });
      return { rows };
    }
    throw new Error(`Unexpected SQL in list view test: ${sql}`);
  }

  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db,
    authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); },
    authorize: () => (req, res, next) => next(),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  async function call(method, path, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "allowed" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text.startsWith("{") ? JSON.parse(text) : text };
  }

  const createView = await call("POST", "/platform/objects/contact/list-views", {
    label: "Paid summary",
    columns: ["name", "amount"],
    filters: { status: "paid" },
    sort: { field: "amount", direction: "desc" },
    pageSize: 10,
  });
  assert.equal(createView.status, 201);
  const listViewId = createView.data.data.id;

  const list = await call("GET", `/platform/objects/contact/records?listViewId=${listViewId}`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.records.map((record) => record.name), ["Acme", "Beta"]);
  assert.equal(Object.keys(list.data.records[0]).includes("internal_note"), false);
  assert.equal(Number(list.data.records[0].amount), 20);

  const invalid = await call("POST", "/platform/objects/contact/list-views", {
    label: "Invalid view",
    columns: ["missing_field"],
  });
  assert.equal(invalid.status, 400);
});
