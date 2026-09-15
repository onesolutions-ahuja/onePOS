import ReportTable from "./ReportTable.jsx";

export default function SummaryCards({ report }) {
  const cards = [
    ["Gross sales", report.grossSales],
    ["Transactions", report.transactions],
    ["Average", `£${report.averageTransaction.toFixed(2)}`],
    ["VAT", `£${report.vat.toFixed(2)}`],
    ["Returns", `£${report.returns.toFixed(2)}`],
    ["Net sales", `£${report.netSales.toFixed(2)}`],
  ];

  return (
    <div className="grid grid-cols-6 gap-3 mb-5">
      {cards.map(([label, value]) => (
        <div key={label} className="bg-white border rounded-lg p-3">
          <div className="text-xs text-slate-500">{label}</div>
          <div className="font-bold mt-1">
            {typeof value === "number" && label === "Gross sales" ? `£${value.toFixed(2)}` : value}
          </div>
        </div>
      ))}
    </div>
  );
}
