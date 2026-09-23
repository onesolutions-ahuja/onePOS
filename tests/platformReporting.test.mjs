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
  { id: "a0000000-0000-4000-8000-000000000002", company_id: "company-a", name: "Beta", status: "paid", amount: "10" },
  { id: "a0000000-0000-4000-8000-000000000003", company_id: "company-a", name: "Gamma", status: "open", amount: "30" },
];

const state = { reports: [] };

function db(sql, params = []) {
  if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
  if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: fields };
  if (sql.startsWith("SELECT * FROM platform_reports")) {
    if (params.length >= 3 && typeof params[2] === "string") {
      return { rows: state.reports.filter((report) => report.object_id === params[0] && report.company_id === params[1] && report.report_key === params[2] && report.active !== false) };
    }
    return { rows: state.reports.filter((report) => report.object_id === params[0] && report.company_id === params[1] && report.active !== false) };
  }
  if (sql.startsWith("INSERT INTO platform_reports")) {
    const report = {
      id: `report-${state.reports.length + 1}`,
      object_id: params[0],
      company_id: params[1],
      report_key: params[2],
      label: params[3],
      description: params[4],
      active: true,
      config: JSON.parse(params[5]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.reports.push(report);
    return { rows: [report] };
  }
  if (sql.startsWith("UPDATE platform_reports")) {
    const report = state.reports.find((entry) => entry.id === params[params.length - 1]);
    if (!report) return { rows: [] };
    if (params[0] !== undefined) report.label = params[0];
    if (params[1] !== undefined) report.description = params[1];
    if (params[2] !== undefined) report.active = params[2];
    if (params[3] !== undefined) report.config = JSON.parse(params[3]);
    report.updated_at = new Date().toISOString();
    return { rows: [report] };
  }
  if (sql.startsWith("SELECT COUNT(*)::int AS total FROM \"contacts\"")) {
    return { rows: [{ total: records.length }] };
  }
  if (sql.startsWith("SELECT \"status\" AS \"group_value\", COUNT(*)::int AS \"count\"")) {
    const byStatus = new Map();
    for (const row of records) {
      const value = row.status;
      byStatus.set(value, (byStatus.get(value) || 0) + 1);
    }
    return { rows: [...byStatus.entries()].map(([group_value, count]) => ({ group_value, count })) };
  }
  return { rows: [] };
}

test("platform reporting stores report definitions and executes grouped summaries", async () => {
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db,
    authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); },
    authorize: () => (req, res, next) => next(),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const createResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "allowed" },
      body: JSON.stringify({ label: "Payments by status", config: { fields: ["status", "amount"], filters: [{ field: "status", operator: "eq", value: "paid" }], sort: [{ field: "amount", direction: "desc" }], groupBy: "status", metrics: [{ type: "count" }] } }),
    });
    assert.equal(createResp.status, 201);
    const created = await createResp.json();
    assert.equal(created.data.report_key, "payments_by_status");
    assert.deepEqual(created.data.config.fields, ["status", "amount"]);
    assert.equal(created.data.config.filters[0].operator, "eq");
    assert.equal(created.data.config.sort[0].direction, "desc");

    const listResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/reports`, {
      headers: { Authorization: "allowed" },
    });
    assert.equal(listResp.status, 200);
    const listed = await listResp.json();
    assert.equal(listed.data.length, 1);

    const execResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/objects/contact/reports/payments_by_status`, {
      headers: { Authorization: "allowed" },
    });
    assert.equal(execResp.status, 200);
    const executed = await execResp.json();
    assert.equal(executed.data.report.label, "Payments by status");
    assert.deepEqual(executed.data.rows.map((row) => row.group_value).sort(), ["open", "paid"]);
    assert.equal(executed.data.rows.find((row) => row.group_value === "paid").count, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
