import QuickDateRange from "./shared/QuickDateRange.jsx";

/**
 * Shared report header: page title + description + the date-range controls.
 *
 * Presentation only — props, state and the run/date callbacks are unchanged.
 * Uses the shared primitives so the header follows the selected preset
 * (page gap, control height, radius) and appearance (surface/text tokens)
 * instead of carrying its own fixed margin, control-height and accent literals.
 */
export default function ReportHeader({
  from,
  to,
  onFromChange,
  onToChange,
  onRun,
  title = "Reports",
  subtitle = "Live sales, product and payment reporting.",
  showQuickRange = true,
}) {
  return (
    <div className="onepos-page-header">
      <div>
        <h1 className="onepos-page-title">{title}</h1>
        <p className="onepos-page-subtitle">{subtitle}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {showQuickRange && (
          <QuickDateRange from={from} to={to} onFromChange={onFromChange} onToChange={onToChange} />
        )}
        <div className="flex items-end gap-2">
          <label className="text-xs text-slate-500">
            From
            <input
              type="date"
              value={from}
              onChange={(event) => onFromChange(event.target.value)}
              className="onepos-input w-auto mt-1"
            />
          </label>
          <label className="text-xs text-slate-500">
            To
            <input
              type="date"
              value={to}
              onChange={(event) => onToChange(event.target.value)}
              className="onepos-input w-auto mt-1"
            />
          </label>
          {onRun && (
            <button onClick={onRun} className="onepos-btn onepos-btn-primary">
              Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
