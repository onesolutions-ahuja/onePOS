import { useState } from "react";
import useReportData from "./shared/useReportData.js";
import { getInventoryMovements } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";
import ReportHeader from "./ReportHeader.jsx";
import { toLocalDateString } from "./shared/quickDateRanges.js";

const MOVEMENT_TYPE_LABELS = {
  OPENING: "Opening",
  PURCHASE: "Purchase/receipt",
  SALE: "Sale",
  CUSTOMER_RETURN: "Sale return",
  SUPPLIER_RETURN: "Supplier return",
  ADJUSTMENT_IN: "Adjustment in",
  ADJUSTMENT_OUT: "Adjustment out",
  RETURN_IN: "Return in",
  RETURN_OUT: "Return out",
  ONLINE_RESERVE: "Online reserve",
  ONLINE_RELEASE: "Online release",
};

export default function StockMovementLedger({ companyId = "current", storeId = "current" }) {
  const today = toLocalDateString(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, loading, error, reload } = useReportData(
    async () => {
      const response = await getInventoryMovements({
        companyId,
        storeId,
        dateFrom: from,
        dateTo: to,
      });
      if (!response.success) throw new Error(response.message);
      return response.data || [];
    },
    [from, to, companyId, storeId],
    "Unable to load stock movements"
  );

  const rows = Array.isArray(data) ? data : [];

  const typeOptions = [
    { value: "", label: "All types" },
    ...Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];

  const [selectedType, setSelectedType] = useState("");

  const filtered = rows.filter((row) => !selectedType || row.movement_type === selectedType);

  if (loading) return <ReportTable title="Stock movement ledger" headers={["Date / time","Product","Store","Movement","Qty","Balance","Reference","Reason"]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load stock movements: {error}</div>;

  return (
    <div>
      <ReportHeader
        title="Stock movement ledger"
        subtitle="Inventory ledger movements for the selected range."
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
      />
      <div className="flex items-center gap-4 mb-3">
        <label className="text-sm text-slate-600">Movement type:</label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <ReportTable
        title="Stock movement ledger"
        exportName="stock-movements"
        headers={["Date / time","Product","Store","Movement","Qty","Balance","Reference","Reason"]}
        rows={filtered.map((row) => [
          row.created_at ? new Date(row.created_at).toLocaleString() : "-",
          row.product || "-",
          row.store || "-",
          MOVEMENT_TYPE_LABELS[row.movement_type] || row.movement_type || "-",
          row.quantity_change != null ? String(row.quantity_change) : "-",
          row.balance_after != null ? String(row.balance_after) : "-",
          row.reference_text || row.reference_type || "-",
          row.reason || "-",
        ])}
      />
    </div>
  );
}
