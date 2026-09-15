import { useEffect, useState } from "react";
import { Package, Users, BarChart3, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function Dashboard({ onNavigate, onAddProduct }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = async () => {
    try {
      setLoading(true);
      setError("");
      const [dashboardData, settingsData] = await Promise.all([
        apiRequest("/api/dashboard/summary"),
        apiRequest("/api/settings"),
      ]);
      if (!dashboardData.success) throw new Error(dashboardData.message || "Unable to load dashboard");
      let logo = null;
      if (settingsData?.success && settingsData.data?.company?.logoUrl) {
        logo = settingsData.data.company.logoUrl;
      } else if (dashboardData.data?.companyLogo) {
        logo = dashboardData.data.companyLogo;
      }
      setSummary({ ...dashboardData.data, companyLogo: logo });
    } catch (err) {
      setError(err.message || "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSummary(); }, []);

  if (loading) return <div><div className="mb-6"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-sm text-slate-500 mt-1">Loading business summary...</p></div><div className="grid grid-cols-4 gap-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-28 bg-white border rounded-xl animate-pulse" />)}</div><div className="h-72 bg-white border rounded-xl mt-5 animate-pulse" /></div>;
  if (error) return <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl"><h1 className="text-xl font-bold text-red-700">Unable to load dashboard</h1><p className="text-sm text-slate-600 mt-2">{error}</p><button onClick={loadSummary} className="mt-5 h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><RefreshCw size={16} /> Refresh</button></div>;

  const chart = summary.salesOverview || [];
  const maxSales = Math.max(...chart.map((day) => Number(day.sales)), 0);
  const stats = [["Today's Sales", `£${Number(summary.todaySales).toFixed(2)}`], ["Transactions", summary.todayTransactions], ["Average Sale", `£${Number(summary.averageSale).toFixed(2)}`], ["Low Stock", summary.lowStockCount]];

  return <><div className="mb-6 flex items-center justify-between"><div><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-sm text-slate-500 mt-1">Today's activity for the current store.</p></div>{summary.companyLogo && <div className="h-10"><img src={summary.companyLogo} alt="Company logo" className="h-full object-contain" /></div>}</div><div className="grid grid-cols-4 gap-4">{stats.map(([label, value]) => <div key={label} className="bg-white border rounded-xl p-5"><div className="text-sm text-slate-500">{label}</div><div className="text-2xl font-bold mt-2">{value}</div></div>)}</div><div className="grid grid-cols-3 gap-5 mt-5"><div className="col-span-2 bg-white border rounded-xl p-5"><div className="font-semibold">Sales Overview · Last 7 days</div>{maxSales === 0 ? <div className="h-64 flex items-center justify-center text-sm text-slate-400">No sales in the last 7 days.</div> : <div className="h-64 flex items-end gap-3 mt-8 px-4 border-b border-l">{chart.map((day) => <div key={day.date} className="flex-1 h-full flex flex-col justify-end items-center gap-2"><div className="w-full bg-blue-500 rounded-t" style={{ height: `${Math.max((Number(day.sales) / maxSales) * 100, 2)}%` }} title={`£${Number(day.sales).toFixed(2)}`} /><span className="text-[10px] text-slate-400">{day.date.slice(5)}</span></div>)}</div>}</div><div className="bg-white border rounded-xl p-5"><div className="font-semibold mb-5">Quick Actions</div><button onClick={onAddProduct} className="w-full p-4 border rounded-lg text-left mb-3 hover:bg-slate-50"><Package size={19} className="text-blue-600" /><div className="font-medium mt-2">Add Product</div></button><button onClick={() => onNavigate("Customers")} className="w-full p-4 border rounded-lg text-left mb-3 hover:bg-slate-50"><Users size={19} className="text-blue-600" /><div className="font-medium mt-2">Add Customer</div></button><button onClick={() => onNavigate("Reports")} className="w-full p-4 border rounded-lg text-left hover:bg-slate-50"><BarChart3 size={19} className="text-blue-600" /><div className="font-medium mt-2">View Reports</div></button></div></div></>;
}
