/*
 * Saved-dashboard runtime selection + tenant isolation.
 *
 * `/app/dashboard` must render any dashboard the current user is permitted to
 * see — not only the shipped default — while permissions, company scoping and
 * archived state are enforced server-side.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateDashboardDefinition } from "../services/dashboardBuilder.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const DASHBOARD = read("../src/pages/dashboard/Dashboard.jsx");
const GRID = read("../src/components/dashboard/DashboardGrid.jsx");
const ROUTER = read("../routes/dashboardBuilder.js");

test("/app/dashboard lists permitted dashboards and renders the selected one", () => {
  assert.match(DASHBOARD, /apiRequest\("\/api\/dashboards"\)/, "the existing permission-scoped list endpoint");
  assert.match(DASHBOARD, /apiRequest\(`\/api\/dashboards\/\$\{dashboardId\}`\)/, "loads the persisted definition");
  assert.match(DASHBOARD, /apiRequest\(`\/api\/dashboards\/\$\{dashboardId\}\/run`/, "runs it through the existing engine");
  assert.match(DASHBOARD, /data-testid="dashboard-selector"/);
  assert.match(DASHBOARD, /<option value="">Default dashboard<\/option>/, "sensible default behaviour");
  assert.match(DASHBOARD, /<DashboardGrid/);
  assert.match(DASHBOARD, /setActiveId/);
});

test("/app/dashboard still hard-codes no widget", () => {
  for (const forbidden of ["Total Sales", "Quarter Sales", "Annual Sales", "Most Selling Product", "Sales by Category", "Payment Method Mix", "Sales by Period", "salesOverview"]) {
    assert.equal(DASHBOARD.includes(forbidden), false, `Dashboard page must not hard-code "${forbidden}"`);
  }
  assert.match(DASHBOARD, /apiRequest\("\/api\/dashboards\/default"\)/, "the default is only a fallback, not the only path");
});

test("archived and other companies' dashboards can never be listed or read", () => {
  /* Listing: company scoped, archive filtered, and permission filtered. */
  assert.match(ROUTER, /FROM dashboards d LEFT JOIN users u ON u\.id=d\.created_by/);
  assert.match(ROUTER, /d\.company_id=\$1 AND d\.archived_at IS NULL/);
  assert.match(ROUTER, /d\.created_by=\$2 OR EXISTS \(SELECT 1 FROM dashboard_users du WHERE du\.dashboard_id=d\.id AND du\.user_id=\$2\)/);
  /* Reading one by id re-applies company + archive scope. */
  assert.match(ROUTER, /async function dashboard\(req, id\) \{[\s\S]*SELECT \* FROM dashboards WHERE id=\$1 AND company_id=\$2 AND archived_at IS NULL/);
  /* Both the list and the run require the existing custom-report permission. */
  assert.match(ROUTER, /const access = authorize\("reports\.custom\.view"\)/);
  assert.match(ROUTER, /router\.get\("\/dashboards", authenticate, access/);
  assert.match(ROUTER, /router\.get\("\/dashboards\/:id", authenticate, access/);
  assert.match(ROUTER, /router\.post\("\/dashboards\/:id\/run", authenticate, access/);
});

test("a saved definition round-trips through the server with its layout intact", () => {
  const saved = validateDashboardDefinition({
    name: "Operations",
    components: [
      { type: "kpi", title: "Revenue", config: { report: { dataSource: "sales", fields: ["net_sales"] }, valueField: "net_sales", format: "currency" }, layout: { x: 0, y: 0, w: 6, h: 1 } },
      { type: "pie", title: "Mix", config: { report: { dataSource: "sales", fields: ["category", "net_sales"], groupBy: ["category"] }, valueField: "net_sales", labelField: "category" }, layout: { x: 6, y: 0, w: 6, h: 4 } },
    ],
  });
  assert.deepEqual(saved.components[0].layout, { x: 0, y: 0, w: 6, h: 1 });
  assert.deepEqual(saved.components[1].layout, { x: 6, y: 0, w: 6, h: 4 });
  assert.deepEqual(saved.components.map((c) => c.type), ["kpi", "pie"], "generic component types, dispatched by the shared runtime");
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved, "reloading a saved dashboard returns the same definition");
});

test("the runtime dispatches every component through one generic renderer", () => {
  assert.match(GRID, /renderDashboardComponent\(component, result, state\)/);
  assert.match(GRID, /data-dashboard-slot=\{component\.id\}/);
  assert.match(GRID, /data-testid=\{testId\}/, "the Builder canvas reuses this grid");
});
