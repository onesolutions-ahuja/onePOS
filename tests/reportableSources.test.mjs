import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformObjectQuery, validatePlatformReportDefinition } from "../services/reportableSources.js";

const object = { id: "object-a", source_table: "service_orders", company_scoped: true, active: true };
const fields = [
  { api_name: "status", label: "Status", field_type: "text", source_column: "status", active: true, readable: true },
  { api_name: "total", label: "Total", field_type: "currency", source_column: "total", active: true, readable: true },
  { api_name: "created_at", label: "Created", field_type: "datetime", source_column: "created_at", active: true, readable: true },
];

test("platform report definitions validate fields, summaries, grouping and filters", () => {
  const definition = validatePlatformReportDefinition({
    dataSource: "platform_object",
    objectId: object.id,
    fields: ["status", "total"],
    groupBy: ["status"],
    summaries: [{ aggregate: "SUM", field: "total" }],
    filters: [{ field: "status", operator: "equals", value: "completed" }],
    sort: [{ field: "status", direction: "asc" }],
  }, object, fields);
  assert.deepEqual(definition.groupBy, ["status"]);
  assert.equal(definition.summaries[0].aggregate, "SUM");
});

test("platform report SQL uses validated identifiers and parameterized values", () => {
  const built = buildPlatformObjectQuery({
    dataSource: "platform_object",
    objectId: object.id,
    fields: ["status", "total"],
    groupBy: ["status"],
    summaries: [{ aggregate: "SUM", field: "total" }],
    filters: [{ field: "status", operator: "contains", value: "comp" }],
    sort: [{ field: "status", direction: "asc" }],
  }, object, fields, "company-a");
  assert.match(built.sql, /FROM "service_orders" r/);
  assert.match(built.sql, /GROUP BY r\."status"/);
  assert.match(built.sql, /SUM\(r\."total"\)/);
  assert.deepEqual(built.params, ["company-a", "%comp%"]);
  assert.doesNotMatch(built.sql, /%comp%/);
});

test("platform reports reject invalid aggregates and foreign fields", () => {
  assert.throws(() => validatePlatformReportDefinition({
    fields: ["status"], summaries: [{ aggregate: "SUM", field: "status" }],
  }, object, fields), /not valid/);
  assert.throws(() => validatePlatformReportDefinition({
    fields: ["unknown"],
  }, object, fields), /valid report field/);
});

test("platform reports traverse only registered relationships", () => {
  const customerFields = [
    { api_name: "name", label: "Customer", field_type: "text", source_column: "name", active: true, readable: true },
  ];
  const built = buildPlatformObjectQuery({
    fields: ["status", "customer.name"],
    groupBy: ["customer.name"],
    filters: [{ field: "customer.name", operator: "contains", value: "Acme" }],
  }, object, fields, "company-a", 100, {}, [{
    relationship_key: "customer",
    target_source_table: "customers",
    child_source_column: "id",
    fields: customerFields,
  }]);
  assert.match(built.sql, /LEFT JOIN "customers" rel1 ON rel1\."id" = r\."id"/);
  assert.match(built.sql, /rel1\."name"/);
  assert.deepEqual(built.params, ["company-a", "%Acme%"]);
  assert.throws(() => validatePlatformReportDefinition({
    fields: ["customer.name"],
  }, object, fields), /valid report field/);
});
