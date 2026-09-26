import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("workflow builder is a drag/drop canvas backed by registered actions and shared metadata resources", () => {
  const source = read("src/pages/settings/Platform/WorkflowAdmin.jsx");
  assert.match(source, /function WorkflowCanvas/);
  assert.match(source, /application\/x-onepos-flow-element/);
  assert.match(source, /workflow-actions/);
  assert.match(source, /MetadataResourcePicker/);
});

test("approval builder uses visual metadata criteria and registered outcome actions", () => {
  const source = read("src/pages/settings/Platform/ApprovalProcessBuilder.jsx");
  assert.match(source, /MetadataResourcePicker/);
  assert.match(source, /workflow-actions/);
  assert.match(source, /draggable/);
  assert.doesNotMatch(source, /JSON\.stringify\(form\.conditions/);
});

test("form and page builder share component registry and metadata resource picker", () => {
  const source = read("src/pages/settings/Platform/PageBuilder.jsx");
  /* Both builders consume the ONE shared registry hook, which owns the
     fallback list and the single /component-registry fetch. */
  assert.match(source, /useComponentRegistry/);
  const registryModule = read("src/pages/settings/Platform/componentRegistry.js");
  assert.match(registryModule, /FALLBACK_COMPONENT_REGISTRY/);
  assert.match(source, /MetadataResourcePicker/);
  assert.match(source, /presentation_mode/);
  assert.match(source, /draggable/);
});

test("custom button builder maps inputs and visibility with metadata picker rather than raw JSON", () => {
  const source = read("src/pages/settings/Platform/LayoutEditor.jsx");
  assert.match(source, /MetadataResourcePicker/);
  assert.match(source, /Add input mapping/);
  assert.doesNotMatch(source, /JSON\.stringify\(component\.input_mappings/);
  assert.match(source, /Registered Action/);
  assert.match(source, /Workflow/);
});
