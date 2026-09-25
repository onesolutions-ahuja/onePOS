import test from "node:test";
import assert from "node:assert/strict";
import { mergeDashboardFilters, validateDashboardDefinition } from "../services/dashboardBuilder.js";

test("dashboard definitions validate report components and layout", () => {
  const value = validateDashboardDefinition({
    name: "Sales",
    components: [{ type: "kpi", config: { reportId: "report-1" }, layout: { x: 1, y: 2, w: 20, h: 0 } }],
  });
  assert.equal(value.components[0].config.reportId, "report-1");
  /* Width and height are clamped and the 12-column layout is repacked, so a
     stored definition can never overlap itself. */
  assert.deepEqual(value.components[0].layout, { x: 0, y: 0, w: 12, h: 1 });
});

test("dashboard filters are merged into saved report definitions", () => {
  const value = mergeDashboardFilters({ fields: ["date"], filters: [] }, [{ field: "date", value: "today" }]);
  assert.deepEqual(value.filters, [{ field: "date", operator: "today" }]);
});

test("non-text components must reference a saved report", () => {
  assert.throws(() => validateDashboardDefinition({ name: "Broken", components: [{ type: "table", config: {} }] }));
});
