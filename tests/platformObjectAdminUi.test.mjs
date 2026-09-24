import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isStandardObject,
  objectType,
  objectTypeLabel,
  objectTypeDescription,
} from "../src/utils/platformObjectType.js";

/*
 * Platform Objects administration UI (compact SFDC-style cleanup).
 *
 * These pin the PRESENTATION contract only: classification, the object list
 * toolbar/filters, the object configuration header + tab rail, the fields
 * table, and the Forms list. None of them pin business behaviour, which is
 * unchanged and still owned by the existing routes and PlatformAdmin.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const objectList = read("src/pages/settings/Platform/ObjectList.jsx");
const objectEditor = read("src/pages/settings/Platform/ObjectEditor.jsx");
const layoutList = read("src/pages/settings/Platform/LayoutList.jsx");
const platformAdmin = read("src/pages/settings/PlatformAdmin.jsx");
const objectTypeUtil = read("src/utils/platformObjectType.js");

/* ------------------------------------------- 1. standard vs custom objects */

test("objects are classified from existing metadata, not from a new flag", () => {
  assert.equal(isStandardObject({ source_table: "products" }), true);
  assert.equal(isStandardObject({ package_id: "pkg-1" }), true);
  assert.equal(isStandardObject({ object_key: "customer", source_table: null, package_id: null }), false);
  assert.equal(isStandardObject(null), false);
  assert.equal(isStandardObject(undefined), false);

  assert.equal(objectType({ source_table: "sales" }), "standard");
  assert.equal(objectType({}), "custom");
  assert.equal(objectTypeLabel({ source_table: "sales" }), "Standard");
  assert.equal(objectTypeLabel({}), "Custom");
  assert.match(objectTypeDescription({ source_table: "sales" }), /onePOS/);
  assert.match(objectTypeDescription({}), /company/);
});

test("classification is presentation only and decides nothing else", () => {
  // No permission, deletion or routing decision may live in the classifier.
  // Comments are stripped first: the header deliberately explains what the
  // helper is NOT allowed to decide.
  const code = objectTypeUtil
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.doesNotMatch(code, /permission|delete|canManage|navigate|active/);
  assert.equal((code.match(/export function/g) || []).length, 4);
});

/* ------------------------------------------------------- 2. the object list */

test("the object list is compact, searchable and filterable by type and status", () => {
  assert.match(objectList, /placeholder="Search objects\.\.\."/);
  assert.match(objectList, /aria-label="Search objects"/);
  assert.match(objectList, /value: "standard", label: "Standard"/);
  assert.match(objectList, /value: "custom", label: "Custom"/);
  assert.match(objectList, /aria-label="Filter by object type"/);
  assert.match(objectList, /aria-label="Filter by status"/);
  assert.match(objectList, /value: "active", label: "Active"/);
  assert.match(objectList, /value: "inactive", label: "Inactive"/);
  assert.match(objectList, /onepos-btn onepos-btn-sm onepos-btn-primary/);
  assert.match(objectList, /New Object/);
});

test("each object row shows label, API name, type, status and existing metadata", () => {
  for (const heading of ["Object", "API Name", "Type", "Module", "Status"]) {
    assert.match(objectList, new RegExp(`<th[^>]*>${heading}</th>`), `${heading} column missing`);
  }
  assert.match(objectList, /objectTypeLabel\(object\)/);
  assert.match(objectList, /objectTypeDescription\(object\)/);
  assert.match(objectList, /getModuleName\(object\)/);
  assert.match(objectList, /\{active \? "Active" : "Inactive"\}/);
});

test("the object list offers no delete affordance, because the backend owns that rule", () => {
  assert.doesNotMatch(objectList, /Delete/);
});

test("the list keeps Open and Configure as the two existing row actions", () => {
  assert.match(objectList, /navigate\("view-object", object\)/);
  assert.match(objectList, /navigate\("edit-object", object\)/);
});

/* ---------------------------------------- 3. object detail header and tabs */

test("object configuration uses a compact header with type and API name", () => {
  assert.match(objectEditor, /onepos-page-title/);
  assert.match(objectEditor, /API: <code>/);
  assert.match(objectEditor, /objectTypeLabel\(form\)/);
  assert.match(objectEditor, /"onepos-badge "\s*\n?\s*\+ \(typeLabel === "Standard" \? "onepos-badge-neutral" : "onepos-badge-info"\)/);
  assert.match(objectEditor, /"onepos-badge "\s*\n?\s*\+ \(objectActive \? "onepos-badge-success" : "onepos-badge-warning"\)/);
  assert.match(objectEditor, /onepos-card pobj-detail-header/);
});

test("object configuration exposes a tab rail of configuration and existing tools", () => {
  assert.match(objectEditor, /role="tab"[\s\S]{0,200}aria-selected=\{activeTab === tab\.key\}/);
  assert.match(objectEditor, /onepos-tab/);
  assert.match(objectEditor, /onepos-tab-active/);

  // Configuration that genuinely lives on this screen.
  assert.match(objectEditor, /key: "details", label: "Details"/);
  assert.match(objectEditor, /key: "fields", label: "Fields & Relationships"/);
  assert.match(objectEditor, /key: "record-types", label: "Record Types"/);

  // Existing Platform tools, opened through the unchanged onNavigate contract.
  assert.match(objectEditor, /key: "relationships", label: "Relationships"/);
  assert.match(objectEditor, /key: "layouts", label: "Forms"/);
  assert.match(objectEditor, /key: "rules", label: "Validation Rules"/);

  assert.match(objectEditor, /onNavigate\?\.\("records"\)/);
  assert.match(objectEditor, /onNavigate\?\.\("relationships"\)/);
  assert.match(objectEditor, /onNavigate\?\.\("layouts"\)/);
  assert.match(objectEditor, /onNavigate\?\.\("rules"\)/);
});

test("object configuration exposes the supported object-scoped surfaces", () => {
  const tabBlock = objectEditor.slice(
    objectEditor.indexOf("const TOOL_TABS"),
    objectEditor.indexOf("];", objectEditor.indexOf("const TOOL_TABS")),
  );
  const declared = [...tabBlock.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(declared, [
    "Relationships",
    "Forms",
    "Page Layouts / Record Pages",
    "Validation Rules",
    "Actions",
    "Automation",
  ]);
});

test("the object editor does not fabricate metadata or a second editor", () => {
  // Field type stays schema-owned: the editor never writes it.
  assert.doesNotMatch(objectEditor, /field_type:|fieldType:/);
  assert.doesNotMatch(objectEditor, /createField|saveField|FieldSecurity/);
  assert.match(objectEditor, /import FieldEditor from "\.\/FieldEditor\.jsx"/);
  assert.doesNotMatch(objectEditor, /import LayoutEditor/);
});

/* ------------------------------------------------------ 4. the fields table */

test("the fields table is compact and keeps create/edit through the field editor", () => {
  for (const heading of ["Field", "API Name", "Type", "Required", "Status"]) {
    assert.match(objectEditor, new RegExp(`<th[^>]*>${heading}</th>`), `${heading} column missing`);
  }

  assert.match(objectEditor, /\+ Add Field/);
  assert.match(objectEditor, /onClick=\{\(\) => setEditingField\(field\)\}/);
  assert.match(objectEditor, /getFieldType\(field\)/);
  assert.match(objectEditor, /isFieldRequired\(field\)/);
  assert.match(objectEditor, /onepos-table pobj-fields-table/);
});

test("fields cannot be added before the object exists, and never inline", () => {
  assert.match(objectEditor, /disabled=\{isNew\}[\s\S]{0,400}\+ Add Field/);
  assert.match(objectEditor, /activeTab === "fields"/);
  // Every field's properties live in the shared FieldEditor, not inline.
  assert.doesNotMatch(objectEditor, /placeholder="Help Text"|Read Only<\/span>/);
});

test("record types stay scoped to the selected object", () => {
  assert.match(objectEditor, /<RecordTypeEditor object=\{\{ id: objectId \}\}/);
  assert.match(objectEditor, /activeTab === "record-types" && !isNew/);
});

/* ---------------------------------------------------------- 5. the Forms tab */

test("forms list humanises purposes and marks default and active forms", () => {
  assert.match(layoutList, /detail: "View Details"/);
  assert.match(layoutList, /quick_create: "Quick Create"/);
  assert.match(layoutList, /create: "Create"/);
  assert.match(layoutList, /edit: "Edit"/);
  assert.match(layoutList, /onepos-badge onepos-badge-success">Default/);
  assert.match(layoutList, /\{active \? "Active" : "Inactive"\}/);
  assert.match(layoutList, /aria-label="Filter forms by purpose"/);
});

test("opening a form still goes through the existing editor and endpoints", () => {
  assert.match(layoutList, /onClick=\{\(\) => onEdit\(layout\)\}/);
  assert.match(layoutList, /\/api\/platform\/layouts\?includeInactive=true/);
  assert.match(layoutList, /`\/api\/platform\/layouts\/\$\{layout\.id\}\/clone`/);
  assert.match(layoutList, /`\/api\/platform\/layouts\/\$\{layout\.id\}\/default`/);
  assert.match(layoutList, /`\/api\/platform\/layouts\/\$\{layout\.id\}\/activate`/);
  assert.match(layoutList, /method: "DELETE"/);
  assert.match(layoutList, /layout\.object_id/);
  assert.match(layoutList, /objectId = null/);
  // No second builder: the list only hands off.
  assert.doesNotMatch(layoutList, /import LayoutEditor|FormRenderer/);
});

test("the Forms entry in object configuration opens the existing layout views", () => {
  assert.match(platformAdmin, /target === "layouts"/);
  assert.match(platformAdmin, /onEdit=\{\(layout\) => navigate\("edit-layout", layout\)\}/);
  assert.match(platformAdmin, /<LayoutEditor/);
});

/* ------------------------------------------- 6. shared design system only */

test("the migrated Platform object screens use shared primitives and tokens", () => {
  const shared = {
    "ObjectList.jsx": objectList,
    "ObjectEditor.jsx": objectEditor,
    "LayoutList.jsx": layoutList,
  };

  for (const [file, source] of Object.entries(shared)) {
    assert.match(source, /onepos-page-title|onepos-card-title/, `${file} needs a shared title`);
    assert.match(source, /onepos-card/, `${file} needs the shared card`);
    assert.match(source, /onepos-btn/, `${file} needs the shared button`);
    assert.match(
      source,
      /var\(--(border-color|card-background|text-primary|text-secondary|primary-color|muted-background)/,
      `${file} must read its colours from the shared tokens`,
    );
  }

  for (const [file, source] of Object.entries(shared)) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${file} must not hard-code a hex colour`);
    assert.doesNotMatch(source, /rgb\(|rgba\(/, `${file} must not hard-code an rgb colour`);
    assert.doesNotMatch(source, /data-onepos-preset/, `${file} must not branch on the preset`);
    assert.doesNotMatch(source, /window\.history|pushState|location\.href\s*=/, `${file} must not route`);
  }
});

test("one icon library, and the shared icon chip", () => {
  assert.match(objectList, /from "lucide-react"/);
  assert.match(objectEditor, /from "lucide-react"/);
  assert.doesNotMatch(objectList, /react-icons|@heroicons|feather/);
  assert.doesNotMatch(objectEditor, /react-icons|@heroicons|feather/);
  assert.match(objectEditor, /onepos-icon-chip/);
});

test("the object and form screens stay inside the Admin boundary", () => {
  for (const [file, source] of Object.entries({ objectList, objectEditor, layoutList })) {
    assert.doesNotMatch(source, /pages\/pos|AdminNavDock/, `${file} must not touch the Till or the dock`);
  }
});
