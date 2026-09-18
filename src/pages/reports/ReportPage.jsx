import { useState } from "react";
import useReportData from "./shared/useReportData.js";
import { getSales, getProducts, getPayments } from "../../services/reports.js";
import ReportHeader from "./ReportHeader.jsx";
import SalesReport from "./SalesReport.jsx";
import PaymentsReport from "./PaymentsReport.jsx";
import ProductsReport from "./ProductsReport.jsx";
import CustomersReport from "./CustomersReport.jsx";
import InventoryReport from "./InventoryReport.jsx";
import ProfitReport from "./ProfitReport.jsx";
import TillReport from "./TillReport.jsx";
import VATReport from "./VATReport.jsx";
import { toLocalDateString } from "./shared/quickDateRanges.js";

/**
 * Submenu entries for the Reports section — the single source of truth used
 * by the admin sidebar. Each entry routes to the existing report component;
 * no report logic is duplicated here.
 *
 * `permission` maps each entry to the EXISTING permission codes (see
 * database/init.js); a string means "requires this code", an array means
 * "requires at least one of these codes". Administrator/Owner roles bypass
 * permission checks via the isAdmin flag from /api/auth/me/permissions.
 */
export const REPORT_MENU_ITEMS = [
  { key: "Sales Report", title: "Sales by Day", subtitle: "Daily sales totals for the selected range.", permission: "reports.sales.view" },
  { key: "Payments Report", title: "Payments", subtitle: "Payments broken down by method.", permission: "reports.payments.view" },
  { key: "Top Products Report", title: "Top Products", subtitle: "Best-selling products for the selected range.", permission: "reports.products.view" },
  { key: "Customers Report", title: "Customers", subtitle: "Customer spend and returns.", permission: "reports.customers.view" },
  { key: "Inventory Report", title: "Inventory Overview", subtitle: "Current stock, cost and low-stock status.", permission: "reports.inventory.view" },
  { key: "Inventory Movements", title: "Stock Movements", subtitle: "Inventory ledger for the selected range.", permission: ["reports.inventory_movements.view", "inventory.movements.view"] },
  { key: "Profit Report", title: "Profit & Margin", subtitle: "Profit and margin for the selected range.", permission: "reports.profit.view" },
  { key: "Till Report", title: "Till & Cash", subtitle: "Till sessions and cash movements.", permission: "reports.till.view" },
  { key: "VAT Report", title: "VAT Summary", subtitle: "VAT collected and reclaimed.", permission: "reports.vat.view" },
];

/* Reports whose data is fetched here and passed as props (same endpoints the
   overview page uses); the rest fetch their own data via useReportData. */
const PROP_DRIVEN_REPORTS = new Set(["Sales Report", "Payments Report", "Top Products Report"]);

/** Reports that are not date-filtered (no From/To header shown). */
const DATELESS_REPORTS = new Set(["Inventory Report"]);

const today = () => toLocalDateString(new Date());

/**
 * Renders one individual report page for the Reports submenu.
 *
 * Reuses the existing report components and their APIs untouched — this
 * wrapper only supplies the shared header (with QuickDateRange) and, for
 * the presentational reports, the same fetch calls the overview page makes.
 */
export default function ReportPage({ reportKey }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const item = REPORT_MENU_ITEMS.find((entry) => entry.key === reportKey);
  const isPropDriven = PROP_DRIVEN_REPORTS.has(reportKey);
  const isDateless = DATELESS_REPORTS.has(reportKey);

  const { data, loading, error, reload } = useReportData(
    async () => {
      if (reportKey === "Sales Report") {
        const response = await getSales(from, to);
        if (!response.success) throw new Error(response.message);
        return response.data || [];
      }
      if (reportKey === "Payments Report") {
        const response = await getPayments(from, to);
        if (!response.success) throw new Error(response.message);
        return response.data || [];
      }
      if (reportKey === "Top Products Report") {
        const response = await getProducts(from, to);
        if (!response.success) throw new Error(response.message);
        return response.data || [];
      }
      /* Self-fetching reports load their own data; nothing to do here. */
      return null;
    },
    [reportKey, from, to],
    "Unable to load report"
  );

  if (isPropDriven && loading) return <div className="p-10 text-center text-slate-400">Loading report...</div>;
  if (isPropDriven && error) {
    return (
      <div className="bg-white border rounded-xl p-8 max-w-xl">
        <h1 className="font-bold text-red-700">Unable to load report</h1>
        <p className="text-sm mt-2">{error}</p>
        <button onClick={reload} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded text-sm">Retry</button>
      </div>
    );
  }

  let content = null;
  switch (reportKey) {
    case "Sales Report": content = <SalesReport daily={data || []} />; break;
    case "Payments Report": content = <PaymentsReport payments={data || []} />; break;
    case "Top Products Report": content = <ProductsReport products={data || []} />; break;
    case "Customers Report": content = <CustomersReport from={from} to={to} />; break;
    case "Inventory Report": content = <InventoryReport />; break;
    case "Inventory Movements": content = <StockMovementLedger />; break;
    case "Profit Report": content = <ProfitReport from={from} to={to} />; break;
    case "Till Report": content = <TillReport from={from} to={to} />; break;
    case "VAT Report": content = <VATReport from={from} to={to} />; break;
    default: content = null;
  }

  return (
    <div>
      {isDateless ? (
        <div className="mb-5">
          <h1 className="text-2xl font-bold">{item?.title}</h1>
          <p className="text-sm text-slate-500 mt-1">{item?.subtitle}</p>
        </div>
      ) : (
        <ReportHeader
          title={item?.title}
          subtitle={item?.subtitle}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />
      )}
      {content}
    </div>
  );
}
