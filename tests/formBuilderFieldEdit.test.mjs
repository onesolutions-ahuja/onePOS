import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Form Builder → Edit Field wiring.
 *
 * The builder's "Edit Field" action must open the EXISTING Platform field
 * editor for the exact field UUID, keep the unsaved builder mounted, and
 * refresh field metadata on return. These tests pin that integration so the
 * builder cannot silently start owning field schema again.
 */

const read = (relative) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const PLATFORM_ADMIN = read("src/pages/settings/PlatformAdmin.jsx");
const LAYOUT_EDITOR = read("src/pages/settings/Platform/LayoutEditor.jsx");
const FIELD_EDITOR = read("src/pages/settings/Platform/FieldEditor.jsx");

test("PlatformAdmin supplies onEditField to the Form Builder", () => {
  assert.match(PLATFORM_ADMIN, /<LayoutEditor[\s\S]*?onEditField=\{\(field, fieldList\) => \{/);
});

test("Edit Field reuses the existing Field editor — no second editor is introduced", () => {
  assert.match(PLATFORM_ADMIN, /import FieldEditor from "\.\/Platform\/FieldEditor\.jsx"/);
  // It is the one and only field editor render in PlatformAdmin.
  assert.equal((PLATFORM_ADMIN.match(/<FieldEditor/g) || []).length, 1);
  // The builder never renders or imports its own field editor.
  assert.doesNotMatch(LAYOUT_EDITOR, /FieldEditor/);
});

test("field identity is the UUID, not the label or api name", () => {
  // The builder only offers Edit Field when a metadata row with a UUID exists.
  assert.match(LAYOUT_EDITOR, /typeof onEditField === "function" && \(field\?\.id \|\| field\?\.field_id\)/);
  // The host re-checks and refuses to open without a UUID.
  assert.match(PLATFORM_ADMIN, /if \(!field\?\.id && !field\?\.field_id\) return;/);
  // The existing editor addresses the field by UUID on update.
  assert.match(FIELD_EDITOR, /const fieldId = field\?\.id \|\| field\?\.field_id;/);
  assert.match(FIELD_EDITOR, /: `\/api\/platform\/fields\/\$\{fieldId\}`/);
});

test("field type stays schema-owned; the builder cannot write field metadata", () => {
  assert.doesNotMatch(LAYOUT_EDITOR, /\/api\/platform\/fields/);
  assert.doesNotMatch(LAYOUT_EDITOR, /updateComponent\(index, "field_type"/);
  assert.doesNotMatch(LAYOUT_EDITOR, /updateComponent\(index, "fieldType"/);
  // Field type is rendered read-only from metadata.
  assert.match(LAYOUT_EDITOR, /getFieldType\(field\)/);
});

test("unsaved builder work survives the round trip", () => {
  // The builder is hidden rather than unmounted, and the view is never changed.
  assert.match(PLATFORM_ADMIN, /<div hidden=\{Boolean\(editingField\)\}>/);
  // The lazy boundary still exists; only its fallback moved onto the shared
  // primitives so it follows the selected preset, appearance and accent.
  assert.match(PLATFORM_ADMIN, /<Suspense fallback=\{<div className="onepos-empty"><span>Loading form builder…<\/span><\/div>\}>/);
  assert.doesNotMatch(PLATFORM_ADMIN, /p-8 text-sm text-slate-500/);
  const block = PLATFORM_ADMIN.slice(
    PLATFORM_ADMIN.indexOf('if (view === "layouts-editor")'),
    PLATFORM_ADMIN.indexOf('if (view === "layouts")'),
  );
  assert.ok(block.length > 0, "expected the layouts-editor branch");
  // Opening the field editor must not navigate: it swaps panels in place.
  const handler = block.slice(
    block.indexOf("onEditField={"),
    block.indexOf("<FieldEditor"),
  );
  assert.ok(handler.length > 0, "expected the onEditField handler");
  assert.doesNotMatch(handler, /setView\(/);
  assert.match(handler, /setEditingField\(/);
});

test("editing closes back to the same form on save or cancel", () => {
  assert.match(PLATFORM_ADMIN, /onCancel=\{\(\) => setEditingField\(null\)\}/);
  assert.match(PLATFORM_ADMIN, /onSave=\{\(\) => \{[\s\S]*?setEditingField\(null\);[\s\S]*?setFieldRefreshKey\(\(key\) => key \+ 1\);/);
});

test("field metadata is refreshed on return without reloading the form", () => {
  assert.match(LAYOUT_EDITOR, /fieldRefreshKey = 0,/);
  assert.match(LAYOUT_EDITOR, /if \(fieldRefreshKey && form\.object_id\) \{\s*loadFields\(form\.object_id\);/);
  assert.match(LAYOUT_EDITOR, /\}, \[fieldRefreshKey\]\)/);
  // The refresh reuses the existing loader, so no new endpoint is introduced.
  assert.match(LAYOUT_EDITOR, /async function loadFields\(objectId\) \{[\s\S]*?\/api\/platform\/objects\/\$\{objectId\}\/fields/);
});

test("no backend, renderer or payload changes accompany the wiring", () => {
  // The builder still speaks the same definition payload and still uses the
  // shared renderer; nothing about the schema or API moved.
  assert.match(LAYOUT_EDITOR, /pageType: form\.page_type/);
  assert.match(LAYOUT_EDITOR, /sections: form\.sections\.map/);
  assert.match(LAYOUT_EDITOR, /<FormRenderer/);
  assert.doesNotMatch(LAYOUT_EDITOR, /apiRequest\([^)]*method: "(POST|PUT|PATCH|DELETE)"[^)]*fields/);
});
