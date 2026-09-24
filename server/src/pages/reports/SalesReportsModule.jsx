import { useCallback, useEffect, useState } from "react";
import useReportData from "./shared/useReportData.js";
import ReportTable from "./ReportTable.jsx";
import { getSalesOverview } from "../../services/reports.js";
import { apiRequest } from "../../services/api.js";

/*
 * Sales Reports — the dedicated sales reporting module (Reporting roadmap).
 *
 * One report, four groupings over the same filtered scope:
 *   By Day | By Store | By Operator | By Product
 *
 * Metrics per group: total quantity, total sales, discounts, tax, returns,
 * counts and net sales — computed SERVER-SIDE by
 * GET /api/reports/sales/overview (permission: the existing
 * reports.sales.view code; the backend re-checks everything, the UI only
 * hides). A payment-method breakdown table accompanies every grouping.
 *
 * Access rules are the EXISTING ones: /api/auth/me/permissions reports
 * isAdmin (Administrator/Admin/Owner bypass) and the role's permission
 * codes — identical to the sidebar/Reports gating in AdminLayout. A 403
 * from the backend renders the standard access-denied panel regardless of
 * what the UI decided.
 */

const BY_DAY = "day";
const BY_STORE = "store";
const BY_USER = "user";
const BY_PRODUCT = "product";

const GROUP_TABS = [
  { key: BY_DAY, label: "By Day" },
  { key: BY_STORE, label: "By Store" },
  { key: BY_USER, label: "By Operator" },
  { key: BY_PRODUCT, label: "By Product" },
];

const GROUP_FIRST_COLUMN = {
  [BY_DAY]: "Date",
  [BY_STORE]: "Store",
  [BY_USER]: "Operator",
  [BY_PRODUCT]: "Product",
};

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export default function SalesReportsModule({ from, to }) {
  const [by, setBy] = useState(BY_DAY);
  /* Stores for the filter dropdown; admins/owners can pick any company
   * store, everyone else sees their assigned ones (backend enforces both). */
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  /* Permission snapshot — same source the Reports menu uses. */
  const [perm, setPerm] = useState({ isAdmin: false, loaded: false });

  useEffect(() => {
    let active = true;
    apiRequest("/api/auth/me/permissions")
      .then((data) => {
        if (!active || !data.success) return;
        setPerm({ isAdmin: data.data?.isAdmin === true, loaded: true });
      })
      .catch(() => {
        /* Backend stays the authority; dropdown just stays hidden. */
        if (active) setPerm({ isAdmin: false, loaded: true });
      });
    return () => {
      active = false;
    };
  }, []);

  /* Store options: admins query the company store list; restricted users
   * rely on the backend's own store scoping (no selector). */
  useEffect(() => {
    if (!perm.isAdmin) return undefined;
    let active = true;
    apiRequest("/api/admin/stores")
      .then((data) => {
        if (!active || !data.success) return;
        const list = (data.data || []).filter((store) => store.active !== false);
        setStores(list);
      })
      .catch(() => setStores([]));
    return () => {
      active = false;
    };
  }, [perm.isAdmin]);

  const { data, loading, error, reload } = useReportData(
    async () => {
      const response = await getSalesOverview({ by, from, to, storeId });
      if (!response.success) throw new Error(response.message);
      return response.data;
    },
    [by, from, to, storeId],
    "Unable to load sales report"
  );

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const payments = data?.payments || [];

  const firstColumn = GROUP_FIRST_COLUMN[by];
  const tableRows = rows.map((row) => [
    row.label || row.key,
    row.count_sales,
    Number(row.total_qty).toLocaleString(),
    money(row.total_sales),
    money(row.total_discount),
    money(row.total_tax),
    money(row.total_returns),
    money(row.net_sales),
  ]);

  const changeGrouping = useCallback((next) => {
    setBy(next);
    setFiltersOpen(false);
  }, []);

  if (loading && !data) return <div className="onepos-empty">Loading sales report...</div>;

  if (error) {
    return (
      <div className="onepos-card onepos-card-body max-w-xl">
        <h1 className="onepos-section-title text-red-700">Unable to load sales report</h1>
        <p className="text-sm mt-2">{error}</p>
        <button onClick={reload} className="onepos-btn onepos-btn-primary mt-4">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="onepos-card overflow-hidden">
        <div className="onepos-toolbar">
          {GROUP_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-selected={by === tab.key}
              onClick={() => changeGrouping(tab.key)}
              className={`onepos-tab ${by === tab.key ? "onepos-tab-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {perm.isAdmin && stores.length > 0 && (
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                className="onepos-input w-auto"
                aria-label="Filter by store"
              >
                <option value="">All my stores</option>
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>{store.name}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={reload}
              className="onepos-btn onepos-btn-sm onepos-btn-secondary"
            >
              Run
            </button>
          </div>
        </div>
        <div className="onepos-card-body">
          <p className="text-xs text-slate-400">
            Sales for {from || "range start"} to {to || "range end"}. Net sales = total sales − total returns. Figures are computed by the server.
          </p>
        </div>
      </div>

      {loading && <div className="text-center text-xs text-slate-400">Refreshing...</div>}

      <ReportTable
        title={`Sales by ${GROUP_TABS.find((tab) => tab.key === by)?.label.replace(/^By /, "").toLowerCase() || "day"}`}
        exportName={`sales-by-${by}`}
        headers={[firstColumn, "Sales count", "Total quantity", "Total sales", "Total discount", "Total tax", "Total returns", "Net sales"]}
        rows={tableRows}
      />

      <div className="onepos-card onepos-card-body grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          ["Sales count", totals.count_sales],
          ["Total quantity", Number(totals.total_qty || 0).toLocaleString()],
          ["Total sales", money(totals.total_sales)],
          ["Total discount", money(totals.total_discount)],
          ["Total tax", money(totals.total_tax)],
          ["Total returns", money(totals.total_returns)],
          ["Net sales", money(totals.net_sales)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="onepos-stat-label">{label}</div>
            <div className="onepos-stat-value">{value}</div>
          </div>
        ))}
      </div>

      <ReportTable
        title="Payment methods"
        exportName={`sales-payments-${by}`}
        headers={["Method", "Sales count", "Total sales"]}
        rows={payments.map((payment) => [payment.method, payment.count_sales, money(payment.total_sales)])}
      />
    </div>
  );
}
