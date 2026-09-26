import ReportTable from "./ReportTable.jsx";
import { formatDateValue } from "../../utils/dateFormat.js";

export default function SalesReport({ daily }) {
  return (
    <ReportTable
      title="Sales by day"
      exportName="sales"
      headers={["Date", "Transactions", "Gross", "Returns", "Net", "VAT"]}
      rows={daily.map((row) => [
        formatDateValue(row.date) || row.date,
        row.transactions,
        `£${Number(row.grossSales).toFixed(2)}`,
        `£${Number(row.returns).toFixed(2)}`,
        `£${Number(row.netSales).toFixed(2)}`,
        `£${Number(row.vat).toFixed(2)}`,
      ])}
    />
  );
}
