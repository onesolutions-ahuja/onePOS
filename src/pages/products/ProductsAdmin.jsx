import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Edit, Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct } from "../../utils/formatters.js";
import ProductFormModal from "./ProductFormModal.jsx";
import ProductHistoryModal from "./ProductHistoryModal.jsx";

function ProductsAdmin({ openCreate = false, createPreset = null }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [presetProduct, setPresetProduct] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProducts = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await apiRequest("/api/products");
      if (!data.success) {
        throw new Error(data.message || "Unable to load products");
      }

      const list = Array.isArray(data.data)
        ? data.data.map(normaliseProduct)
        : [];

      setProducts(list);
    } catch (err) {
      console.error("Admin products error:", err);
      setError(err.message || "Unable to load products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();

    apiRequest("/api/categories")
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setCategories(data.data);
        }
      })
      .catch((err) => {
        console.error("Admin categories error:", err);
      });
  }, []);

  useEffect(() => {
    if (openCreate) {
      openCreateForm(createPreset);
    }
  }, [openCreate, createPreset]);

  const openCreateForm = (preset = null) => {
    setActionError("");
    setEditingProduct(null);
    setPresetProduct(preset);
    setShowProductForm(true);
  };

  const openEditForm = (product) => {
    setActionError("");
    setEditingProduct(product);
    setPresetProduct(null);
    setShowProductForm(true);
  };

  const openHistoryModal = (product) => {
    setHistoryProduct(product);
    setShowHistoryModal(true);
  };

  const closeProductForm = () => {
    if (!saving) {
      setShowProductForm(false);
      setEditingProduct(null);
      setPresetProduct(null);
      setActionError("");
    }
  };

  const saveProduct = async (form) => {
    try {
      setSaving(true);
      setActionError("");

      const endpoint = editingProduct
        ? `/api/products/${editingProduct.id}`
        : "/api/products";

      await apiRequest(endpoint, {
        method: editingProduct ? "PUT" : "POST",
        body: JSON.stringify(form),
      });

      await loadProducts();
      setShowProductForm(false);
      setEditingProduct(null);
      setPresetProduct(null);
    } catch (err) {
      setActionError(err.message || "Unable to save product");
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Deactivate ${product.name}?`)) return;

    try {
      setActionError("");
      await apiRequest(`/api/products/${product.id}`, {
        method: "DELETE",
      });
      await loadProducts();
    } catch (err) {
      setActionError(err.message || "Unable to deactivate product");
    }
  };

  const filteredProducts = products.filter((product) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      product.name.toLowerCase().includes(q) ||
      product.sku.toLowerCase().includes(q) ||
      product.barcode.toLowerCase().includes(q) ||
      product.category.toLowerCase().includes(q)
    );
  });

  const activeCount = products.filter((product) => product.active).length;
  const lowStockCount = products.filter((product) => product.stock <= 5).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Products</h1>
          <p className="text-xs text-slate-500 mt-0.5 hidden lg:block">
            Manage products available in your onePOS system.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadProducts}
            className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50"
          >
            <RefreshCw size={15} />
            <span className="hidden md:inline">Refresh</span>
          </button>

          <button
            onClick={() => openCreateForm()}
            className="h-9 px-3 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700"
          >
            <Plus size={16} />
            <span className="hidden md:inline">Add Product</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError("")}
            className="p-1 hover:bg-red-100 rounded"
            title="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">Total Products</div>
          <div className="text-lg font-bold leading-tight">{products.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">Active Products</div>
          <div className="text-lg font-bold leading-tight">{activeCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">Low Stock</div>
          <div className="text-lg font-bold leading-tight text-orange-600">{lowStockCount}</div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-200">
          <div className="relative max-w-md">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products, SKU, barcode..."
              className="w-full h-9 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <RefreshCw size={24} className="mx-auto mb-2 animate-spin" />
            Loading products...
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-red-600 font-medium">{error}</div>
            <button
              onClick={loadProducts}
              className="mt-3 h-9 px-4 bg-blue-600 text-white rounded-lg text-sm"
            >
              Try Again
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Package size={32} className="mx-auto mb-2" />
            <div className="font-medium text-slate-600">No products found</div>
            <div className="text-sm mt-1">
              {products.length === 0
                ? "There are currently no products in the database."
                : "Try a different search."}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Product
                  </th>
                  <th className="hidden lg:table-cell text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    SKU
                  </th>
                  <th className="hidden lg:table-cell text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Category
                  </th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Price
                  </th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Stock
                  </th>
                  <th className="text-center px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Status
                  </th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-slate-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                          <Package size={16} className="text-slate-400" />
                        </div>
                        <div className="min-w-0">
                          <div
                            className="font-medium text-sm max-w-[260px] 2xl:max-w-[380px] truncate"
                            title={product.name}
                          >
                            {product.name}
                          </div>
                          {product.barcode && (
                            <div
                              className="text-xs text-slate-400 mt-0.5 max-w-[260px] 2xl:max-w-[380px] truncate"
                              title={product.barcode}
                            >
                              {product.barcode}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2 text-sm text-slate-600">
                      {product.sku || "—"}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2">
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                        {product.category}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-sm">
                      £{Number(product.price || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`text-sm font-medium ${
                          product.stock <= 5 ? "text-orange-600" : "text-slate-700"
                        }`}
                      >
                        {product.stock}
                        {product.stock <= 5 && (
                          <AlertTriangle size={14} className="inline ml-1" />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          product.active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {product.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => openEditForm(product)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                        title="Edit product"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => openHistoryModal(product)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                        title="View history"
                      >
                        <Clock size={16} />
                      </button>
                      <button
                        onClick={() => deleteProduct(product)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                        title="Deactivate product"
                      >
                        <X size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showProductForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          preset={presetProduct}
          saving={saving}
          error={actionError}
          onClose={closeProductForm}
          onSave={saveProduct}
        />
      )}

      {showHistoryModal && (
        <ProductHistoryModal
          product={historyProduct}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </div>
  );
}

export default ProductsAdmin;
