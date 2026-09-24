import useReportData from "./shared/useReportData.js";
import { getProfit } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

export default function ProfitReport({ from, to }) {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getProfit(from, to);
      if (!response.success) throw new Error(response.message);
      return response.data || null;
    },
    [from, to],
    "Unable to load profit report"
  );

  const profit = data || null;

  if (loading) return <ReportTable title="Profit & Margin" headers={["Metric", "Value"]} rows={[]} />;
  if (error) return <div className="onepos-alert onepos-alert-error">Unable to load profit report: {error}</div>;
  if (!profit) return <ReportTable title="Profit & Margin" headers={["Metric", "Value"]} rows={[]} />;

  const money = (value) => `£${Number(value || 0).toFixed(2)}`;

  return (
    <ReportTable
      title="Profit & Margin"
      exportName="profit"
      headers={["Metric", "Value"]}
      rows={[
        ["Gross sales", money(profit.grossSales)],
        ["Discounts", money(profit.discounts)],
        ["Returns", money(profit.returns)],
        ["Net sales", money(profit.netSales)],
        ["Cost of goods sold", money(profit.cogs)],
        ["Gross profit", money(profit.grossProfit)],
        ["Gross margin", `${Number(profit.grossMargin || 0).toFixed(2)}%`],
      ]}
    />
  );
}