import { useEffect, useState } from "react";
import { AlertTriangle, Edit, Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct } from "../../utils/formatters.js";
function ProductsAdmin({ openCreate = false }) {
  const [products, setProducts] =
    useState([]);

  const [categories, setCategories] =
    useState([]);

  const [editingProduct, setEditingProduct] =
    useState(null);

  const [showProductForm, setShowProductForm] =
    useState(false);

  const [actionError, setActionError] =
    useState("");

  const [saving, setSaving] =
    useState(false);

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const loadProducts = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await apiRequest(
        "/api/products"
      );

      if (!data.success) {
        throw new Error(
          data.message ||
            "Unable to load products"
        );
      }

      const list = Array.isArray(data.data)
        ? data.data.map(normaliseProduct)
        : [];

      setProducts(list);
    } catch (err) {
      console.error(
        "Admin products error:",
        err
      );

      setError(
        err.message ||
          "Unable to load products"
      );
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
      openCreateForm();
    }
  }, [openCreate]);

  const openCreateForm = () => {
    setActionError("");
    setEditingProduct(null);
    setShowProductForm(true);
  };

  const openEditForm = (product) => {
    setActionError("");
    setEditingProduct(product);
    setShowProductForm(true);
  };

  const closeProductForm = () => {
    if (!saving) {
      setShowProductForm(false);
      setEditingProduct(null);
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
    } catch (err) {
      setActionError(
        err.message || "Unable to save product"
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Deactivate ${product.name}?`)) {
      return;
    }

    try {
      setActionError("");
      await apiRequest(`/api/products/${product.id}`, {
        method: "DELETE",
      });
      await loadProducts();
    } catch (err) {
      setActionError(
        err.message || "Unable to deactivate product"
      );
    }
  };

  const filteredProducts =
    products.filter((product) => {
      const q =
        search.toLowerCase().trim();

      if (!q) return true;

      return (
        product.name
          .toLowerCase()
          .includes(q) ||
        product.sku
          .toLowerCase()
          .includes(q) ||
        product.barcode
          .toLowerCase()
          .includes(q) ||
        product.category
          .toLowerCase()
          .includes(q)
      );
    });

  const activeCount =
    products.filter(
      (product) => product.active
    ).length;

  const lowStockCount =
    products.filter(
      (product) =>
        product.stock <= 5
    ).length;

  return (
    <div>
      {/* PAGE HEADER */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">
            Products
          </h1>

          <p className="text-sm text-slate-500 mt-1">
            Manage products available in
            your onePOS system.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadProducts}
            className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50"
          >
            <RefreshCw size={16} />
            Refresh
          </button>

          <button
            onClick={openCreateForm}
            className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700"
          >
            <Plus size={17} />
            Add Product
          </button>
        </div>
      </div>

      {/* STATS */}
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

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">
            Total Products
          </div>

          <div className="text-2xl font-bold mt-2">
            {products.length}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">
            Active Products
          </div>

          <div className="text-2xl font-bold mt-2">
            {activeCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-sm text-slate-500">
            Low Stock
          </div>

          <div className="text-2xl font-bold mt-2 text-orange-600">
            {lowStockCount}
          </div>
        </div>
      </div>

      {/* PRODUCT TABLE */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="relative max-w-md">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search products, SKU, barcode..."
              className="w-full h-10 pl-10 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw
              size={28}
              className="mx-auto mb-3 animate-spin"
            />

            Loading products...
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <div className="text-red-600 font-medium">
              {error}
            </div>

            <button
              onClick={loadProducts}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
            >
              Try Again
            </button>
          </div>
        ) : filteredProducts.length ===
          0 ? (
          <div className="p-12 text-center text-slate-400">
            <Package
              size={40}
              className="mx-auto mb-3"
            />

            <div className="font-medium text-slate-600">
              No products found
            </div>

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
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Product
                  </th>

                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    SKU
                  </th>

                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Category
                  </th>

                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Price
                  </th>

                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Stock
                  </th>

                  <th className="text-center px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Status
                  </th>

                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(
                  (product) => (
                    <tr
                      key={product.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                            <Package
                              size={19}
                              className="text-slate-400"
                            />
                          </div>

                          <div>
                            <div className="font-medium text-sm">
                              {product.name}
                            </div>

                            {product.barcode && (
                              <div className="text-xs text-slate-400 mt-1">
                                {product.barcode}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-4 text-sm text-slate-600">
                        {product.sku ||
                          "—"}
                      </td>

                      <td className="px-5 py-4">
                        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs">
                          {product.category}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right font-semibold text-sm">
                        £
                        {Number(
                          product.price || 0
                        ).toFixed(2)}
                      </td>

                      <td className="px-5 py-4 text-right">
                        <span
                          className={`text-sm font-medium ${
                            product.stock <=
                            5
                              ? "text-orange-600"
                              : "text-slate-700"
                          }`}
                        >
                          {product.stock}

                          {product.stock <=
                            5 && (
                            <AlertTriangle
                              size={14}
                              className="inline ml-1"
                            />
                          )}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-center">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            product.active
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-50 text-red-700"
                          }`}
                        >
                          {product.active
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => openEditForm(product)}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                          title="Edit product"
                        >
                          <Edit
                            size={17}
                          />
                        </button>

                        <button
                          onClick={() => deleteProduct(product)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Deactivate product"
                        >
                          <X size={17} />
                        </button>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showProductForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          saving={saving}
          error={actionError}
          onClose={closeProductForm}
          onSave={saveProduct}
        />
      )}
    </div>
  );
}

function ProductFormModal({
  product,
  categories,
  saving,
  error,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({
    name: product?.name || "",
    sku: product?.sku || "",
    barcode: product?.barcode || "",
    categoryId: product?.categoryId || "",
    price: product?.price ?? 0,
    costPrice: product?.cost ?? 0,
    lowStockLevel: product?.lowStockLevel ?? 0,
    vatRate: product?.vatRate ?? 20,
    trackStock: product?.trackStock ?? true,
  });

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const submit = (event) => {
    event.preventDefault();

    onSave({
      ...form,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      categoryId: form.categoryId || null,
      price: Number(form.price) || 0,
      costPrice: Number(form.costPrice) || 0,
      lowStockLevel: Number(form.lowStockLevel) || 0,
      vatRate: Number(form.vatRate) || 0,
    });
  };

  const fields = [
    ["name", "Name", "text", true],
    ["sku", "SKU", "text", false],
    ["barcode", "Barcode", "text", false],
    ["price", "Selling price", "number", true],
    ["costPrice", "Cost price", "number", false],
    ["lowStockLevel", "Low stock level", "number", false],
    ["vatRate", "VAT rate %", "number", false],
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[620px] max-w-full shadow-2xl">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-xl">
              {product ? "Edit Product" : "Add Product"}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Product details are saved to the onePOS database.
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

          <div className="grid grid-cols-2 gap-4">
            {fields.map(([field, label, type, required]) => (
              <label key={field} className="text-sm text-slate-600">
                <span className="block mb-1 font-medium">{label}</span>
                <input
                  required={required}
                  type={type}
                  min={type === "number" ? "0" : undefined}
                  step={type === "number" ? "0.01" : undefined}
                  value={form[field]}
                  onChange={(event) =>
                    updateField(field, event.target.value)
                  }
                  className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            ))}

            <label className="text-sm text-slate-600">
              <span className="block mb-1 font-medium">Category</span>
              <select
                value={form.categoryId}
                onChange={(event) =>
                  updateField("categoryId", event.target.value)
                }
                className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-600 pt-6">
              <input
                type="checkbox"
                checked={form.trackStock}
                onChange={(event) =>
                  updateField("trackStock", event.target.checked)
                }
                className="w-4 h-4 accent-blue-600"
              />
              Track stock for this product
            </label>
          </div>

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
              disabled={saving || !form.name.trim()}
              className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {saving ? "Saving..." : product ? "Save changes" : "Create product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProductsAdmin;
