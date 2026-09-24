import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Compact SFDC-style Form Builder (LayoutEditor) — presentation contract.
 *
 * The builder is a UX refactor of the existing Platform layout editor: the same
 * sections/components/definition payload, the same drag/drop and preview, the
 * same diagnostics. These tests pin the three-pane presentation, the selection
 * model, the add-field picker semantics and the shared-token discipline so the
 * UI cannot silently regress back to an everything-inline form.
 */

const EDITOR = readFileSync(
  new URL("../src/pages/settings/Platform/LayoutEditor.jsx", import.meta.url),
  "utf8",
);

test("builder is a compact three-pane layout: palette / canvas / properties", () => {
  assert.match(EDITOR, /className="pfb-panel"/);
  assert.match(EDITOR, /className="pfb-canvas"/);
  assert.match(EDITOR, /className="pfb-properties"/);
  assert.match(EDITOR, /\.pfb-body\s*\{[\s\S]*?grid-template-columns: 226px minmax\(0, 1fr\) 284px/);
});

test("selection drives the properties panel (form / section / component)", () => {
  assert.match(EDITOR, /setSelection\(\{ kind: "form", id: "" \}\)/);
  assert.match(EDITOR, /setSelection\(\{ kind: "section", id: section\.id \}\)/);
  assert.match(EDITOR, /setSelection\(\{ kind: "component", id \}\)/);
  assert.match(EDITOR, /selection\.kind === "component"/);
  assert.match(EDITOR, /selection\.kind === "section"/);
  // Clicking a chip selects it; clicking canvas whitespace returns to form props.
  assert.match(EDITOR, /onClick=\{\(\) => setSelection\(\{ kind: "form", id: "" \}\)\}/);
});

test("field properties are only rendered for the selected field", () => {
  assert.match(EDITOR, /renderFieldProperties\(component, index\)/);
  assert.match(EDITOR, /renderSectionProperties\(\)/);
  assert.match(EDITOR, /renderFormProperties\(\)/);
  // The canvas itself renders no property inputs — only chips and the add rail.
  const canvas = EDITOR.slice(EDITOR.indexOf("function renderCanvas()"), EDITOR.indexOf("function renderPreview()"));
  assert.doesNotMatch(canvas, /<input/);
  assert.doesNotMatch(canvas, /<select/);
});

test("compact + Add rail per section opens a searchable picker", () => {
  assert.match(EDITOR, /className="pfb-add-btn"[\s\S]*?<Plus size=\{11\} aria-hidden="true" \/> Add/);
  assert.match(EDITOR, /setPickerSectionId\(section\.id\)/);
  assert.match(EDITOR, /placeholder="Search fields\.\.\."/);
  assert.match(EDITOR, /aria-label="Search fields"/);
  // The picker reuses the shared modal foundation for desktop/mobile behaviour.
  assert.match(EDITOR, /onepos-modal-overlay[\s\S]*?onepos-modal onepos-modal-md/);
  assert.match(EDITOR, /role="dialog" aria-modal="true"/);
});

test("already-placed fields stay visible, disabled and marked Already added", () => {
  assert.match(EDITOR, /const alreadyAdded = added\.has\(key\)/);
  assert.match(EDITOR, /disabled=\{alreadyAdded\}/);
  assert.match(EDITOR, /Already added/);
  // Filtering narrows the list but never removes the already-added row.
  assert.match(EDITOR, /row\.\.\.|rows\.map\(\(field\)/);
  assert.match(EDITOR, /No fields match/);
});

test("components palette offers Section, Header, Information Text, Divider, Spacer", () => {
  const registry = readFileSync(new URL("../src/pages/settings/Platform/componentRegistry.js", import.meta.url), "utf8");
  assert.match(registry, /label: "Section"/);
  assert.match(registry, /label: "Header"/);
  assert.match(registry, /label: "Information Text"/);
  assert.match(registry, /label: "Divider"/);
  assert.match(registry, /label: "Spacer"/);
  assert.match(EDITOR, /paletteComponents\(componentRegistry\)/);
});

test("real drag/drop reorders and moves between sections with a drop indicator", () => {
  assert.match(EDITOR, /onDragStart/);
  assert.match(EDITOR, /onDragOver/);
  assert.match(EDITOR, /onDrop=\{\(event\) => dropComponent\(index, event\)\}/);
  assert.match(EDITOR, /onDrop=\{\(event\) => dropOnSection\(section\.id, event\)\}/);
  assert.match(EDITOR, /section_id: targetSectionId/);
  assert.match(EDITOR, /className="pfb-drop-line"/);
  assert.match(EDITOR, /function dropOnSection\(sectionId, event\)/);
});

test("the canvas shows no arrow-glyph reorder controls; ordering stays keyboard/panel accessible", () => {
  assert.doesNotMatch(EDITOR, /↑/);
  assert.doesNotMatch(EDITOR, /↓/);
  assert.match(EDITOR, /function onChipKeyDown\(event, index\)/);
  assert.match(EDITOR, /event\.altKey/);
  assert.match(EDITOR, /Move up/);
  assert.match(EDITOR, /Move down/);
});

test("field type is read-only and Field Type is not redefined on the layout", () => {
  assert.match(EDITOR, /Field type/);
  assert.match(EDITOR, /getFieldType\(field\)/);
  // "Edit Field" only appears when the host supplies the handler, so the
  // builder never invents a second field-type authority.
  assert.match(EDITOR, /typeof onEditField === "function"/);
  assert.doesNotMatch(EDITOR, /updateComponent\(index, "field_type"/);
  assert.doesNotMatch(EDITOR, /updateComponent\(index, "fieldType"/);
});

test("visibility condition uses the shared condition shape and operator vocabulary", () => {
  assert.match(EDITOR, /visibilityCondition/);
  assert.match(EDITOR, /conditions: working/);
  assert.match(EDITOR, /match: component\.visibilityCondition\?\.match \|\| "all"/);
  assert.match(EDITOR, /updateComponent\(index, "visibilityCondition", condition\?\.conditions\?\.length \? condition : null\)/);
  for (const operator of ["equals", "not_equals", "is_empty", "is_not_empty"]) {
    assert.ok(EDITOR.includes(operator), `expected operator ${operator}`);
  }
});

test("field security is presented as read-only metadata, not a second permission system", () => {
  assert.match(EDITOR, /Field Security/);
  assert.match(EDITOR, /View \/ Configure/);
  assert.match(EDITOR, /Security is defined on the field metadata\. Placing a field on a form cannot grant access to it\./);
  assert.doesNotMatch(EDITOR, /api\/platform\/permissions/);
});

test("existing builder functionality is preserved: preview, sections, columns, diagnostics, related lists, actions", () => {
  assert.match(EDITOR, /<FormRenderer/);
  assert.match(EDITOR, /diagnoseFormDefinition/);
  assert.match(EDITOR, /Add Section/);
  assert.match(EDITOR, /Columns/);
  assert.match(EDITOR, /Read-only/);
  assert.match(EDITOR, /Required/);
  assert.match(EDITOR, /type: "related_list"/);
  assert.match(EDITOR, /sort_field/);
  assert.match(EDITOR, /sort_direction/);
  assert.match(EDITOR, /type: "action"/);
  assert.match(EDITOR, /run_workflow/);
  assert.match(EDITOR, /call_function/);
  assert.match(EDITOR, /sections:/);
  assert.match(EDITOR, /pageType: form\.page_type/);
});

test("builder composes the shared design system and hard-codes no presentation", () => {
  assert.match(EDITOR, /onepos-alert onepos-alert-error/);
  assert.match(EDITOR, /onepos-btn onepos-btn-sm onepos-btn-primary/);
  assert.match(EDITOR, /onepos-input/);
  assert.match(EDITOR, /onepos-badge onepos-badge-neutral/);
  assert.match(EDITOR, /var\(--border-color\)/);
  assert.match(EDITOR, /var\(--primary-color\)/);
  assert.match(EDITOR, /var\(--card-background\)/);
  assert.match(EDITOR, /var\(--text-primary\)/);
  assert.match(EDITOR, /var\(--text-secondary\)/);
  assert.match(EDITOR, /var\(--muted-background\)/);
  // No literal colour anywhere in the editor (style block included).
  assert.doesNotMatch(EDITOR, /#[0-9a-fA-F]{3,6}\b/);
  assert.doesNotMatch(EDITOR, /rgb\(/);
  // No preset branching inside the builder.
  assert.doesNotMatch(EDITOR, /data-onepos-preset/);
  // One icon library only.
  const iconImports = EDITOR.match(/from "lucide-react"/g) || [];
  assert.equal(iconImports.length, 1);
});
