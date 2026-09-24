import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSafeIdentifier, platformSchema, toSafeApiName } from "../services/platformMetadata.js";

test("metadata labels produce deterministic lowercase snake_case API names", () => {
  assert.equal(toSafeApiName("Customer Name"), "customer_name");
  assert.equal(toSafeApiName("SaleLine"), "sale_line");
  assert.equal(toSafeApiName("Customer Name!"), "customer_name");
  assert.equal(toSafeApiName(""), "field");
});

test("metadata API-name generation preserves the first character for representative object labels", () => {
  const cases = [
    ["Customer", "customer"],
    ["Products", "products"],
    ["Service_Order", "service_order"],
    ["Asset123", "asset123"],
    [" Customer Name ", "customer_name"],
    ["Products / Services", "products_services"],
  ];

  for (const [label, expected] of cases) {
    assert.equal(toSafeApiName(label, "object"), expected);
    assert.equal(toSafeApiName(label, "object")[0], expected[0]);
    assert.equal(isSafeIdentifier(toSafeApiName(label, "object")), true);
  }
});

test("platform metadata only accepts safe SQL identifiers", () => {
  assert.equal(isSafeIdentifier("customer"), true);
  assert.equal(isSafeIdentifier("customer_2"), true);
  assert.equal(isSafeIdentifier("Customer"), false);
  assert.equal(isSafeIdentifier(" customer"), false);
  assert.equal(isSafeIdentifier("_customer"), true);
  assert.equal(isSafeIdentifier("customer;drop_table"), false);
  assert.equal(isSafeIdentifier(""), false);
});

test("platform schema is additive and contains tenant-aware metadata primitives", () => {
  assert.match(platformSchema, /CREATE TABLE IF NOT EXISTS platform_objects/);
  assert.match(platformSchema, /CREATE TABLE IF NOT EXISTS platform_fields/);
  assert.match(platformSchema, /CREATE TABLE IF NOT EXISTS platform_relationships/);
  assert.match(platformSchema, /CREATE TABLE IF NOT EXISTS platform_layouts/);
  assert.match(platformSchema, /CREATE TABLE IF NOT EXISTS platform_rules/);
  assert.doesNotMatch(platformSchema, /\bDROP\s+TABLE\b/i);
});

test("platform records API uses the existing authentication and settings permission", () => {
  const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  assert.match(source, /router\.get\("\/platform\/metadata", \.\.\.manage/);
  assert.match(source, /authorize\("settings\.manage"\)/);
  assert.match(source, /router\.get\("\/platform\/objects\/:objectKey\/records", authenticate/);
  assert.match(source, /company_id=\$1/);
});

test("platform records API supports safe pagination, search, and metadata filters", () => {
  const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  assert.match(source, /pageSize/);
  assert.match(source, /boundedInteger/);
  assert.match(source, /offset/);
  assert.match(source, /COUNT\(\*\)::int AS total/);
  assert.match(source, /req\.query\.search/);
  assert.match(source, /parseRecordFilters/);
  assert.match(source, /Unknown or unavailable filter field/);
  assert.match(source, /fieldByApiName/);
  assert.match(source, /ILIKE/);
  assert.match(source, /records: result\.rows/);
  assert.match(source, /pages/);
  assert.match(source, /isSafeIdentifier\(field\.source_column\)/);
  assert.doesNotMatch(source, /req\.query\.(?:table|column|sql)/);
});

test("platform generic record mutations are authenticated, metadata-driven, and scoped", () => {
  const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/platform\/objects\/:objectKey\/records", \.\.\.manage/);
  assert.match(source, /router\.put\("\/platform\/objects\/:objectKey\/records\/:recordId", \.\.\.manage/);
  assert.match(source, /metadataColumn/);
  assert.match(source, /Unknown field/);
  assert.match(source, /is unmapped/);
  assert.match(source, /is inactive/);
  assert.match(source, /is required/);
  assert.match(source, /company_id=\$\$\{params\.length\}/);
  assert.match(source, /Company ownership violation/);
  assert.match(source, /recordIdIsValid/);
  assert.doesNotMatch(source, /router\.delete\("\/platform\/objects\/:objectKey\/records/);
});

test("platform configuration API exposes complete metadata CRUD", () => {
  const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  for (const endpoint of [
    'router.get("/platform/objects"',
    'router.get("/platform/objects/:objectId"',
    'router.put("/platform/objects/:objectId"',
    'router.get("/platform/objects/:objectId/fields"',
    'router.put("/platform/fields/:fieldId"',
    'router.delete("/platform/fields/:fieldId"',
    'router.get("/platform/relationships"',
    'router.put("/platform/relationships/:relationshipId"',
    'router.delete("/platform/relationships/:relationshipId"',
    'router.get("/platform/layouts"',
    'router.get("/platform/layouts/:layoutId"',
    'router.put("/platform/layouts/:layoutId"',
    'router.delete("/platform/layouts/:layoutId"',
    'router.get("/platform/rules"',
    'router.put("/platform/rules/:ruleId"',
    'router.delete("/platform/rules/:ruleId"',
    'router.get("/platform/modules/:moduleId"',
    'router.patch("/platform/modules/:moduleId"',
  ]) assert.match(source, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /FIELD_TYPES = PLATFORM_FIELD_TYPE_SET/);
  assert.match(source, /RELATIONSHIP_POLICIES = new Set/);
  assert.match(source, /Only a Superadmin can activate or deactivate/);
});

test("field deactivation checks active metadata references before soft deletion", () => {
  const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  assert.match(source, /async function activeFieldReferences/);
  assert.match(source, /FIELD_IN_USE/);
  assert.match(source, /platform_record_type_picklist_values/);
  assert.match(source, /platform_relationships/);
  assert.match(source, /platform_layouts/);
  assert.match(source, /platform_reports/);
  assert.match(source, /platform_approval_processes/);
  assert.match(source, /FIELD_HAS_VALUES/);
  assert.match(source, /OBJECT_IN_USE/);
  assert.match(source, /platform_record_associations/);
});

test("platform metadata supports deactivation and tenant ownership", () => {
  assert.match(platformSchema, /company_id UUID REFERENCES companies\(id\)/);
  assert.match(platformSchema, /active BOOLEAN NOT NULL DEFAULT TRUE/);
  assert.match(platformSchema, /ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS active/);
  assert.match(platformSchema, /ALTER TABLE platform_relationships ADD COLUMN IF NOT EXISTS active/);
});

test("platform object editor is wired to authenticated metadata APIs", () => {
  const editor = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectEditor.jsx", import.meta.url), "utf8");
  const fieldEditor = fs.readFileSync(new URL("../src/pages/settings/Platform/FieldEditor.jsx", import.meta.url), "utf8");
  const list = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectList.jsx", import.meta.url), "utf8");
  const home = fs.readFileSync(new URL("../src/pages/settings/PlatformAdmin.jsx", import.meta.url), "utf8");
  assert.match(editor, /\/api\/platform\/objects/);
  assert.match(fieldEditor, /\/api\/platform\/fields/);
  assert.match(editor, /Description/);
  assert.match(fieldEditor, /FIELD_TYPES/);
  assert.match(fieldEditor, /active/);
  assert.match(list, /onNavigate/);
  assert.match(home, /ObjectEditor/);
  assert.match(home, /ObjectList/);
});

test("platform relationship editor is integrated with relationship APIs", () => {
  const editor = fs.readFileSync(new URL("../src/pages/settings/Platform/RelationshipEditor.jsx", import.meta.url), "utf8");
  const list = fs.readFileSync(new URL("../src/pages/settings/Platform/RelationshipList.jsx", import.meta.url), "utf8");
  const home = fs.readFileSync(new URL("../src/pages/settings/PlatformAdmin.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(editor, /```/);
  assert.match(editor, /apiRequest\("\/api\/platform\/objects"/);
  assert.match(editor, /relationshipKey/);
  assert.match(editor, /relationshipType/);
  assert.match(editor, /method: isNew \? "POST" : "PUT"/);
  assert.match(list, /\/api\/platform\/relationships/);
  assert.match(list, /method: "DELETE"/);
  assert.match(home, /RelationshipEditor/);
  assert.match(home, /RelationshipList/);
});

test("platform ObjectPage integrates the generic metadata-driven search", () => {
  const page = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectPage.jsx", import.meta.url), "utf8");
  const search = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectSearch.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(search, /^```/);
  assert.match(page, /import ObjectSearch/);
  assert.match(page, /getFieldValue\(record, field\)/);
  assert.match(page, /filteredRecords/);
  assert.match(page, /Search records/);
});
