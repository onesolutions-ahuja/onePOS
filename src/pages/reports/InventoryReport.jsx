import useReportData from "./shared/useReportData.js";
import { getInventory } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

export default function InventoryReport() {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getInventory();
      if (!response.success) throw new Error(response.message);
      return response.data || [];
    },
    [],
    "Unable to load inventory report"
  );

  const movements = data || [];

  if (loading) return <ReportTable title="Inventory movements" headers={["Date", "Product", "Store", "Type", "Qty", "Balance", "Reason"]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load inventory: {error}</div>;

  return (
    <ReportTable
      title="Inventory movements"
      exportName="inventory"
      headers={["Date", "Product", "Store", "Type", "Qty", "Balance", "Reason"]}
      rows={movements.map((row) => [
        row.created_at ? new Date(row.created_at).toLocaleDateString() : "-",
        row.product || "-",
        row.store_name || "-",
        row.movement_type || "-",
        row.quantity_change || 0,
        row.balance_after || 0,
        row.reason || "-",
      ])}
    />
  );
}
