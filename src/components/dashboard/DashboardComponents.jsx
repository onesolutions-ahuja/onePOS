/*
 * Generic dashboard component renderers.
 *
 * Nothing here knows about sales, products or payments: every component reads
 * its datasource, metric, grouping and date range from the configuration the
 * Dashboard Builder persisted. Swapping a component's report/field changes what
 * these renderers draw without changing this file.
 */
import { DASHBOARD_COMPONENTS } from "./platformDashboard.js";


const PALETTE = ["#176f6a", "#2f8a82", "#82c1bb", "#4fa69e", "#0d3b39", "#7aa7f8", "#c9a227", "#b4553f", "#6b7f3a", "#8a5fb0"];

const CURRENCY = new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatValue(value, format) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (format === "currency") return CURRENCY.format(n);
  if (format === "percent") return `${NUMBER.format(n)}%`;
  return NUMBER.format(n);
}

/* Pull the value/label a configured component should display out of whatever
   rows the reporting engine returned. */
export function seriesFrom(config, result) {
  const rows = Array.isArray(result?.data?.rows) ? result.data.rows : [];
  const valueField = config?.valueField || result?.data?.columns?.find((key) => key !== config?.labelField);
  const labelField = config?.labelField || result?.data?.columns?.find((key) => key !== valueField);
  return rows
    .map((row) => ({ label: labelField ? String(row[labelField] ?? "—") : "Total", value: Number(row[valueField]) || 0 }))
    .filter((point) => Number.isFinite(point.value));
}

function Empty({ children }) {
  return <div className="h-full min-h-[120px] flex flex-col items-center justify-center gap-1 text-center px-2" style={{ color: "var(--onepos-text-muted)" }}>
    <span className="text-sm font-medium">No data</span>
    <span className="text-xs opacity-80">{children || "Nothing recorded for this configuration yet."}</span>
  </div>;
}

function State({ state, children }) {
  if (state === "loading") return <div className="h-full min-h-[120px] rounded-lg animate-pulse" style={{ background: "var(--onepos-surface-alt)" }} />;
  if (state === "error") return <div className="h-full min-h-[120px] flex items-center justify-center text-sm text-center px-3" style={{ color: "var(--onepos-text-secondary)" }}>This component could not be loaded.</div>;
  return children;
}

function slices(points) {
  const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0);
  if (!total) return [];
  let angle = -Math.PI / 2;
  return points.map((point, index) => {
    const sweep = (Math.max(0, point.value) / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const large = sweep > Math.PI ? 1 : 0;
    const point_ = (radius, a) => `${50 + radius * Math.cos(a)} ${50 + radius * Math.sin(a)}`;
    return {
      ...point,
      color: PALETTE[index % PALETTE.length],
      d: `M 50 50 L ${point_(50, start)} A 50 50 0 ${large} 1 ${point_(50, end)} Z`,
      inner: `M 50 50 L ${point_(32, start)} A 32 32 0 ${large} 1 ${point_(32, end)} Z`,
    };
  });
}

function Legend({ arcs, config }) {
  return <ul className="mt-2 space-y-1.5 min-w-0 flex-1">
    {arcs.map((arc) => (
      <li key={arc.label} className="flex items-center gap-2 text-xs min-w-0">
        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: arc.color }} />
        <span className="truncate flex-1" style={{ color: "var(--onepos-text-primary)" }}>{arc.label}</span>
        <span className="shrink-0 tabular-nums" style={{ color: "var(--onepos-text-muted)" }}>{formatValue(arc.value, config?.format)}</span>
      </li>
    ))}
  </ul>;
}


function PieChart({ points, config, donut }) {
  if (!points.length) return <Empty />;
  const arcs = slices(points).slice(0, config?.maxCategories || 6);
  const total = arcs.reduce((sum, arc) => sum + arc.value, 0);
  return <div className="h-full flex flex-col items-center justify-center sm:flex-row gap-4">
    <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0" role="img" aria-label={donut ? "Donut chart" : "Pie chart"}>
      <title>{donut ? "Donut chart" : "Pie chart"}</title>
      {arcs.map((arc) => <path key={arc.label} d={arc.d} fill={arc.color}><title>{arc.label}: {formatValue(arc.value, config?.format)}</title></path>)}
      {donut && <path d={arcs.map((arc) => arc.inner).join(" ")} fill="var(--onepos-surface-raised)" />}
      {donut && <text x="50" y="48" textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--onepos-text-heading)">{formatValue(total, config?.format)}</text>}
      {donut && <text x="50" y="60" textAnchor="middle" fontSize="5.5" fill="var(--onepos-text-muted)">Total</text>}
    </svg>
    <Legend arcs={arcs} config={config} />
  </div>;
}

function BarChart({ points, config }) {
  if (!points.length) return <Empty />;
  const shown = points.slice(0, config?.limit || 12);
  const max = Math.max(...shown.map((point) => Math.abs(point.value)), 0);
  return <div className="h-full flex flex-col">
    <div className="flex-1 min-h-[140px] flex items-end gap-1.5 pt-2" style={{ borderBottom: "1px solid var(--onepos-border)" }}>
      {shown.map((point) => (
        <div key={point.label} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${point.label}: ${formatValue(point.value, config?.format)}`}>
          <div className="w-full rounded-t transition-[height] duration-300" style={{ height: `${max ? Math.max((Math.abs(point.value) / max) * 100, 2) : 2}%`, background: "var(--onepos-accent-600)" }} />
        </div>
      ))}
    </div>
    <div className="flex gap-1.5 mt-1.5">
      {shown.map((point) => <span key={point.label} className="flex-1 min-w-0 text-center text-[10px] truncate" style={{ color: "var(--onepos-text-muted)" }}>{point.label}</span>)}
    </div>
  </div>;
}

function MetricTile({ points, config }) {
  if (!points.length) return <Empty>Configure a datasource and metric for this KPI.</Empty>;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const lead = points[0];
  const showLead = Boolean(config?.labelField);
  const sizeClass = config?.size === "large" ? "text-3xl" : config?.size === "small" ? "text-xl" : "text-2xl";
  return <div className="h-full flex flex-col justify-center">
    {showLead && <div className="text-sm truncate" style={{ color: "var(--onepos-text-secondary)" }} title={lead.label}>{lead.label}</div>}
    <div className={`${sizeClass} font-bold tabular-nums mt-1`} style={{ color: "var(--onepos-text-heading)" }}>{formatValue(showLead ? lead.value : total, config?.format)}</div>
    {showLead && <div className="text-[11px] mt-0.5" style={{ color: "var(--onepos-text-muted)" }}>{formatValue(lead.value, config?.format)} of {formatValue(total, config?.format)}</div>}
  </div>;
}

function RecordTable({ result }) {
  const columns = Array.isArray(result?.data?.columns) ? result.data.columns : [];
  const rows = Array.isArray(result?.data?.rows) ? result.data.rows : [];
  if (!rows.length) return <Empty />;
  return <div className="h-full overflow-auto">
    <table className="w-full text-sm">
      <thead><tr>{columns.map((column) => <th key={column} className="text-left font-semibold pb-2" style={{ color: "var(--onepos-text-secondary)" }}>{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index} className="border-t" style={{ borderColor: "var(--onepos-border)" }}>{columns.map((column) => <td key={column} className="py-1.5 truncate">{String(row[column] ?? "—")}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function Card({ component, state, children }) {
  const type = component.type === "chart" ? (component.config?.chartType || "bar") : component.type;
  const spec = DASHBOARD_COMPONENTS.find((entry) => entry.key === type);
  return <section
    data-testid={`dashboard-component-${component.id}`}
    data-component-type={type}
    aria-label={component.title || spec?.label || "Dashboard component"}
    className="flex flex-col min-h-0 h-full"
    style={{ background: "var(--onepos-card-bg, var(--onepos-surface-raised))", border: "var(--onepos-card-border-width, 1px) solid var(--onepos-card-border, var(--onepos-border))", borderRadius: "var(--onepos-card-radius, 16px)", boxShadow: "var(--onepos-shadow-card, none)", padding: "var(--onepos-card-pad, 18px)" }}
  >
    {component.title ? <h2 className="text-sm font-semibold mb-3 truncate" style={{ color: "var(--onepos-text-heading)" }}>{component.title}</h2> : null}
    <div className="flex-1 min-h-0">
      <State state={state}>{children}</State>
    </div>
  </section>;
}

/*
 * The one runtime entry point shared by the Dashboard page, the Dashboard
 * Builder preview and any saved dashboard. It receives an already-validated
 * definition plus the run results, and contains no domain knowledge.
 */
export function renderDashboardComponent(component, result, state) {
  if (component.type === "text") {
    return <Card component={component} state={state}><p className="text-sm" style={{ color: "var(--onepos-text-body)" }}>{component.config?.content}</p></Card>;
  }
  const config = component.config || {};
  const points = seriesFrom(config, result);
  const type = component.type === "chart" ? (config.chartType || "bar") : component.type;
  const body = {
    kpi: <MetricTile points={points} config={config} />,
    pie: <PieChart points={points} config={config} />,
    donut: <PieChart points={points} config={config} donut />,
    bar: <BarChart points={points} config={config} />,
    table: <RecordTable result={result} />,
  }[type] || <Empty />;
  return <Card component={component} state={state}>{body}</Card>;
}

export default renderDashboardComponent;
