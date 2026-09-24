import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const PICKER = fs.readFileSync(new URL("../src/pages/settings/Platform/PlatformFieldPicker.jsx", import.meta.url), "utf8");
const TEMPLATES = fs.readFileSync(new URL("../src/pages/settings/MessageTemplatesAdmin.jsx", import.meta.url), "utf8");
const WORKFLOW = fs.readFileSync(new URL("../src/pages/settings/Platform/WorkflowAdmin.jsx", import.meta.url), "utf8");
const PLATFORM_ROUTE = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

test("shared picker loads existing Platform objects and fields", () => {
  assert.match(PICKER, /apiRequest\("\/api\/platform\/objects"\)/);
  assert.match(PICKER, /\/api\/platform\/objects\/\$\{encodeURIComponent\(objectId\)\}\/fields/);
  assert.match(PICKER, /field\.readable !== false/);
  assert.match(PICKER, /const objectId = object\.id \|\| object\.object_id/);
  assert.match(PICKER, /Unknown field:/);
  assert.match(PLATFORM_ROUTE, /const fields = await applyFieldSecurity\(db, result\.rows, req\)/);
});

test("message templates use related object metadata and cursor token insertion", () => {
  assert.match(TEMPLATES, /PlatformFieldPicker includeObjectSelector/);
  assert.match(TEMPLATES, /selectionStart/);
  assert.match(PICKER, /`\{\{\$\{key\}\}\}`/);
  assert.match(TEMPLATES, /subjectRef/);
  assert.match(TEMPLATES, /bodyRef/);
  assert.match(TEMPLATES, /objectId/);
  assert.match(PICKER, /function selectObject\(nextKey\)/);
  assert.match(PICKER, /onObjectChange\?\.\(canonicalKey, selected\?\.id \|\| selected\?\.object_id/);
  assert.match(PICKER, /onChange\?\.\(""\)/);
  assert.match(TEMPLATES, /setShowEditor\(true\)/);
  assert.match(TEMPLATES, /object\?\.object_key \|\| object\?\.objectKey/);
});

test("workflow conditions and mappings use the shared object-aware picker", () => {
  assert.match(WORKFLOW, /StepConditionEditor[\s\S]*PlatformFieldPicker/);
  assert.match(WORKFLOW, /includeObjectSelector selectedObjectKey=\{step\.config\?\.object/);
  assert.match(WORKFLOW, /Target field/);
  assert.match(WORKFLOW, /label="Source value"/);
  assert.match(WORKFLOW, /Insert message field/);
  assert.match(WORKFLOW, /Trigger object/);
});

test("workflow administration opens to a list and preserves the existing builder behind New/Edit", () => {
  assert.match(WORKFLOW, /const \[showBuilder, setShowBuilder\] = useState\(false\)/);
  assert.match(WORKFLOW, /\+ New Workflow/);
  assert.match(WORKFLOW, /setShowBuilder\(true\)/);
  assert.match(WORKFLOW, /onClick=\{\(\) => setShowBuilder\(false\)\}/);
});
