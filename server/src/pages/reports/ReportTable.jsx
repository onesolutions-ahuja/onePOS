import { exportCsv } from "../../utils/csvExport.js";

/**
 * Shared report table: titled card + table + CSV export + empty state.
 *
 * Presentation only — headers, rows and the export call are unchanged. The
 * card and table now come from the shared primitives, so row density follows
 * the preset (--onepos-table-cell-y) and the surface follows appearance.
 */
export default function ReportTable({ title, headers, rows, exportName }) {
  const handleExport = () => exportCsv(headers, rows, exportName);
  return (
    <div className="onepos-card overflow-hidden">
      <div className="onepos-card-header">
        <span className="onepos-card-title">{title}</span>
        {exportName && rows.length > 0 && (
          <button onClick={handleExport} className="onepos-btn onepos-btn-secondary onepos-btn-sm">
            Export CSV
          </button>
        )}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="onepos-table">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="onepos-empty">
          <span className="onepos-empty-title">No data for this range.</span>
        </div>
      )}
    </div>
  );
}
