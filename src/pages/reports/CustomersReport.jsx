import useReportData from "./shared/useReportData.js";
import { getCustomers } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

export default function CustomersReport({ from, to }) {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getCustomers(from, to);
      if (!response.success) throw new Error(response.message);
      return response.data || [];
    },
    [from, to],
    "Unable to load customer report"
  );

  const customers = data || [];

  if (loading) return <ReportTable title="Customers" headers={["Customer", "Transactions", "Spend", "Returns", "Net spend"]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load customers: {error}</div>;

  return (
    <ReportTable
      title="Customers"
      exportName="customers"
      headers={["Customer", "Transactions", "Spend", "Returns", "Net spend"]}
      rows={customers.map((row) => [
        row.customer || "Walk-in Customer",
        row.transactions,
        `£${Number(row.spend).toFixed(2)}`,
        `£${Number(row.returns).toFixed(2)}`,
        `£${Number(row.netSpend).toFixed(2)}`,
      ])}
    />
  );
}
