import { exportCsv } from "../../utils/csvExport.js";

export default function ReportTable({ title, headers, rows, exportName }) {
  const handleExport = () => exportCsv(headers, rows, exportName);
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 border-b font-semibold flex items-center justify-between">
        <span>{title}</span>
        {exportName && rows.length > 0 && (
          <button onClick={handleExport} className="text-xs font-medium px-2 py-1 border rounded text-slate-600 hover:bg-slate-50">
            Export CSV
          </button>
        )}
      </div>
      {rows.length ? (
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50">
              {headers.map((header) => (
                <th key={header} className="text-left px-3 py-2 text-xs uppercase text-slate-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 text-sm">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="p-6 text-sm text-slate-500">No data for this range.</div>
      )}
    </div>
  );
}
