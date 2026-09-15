import useReportData from "./shared/useReportData.js";
import { getVat } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

export default function VATReport({ from, to }) {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getVat(from, to);
      if (!response.success) throw new Error(response.message);
      return response.data || null;
    },
    [from, to],
    "Unable to load VAT report"
  );

  const vat = data || null;

  if (loading) return <ReportTable title="VAT Summary" headers={["Metric", "Value"]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load VAT report: {error}</div>;
  if (!vat) return <ReportTable title="VAT Summary" headers={["Metric", "Value"]} rows={[]} />;

  const money = (value) => `£${Number(value || 0).toFixed(2)}`;

  return (
    <ReportTable
      title="VAT Summary"
      exportName="vat"
      headers={["Metric", "Value"]}
      rows={[
        ["Gross sales (incl. VAT)", money(vat.grossSales)],
        ["Discounts", money(vat.discounts)],
        ["Net sales (after returns)", money(vat.netSales)],
        ["Sales excluding VAT", money(vat.salesExVat)],
        ["VAT collected", money(vat.vat)],
        ["Returns", money(vat.returns)],
        ["VAT on returns", money(vat.returnsVat)],
        ["VAT after returns", money(vat.vatAfterReturns)],
      ]}
    />
  );
}