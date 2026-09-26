import { useEffect, useState } from "react";
import { Calculator, History, PackagePlus, RefreshCw, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import ObjectList from "../../components/records/ObjectList.jsx";
import { normaliseProduct, getStockStatus } from "../../utils/formatters.js";
import StockAdjustmentModal from "./StockAdjustmentModal.jsx";
import StockByStore from "./StockByStore.jsx";
import StockTransfers from "./StockTransfers.jsx";

/* Column formatting for the shared global list — data shaping only, the
   presentation (header, spacing, pills, primary link, actions) is ObjectList. */
const INVENTORY_COLUMNS = [
  { key: "name", label: "Product", primary: true },
  { key: "sku", label: "SKU", format: (value) => value || "-" },
  { key: "barcode", label: "Barcode", format: (value) => value || "-" },
  { key: "category", label: "Category", format: (value) => value || "All" },
  { key: "stock", label: "Current Stock", format: (value) => String(value ?? 0) },
  { key: "price", label: "Price", format: (value) => `£${Number(value || 0).toFixed(2)}` },
  {
    key: "stock",
    label: "Stock Status",
    format: (_value, product) => getStockStatus(product).label,
    pill: (_value, product) => {
      const label = getStockStatus(product).label;
      return label === "Out of Stock" ? "danger" : label === "Low Stock" ? "warning" : "success";
    },
  },
];

function ReconciliationModal({ data, onClose }) {
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="onepos-card w-[850px] max-w-full max-h-[85vh] flex flex-col"><div className="onepos-card-header"><div><h2 className="font-bold text-lg">Stock Reconciliation</h2><p className="text-xs text-slate-500">{data.product}</p></div><button onClick={onClose} title="Close"><X size={18} /></button></div><div className="p-4 overflow-auto"><div className={`p-3 rounded text-sm mb-4 ${data.mismatch ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{data.mismatch ? "Stock balance mismatch" : "Stock balance matches ledger"} <span className="ml-3">Current {data.currentStock} · Ledger {data.ledgerBalance}</span></div><table className="onepos-table"><thead><tr className="bg-slate-50">{["Date/time", "Type", "Quantity", "Balance", "Reference", "User", "Reason"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs uppercase text-slate-500">{heading}</th>)}</tr></thead><tbody>{(data.movements || []).map((movement, index) => <tr key={`${movement.created_at}-${index}`} className="border-t"><td className="px-3 py-2 text-xs">{new Date(movement.created_at).toLocaleString()}</td><td className="px-3 py-2 text-sm font-semibold">{movement.movement_type}</td><td className="px-3 py-2 text-sm">{movement.quantity_change}</td><td className="px-3 py-2 text-sm font-semibold">{movement.balance_after}</td><td className="px-3 py-2 text-xs">{movement.reference_type || "-"}</td><td className="px-3 py-2 text-sm">{movement.username || "-"}</td><td className="px-3 py-2 text-sm">{movement.reason || "-"}</td></tr>)}</tbody></table></div></div></div>;
}

function InventoryAdmin() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustingProduct, setAdjustingProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [movements, setMovements] = useState([]);
  const [movementType, setMovementType] = useState("ALL");
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [reconciliation, setReconciliation] = useState(null);
  const [stockView, setStockView] = useState("products"); // products | byStore | transfers

  const loadProducts = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await apiRequest("/api/products");

      if (!data.success) {
        throw new Error(data.message || "Unable to load inventory");
      }

      setProducts(
        Array.isArray(data.data)
          ? data.data.map(normaliseProduct)
          : []
      );
    } catch (err) {
      console.error("Admin inventory error:", err);
      setError(err.message || "Unable to load inventory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const filteredProducts = products.filter((product) => {
    const query = search.toLowerCase().trim();

    return !query || [
      product.name,
      product.sku,
      product.barcode,
    ].some((value) => value.toLowerCase().includes(query));
  });

  const adjustStock = async (product, adjustmentQuantity, reason) => {
    try {
      setMessage("");
      setError("");

      const data = await apiRequest("/api/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          adjustmentQuantity,
          reason: reason.trim() || null,
        }),
      });

      if (!data.success) {
        throw new Error(data.message || "Unable to adjust stock");
      }

      await loadProducts();
      setAdjustingProduct(null);
      setMessage(`${product.name} stock was updated successfully.`);
    } catch (err) {
      setError(err.message || "Unable to adjust stock");
    }
  };

      const loadMovements = async (product, type = movementType) => {
        try {
          setLoadingMovements(true);
          setError("");

          const params = new URLSearchParams({
            productId: product.id,
          });

          if (type !== "ALL") {
            params.set("movementType", type);
          }

          const data = await apiRequest(
            `/api/inventory/movements?${params.toString()}`
          );

          if (!data.success) {
            throw new Error(data.message || "Unable to load movement history");
          }

          setMovements(Array.isArray(data.data) ? data.data : []);
          setHistoryProduct(product);
        } catch (err) {
          setError(err.message || "Unable to load movement history");
        } finally {
          setLoadingMovements(false);
        }
      };

      const changeMovementType = (type) => {
        setMovementType(type);
        if (historyProduct) {
          loadMovements(historyProduct, type);
        }
      };

      const loadReconciliation = async (product) => {
        try {
          setError("");
          const data = await apiRequest(`/api/inventory/reconciliation?productId=${product.id}`);
          if (!data.success) throw new Error(data.message || "Unable to load reconciliation");
          setReconciliation(data.data);
        } catch (err) {
          setError(err.message || "Unable to load reconciliation");
        }
      };

      const formatMovementQuantity = (quantity) => {
        const value = Number(quantity);
        return `${value > 0 ? "+" : ""}${value}`;
      };

      const formatMovementDate = (value) =>
        new Date(value).toLocaleString([], {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

      return (
        <div>
          <div className="onepos-page-header">
            <div>
              <h1 className="onepos-page-title">Inventory</h1>
              <p className="onepos-page-subtitle">
                Monitor and adjust stock for active products.
              </p>
            </div>

            <div className="onepos-page-header-actions">
              <button
                onClick={loadProducts}
                className="onepos-btn onepos-btn-secondary"
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
          </div>

          {/* Same tabular segmented pattern the admin uses everywhere. */}
          <div className="mb-4 inline-flex rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setStockView("products")}
              className={`px-4 h-9 text-sm ${stockView === "products" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Products
            </button>
            <button
              onClick={() => setStockView("byStore")}
              className={`px-4 h-9 text-sm ${stockView === "byStore" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Stock by Store
            </button>
            <button
              onClick={() => setStockView("transfers")}
              className={`px-4 h-9 text-sm ${stockView === "transfers" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Stock Transfers
            </button>
          </div>

          {message && (
            <div className="onepos-alert onepos-alert-success mb-4">
              {message}
            </div>
          )}

          {error && (
            <div className="onepos-alert onepos-alert-error mb-4 flex items-center justify-between">
              <span>{error}</span>
              <button
                onClick={() => setError("")}
                className="p-1 hover:bg-red-100 rounded"
                title="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className="onepos-card overflow-hidden">
            {stockView === "byStore" ? (
              <StockByStore />
            ) : stockView === "transfers" ? (
              <StockTransfers />
            ) : loading ? (
              <div className="onepos-empty">
                <RefreshCw size={28} className="mx-auto mb-3 animate-spin" />
                Loading inventory...
              </div>
            ) : (
              <ObjectList
                records={filteredProducts}
                columns={INVENTORY_COLUMNS}
                searchValue={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search product, SKU or barcode..."
                emptyMessage="No products found"
                emptyHint="Try a different search."
                onOpenRecord={loadMovements}
                renderActions={(product) => (
                  <div className="inline-flex items-center gap-0.5 whitespace-nowrap">
                    <button
                      onClick={() => loadMovements(product)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                      title="View movement history"
                    >
                      <History size={16} />
                    </button>
                    <button
                      onClick={() => loadReconciliation(product)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                      title="Reconcile stock"
                    >
                      <Calculator size={16} />
                    </button>
                    <button
                      onClick={() => {
                        setError("");
                        setMessage("");
                        setAdjustingProduct(product);
                      }}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                      title="Adjust stock"
                    >
                      <PackagePlus size={16} />
                    </button>
                  </div>
                )}
              />
            )}
          </div>

          {adjustingProduct && (
            <StockAdjustmentModal
              product={adjustingProduct}
              onClose={() => setAdjustingProduct(null)}
              onSave={adjustStock}
            />
          )}

          {historyProduct && (
            <MovementHistoryModal
              product={historyProduct}
              movements={movements}
              movementType={movementType}
              loading={loadingMovements}
              onTypeChange={changeMovementType}
              onClose={() => setHistoryProduct(null)}
              formatDate={formatMovementDate}
              formatQuantity={formatMovementQuantity}
            />
          )}

          {reconciliation && (
            <ReconciliationModal
              data={reconciliation}
              onClose={() => setReconciliation(null)}
            />
          )}
        </div>
      );
    }

    function MovementHistoryModal({
      product,
      movements,
      movementType,
      loading,
      onTypeChange,
      onClose,
      formatDate,
      formatQuantity,
    }) {
      const movementTypes = [
        "ALL",
        "OPENING",
        "PURCHASE",
        "SALE",
        "CUSTOMER_RETURN",
        "SUPPLIER_RETURN",
        "ADJUSTMENT_IN",
        "ADJUSTMENT_OUT",
      ];

      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="onepos-card w-[1000px] max-w-full max-h-[85vh] flex flex-col">
            <div className="onepos-card-header">
              <div>
                <h2 className="font-bold text-xl">Movement History</h2>
                <p className="onepos-page-subtitle">{product.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={movementType}
                  onChange={(event) => onTypeChange(event.target.value)}
                  className="onepos-input w-auto"
                >
                  {movementTypes.map((type) => (
                    <option key={type} value={type}>
                      {type === "ALL" ? "All movement types" : type}
                    </option>
                  ))}
                </select>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close">
                  <X size={20} />
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              {loading ? (
                <div className="onepos-empty">Loading movement history...</div>
              ) : movements.length === 0 ? (
                <div className="onepos-empty">No movements found.</div>
              ) : (
                <table className="onepos-table">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Date/time", "Product", "Movement", "Quantity", "Balance", "Reason", "Reference", "User"].map((heading) => (
                        <th key={heading} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <tr key={movement.id} className="border-b border-slate-100">
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(movement.created_at)}</td>
                        <td className="px-4 py-3 text-sm font-medium">{movement.product_name}</td>
                        <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap">{movement.movement_type}</td>
                        <td className={`px-4 py-3 text-sm font-semibold ${Number(movement.quantity_change) < 0 ? "text-red-600" : "text-emerald-600"}`}>{formatQuantity(movement.quantity_change)}</td>
                        <td className="px-4 py-3 text-sm font-semibold">{movement.balance_after}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{movement.reason || "-"}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{movement.reference_type || "-"}{movement.reference_id ? ` ${movement.reference_id}` : ""}</td>
                        <td className="px-4 py-3 text-sm text-slate-600">{movement.created_by_username || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      );
    }

export default InventoryAdmin;

