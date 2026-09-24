import ReportTable from "./ReportTable.jsx";

export default function PaymentsReport({ payments }) {
  return (
    <ReportTable
      title="Payments by method"
      exportName="payments"
      headers={["Method", "Transactions", "Total"]}
      rows={payments.map((row) => [
        row.method,
        row.transactions,
        `£${Number(row.total).toFixed(2)}`,
      ])}
    />
  );
}
