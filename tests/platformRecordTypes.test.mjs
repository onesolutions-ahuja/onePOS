import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
const objectEditor = readFileSync(new URL("../src/pages/settings/Platform/ObjectEditor.jsx", import.meta.url), "utf8");
const recordTypeEditor = readFileSync(new URL("../src/pages/settings/Platform/RecordTypeEditor.jsx", import.meta.url), "utf8");
const objectPage = readFileSync(new URL("../src/pages/settings/Platform/ObjectPage.jsx", import.meta.url), "utf8");

test("record type metadata is tenant and object scoped with nullable associations", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_record_types/);
  assert.match(schema, /object_id UUID NOT NULL REFERENCES platform_objects/);
  assert.match(schema, /company_id UUID REFERENCES companies/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_record_associations/);
  assert.match(schema, /record_type_id UUID REFERENCES platform_record_types\(id\) ON DELETE SET NULL/);
});

test("record type APIs enforce object ownership, defaults and picklist restrictions", () => {
  assert.match(routes, /\/platform\/objects\/:objectId\/record-types/);
  assert.match(routes, /platform_record_type_picklist_values/);
  assert.match(routes, /Record type does not belong to this object and company/);
  assert.match(routes, /default_values/);
  assert.match(routes, /associateRecordType/);
  assert.match(routes, /active configured options/);
  assert.match(routes, /validateRecordTypeDefaults/);
  assert.match(routes, /is_default=false WHERE object_id=\$1 AND company_id=\$2/);
});

test("record type administration and generic create form are wired to the selected object", () => {
  assert.match(objectEditor, /RecordTypeEditor/);
  assert.match(objectEditor, /<RecordTypeEditor object=\{\{ id: objectId \}\}/);
  assert.match(recordTypeEditor, /\/record-types/);
  assert.match(recordTypeEditor, /picklistRestrictions/);
  assert.match(objectPage, /creating\?\.fields/);
  assert.match(objectPage, /recordTypeId: creating\?\.childKey \? null : selectedRecordTypeId/);
});
