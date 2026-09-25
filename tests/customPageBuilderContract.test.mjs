import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/* Shared renderer contract: builder and runtime MUST consume the same renderer. */
test("builder and runtime render the same shared component renderer", () => {
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  const runtime = read("src/components/CustomPageRuntime.jsx");
  assert.match(renderer, /export default function CustomPageRenderer/);
  assert.match(builder, /components\/platform\/CustomPageRenderer\.jsx"/);
  assert.match(runtime, /from "\.\/platform\/CustomPageRenderer\.jsx"/);
  // Both host the renderer with a definition prop — one metadata tree, two modes.
  assert.match(builder, /<CustomPageRenderer/);
  assert.match(runtime, /<CustomPageRenderer/);
});

/* Registry-driven palette — no second hard-coded component list. */
test("palette is populated from the component registry", () => {
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  assert.match(builder, /component-registry/);
  assert.match(builder, /FALLBACK_COMPONENT_REGISTRY/);
});

/* MultiContainer + Container exist in the canonical registry. */
test("multi container and container are registered components", () => {
  const registry = read("services/platformComponentRegistry.js");
  assert.match(registry, /key: "multi_container"/);
  assert.match(registry, /key: "container"/);
});

/* Record Collection: no embedded SQL inside components — one runtime endpoint. */
test("record collections run through one platform record endpoint with permission gate", () => {
  const routes = read("routes/platform.js");
  assert.match(routes, /\/platform\/runtime\/record-collection/);
  assert.match(routes, /hasPlatformObjectPermission\(db, req, object\.id, "view"\)/);
  assert.match(routes, /appendSystemReadScope\(object, req, clauses, params\)/);
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  assert.match(renderer, /\/api\/platform\/runtime\/record-collection/);
  assert.doesNotMatch(renderer, /SELECT .* FROM/i, "no SQL in the visual component");
});

/* Condition engine reuse — collection conditions use the canonical vocabulary. */
test("collection conditions reuse the canonical condition vocabulary", () => {
  const tree = read("src/pages/settings/Platform/customPageTree.js");
  for (const operator of ["equals", "not_equals", "greater_than", "less_than", "is_empty", "is_not_empty"]) {
    assert.ok(tree.includes(`"${operator}"`), `operator ${operator} whitelisted`);
  }
});

/* Workflow picker: searchable, object-prioritised, UUID-persisted, + in-screen. */
test("workflow picker searches existing workflows and prioritises object compatibility", () => {
  const picker = read("src/pages/settings/Platform/ActionWorkflowPicker.jsx");
  assert.match(picker, /platform\/rules/);
  assert.match(picker, /Search workflows/);
  assert.match(picker, /compatible/);
  assert.match(picker, /workflowUuid: String\(workflow\.id\)/, "stores the UUID, not the name");
  assert.match(picker, /aria-label="New workflow"/);
  assert.match(picker, /from "\.\/WorkflowAdmin\.jsx"/, "reuses the existing Workflow Builder surface");
});

/* Builder does not navigate away and preserves unsaved state. */
test("page builder keeps unsaved state and saves through the existing pages API", () => {
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  assert.match(builder, /\/api\/platform\/pages\//);
  assert.match(builder, /undoStack/);
  assert.match(builder, /redoStack/);
  assert.match(builder, /"desktop", "tablet", "mobile"/);
  assert.match(builder, /setPreview/);
});

/* Runtime click supplies record_uuid and dispatches the configured interaction. */
test("runtime dispatches clicks with record context through canonical endpoints", () => {
  const runtime = read("src/components/CustomPageRuntime.jsx");
  assert.match(runtime, /record\?\.id \|\| null/);
  assert.match(runtime, /page-interactions\/execute/);
  assert.match(runtime, /runtime-forms/);
  assert.match(runtime, /buildCustomPagePath/);
});

/* Server-side whitelist accepts the nested tree. */
test("page definition normalizer whitelists the nested tree shape", () => {
  const navigation = read("services/platformObjectNavigation.js");
  assert.match(navigation, /pageTree = true/);
});

/* Platform nav exposes the visual builder as a full-width surface. */
test("platform admin registers the visual custom page builder surface", () => {
  const nav = read("src/pages/settings/Platform/platformNav.js");
  assert.match(nav, /custom-page-builder/);
  const admin = read("src/pages/settings/PlatformAdmin.jsx");
  assert.match(admin, /CustomPageBuilder/);
  assert.match(admin, /custom-page-builder/);
});

/* Theme rules: renderer and builder use shared tokens only. */
test("custom pages inherit the global onePOS design tokens", () => {
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  assert.match(renderer, /onepos-card/);
  assert.match(renderer, /onepos-btn/);
  assert.match(renderer, /var\(--/);
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  assert.match(builder, /onepos-btn/);
  assert.match(builder, /var\(--/);
});

/* Builder-only controls never reach runtime mode. */
test("builder controls are gated behind builder mode", () => {
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  assert.match(renderer, /builderMode/);
  const runtime = read("src/components/CustomPageRuntime.jsx");
  assert.match(runtime, /builderMode=\{false\}/);
});

/* ================================================================
   BATCH 2 — architecture contracts for pagination, canonical
   conditions, record-less workflow execution and Table/List.
   ================================================================ */

test("one record-collection datasource serves every record-bound component", () => {
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  // One exported hook; the Table and MultiContainer both receive hook state.
  assert.match(renderer, /export function useRecordCollection/);
  assert.match(renderer, /function TableView/);
  assert.match(renderer, /function MultiContainerView/);
  assert.doesNotMatch(renderer, /\/api\/platform\/objects\/.*\/records\?/, "no second datasource path in components");
});

test("record collection endpoint evaluates canonical conditions and reports totals", () => {
  const routes = read("routes/platform.js");
  assert.match(routes, /validateConditionConfig\(\{ match: conditionMatch, conditions \}, fields, "Record Collection conditions"\)/);
  assert.match(routes, /IS DISTINCT FROM/);
  assert.match(routes, /COUNT\(\*\)::int AS total/);
  assert.match(routes, /total: count\.rows\[0\]\?\.total \|\| 0/);
});

test("one page-interactions endpoint executes workflows and actions with optional record", () => {
  const routes = read("routes/platform.js");
  assert.match(routes, /\/platform\/runtime\/page-interactions\/execute/);
  assert.match(routes, /executeWorkflowActions\(\{/);
  assert.match(routes, /triggerKey: "page_interaction"/);
  assert.match(routes, /record: null|recordId: record\?\.id \|\| null/);
  // Action Registry enforcement stays in the same place.
  assert.match(routes, /listRegisteredPlatformActions\(\)\.find\(\(item\) => item\.key === actionKey\)/);
  assert.match(routes, /hasExecutionPermission\(req, requiredPermission\)/);
});

test("runtime dispatches every click through the one interaction endpoint", () => {
  const runtime = read("src/components/CustomPageRuntime.jsx");
  assert.match(runtime, /page-interactions\/execute/);
  assert.match(runtime, /executeInteraction\(\{ type: "workflow", objectKey: null, recordId: null, interaction \}\)/, "buttons run workflows without a bound record");
  assert.doesNotMatch(runtime, /buttons\/\$\{encodeURIComponent\(workflowUuid\)\}\/execute/, "the per-record button path is retired for page interactions");
});

test("table is a registered record-bound component with builder support", () => {
  const registry = read("services/platformComponentRegistry.js");
  assert.match(registry, /key: "table", label: "Table \/ List", category: "record", kind: "record", bindable: true, recordBound: true/);
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  assert.match(builder, /function TableProperties/);
  assert.match(builder, /function RecordCollectionDataGroup/, "one shared collection config for MultiContainer and Table");
});

test("collection condition editors use the canonical operator vocabulary", () => {
  const builder = read("src/pages/settings/Platform/CustomPageBuilder.jsx");
  assert.match(builder, /import \{ CONDITION_OPERATORS \} from "\.\/conditionOperators\.jsx?"/);
  assert.match(builder, /Match ALL/);
  assert.match(builder, /Match ANY/);
  const tree = read("src/pages/settings/Platform/customPageTree.js");
  assert.match(tree, /conditionMatch/);
});

test("pagination is client state over the same collection request", () => {
  const renderer = read("src/components/platform/CustomPageRenderer.jsx");
  assert.match(renderer, /Previous page/);
  assert.match(renderer, /Next page/);
  assert.match(renderer, /offset: \(clampedPage - 1\) \* maxRecords/);
});
