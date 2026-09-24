import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const admin = readFileSync(new URL("../src/pages/settings/PlatformAdmin.jsx", import.meta.url), "utf8");
const objectList = readFileSync(new URL("../src/pages/settings/Platform/ObjectList.jsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../src/pages/settings/Platform/ObjectEditor.jsx", import.meta.url), "utf8");
const relationshipList = readFileSync(new URL("../src/pages/settings/Platform/RelationshipList.jsx", import.meta.url), "utf8");
const layoutList = readFileSync(new URL("../src/pages/settings/Platform/LayoutList.jsx", import.meta.url), "utf8");
const ruleList = readFileSync(new URL("../src/pages/settings/Platform/RuleList.jsx", import.meta.url), "utf8");

test("Platform object configuration exposes all existing metadata tools", () => {
  assert.match(editor, /Fields & Relationships/);
  assert.match(editor, /Page Layouts \/ Record Pages/);
  assert.match(editor, /Actions/);
  assert.match(editor, /Automation/);
  assert.match(editor, /onNavigate\?\.\("records"\)/);
  assert.match(editor, /onNavigate\?\.\("relationships"\)/);
  assert.match(editor, /onNavigate\?\.\("layouts"\)/);
  assert.match(editor, /onNavigate\?\.\("rules"\)/);
  assert.match(editor, /FieldEditor/);
  assert.match(editor, /Add Field/);
});

test("Object-scoped action and automation tabs reuse object rules", () => {
  assert.match(editor, /tab === "actions" \|\| tab === "automation"/);
  assert.match(editor, /onNavigate\?\.\("rules"\)/);
});

test("PlatformAdmin keeps the selected object while opening and returning from tools", () => {
  assert.match(admin, /if \(view === "object-page"\)/);
  assert.match(admin, /onBack=\{\(\) => setView\("editor"\)\}/);
  assert.match(admin, /target === "relationships"/);
  assert.match(admin, /target === "layouts"/);
  assert.match(admin, /target === "rules"/);
  assert.match(admin, /selectedObject \? "editor" : "objects"/);
  assert.match(admin, /objectId=\{selectedObject\?\.id \|\| selectedObject\?\.object_id\}/);
  assert.match(admin, /initialObjectId=\{selectedObject\?\.id \|\| selectedObject\?\.object_id \|\| ""\}/);
});

test("Platform objects expose one create action that opens ObjectEditor in create mode", () => {
  assert.match(objectList, /onClick=\{\(\) => navigate\("new-object"\)\}/);
  assert.match(admin, /if \(target === "new-object"\)/);
  assert.match(admin, /setSelectedObject\(null\)/);
  assert.match(admin, /<ObjectEditor/);
  assert.match(admin, /object=\{selectedObject\}/);
  assert.match(editor, /const isNew = !object\?\.id && !object\?\.object_id/);
  assert.match(editor, /onChange=\{\(event\) =>\s*updateField\("name", event\.target\.value\)/);
  assert.match(editor, /<input[\s\S]*?readOnly[\s\S]*?placeholder="customer"/);
  assert.doesNotMatch(objectList, /ObjectForm/);
});

test("Platform object rows keep Open and Configure as separate actions", () => {
  assert.match(objectList, /navigate\("view-object", object\)/);
  assert.match(objectList, /navigate\("edit-object", object\)/);
  assert.match(objectList, /aria-label=\{`Open \$\{getObjectName\(object\)\}`\}/);
  assert.match(objectList, /aria-label=\{`Configure \$\{getObjectName\(object\)\}`\}/);
  assert.match(admin, /target === "view-object"/);
  assert.match(admin, /target === "edit-object"/);
});

test("existing metadata lists support selected-object scoping", () => {
  assert.match(relationshipList, /objectId = null/);
  assert.match(relationshipList, /parent_object_id/);
  assert.match(relationshipList, /child_object_id/);
  assert.match(layoutList, /objectId = null/);
  assert.match(layoutList, /layout\.object_id/);
  assert.match(ruleList, /objectId = null/);
  assert.match(ruleList, /rule\.object_id/);
});
