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
  const [selectedType, setSelectedType] = useState("");
  /* T10R: reason filter over the SAME ledger reason column. */
  const [selectedReason, setSelectedReason] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const { data, loading, error, reload } = useReportData(
    async () => {
      const response = await getInventoryMovements({
        companyId,
        storeId,
        dateFrom: from,
        dateTo: to,
        reason: selectedReason || undefined,
        productId: productFilter.trim() || undefined,
        category: categoryFilter.trim() || undefined,
        movementTypes: selectedType ? [selectedType] : [],
      });
      if (!response.success) throw new Error(response.message);
      return response.data || { rows: [], total: 0, quantity: 0, value: 0 };
    },
    [from, to, companyId, storeId, selectedType, selectedReason, productFilter, categoryFilter],
    "Unable to load stock movements"
  );

  const payload = data && Array.isArray(data.rows) ? data : { rows: Array.isArray(data) ? data : [], total: 0, quantity: 0, value: 0 };
  const rows = payload.rows;

  const typeOptions = [
    { value: "", label: "All types" },
    ...Object.entries(MOVEMENT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const reasonOptions = ["", "Wastage", "Breakage", "Other"];
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
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="text-sm text-slate-600">Movement type:
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">Reason:
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {reasonOptions.map((value) => (
              <option key={value} value={value}>{value === "" ? "All reasons" : value}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">Product:
          <input
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
            placeholder="name, SKU or barcode"
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm text-slate-600">Category:
          <input
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            placeholder="category"
            className="ml-2 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        {(payload.quantity || payload.value) ? (
          <span className="text-xs text-slate-500">
            Total qty {payload.quantity} · value {payload.value}
          </span>
        ) : null}
      </div>
      <ReportTable
        title="Stock movement ledger"
        exportName="stock-movements"
        headers={["Date / time","Product","Category","Store","Movement","Qty","Value","Balance","Reference","Reason"]}
        rows={rows.map((row) => [
          row.createdAt ? new Date(row.createdAt).toLocaleString() : (row.created_at ? new Date(row.created_at).toLocaleString() : "-"),
          row.product || "-",
          row.category || "-",
          row.storeName || row.store || "-",
          MOVEMENT_TYPE_LABELS[row.movementType || row.movement_type] || row.movementType || row.movement_type || "-",
          row.quantityChange ?? row.quantity_change ?? "-",
          row.lineValue ?? "-",
          row.balanceAfter ?? row.balance_after ?? "-",
          row.referenceType || row.reference_text || "-",
          row.reason || "-",
        ])}
      />
    </div>
  );
}
