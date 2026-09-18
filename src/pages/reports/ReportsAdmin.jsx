import { useState } from "react";
import useReportData from "./shared/useReportData.js";
import { getSummary, getSales, getProducts, getPayments } from "../../services/reports.js";
import ReportHeader from "./ReportHeader.jsx";
import SummaryCards from "./SummaryCards.jsx";
import SalesReport from "./SalesReport.jsx";
import ProductsReport from "./ProductsReport.jsx";
import PaymentsReport from "./PaymentsReport.jsx";
import CustomersReport from "./CustomersReport.jsx";
import InventoryReport from "./InventoryReport.jsx";
import StockMovementLedger from "./StockMovementLedger.jsx";
import ProfitReport from "./ProfitReport.jsx";
import TillReport from "./TillReport.jsx";
import VATReport from "./VATReport.jsx";

export default function ReportsAdmin() {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data, loading, error, reload } = useReportData(
    async () => {
      const [summary, sales, productRows, paymentRows] = await Promise.all([
        getSummary(from, to),
        getSales(from, to),
        getProducts(from, to),
        getPayments(from, to),
      ]);
      if (!summary.success) throw new Error(summary.message);
      return {
        report: summary.data,
        dailySales: sales.data || [],
        products: productRows.data || [],
        payments: paymentRows.data || [],
      };
    },
    [],
    "Unable to load reports"
  );

  if (loading) return <div className="p-10 text-center text-slate-400">Loading reports...</div>;
  if (error) return <div className="bg-white border rounded-xl p-8 max-w-xl"><h1 className="font-bold text-red-700">Unable to load reports</h1><p className="text-sm mt-2">{error}</p><button onClick={reload} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Retry</button></div>;

  return (
    <div>
      <ReportHeader
        title="Reports"
        subtitle="Live sales, product and payment reporting."
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onRun={reload}
      />
      <SummaryCards report={data.report} />
      <div className="grid grid-cols-2 gap-5">
        <SalesReport daily={data.dailySales} />
        <PaymentsReport payments={data.payments} />
        <ProductsReport products={data.products} />
        <CustomersReport from={from} to={to} />
        <InventoryReport />
        <StockMovementLedger />
        <ProfitReport from={from} to={to} />
        <TillReport from={from} to={to} />
        <VATReport from={from} to={to} />
      </div>
    </div>
  );
}