/*
 * Dashboard Builder completion tests: layout, Platform Object, conditions.
 *
 * The runtime-selection path lives in dashboardRuntimeSelection.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyLayout, clampWidth, dashboardSpanClass, DASHBOARD_COLUMNS, packLayout,
  platformFieldChoices, aggregatesForFieldType, operatorsForFieldType, SUMMARY_COLUMN,
} from "../src/components/dashboard/platformDashboard.js";
import {
  validateDashboardDefinition, packLayout as serverPackLayout, clampWidth as serverClampWidth,
} from "../services/dashboardBuilder.js";
import { buildPlatformObjectQuery, validatePlatformReportDefinition } from "../services/reportableSources.js";
import { buildCustomSalesQuery, validateCustomReportDefinition } from "../routes/reports.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const BUILDER = read("../src/pages/dashboard/DashboardBuilder.jsx");
const PROPERTIES = read("../src/components/dashboard/DashboardComponentProperties.jsx");
const CANVAS = read("../src/components/dashboard/DashboardLayoutCanvas.jsx");
const ROUTER = read("../routes/dashboardBuilder.js");

const component = (id, w, h) => ({ id, type: "kpi", title: id, config: {}, layout: { x: 0, y: 0, w, h } });

/* ---- 1. drag-and-drop layout on the ONE 12-column model ---- */

test("layout packing is dense, 12 columns wide and never overlaps", () => {
  assert.equal(DASHBOARD_COLUMNS, 12);
  assert.deepEqual(packLayout([component("a", 3, 1), component("b", 3, 1), component("c", 3, 1), component("d", 3, 1)]).map((p) => [p.x, p.y]), [[0, 0], [3, 0], [6, 0], [9, 0]]);
  assert.deepEqual(packLayout([component("a", 4, 1), component("b", 4, 1), component("c", 4, 1)]).map((p) => [p.x, p.y]), [[0, 0], [4, 0], [8, 0]]);
  const wrap = packLayout([component("a", 3, 1), component("b", 3, 1), component("c", 3, 1), component("d", 3, 1), component("e", 3, 1)]);
  assert.deepEqual(wrap[4], { x: 0, y: 1, w: 3, h: 1 }, "the overflowing component wraps");
  assert.deepEqual(packLayout([component("a", 6, 3), component("b", 6, 3), component("c", 6, 1)]).map((p) => p.y), [0, 0, 3], "row height is respected");
  const seen = new Set();
  for (const placement of wrap) {
    assert.ok(placement.x + placement.w <= DASHBOARD_COLUMNS);
    for (let c = placement.x; c < placement.x + placement.w; c += 1) {
      const cell = `${placement.y}:${c}`;
      assert.equal(seen.has(cell), false, `cell ${cell} occupied twice`);
      seen.add(cell);
    }
  }
});

test("drag reordering rewrites order AND coordinates, so a reload matches", () => {
  const before = applyLayout([component("a", 3, 1), component("b", 3, 1), component("c", 3, 1)]);
  const after = applyLayout([before[2], before[0], before[1]]);
  assert.deepEqual(after.map((c) => c.id), ["c", "a", "b"]);
  assert.deepEqual(after.map((c) => c.layout), [{ x: 0, y: 0, w: 3, h: 1 }, { x: 3, y: 0, w: 3, h: 1 }, { x: 6, y: 0, w: 3, h: 1 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(after)), after, "save/reload is lossless");
});

test("resizing clamps to the grid and repacks following components", () => {
  const resized = applyLayout([component("a", 8, 2), component("b", 4, 4)]);
  assert.equal(resized[1].layout.x, 8, "8 + 4 fills the row");
  assert.equal(clampWidth(99), 12);
  assert.equal(clampWidth(0), 1);
  const grown = applyLayout([{ ...resized[0], layout: { ...resized[0].layout, w: 10 } }, resized[1]]);
  assert.deepEqual(grown[0].layout, { x: 0, y: 0, w: 10, h: 2 });
  assert.deepEqual(grown[1].layout, { x: 0, y: 2, w: 4, h: 4 }, "the next component moved down");
  assert.equal(dashboardSpanClass(10), "col-span-4 sm:col-span-6 lg:col-span-10");
});

test("the server and the Builder canvas compute identical layouts", () => {
  const cases = [
    [{ w: 4, h: 1 }, { w: 4, h: 1 }, { w: 4, h: 1 }],
    [{ w: 3, h: 1 }, { w: 3, h: 1 }, { w: 3, h: 1 }, { w: 3, h: 1 }, { w: 3, h: 1 }],
    [{ w: 10, h: 2 }, { w: 4, h: 4 }],
    [{ w: 12, h: 6 }, { w: 6, h: 1 }],
    [{ w: 99, h: 0 }, { w: 0, h: 99 }],
  ];
  for (const layouts of cases) {
    const client = packLayout(layouts);
    assert.deepEqual(serverPackLayout(layouts), client, "layouts must pack identically");
  }
  for (const value of [0, 1, 5, 12, 13, 99, null, undefined, "6"]) {
    assert.equal(serverClampWidth(value), clampWidth(value), `clampWidth(${value}) must agree`);
  }
});

test("saving a dragged layout and reloading returns the same coordinates", () => {
  const dragged = applyLayout([component("a", 3, 1), component("b", 3, 1), component("c", 6, 4)]);
  const saved = validateDashboardDefinition({
    name: "Dragged",
    components: dragged.map((e) => ({ type: e.type, title: e.title, config: { report: { fields: ["net_sales"] } }, layout: e.layout })),
  });
  assert.deepEqual(saved.components.map((c) => c.layout), dragged.map((c) => c.layout));
});

test("sizes are clamped server-side, so a hand-edited definition cannot break the grid", () => {
  const value = validateDashboardDefinition({
    name: "Layout",
    components: [{ type: "kpi", config: { report: { fields: ["net_sales"] } }, layout: { x: 99, y: 99, w: 40, h: 99 } }],
  });
  assert.deepEqual(value.components[0].layout, { x: 0, y: 0, w: 12, h: 12 });
});

test("the canvas drags and resizes with pointer + native DnD, sharing the runtime grid", () => {
  assert.match(CANVAS, /import DashboardGrid from "\.\/DashboardGrid\.jsx"/, "one grid, no second renderer");
  assert.match(CANVAS, /dashboardSpanClass/, "one span table shared with the runtime");
  assert.match(CANVAS, /onDragStart=\{\(event\) => \{ dragIndex\.current = index/);
  assert.match(CANVAS, /onDrop=/);
  assert.match(CANVAS, /reorderComponents\(components, from, to\)/);
  assert.match(CANVAS, /onPointerDown=\{\(event\) => beginResize\(event, component\.id\)\}/, "resize works with touch and pen");
  assert.match(CANVAS, /pointermove/);
  assert.match(CANVAS, /data-testid=\{`drag-handle-\$\{component\.id\}`\}/);
  assert.match(CANVAS, /data-testid=\{`resize-handle-\$\{component\.id\}`\}/);
  assert.match(CANVAS, /touch-pan-y/);
  assert.match(BUILDER, /onChange=\{\(components\) => setCurrent\(\{ \.\.\.current, components \}\)\}/, "layout is persisted");
  assert.match(BUILDER, /applyLayout\(current\.components \|\| \[\]\)/);
});

/* ---- 2. Platform Object datasource picker ---- */

test("the Object picker is metadata-driven, never a hard-coded list", () => {
  assert.match(PROPERTIES, /apiRequest\("\/api\/reports\/custom\/metadata"\)/, "reuses the reporting metadata endpoint");
  assert.match(PROPERTIES, /apiRequest\(`\/api\/reports\/custom\/platform-objects\//);
  assert.match(PROPERTIES, /response\.data\?\.platformObjects \|\| \[\]/);
  for (const name of ["customer", "product", "supplier", "invoice"]) {
    assert.equal(new RegExp(`"${name}"`).test(PROPERTIES), false, `no Object "${name}" is named in the picker`);
  }
});

test("eligible metric, grouping and condition fields come from Object metadata", () => {
  const fields = [
    { api_name: "status", label: "Status", field_type: "text", active: true, readable: true },
    { api_name: "total", label: "Total", field_type: "currency", active: true, readable: true },
    { api_name: "created", label: "Created", field_type: "datetime", active: true, readable: true },
    { api_name: "secret", label: "Secret", field_type: "currency", active: true, readable: false },
    { api_name: "gone", label: "Gone", field_type: "currency", active: false, readable: true },
  ];
  const choices = platformFieldChoices(fields);
  assert.deepEqual(choices.metricFields.map((f) => f.key), ["total", "created"], "only aggregatable, readable, active fields");
  assert.equal(choices.groupFields.some((f) => f.key === "secret"), false, "unreadable fields are never offered");
  assert.equal(choices.groupFields.some((f) => f.key === "gone"), false, "inactive fields are never offered");
  assert.deepEqual(choices.all.map((f) => f.key), ["status", "total", "created"]);
  assert.deepEqual(choices.all.map((f) => f.label), ["Status", "Total", "Created"], "labels come from metadata");
  assert.deepEqual([...aggregatesForFieldType("currency")], ["COUNT", "SUM", "AVG", "MIN", "MAX"]);
  assert.deepEqual([...aggregatesForFieldType("text")], ["COUNT"], "text cannot be SUMmed");
});

test("a Platform Object component produces a valid, executable report definition", () => {
  const object = { id: "obj-1", source_table: "service_orders", company_scoped: true, active: true };
  const fields = [
    { api_name: "status", label: "Status", field_type: "text", source_column: "status", active: true, readable: true },
    { api_name: "amount", label: "Amount", field_type: "currency", source_column: "amount", active: true, readable: true },
  ];
  const report = {
    dataSource: "platform_object", objectId: object.id,
    fields: ["status", "amount"], groupBy: ["status"],
    summaries: [{ aggregate: "SUM", field: "amount" }],
    filters: [{ field: "status", operator: "equals", value: "open" }],
    filterLogic: "all", sort: [],
  };
  assert.deepEqual(validatePlatformReportDefinition(report, object, fields).groupBy, ["status"]);
  const built = buildPlatformObjectQuery(report, object, fields, "company-a", 1000, { storeId: "store-a" });
  assert.match(built.sql, /SUM\(r\."amount"\) AS "sum_amount"/);
  assert.match(built.sql, /GROUP BY r\."status"/);
  assert.match(built.sql, /r\."status" = \$2/);
  assert.equal(built.params[0], "company-a", "company scoping is server supplied");
  assert.equal(SUMMARY_COLUMN("SUM", "amount"), "sum_amount");
});

test("an invalid Platform Object configuration is refused, not silently ignored", () => {
  const object = { id: "obj-1", source_table: "service_orders", company_scoped: true, active: true };
  const fields = [{ api_name: "status", field_type: "text", source_column: "status", active: true, readable: true }];
  assert.throws(() => validatePlatformReportDefinition({ fields: ["nope"] }, object, fields), /valid report field/);
  assert.throws(() => validatePlatformReportDefinition({ fields: ["status"], summaries: [{ aggregate: "SUM", field: "status" }] }, object, fields), /not valid/);
  assert.throws(() => validatePlatformReportDefinition({ fields: ["status"], filters: [{ field: "status", operator: "DROP" }] }, object, fields), /Invalid report filter/);
});

test("the picker keeps the saved report definition consistent with the chosen fields", () => {
  assert.match(PROPERTIES, /const selectMetric = \(value\) =>/);
  assert.match(PROPERTIES, /summaries: isPlatform \? \[\{ aggregate, field: value \}\] : \[\]/, "a Platform Object metric carries its aggregate");
  assert.match(PROPERTIES, /const selectAggregate = \(value\) =>/);
  assert.match(PROPERTIES, /summaries: \[\{ aggregate: value, field: config\.valueField \}\]/);
  assert.match(PROPERTIES, /data-testid="value-column"/, "the runtime column is surfaced");
  assert.match(PROPERTIES, /SUMMARY_COLUMN\(config\.aggregate, config\.valueField\)/);
  assert.match(ROUTER, /toLowerCase\(\)\}_\$\{summary\.field\}/, "the server returns the aliased summary column");
});

/* ---- 3. Condition / filter editor ---- */

test("the condition editor adds, edits and removes conditions with field, operator and value", () => {
  assert.match(PROPERTIES, /data-testid="add-condition"/);
  assert.match(PROPERTIES, /data-testid=\{`remove-condition-\$\{index\}`\}/);
  assert.match(PROPERTIES, /data-testid=\{`condition-\$\{index\}`\}/);
  assert.match(PROPERTIES, /aria-label="Condition field"/);
  assert.match(PROPERTIES, /aria-label="Condition operator"/);
  assert.match(PROPERTIES, /aria-label="Condition value"/);
  assert.match(PROPERTIES, /data-testid="filter-logic"/, "filter logic where the engine supports it");
  assert.match(PROPERTIES, /<option value="all">Match all<\/option>/);
  assert.match(PROPERTIES, /<option value="any">Match any<\/option>/);
  assert.match(PROPERTIES, /DASHBOARD_DATE_RANGES\.map\(\(range\) => \[range\.key, range\.label\]\)/, "date conditions use the reporting presets");
  assert.match(PROPERTIES, /operatorsForFieldType\(field\?\.type\)/, "operators are metadata driven");
});

test("operators offered by the Builder are exactly those the reporting engine accepts", () => {
  const textOperators = operatorsForFieldType("text").map(([key]) => key);
  const numberOperators = operatorsForFieldType("currency").map(([key]) => key);
  const accepted = ["equals", "not_equals", "contains", "starts_with", "is_blank", "is_not_blank", "gt", "gte", "lt", "lte", "between", "in"];
  for (const operator of [...textOperators, ...numberOperators]) {
    assert.ok(accepted.includes(operator), `${operator} must be accepted by the reporting engine`);
  }
  assert.ok(textOperators.includes("contains") && textOperators.includes("is_blank"));
  assert.ok(numberOperators.includes("between") && numberOperators.includes("gte"));
  assert.equal(numberOperators.includes("contains"), false, "numeric fields do not offer text operators");
});

test("conditions authored in the Builder execute through the reporting engine unchanged", () => {
  const definition = validateCustomReportDefinition({
    dataSource: "sales",
    fields: ["product", "net_sales"],
    groupBy: ["product"],
    sort: [{ field: "net_sales", direction: "desc" }],
    filters: [
      { field: "date", operator: "this_quarter" },
      { field: "product", operator: "in", value: ["p-1", "p-2"] },
    ],
    filterLogic: "all",
  });
  assert.equal(definition.filters.length, 2);
  const built = buildCustomSalesQuery(definition, { from: "2026-01-01", to: "2026-06-30" }, [], []);
  assert.match(built.sql, /si\.product_id = ANY\(\$4::uuid\[\]\)/, "the in-condition reaches the query");
  assert.match(built.sql, /GROUP BY p\.name/);
  assert.match(ROUTER, /\{ field: "date", operator: config\.dateRange \}/);
  assert.match(ROUTER, /mergeDashboardFilters\(definition, dashboardFilters\)/, "dashboard and component filters merge through the existing helper");
});

test("the sales datasource offers only filter fields the engine accepts", () => {
  const base = { fields: ["net_sales"] };
  assert.throws(() => validateCustomReportDefinition({ ...base, filters: [{ field: "nope", operator: "equals", value: "x" }] }), /Invalid report filter/);
  assert.throws(() => validateCustomReportDefinition({ ...base, filters: [{ field: "date", operator: "nope" }] }), /Invalid date filter/);
  assert.throws(() => validateCustomReportDefinition({ ...base, filterLogic: "maybe" }), /Invalid filter logic/);
  assert.doesNotThrow(() => validateCustomReportDefinition({ ...base, filters: [{ field: "date", operator: "this_month" }] }));
});

/* ---- end to end: builder -> configure -> layout -> preview -> save ---- */

test("preview, save and runtime all travel the same definition", () => {
  assert.match(BUILDER, /\/api\/dashboards\/run/, "preview uses the runtime endpoint");
  assert.match(BUILDER, /body: JSON\.stringify\(\{ \.\.\.\(current \|\| empty\), name/);
  assert.match(BUILDER, /method: current\?\.id \? "PUT" : "POST"/);
  assert.match(ROUTER, /router\.post\("\/dashboards\/run", authenticate, access/);
  assert.equal((ROUTER.match(/runComponent\(req, component, definition\.filters \|\| \[\]\)/g) || []).length, 2, "both endpoints share one executor");
  assert.equal((ROUTER.match(/buildCustomSalesQuery\(/g) || []).length, 1, "one query build call in the router");
  assert.equal((ROUTER.match(/buildPlatformObjectQuery\(/g) || []).length, 1);
});

test("the Builder exposes the full generic palette and properties", () => {
  assert.match(BUILDER, /DASHBOARD_COMPONENTS\.map/);
  assert.match(BUILDER, /data-testid=\{`add-component-\$\{spec\.key\}`\}/);
  for (const control of ["Data source", "Metric field", "Category / group field", "Date range", "Format", "Size", "Maximum categories", "Width", "Height", "Conditions"]) {
    assert.ok(PROPERTIES.includes(control), `Properties must expose ${control}`);
  }
});
