/**
 * Report summary KPI row.
 *
 * Presentation only — the labels and values are unchanged. Cards now use the
 * shared stat primitive, so padding/radius/shadow follow the preset and the
 * surfaces follow appearance.
 */
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
    <div className="grid grid-cols-6 gap-3" style={{ marginBottom: "var(--onepos-section-gap, 20px)" }}>
      {cards.map(([label, value]) => (
        <div key={label} className="onepos-stat">
          <div className="onepos-stat-label">{label}</div>
          <div className="onepos-stat-value">
            {typeof value === "number" && label === "Gross sales" ? `£${value.toFixed(2)}` : value}
          </div>
        </div>
      ))}
    </div>
  );
}
