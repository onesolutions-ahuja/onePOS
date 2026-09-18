import { useState } from "react";
import useReportData from "./shared/useReportData.js";
import { getInventoryOverview } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";
import { toLocalDateString } from "./shared/quickDateRanges.js";

export default function InventoryReport() {
  const [from, setFrom] = useState(toLocalDateString(new Date()));
  const [to, setTo] = useState(toLocalDateString(new Date()));

  const { data, loading, error, reload } = useReportData(
    async () => {
      const response = await getInventoryOverview({
        dateFrom: from,
        dateTo: to,
      });
      if (!response.success) throw new Error(response.message);
      return response.data || [];
    },
    [from, to],
    "Unable to load inventory overview"
  );

  const rows = Array.isArray(data) ? data : [];

  if (loading) return <ReportTable title="Inventory overview" headers={["Product","SKU / EAN","Category","Stock","Cost","Stock value","Low stock"]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load inventory overview: {error}</div>;

  return (
    <ReportTable
      title="Inventory overview"
      exportName="inventory-overview"
      headers={["Product","SKU / EAN","Category","Stock","Cost","Stock value","Low stock"]}
      rows={rows.map((row) => [
        row.product || "-",
        (row.sku || row.ean) ? [row.sku, row.ean].filter(Boolean).join(" / ") : "-",
        row.category || "-",
        Number(row.stock_quantity) || 0,
        row.cost_price != null ? `£${Number(row.cost_price).toFixed(2)}` : "-",
        row.stock_value != null ? `£${Number(row.stock_value).toFixed(2)}` : "-",
        row.low_stock ? "Low stock" : "-",
      ])}
    />
  );
}
