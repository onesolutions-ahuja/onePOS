import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Bell, Calculator, ChevronDown, CreditCard, Database, FileText, Grid3X3, Home, LogOut, Package, Percent, Plug, Receipt, RefreshCw, Settings, ShoppingBag, Store, Tag, UserCircle, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import BottomStatusBar from "../../components/BottomStatusBar.jsx";
import AdminNavDock from "../../components/AdminNavDock.jsx";
import Dashboard from "../dashboard/Dashboard.jsx";import ProductsAdmin from "../products/ProductsAdmin.jsx";
import GlobalProductsAdmin from "../products/GlobalProductsAdmin.jsx";
import CategoriesAdmin from "../categories/CategoriesAdmin.jsx";
import InventoryAdmin from "../inventory/InventoryAdmin.jsx";
import SettingsAdmin from "../settings/SettingsAdmin.jsx";
import SuppliersAdmin from "../suppliers/SuppliersAdmin.jsx";
import IntegrationsAdmin from "../integrations/IntegrationsAdmin.jsx";
import AccountingAdmin from "../integrations/AccountingAdmin.jsx";
import PurchasesAdmin from "../purchases/PurchasesAdmin.jsx";
import SalesAdmin from "../sales/SalesAdmin.jsx";
import ReportsAdmin from "../reports/ReportsAdmin.jsx";
import ReportPage, { REPORT_MENU_ITEMS } from "../reports/ReportPage.jsx";
import ReturnsAdmin, { SupplierReturnsAdmin } from "../returns/ReturnsAdmin.jsx";
import CustomersAdmin from "../customers/CustomersAdmin.jsx";
import OnlineOrdersAdmin from "../online/OnlineOrdersAdmin.jsx";
import OnlineOrdersPrep from "../online/OnlineOrdersPrep.jsx";
import StoresAdmin from "../stores/StoresAdmin.jsx";

export default function AdminLayout({ onPOS, onLogout, user = null, initialPage = "Dashboard" }) {
  const [page, setPage] = useState(initialPage);

  /* Compact top-bar profile menu (T5B). Data comes from the existing session
     user prop — no extra API call. Profile opens the existing "Users &
     Permissions" settings tab (change password / user management); Settings
     reuses the same navigation action as the T5A gear button. */
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  useEffect(() => {
    if (!profileOpen) return undefined;
    const handlePointerDown = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  const [onlinePermissions, setOnlinePermissions] = useState({ isAdmin: false, permissions: [] });
  const [reportsLoaded, setReportsLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    apiRequest("/api/auth/me/permissions").then((data) => {
      if (alive && data.success) {
        setOnlinePermissions(data.data);
        setReportsLoaded(true);
      } else {
        if (alive) setReportsLoaded(true);
      }
    }).catch((error) => { console.error("Online order permissions:", error); if (alive) setReportsLoaded(true); });
    return () => { alive = false; };
  }, []);
  const [productCreateRequested, setProductCreateRequested] = useState(false);
  /* Which tab the existing Settings page opens on (gear = General, profile menu = Users & Permissions). */
  const [settingsTab, setSettingsTab] = useState("General");

  /*
   * Reports submenu visibility — reuses the EXISTING permission model from
   * /api/auth/me/permissions (the same session data Order Prep uses):
   * Administrator/Admin/Owner roles bypass permission checks entirely via the
   * isAdmin flag (mirroring the server-side authorize() helper); every other
   * role needs the matching seeded permission code(s). Item requirements come
   * from REPORT_MENU_ITEMS: string = one required code, array = any-of.
   */
  const canViewReport = useCallback((permission) => {
    if (onlinePermissions.isAdmin) return true;
    if (!permission) return true;
    const codes = Array.isArray(permission) ? permission : [permission];
    return codes.some((code) => onlinePermissions.permissions.includes(code));
  }, [onlinePermissions]);

  const visibleReportItems = REPORT_MENU_ITEMS.filter((item) => canViewReport(item.permission));
  /* Overview / Summary cards page requires reports.summary.view per T10B granular catalogue. */
  const canViewOverview = canViewReport("reports.summary.view");
  /* Users with ANY of the 13 granular reports.*.view codes can discover Reports.
     Admin/Owner bypass: if isAdmin we unconditionally show Reports.
     Also: if permissions are still loading (reportsLoaded=false) we KEEP the
     entry rendered (it is always present in the items array) so a flash of
     "missing sidebar entry" cannot happen on first paint for an Admin user. */
  const canViewReports =
    !reportsLoaded ||
    canViewOverview ||
    visibleReportItems.length > 0 ||
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.some((code) => code.startsWith("reports."));

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
    /* T9M-SMALL: Returns respects the existing permission system —
     * returns.view/returns.create for restricted roles, admin bypass. */
    ...(onlinePermissions.isAdmin ||
      onlinePermissions.permissions.includes("returns.view") ||
      onlinePermissions.permissions.includes("returns.create")
      ? [["Returns", RefreshCw]] : []),
    ...(onlinePermissions.isAdmin ||
      onlinePermissions.permissions.includes("returns.create")
      ? [["Supplier Returns", RefreshCw]] : []),
    ["Products", Package],
    ["Global Products", Database],
    ["Categories", Tag],
    ["Purchases", Receipt],
    ["Suppliers", Users],
    ["Inventory", Grid3X3],
    ["Customers", Users],
    ["Employees", Users],
    ["Stores", Store],
    ["Payments", CreditCard],
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("online_orders.view")
      ? [["Order Prep", ShoppingBag]] : []),
    /* T9F: Integration management — existing permission system (integration.manage, admin bypass). */
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("integration.manage")
      ? [["Integrations", Plug]] : []),
    /* T9O: Accounting Integration — same permission mechanism, accounting-focused UI. */
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("integration.manage")
      ? [["Accounting", Calculator]] : []),
    ["Reports", BarChart3],
  ];

  return (
    <div className="h-screen bg-slate-100 flex relative">
      {/* NAVIGATION — floating dock, bottom-centre of the status bar.
         Consumes the SAME permission-filtered items list the sidebar used,
         so visibility per user/role is identical. */}
      <AdminNavDock
        items={items}
        reportItems={canViewReports ? (canViewOverview ? [{ key: "Reports", title: "Overview" }, ...visibleReportItems] : visibleReportItems) : []}
        page={page}
        onNavigate={(nextPage) => {
          setProductCreateRequested(false);
          setPage(nextPage);
        }}
        onOpenTill={onPOS}
      />

      {/* MAIN */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 bg-white border-b flex items-center justify-between gap-3 px-4 lg:px-6 shrink-0">
          <div className="min-w-0">
            <div className="font-semibold truncate">
              {page}
            </div>

            <div className="text-xs text-slate-400 hidden xl:block">
              London Store
            </div>
          </div>

          <div className="flex items-center gap-1.5 lg:gap-3 shrink-0">
            <button
              onClick={openOnlineOrders}
              aria-label="Online Orders"
              title="Online Orders"
              className="relative px-2.5 py-2 lg:px-4 bg-slate-100 text-slate-800 border border-slate-200 rounded-md text-sm hover:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className="flex items-center gap-2">
                <ShoppingBag size={16} />
                <span className="hidden lg:inline">Online Orders</span>
                {onlineOrderCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {onlineOrderCount > 99 ? "99+" : onlineOrderCount}
                  </span>
                )}
              </span>
            </button>

            <button
              onClick={onPOS}
              aria-label="Open Till"
              title="Open Till"
              className="px-2.5 py-2 lg:px-4 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className="flex items-center gap-2">
                <Store size={16} />
                <span className="hidden lg:inline">Open Till</span>
              </span>
            </button>

            <button
              onClick={() => {
                setProductCreateRequested(false);
                setSettingsTab("General");
                setPage("Settings");
              }}
              title="Settings"
              aria-label="Settings"
              className={`p-2 hover:bg-slate-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                page === "Settings" ? "bg-slate-100 text-slate-900" : "text-slate-600"
              }`}
            >
              <Settings size={18} />
            </button>

            <button
              onClick={onLogout}
              aria-label="Log out"
              title="Log out"
              className="p-2 hover:bg-slate-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <LogOut size={18} />
            </button>

            {/* Compact user/profile menu — reuses the existing session user prop. */}
            {(() => {
              const displayName = user?.fullName || user?.name || user?.username || "User";
              const roleLabel = user?.role || "";
              const initials = displayName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase() || "?";
              return (
                <div className="relative" ref={profileRef}>
                  <button
                    onClick={() => setProfileOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={profileOpen}
                    aria-label="User menu"
                    title={displayName}
                    className={`flex items-center gap-2 pl-1.5 pr-1.5 py-1 rounded-md border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      profileOpen ? "bg-slate-100 border-slate-300" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-7 h-7 shrink-0 rounded-full bg-blue-700 text-white text-[11px] font-semibold flex items-center justify-center uppercase">
                      {initials}
                    </span>
                    <span className="hidden xl:block text-left leading-tight min-w-0">
                      <span className="block font-medium text-slate-800 max-w-[140px] truncate">{displayName}</span>
                      {roleLabel && <span className="block text-[11px] text-slate-400 max-w-[140px] truncate">{roleLabel}</span>}
                    </span>
                    <ChevronDown size={14} className="text-slate-400 shrink-0" />
                  </button>

                  {profileOpen && (
                    <div
                      role="menu"
                      aria-label="User menu"
                      className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50"
                    >
                      <div className="px-3 py-2 border-b border-slate-100">
                        <div className="text-sm font-semibold text-slate-800 truncate">{displayName}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {user?.username || ""}{user?.storeName ? ` · ${user.storeName}` : ""}
                        </div>
                      </div>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setProductCreateRequested(false);
                          setSettingsTab("Users & Permissions");
                          setPage("Settings");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <UserCircle size={15} /> Profile
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setProductCreateRequested(false);
                          setSettingsTab("General");
                          setPage("Settings");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        <Settings size={15} /> Settings
                      </button>
                      <div className="border-t border-slate-100 my-1" />
                      <button
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          onLogout();
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <LogOut size={15} /> Logout
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
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

        <div className="p-6 flex-1 overflow-y-auto" style={{ paddingBottom: "84px" }}>
          {page ===
          "Dashboard" ? (
            <Dashboard
              canViewReports={canViewReports}
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
            "Global Products" ? (
            <GlobalProductsAdmin />
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
            "Stores" ? (
            <StoresAdmin />
          ) : page ===
            "Integrations" ? (
            <IntegrationsAdmin />
          ) : page ===
            "Accounting" ? (
            <AccountingAdmin storeId={user?.storeId || null} />
          ) : page ===
            "Online Orders" ? (
            <OnlineOrdersAdmin />
          ) : page ===
            "Order Prep" ? (
            <OnlineOrdersPrep permissions={onlinePermissions} />
          ) : page ===
            "Settings" ? (
            <SettingsAdmin key={settingsTab} initialTab={settingsTab} />
          ) : page ===
            "Reports" ? (
            canViewReports ? (
              <ReportsAdmin />
            ) : (
              <div className="bg-white rounded-xl border p-10 text-center">
                <h2 className="text-xl font-bold">Access denied</h2>
                <p className="text-sm text-slate-400 mt-2">You do not have permission to view reports.</p>
              </div>
            )
          ) : REPORT_MENU_ITEMS.some((item) => item.key === page) ? (
            canViewReport(REPORT_MENU_ITEMS.find((item) => item.key === page)?.permission) ? (
              <ReportPage reportKey={page} />
            ) : (
              <div className="bg-white rounded-xl border p-10 text-center">
                <h2 className="text-xl font-bold">Access denied</h2>
                <p className="text-sm text-slate-400 mt-2">You do not have permission to view this report.</p>
              </div>
            )
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
