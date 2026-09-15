import { useCallback, useEffect, useState } from "react";
import { BarChart3, Bell, Calculator, CreditCard, FileText, Grid3X3, Home, LogOut, Package, Percent, Receipt, RefreshCw, Settings, ShoppingBag, Store, Tag, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import BottomStatusBar from "../../components/BottomStatusBar.jsx";
import Dashboard from "../dashboard/Dashboard.jsx";
import ProductsAdmin from "../products/ProductsAdmin.jsx";
import CategoriesAdmin from "../categories/CategoriesAdmin.jsx";
import InventoryAdmin from "../inventory/InventoryAdmin.jsx";
import SettingsAdmin from "../settings/SettingsAdmin.jsx";
import SuppliersAdmin from "../suppliers/SuppliersAdmin.jsx";
import PurchasesAdmin from "../purchases/PurchasesAdmin.jsx";
import SalesAdmin from "../sales/SalesAdmin.jsx";
import ReportsAdmin from "../reports/ReportsAdmin.jsx";
import ReturnsAdmin, { SupplierReturnsAdmin } from "../returns/ReturnsAdmin.jsx";
import CustomersAdmin from "../customers/CustomersAdmin.jsx";
import OnlineOrdersAdmin from "../online/OnlineOrdersAdmin.jsx";

export default function AdminLayout({ onPOS, onLogout, initialPage = "Dashboard" }) {
  const [page, setPage] = useState(initialPage);
  const [productCreateRequested, setProductCreateRequested] = useState(false);

  /* Non-blocking online-order notifications (Uber Eats / Deliveroo). */
  const [onlineOrderCount, setOnlineOrderCount] = useState(0);
  const [onlineOrderToast, setOnlineOrderToast] = useState(null);

  /*
   * Polls the online-order count (RECEIVED = pending acceptance / new).
   * This is webhook-ready: when the real Uber webhook lands, the receive
   * endpoint will push the same state and this polling remains as fallback.
   */
  const loadOnlineOrderCount = useCallback(async () => {
    try {
      const data = await apiRequest("/api/online/orders?status=RECEIVED&limit=50");
      if (data.success) {
        setOnlineOrderCount(Array.isArray(data.data) ? data.data.length : 0);
      }
    } catch (error) {
      console.error("Load online order count error:", error);
    }
  }, []);

  useEffect(() => {
    loadOnlineOrderCount();
    const timer = setInterval(loadOnlineOrderCount, 15000);
    return () => clearInterval(timer);
  }, [loadOnlineOrderCount]);

  const openOnlineOrders = () => {
    setOnlineOrderToast(null);
    setPage("Online Orders");
  };

  /* Surfaces a new-order toast without blocking the admin/till workflow. */
  const notifyNewOnlineOrder = useCallback((payload = {}) => {
    setOnlineOrderToast({
      message: payload.message || "New Uber Eats Order",
      externalOrderId: payload.externalOrderId || null,
    });
    loadOnlineOrderCount();
  }, [loadOnlineOrderCount]);

  const items = [
    ["Dashboard", Home],
    ["Sales", FileText],
    ["Returns", RefreshCw],
    ["Supplier Returns", RefreshCw],
    ["Products", Package],
    ["Categories", Tag],
    ["Purchases", Receipt],
    ["Suppliers", Users],
    ["Inventory", Grid3X3],
    ["Customers", Users],
    ["Employees", Users],
    ["Stores", Store],
    ["Payments", CreditCard],
    ["Reports", BarChart3],
    ["Settings", Settings],
  ];

  return (
    <div className="h-screen bg-slate-100 flex relative">
      {/* SIDEBAR */}
      <aside className="w-60 bg-slate-950 text-white shrink-0">
        <div className="h-16 flex items-center px-5 border-b border-slate-800">
          <Calculator
            size={22}
            className="text-blue-400"
          />

          <span className="font-bold text-lg ml-3">
            onePOS
          </span>
        </div>

        <div className="p-3 overflow-y-auto" style={{ height: "calc(100vh - 64px)" }}>
          {items.map(
            ([name, Icon]) => (
              <button
                key={name}
                onClick={() => {
                  setProductCreateRequested(false);
                  setPage(name);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md mb-1 text-sm ${
                  page === name
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                <Icon size={17} />
                {name}
              </button>
            )
          )}
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b flex items-center justify-between px-6 shrink-0">
          <div>
            <div className="font-semibold">
              {page}
            </div>

            <div className="text-xs text-slate-400">
              London Store
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={openOnlineOrders}
              className="relative px-4 py-2 bg-slate-800 text-white rounded-md text-sm hover:bg-slate-700"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag size={16} />
                Online Orders
                {onlineOrderCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {onlineOrderCount > 99 ? "99+" : onlineOrderCount}
                  </span>
                )}
              </span>
            </button>

            <button
              onClick={onPOS}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              Open Till
            </button>

            <button
              onClick={onLogout}
              className="p-2 hover:bg-slate-100 rounded"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Non-blocking new-online-order notification (never blocks the UI). */}
        {onlineOrderToast && (
          <button
            onClick={openOnlineOrders}
            className="absolute top-20 right-6 z-50 bg-white border border-slate-200 shadow-lg rounded-lg px-4 py-3 text-sm text-left hover:border-blue-400"
          >
            <span className="flex items-start gap-2">
              <Bell size={16} className="text-blue-600 mt-0.5" />
              <span>
                <span className="font-medium">{onlineOrderToast.message}</span>
                {onlineOrderToast.externalOrderId ? (
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Order {onlineOrderToast.externalOrderId} - click to view
                  </span>
                ) : (
                  <span className="block text-xs text-slate-500 mt-0.5">Click to open Online Orders</span>
                )}
              </span>
              <X
                size={14}
                className="text-slate-400 ml-2 mt-0.5"
                onClick={(event) => {
                  event.stopPropagation();
                  setOnlineOrderToast(null);
                }}
              />
            </span>
          </button>
        )}

        <div className="p-6 flex-1 overflow-y-auto pb-14">
          {page ===
          "Dashboard" ? (
            <Dashboard
              onNavigate={(nextPage) => {
                setProductCreateRequested(false);
                setPage(nextPage);
              }}
              onAddProduct={() => {
                setProductCreateRequested(true);
                setPage("Products");
              }}
            />
          ) : page ===
            "Sales" ? (
            <SalesAdmin />
          ) : page ===
            "Returns" ? (
            <ReturnsAdmin />
          ) : page ===
            "Supplier Returns" ? (
            <SupplierReturnsAdmin />
          ) : page ===
            "Products" ? (
            <ProductsAdmin openCreate={productCreateRequested} />
          ) : page ===
            "Categories" ? (
            <CategoriesAdmin />
          ) : page ===
            "Inventory" ? (
            <InventoryAdmin />
          ) : page ===
            "Purchases" ? (
            <PurchasesAdmin />
          ) : page ===
            "Suppliers" ? (
            <SuppliersAdmin />
          ) : page ===
            "Customers" ? (
            <CustomersAdmin />
          ) : page ===
            "Online Orders" ? (
            <OnlineOrdersAdmin />
          ) : page ===
            "Settings" ? (
            <SettingsAdmin />
          ) : page ===
            "Reports" ? (
            <ReportsAdmin />
          ) : (
            <div className="bg-white rounded-xl border p-10 text-center">
              <h2 className="text-xl font-bold">
                {page}
              </h2>

              <p className="text-sm text-slate-400 mt-2">
                Module will be connected
                to the onePOS API.
              </p>
            </div>
          )}
        </div>
      </main>
      <BottomStatusBar storeName="London Store" />
    </div>
  );
}
