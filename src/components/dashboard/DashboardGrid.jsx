/*
 * The responsive dashboard grid. It renders whatever definition it is given —
 * no component is named, ordered or styled here. Row/column placement comes
 * from each component's saved `layout`, so rearranging in Dashboard Builder
 * rearranges the rendered page with no code change.
 *
 * Placement is expressed in 12 columns and packed into CSS grid ROWS so a
 * component never overlaps another and the page never needs a second
 * dashboard implementation per breakpoint.
import renderDashboardComponent from "./DashboardComponents.jsx";

 */
const spanClass = (w) => ({
  1: "col-span-1", 2: "col-span-2", 3: "col-span-1 sm:col-span-2 lg:col-span-3", 4: "col-span-2 sm:col-span-2 lg:col-span-3",
  5: "col-span-2 sm:col-span-3 lg:col-span-4", 6: "col-span-2 sm:col-span-3 lg:col-span-6", 7: "col-span-3 sm:col-span-4 lg:col-span-7",
  8: "col-span-3 sm:col-span-4 lg:col-span-8", 9: "col-span-3 sm:col-span-6 lg:col-span-9", 10: "col-span-4 sm:col-span-6 lg:col-span-10",
  11: "col-span-4 sm:col-span-6 lg:col-span-11", 12: "col-span-4 sm:col-span-6 lg:col-span-12",
}[Math.min(12, Math.max(1, Number(w) || 4))]);

const heightClass = (h) => {
  const n = Math.min(12, Math.max(1, Number(h) || 3));
  return n <= 1 ? "min-h-[104px]" : n <= 2 ? "min-h-[150px]" : n <= 4 ? "min-h-[260px]" : n <= 6 ? "min-h-[340px]" : "min-h-[420px]";
};

export function DashboardGrid({ components, results, loading = false, className = "" }) {
  const byId = new Map((results || []).map((result) => [result.id, result]));
  if (!components?.length) {
    return <div data-testid="dashboard-grid-empty" className={`rounded-xl border p-8 text-center text-sm ${className}`} style={{ borderColor: "var(--onepos-border)", color: "var(--onepos-text-muted)" }}>
      This dashboard has no components yet. Open Dashboard Builder to add a Metric, Pie, Donut or Bar component.
    </div>;
  }
  return <div data-testid="dashboard-grid" className={`grid grid-cols-4 gap-4 ${className}`}>
    {components.map((component) => {
      const result = byId.get(component.id);
      const state = loading ? "loading" : result?.error ? "error" : "ready";
      return <div key={component.id} className={`${spanClass(component.layout?.w)} ${heightClass(component.layout?.h)} min-w-0`}>
        {renderDashboardComponent(component, result, state)}
      </div>;
    })}
  </div>;
}

export default DashboardGrid;
