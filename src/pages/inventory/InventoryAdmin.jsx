import { useEffect, useState } from "react";
import { Calculator, History, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct, getStockStatus } from "../../utils/formatters.js";
function ReconciliationModal({ data, onClose }) {
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[850px] max-w-full max-h-[85vh] shadow-2xl flex flex-col"><div className="p-4 border-b flex justify-between"><div><h2 className="font-bold text-lg">Stock Reconciliation</h2><p className="text-xs text-slate-500">{data.product}</p></div><button onClick={onClose} title="Close"><X size={18} /></button></div><div className="p-4 overflow-auto"><div className={`p-3 rounded text-sm mb-4 ${data.mismatch ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{data.mismatch ? "Stock balance mismatch" : "Stock balance matches ledger"} <span className="ml-3">Current {data.currentStock} · Ledger {data.ledgerBalance}</span></div><table className="w-full"><thead><tr className="bg-slate-50">{["Date/time", "Type", "Quantity", "Balance", "Reference", "User", "Reason"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs uppercase text-slate-500">{heading}</th>)}</tr></thead><tbody>{(data.movements || []).map((movement, index) => <tr key={`${movement.created_at}-${index}`} className="border-t"><td className="px-3 py-2 text-xs">{new Date(movement.created_at).toLocaleString()}</td><td className="px-3 py-2 text-sm font-semibold">{movement.movement_type}</td><td className="px-3 py-2 text-sm">{movement.quantity_change}</td><td className="px-3 py-2 text-sm font-semibold">{movement.balance_after}</td><td className="px-3 py-2 text-xs">{movement.reference_type || "-"}</td><td className="px-3 py-2 text-sm">{movement.username || "-"}</td><td className="px-3 py-2 text-sm">{movement.reason || "-"}</td></tr>)}</tbody></table></div></div></div>;
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
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold">Inventory</h1>
              <p className="text-sm text-slate-500 mt-1">
                Monitor and adjust stock for active products.
              </p>
            </div>

            <button
              onClick={loadProducts}
              className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>

          {message && (
            <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
              {message}
            </div>
          )}

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
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

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="relative max-w-md flex-1">
                  <Search
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search product, SKU or barcode..."
                    className="w-full h-10 pl-10 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {loading ? (
              <div className="p-12 text-center text-slate-400">
                <RefreshCw size={28} className="mx-auto mb-3 animate-spin" />
                Loading inventory...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <Package size={40} className="mx-auto mb-3" />
                <div className="font-medium text-slate-600">No products found</div>
                <div className="text-sm mt-1">Try a different search.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {[
                        "Product",
                        "SKU",
                        "Barcode",
                        "Category",
                        "Current Stock",
                        "Price",
                        "Stock Status",
                        "Action",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product) => {
                      const status = getStockStatus(product);

                      return (
                        <tr
                          key={product.id}
                          className="border-b border-slate-100 hover:bg-slate-50"
                        >
                          <td className="px-4 py-4 font-medium text-sm">
                            {product.name}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-600">
                            {product.sku || "-"}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-600">
                            {product.barcode || "-"}
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-600">
                            {product.category}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold">
                            {product.stock}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold">
                            £{product.price.toFixed(2)}
                          </td>
                          <td className="px-4 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${status.className}`}>
                              {status.label}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <button
                              onClick={() => loadMovements(product)}
                              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                              title="View movement history"
                            >
                              <History size={17} />
                            </button>
                            <button
                              onClick={() => {
                                setError("");
                                setMessage("");
                                setAdjustingProduct(product);
                              }}
                              className="ml-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100"
                            >
                              Adjust stock
                            </button>
                            <button
                              onClick={() => loadReconciliation(product)}
                              className="ml-1 p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                              title="Reconcile stock"
                            >
                              <Calculator size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
          <div className="bg-white rounded-xl w-[1000px] max-w-full max-h-[85vh] shadow-2xl flex flex-col">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-xl">Movement History</h2>
                <p className="text-sm text-slate-500 mt-1">{product.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={movementType}
                  onChange={(event) => onTypeChange(event.target.value)}
                  className="h-9 px-3 border border-slate-200 rounded-lg text-sm bg-white"
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
                <div className="p-12 text-center text-slate-400">Loading movement history...</div>
              ) : movements.length === 0 ? (
                <div className="p-12 text-center text-slate-400">No movements found.</div>
              ) : (
                <table className="w-full">
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

function StockAdjustmentModal({ product, onClose, onSave }) {
  const [direction, setDirection] = useState("increase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const amount = Number(quantity);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an adjustment quantity greater than zero.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await onSave(
        product,
        direction === "increase" ? amount : -amount,
        reason
      );
    } catch (err) {
      setError(err.message || "Unable to adjust stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[440px] max-w-full shadow-2xl">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-xl">Adjust Stock</h2>
            <p className="text-sm text-slate-500 mt-1">
              {product.name} · Current stock: {product.stock}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-2 hover:bg-slate-100 rounded"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="p-5">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-4">
            {["increase", "decrease"].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDirection(option)}
                className={`h-10 rounded-lg border text-sm font-medium capitalize ${
                  direction === option
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {option} stock
              </button>
            ))}
          </div>

          <label className="block text-sm text-slate-600 mb-4">
            <span className="block mb-1 font-medium">Adjustment quantity</span>
            <input
              autoFocus
              required
              type="number"
              min="0.01"
              step="0.01"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Reason (optional)</span>
            <textarea
              rows="3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none resize-none focus:ring-2 focus:ring-blue-500"
              placeholder="For example: delivery received or stock count"
            />
          </label>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {saving ? "Saving..." : "Save adjustment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default InventoryAdmin;
