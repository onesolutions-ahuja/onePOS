import { useMemo } from "react";
import { getQuickDateRanges } from "./quickDateRanges.js";

/**
 * Reusable quick date-range selection bar for Reports.
 *
 * Renders a compact row of preset buttons (Today, Yesterday, This Week,
 * This Month, This Quarter, Fiscal Year) that ONLY update the existing
 * From/To date picker values via the provided callbacks. It never triggers
 * a report load — the report's own Run/Refresh button stays responsible
 * for that.
 *
 * The active preset is highlighted whenever the current From/To values
 * exactly match one of the ranges; manual edits simply clear the highlight.
 *
 * @param {string}   from         Current From date ("YYYY-MM-DD").
 * @param {string}   to           Current To date ("YYYY-MM-DD").
 * @param {(value: string) => void} onFromChange Setter for the From picker.
 * @param {(value: string) => void} onToChange   Setter for the To picker.
 * @param {string}   [className]  Optional extra classes on the wrapper.
 */
export default function QuickDateRange({ from, to, onFromChange, onToChange, className = "" }) {
  // Ranges are stable for the whole calendar day, so key the memo on the
  // local date string rather than wall-clock time.
  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  }, []);
  const ranges = useMemo(() => getQuickDateRanges(), [todayKey]);

  const selectedKey = ranges.find((range) => range.from === from && range.to === to)?.key || null;

  const handleSelect = (range) => {
    onFromChange(range.from);
    onToChange(range.to);
  };

  return (
    <div className={`flex items-center gap-1 ${className}`} role="group" aria-label="Quick date range">
      {ranges.map((range) => {
        const selected = range.key === selectedKey;
        return (
          <button
            key={range.key}
            type="button"
            onClick={() => handleSelect(range)}
            title={`${range.label}: ${range.from} → ${range.to}`}
            aria-pressed={selected}
            className={`onepos-btn onepos-btn-sm ${selected ? "onepos-btn-primary" : "onepos-btn-secondary"}`}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
