import { useState } from "react";
import { BarChart3, Calculator, CreditCard, FileText, Grid3X3, Home, LogOut, Package, Percent, Receipt, RefreshCw, Settings, Store, Tag, Users } from "lucide-react";
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

export default function AdminLayout({ onPOS, onLogout }) {
  const [page, setPage] = useState("Dashboard");
  const [productCreateRequested, setProductCreateRequested] = useState(false);

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
    <div className="h-screen bg-slate-100 flex">
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
