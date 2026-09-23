import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metadata = readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8") + readFileSync(new URL("../services/platformFieldValues.js", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/pages/settings/Platform/FieldEditor.jsx", import.meta.url), "utf8");

test("field security metadata is role and company scoped", () => {
  assert.match(metadata, /CREATE TABLE IF NOT EXISTS platform_field_security/);
  assert.match(metadata, /role_id UUID NOT NULL REFERENCES roles/);
  assert.match(metadata, /company_id UUID NOT NULL REFERENCES companies/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS platform_field_security/);
});

test("generic record reads and writes apply role field security", () => {
  assert.match(routes, /applyFieldSecurity/);
  assert.match(routes, /platform_field_security WHERE role_id=\$1 AND company_id=\$2/);
  assert.match(routes, /Field "\$\{apiName\}" is read-only/);
  assert.match(routes, /\/platform\/fields\/:fieldId\/security\/:roleId/);
});

test("field administration exposes readable and writable metadata", () => {
  assert.match(editor, /readable: true/);
  assert.match(editor, /writable: true/);
  assert.match(editor, />Readable</);
  assert.match(editor, />Writable</);
});
