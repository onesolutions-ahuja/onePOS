import assert from "node:assert/strict";
import test from "node:test";
import { searchPlatformRecords } from "../services/platformSearch.js";

function database({ object, fields, rows, permitted = true }) {
  return async (sql) => {
    if (sql.includes("FROM platform_objects")) return { rows: [object] };
    if (sql.includes("FROM role_permissions")) return { rows: permitted ? [{ "?column?": 1 }] : [] };
    if (sql.includes("FROM platform_object_permissions")) return { rows: permitted ? [{ "?column?": 1 }] : [] };
    if (sql.includes("FROM platform_fields")) return { rows: fields };
    if (sql.includes("FROM platform_field_security")) return { rows: [] };
    if (sql.includes(`FROM "${object.source_table}"`)) return { rows };
    throw new Error(`Unexpected query: ${sql}`);
  };
}

test("searches readable standard object records with a bounded public shape", async () => {
  const data = await searchPlatformRecords(database({
    object: { id: "11111111-1111-1111-1111-111111111111", object_key: "product", label: "Product", source_table: "products", company_scoped: true },
    fields: [{ id: "field-1", api_name: "name", label: "Name", field_type: "text", source_column: "name", active: true }],
    rows: [{ id: "record-1", primary_value: "Johnnie Walker", secondary_value: null }],
  }), { user: { companyId: "company-1", roleId: "role-1", storeId: "store-1" } }, "John");

  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].primaryLabel, "Johnnie Walker");
  assert.equal(data.results[0].objectApiName, "product");
  assert.deepEqual(Object.keys(data.results[0]).sort(), [
    "destination", "objectApiName", "objectId", "objectLabel", "primaryLabel", "recordId", "secondaryLabel",
  ].sort());
});

test("short queries do not execute database search", async () => {
  let calls = 0;
  const data = await searchPlatformRecords(async () => { calls += 1; return { rows: [] }; }, { user: { companyId: "company-1" } }, "J");
  assert.equal(calls, 0);
  assert.deepEqual(data.results, []);
});
