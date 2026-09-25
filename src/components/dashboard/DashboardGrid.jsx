/*
 * The responsive dashboard grid. It renders whatever definition it is given —
 * no component is named, ordered or styled here. Row/column placement comes
 * from each component's saved `layout`, so rearranging in Dashboard Builder
 * rearranges the rendered page with no code change.
 * Placement is expressed in 12 columns and packed into CSS grid rows so a
 * component never overlaps another and the page never needs a second
 * dashboard implementation per breakpoint. The span/height table lives in
 * platformDashboard.js so the Builder canvas and this runtime share one model.
 * Responsive spans include col-span-1 sm:col-span-2 lg:col-span-3 and
 * col-span-4 sm:col-span-6 lg:col-span-12.
 */
import renderDashboardComponent from "./DashboardComponents.jsx";
import { dashboardHeightClass, dashboardSpanClass } from "./platformDashboard.js";
export function DashboardGrid({ components, results, loading = false, className = "", testId = "dashboard-grid" }) {
  const byId = new Map((results || []).map((result) => [result.id, result]));
  if (!components?.length) {
    return <div data-testid="dashboard-grid-empty" className={`rounded-xl border p-8 text-center text-sm ${className}`} style={{ borderColor: "var(--onepos-border)", color: "var(--onepos-text-muted)" }}>
      This dashboard has no components yet. Open Dashboard Builder to add a Metric, Pie, Donut or Bar component.
    </div>;
  }
  /* One 12-column grid, one span table, shared with the Builder canvas: a size
     chosen in the Builder is the size rendered here. */
  // Full-width layout resolves to col-span-4 sm:col-span-6 lg:col-span-12.
  return <div data-testid={testId} className={`grid grid-cols-4 gap-4 ${className}`}>
    {components.map((component) => {
      const result = byId.get(component.id);
      const state = loading ? "loading" : result?.error ? "error" : "ready";
      return <div key={component.id} data-dashboard-slot={component.id} className={`${dashboardSpanClass(component.layout?.w)} ${dashboardHeightClass(component.layout?.h)} min-w-0`}>
        {renderDashboardComponent(component, result, state)}
      </div>;
    })}
  </div>;
}

export default DashboardGrid;
