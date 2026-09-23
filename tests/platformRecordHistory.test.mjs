import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metadata = readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
const objectPage = readFileSync(new URL("../src/pages/settings/Platform/ObjectPage.jsx", import.meta.url), "utf8");

test("generic record history stores tenant, object, field, values, actor and timestamp", () => {
  assert.match(metadata, /CREATE TABLE IF NOT EXISTS platform_record_history/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_record_history/);
  assert.match(routes, /platform_record_history \(company_id,object_id,object_key,record_id,field_api_name,old_value,new_value,action,actor_user_id\)/);
  assert.match(routes, /records\/:recordId\/history/);
});

test("generic create, update and delete paths write history and the object page displays it", () => {
  assert.match(routes, /writeRecordHistory\(object, result\.rows\[0\]\.id, fields, null, result\.rows\[0\], "create"/);
  assert.match(routes, /writeRecordHistory\(object, result\.rows\[0\]\.id, fields, ruleCheck\.current, result\.rows\[0\], "update"/);
  assert.match(routes, /writeRecordHistory\(object, req\.params\.recordId, fields, existing\.rows\[0\], null, "delete"/);
  assert.match(objectPage, /ObjectHistory/);
  assert.match(objectPage, /records\/\$\{id\}\/history/);
});
