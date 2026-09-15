export default function ReportHeader({
  from,
  to,
  onFromChange,
  onToChange,
  onRun,
  title = "Reports",
  subtitle = "Live sales, product and payment reporting.",
}) {
  return (
    <div className="flex justify-between items-end mb-5">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
      </div>
      <div className="flex items-end gap-2">
        <label className="text-xs text-slate-500">
          From
          <input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} className="block h-9 mt-1 border rounded px-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input type="date" value={to} onChange={(event) => onToChange(event.target.value)} className="block h-9 mt-1 border rounded px-2 text-sm" />
        </label>
        <button onClick={onRun} className="h-9 px-3 bg-blue-600 text-white rounded text-sm">Run</button>
      </div>
    </div>
  );
}
