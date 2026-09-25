import test from "node:test";
import assert from "node:assert/strict";
import {
  SECTION_WIDTHS,
  canDropNode,
  canReorderInto,
  duplicateNodeInSections,
  findNode,
  moveNodeInSections,
  multiContainerColumns,
  normalizeCustomPageTree,
  normalizeRecordCollection,
  removeNodeFromSections,
  updateNodeInSections,
} from "../src/pages/settings/Platform/customPageTree.js";

const section = (id, width, children = []) => ({ id, width, children });
const container = (id, children = []) => ({ id, componentKey: "container", children });
const multi = (id, collection = {}) => ({ id, componentKey: "multi_container", containerSize: "medium", collection });
const text = (id) => ({ id, componentKey: "text", text: id });

/* 1 — Section can be added to the tree (canvas drop) */
test("sections can be added to an empty page tree", () => {
  const tree = normalizeCustomPageTree({ sections: [section("s1", "full")] });
  assert.equal(tree.sections.length, 1);
  assert.equal(tree.sections[0].width, "full");
});

/* 2 — Components can drop into compatible Sections */
test("components can be dropped into sections", () => {
  assert.equal(canDropNode({ parentComponentKey: null, droppedComponentKey: "multi_container" }), true);
  assert.equal(canDropNode({ parentComponentKey: null, droppedComponentKey: "button" }), true);
});

/* 3 — Invalid drops are rejected */
test("invalid parent/child drops are rejected", () => {
  // a dropped Section is only valid at the top level — never inside a parent
  assert.equal(canDropNode({ parentComponentKey: null, droppedComponentKey: "section", droppedIsSection: true }), true);
  assert.equal(canDropNode({ parentComponentKey: "container", droppedComponentKey: "section", droppedIsSection: true }), false);
  // record-bound components never nest inside themselves
  assert.equal(canDropNode({ parentComponentKey: "multi_container", droppedComponentKey: "multi_container" }), false);
});

/* 4 — Components can be reordered and moved across parents */
test("nodes can be reordered and moved between parents", () => {
  const sections = [section("s1", "full", [text("a"), text("b")]), section("s2", "half", [])];
  // reorder within the same section: b before a
  const moved = moveNodeInSections(sections, { nodeId: "b", targetParentKey: "SECTION", targetIndex: 0, targetSectionId: "s1" });
  assert.deepEqual(moved[0].children.map((node) => node.id), ["b", "a"]);
  // move across sections
  const cross = moveNodeInSections(sections, { nodeId: "a", targetParentKey: "SECTION", targetIndex: 0, targetSectionId: "s2" });
  assert.equal(cross[1].children[0].id, "a");
  assert.equal(cross[0].children.length, 1);
});

/* 5 — Full/Half/Third widths persist and render as CSS flex-basis */
test("full half third widths persist with renderable basis", () => {
  assert.equal(SECTION_WIDTHS.full.basis, "100%");
  assert.equal(SECTION_WIDTHS.half.basis, "50%");
  assert.equal(SECTION_WIDTHS.third.basis, "33.333%");
  const tree = normalizeCustomPageTree({ sections: [section("a", "half"), section("b", "third")] });
  assert.equal(tree.sections[0].width, "half");
  assert.equal(tree.sections[1].width, "third");
});

/* 6 — MultiContainer binds to any compatible Platform Object */
test("multi container binds to any platform object", () => {
  for (const objectKey of ["online_order", "customer", "product", "purchase", "reservation", "task"]) {
    const node = multi("m", { objectKey });
    const normalized = normalizeCustomPageTree({ sections: [section("s", "full", [node])] });
    assert.equal(normalized.sections[0].children[0].collection.objectKey, objectKey);
  }
});

/* 7 — Record Collection conditions persist (canonical operators only) */
test("record collection conditions persist through normalization", () => {
  const collection = normalizeRecordCollection({
    objectKey: "online_order",
    conditions: [
      { field: "status", operator: "equals", value: "NEW" },
      { field: "store_id", operator: "equals", value: "current" },
      { field: "DROP TABLE", operator: "equals", value: "x" }, // rejected
      { field: "total", operator: "greater_than_or_equal", value: 10 },
      { field: "total", operator: "nonsense", value: 1 }, // operator reset to equals
    ],
    conditionMatch: "any",
    sort: [{ field: "created_at", direction: "desc" }],
    maxRecords: 10,
    fields: ["order_number", "customer_name", "total", "status"],
  });
  assert.equal(collection.conditions.length, 4, "only the unsafe field name is rejected");
  assert.equal(collection.conditions[0].field, "status");
  assert.equal(collection.conditions[0].value, "NEW");
  assert.equal(collection.conditions[2].operator, "greater_than_or_equal", "canonical operators persist");
  assert.equal(collection.conditions[3].operator, "equals", "unknown operator falls back to equals");
  assert.equal(collection.conditionMatch, "any");
  assert.equal(collection.sort[0].field, "created_at");
  assert.equal(collection.sort[0].direction, "desc");
  assert.equal(collection.maxRecords, 10);
});

/* 8+9 — Sort and Maximum Records persist */
test("sort and maximum records persist with bounds", () => {
  const tight = normalizeRecordCollection({ maxRecords: 999 });
  assert.equal(tight.maxRecords, 50, "max records clamp to 50");
  const floor = normalizeRecordCollection({ maxRecords: 0 });
  assert.equal(floor.maxRecords, 1, "max records floor at 1");
  const fallback = normalizeRecordCollection({});
  assert.equal(fallback.maxRecords, 10, "default when absent");
});

/* 10 — Small/Medium/Large container sizes persist */
test("container size small medium large persists", () => {
  for (const size of ["small", "medium", "large"]) {
    const tree = normalizeCustomPageTree({ sections: [section("s", "full", [{ id: "m", componentKey: "multi_container", containerSize: size, collection: {} }])] });
    assert.equal(tree.sections[0].children[0].containerSize, size);
  }
  const invalid = normalizeCustomPageTree({ sections: [section("s", "full", [{ id: "m", componentKey: "multi_container", containerSize: "gigantic", collection: {} }])] });
  assert.equal(invalid.sections[0].children[0].containerSize, "medium");
});

/* 11 — MultiContainer responds to Section width */
test("multi container columns respond to section width and size", () => {
  // Half section → fewer cards; full section → more.
  assert.ok(multiContainerColumns({ sectionWidth: "half", containerSize: "large", device: "desktop" }) < multiContainerColumns({ sectionWidth: "full", containerSize: "large", device: "desktop" }));
  assert.ok(multiContainerColumns({ sectionWidth: "third", containerSize: "medium", device: "desktop" }) <= multiContainerColumns({ sectionWidth: "half", containerSize: "medium", device: "desktop" }));
  // Small cards → more columns than large cards at the same width.
  assert.ok(multiContainerColumns({ sectionWidth: "full", containerSize: "small", device: "desktop" }) > multiContainerColumns({ sectionWidth: "full", containerSize: "large", device: "desktop" }));
  // Device response.
  assert.equal(multiContainerColumns({ sectionWidth: "full", containerSize: "medium", device: "mobile" }), 1);
  assert.ok(multiContainerColumns({ sectionWidth: "full", containerSize: "medium", device: "tablet" }) < multiContainerColumns({ sectionWidth: "full", containerSize: "medium", device: "desktop" }));
});

/* 12 — Record display fields come from Object metadata (whitelisted api names) */
test("displayed fields persist only as safe api names", () => {
  const collection = normalizeRecordCollection({ objectKey: "online_order", fields: ["order_number", "total", "1; DROP TABLE users"], titleField: "order_number", subtitleField: "customer_name" });
  assert.deepEqual(collection.fields, ["order_number", "total"]);
  assert.equal(collection.titleField, "order_number");
  assert.equal(collection.subtitleField, "customer_name");
});

/* 13 — Design-time preview updates when properties change (pure-data contract) */
test("property updates re-render the same tree instance shape", () => {
  const sections = [section("s", "full", [multi("m", { objectKey: "online_order" })])];
  const updated = updateNodeInSections(sections, "m", (node) => ({ ...node, containerSize: "small" }));
  assert.equal(updateNodeInSections === updateNodeInSections, true);
  const found = findNode(updated, "m");
  assert.equal(found.node.containerSize, "small");
  assert.equal(found.parentComponentKey, null);
  assert.equal(findNode(updated, "missing"), null);
});

/* 16 — Workflow references persist by UUID, never by name */
test("interaction stores workflow uuid and whitelists keys", () => {
  const tree = normalizeCustomPageTree({
    sections: [section("s", "full", [{
      id: "m", componentKey: "multi_container", collection: { objectKey: "online_order" },
      interaction: { type: "workflow", workflowUuid: "0b9e6c1e-1111-4111-8111-111111111111", workflowLabel: "Open Order Details" },
    }])],
  });
  const node = tree.sections[0].children[0];
  assert.equal(node.interaction.type, "workflow");
  assert.equal(node.interaction.workflowUuid, "0b9e6c1e-1111-4111-8111-111111111111");
  assert.equal(node.interaction.workflowLabel, undefined, "labels are builder-only state");
});

test("form layout presentation whitelist honours canonical types", () => {
  const tree = normalizeCustomPageTree({
    sections: [section("s", "full", [{ id: "b", componentKey: "button", interaction: { type: "form_layout", formLayoutId: "lay-1", formPresentation: "compact_popup" } }])],
  });
  assert.equal(tree.sections[0].children[0].interaction.formPresentation, "compact_popup");
  const fallback = normalizeCustomPageTree({ sections: [section("s", "full", [{ id: "b", componentKey: "button", interaction: { type: "form_layout", formPresentation: "hologram" } }])] });
  assert.equal(fallback.sections[0].children[0].interaction.formPresentation, "screen_modal");
});

/* 27/29/31 — container nesting rules + reorder validation */
test("containers accept children and nesting validation applies", () => {
  assert.equal(canReorderInto({ parentComponentKey: "container", movingComponentKey: "text" }), true);
  assert.equal(canReorderInto({ parentComponentKey: "container", movingComponentKey: "container" }), true);
  assert.equal(canReorderInto({ parentComponentKey: "container", movingComponentKey: "multi_container" }), true);
  assert.equal(canReorderInto({ parentComponentKey: "multi_container", movingComponentKey: "text" }), false);
});

/* Duplicate/remove helpers used by builder controls */
test("duplicate and remove operate immutably on the tree", () => {
  const sections = [section("s", "full", [container("c", [text("t")])])];
  const duplicated = duplicateNodeInSections(sections, "c");
  assert.equal(duplicated[0].children.length, 2);
  assert.notEqual(duplicated[0].children[1].id, "c", "clone gets a fresh id");
  assert.equal(duplicated[0].children[1].children[0].id !== "t", true, "descendants get fresh ids too");
  const removed = removeNodeFromSections(duplicated, "c");
  assert.equal(removed[0].children.length, 1);
});

/* 32 — Existing pages remain compatible (legacy migration) */
test("legacy flat definitions migrate to the nested tree", () => {
  const legacy = {
    presentation_mode: "landing",
    sections: [{ id: "section-1", label: "Main", columns: 2, visible: true }],
    components: [{ id: "cmp-1", component_key: "header", label: "Hello", section_id: "section-1", width: "full", visible: true }],
  };
  const tree = normalizeCustomPageTree(legacy);
  assert.equal(tree.sections.length, 1);
  assert.equal(tree.sections[0].width, "half", "two legacy columns map to half width");
  assert.equal(tree.sections[0].children[0].componentKey, "header");
});

test("empty or malformed definitions normalize to an empty tree", () => {
  assert.deepEqual(normalizeCustomPageTree(null).sections, []);
  assert.deepEqual(normalizeCustomPageTree({ sections: "nope" }).sections, []);
});

/* ================================================================
   BATCH 2 — pagination, canonical conditions, record-less workflows,
   Table/List over the SAME Record Collection.
   ================================================================ */
import { RECORD_CONDITION_OPERATORS } from "../src/pages/settings/Platform/customPageTree.js";

test("canonical condition operator vocabulary is shared with the platform engine", () => {
  // The same operator names the server-side condition engine defines.
  assert.deepEqual([...RECORD_CONDITION_OPERATORS].sort(), [
    "equals", "greater_than", "greater_than_or_equal", "is_empty", "is_not_empty", "less_than", "less_than_or_equal", "not_equals",
  ].sort());
  // Transition operators are excluded from standing collection filters.
  for (const banned of ["changed", "changed_from", "changed_to", "changed_from_to"]) {
    assert.ok(!RECORD_CONDITION_OPERATORS.includes(banned));
  }
});

test("conditionMatch all/any persists with all as default", () => {
  assert.equal(normalizeRecordCollection({ conditionMatch: "any" }).conditionMatch, "any");
  assert.equal(normalizeRecordCollection({ conditionMatch: "all" }).conditionMatch, "all");
  assert.equal(normalizeRecordCollection({}).conditionMatch, "all");
  assert.equal(normalizeRecordCollection({ conditionMatch: "sometimes" }).conditionMatch, "all");
});

test("table nodes normalize with their own Record Collection", () => {
  const tree = normalizeCustomPageTree({
    sections: [section("s", "full", [{ id: "t1", componentKey: "table", clickable: true, collection: { objectKey: "customer", conditions: [{ field: "active", operator: "equals", value: true }], maxRecords: 20 }, interaction: { type: "none" } }])],
  });
  const node = tree.sections[0].children[0];
  assert.equal(node.componentKey, "table");
  assert.equal(node.collection.objectKey, "customer");
  assert.equal(node.collection.maxRecords, 20);
  assert.equal(node.collection.conditions[0].value, true, "boolean values persist");
});

test("table nodes accept no children like multi containers", () => {
  assert.equal(canReorderInto({ parentComponentKey: "table", movingComponentKey: "text" }), false);
  assert.equal(canReorderInto({ parentComponentKey: "container", movingComponentKey: "table" }), true);
  assert.equal(canDropNode({ parentComponentKey: null, droppedComponentKey: "table" }), true);
});

test("multi container max records still bounds the page size used for pagination", () => {
  const collection = normalizeRecordCollection({ maxRecords: 50 });
  assert.equal(collection.maxRecords, 50, "50 per page is the server maximum");
});
