import { useEffect, useState } from "react";
import { AlertTriangle, Edit, Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct } from "../../utils/formatters.js";
import { Toggle } from "../../components/ui.jsx";
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
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">
            Products
          </h1>

          <p className="text-xs text-slate-500 mt-0.5 hidden lg:block">
            Manage products available in
            your onePOS system.
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
            onClick={openCreateForm}
            className="h-9 px-3 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700"
          >
            <Plus size={16} />
            <span className="hidden md:inline">Add Product</span>
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

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">
            Total Products
          </div>

          <div className="text-lg font-bold leading-tight">
            {products.length}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">
            Active Products
          </div>

          <div className="text-lg font-bold leading-tight">
            {activeCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5">
          <div className="text-xs text-slate-500">
            Low Stock
          </div>

          <div className="text-lg font-bold leading-tight text-orange-600">
            {lowStockCount}
          </div>
        </div>
      </div>

      {/* PRODUCT TABLE */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-200">
          <div className="relative max-w-md">
            <Search
              size={16}
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
              className="w-full h-9 pl-9 pr-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <RefreshCw
              size={24}
              className="mx-auto mb-2 animate-spin"
            />

            Loading products...
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <div className="text-red-600 font-medium">
              {error}
            </div>

            <button
              onClick={loadProducts}
              className="mt-3 h-9 px-4 bg-blue-600 text-white rounded-lg text-sm"
            >
              Try Again
            </button>
          </div>
        ) : filteredProducts.length ===
          0 ? (
          <div className="p-8 text-center text-slate-400">
            <Package
              size={32}
              className="mx-auto mb-2"
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
                {filteredProducts.map(
                  (product) => (
                    <tr
                      key={product.id}
                      className="border-b border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                            <Package
                              size={16}
                              className="text-slate-400"
                            />
                          </div>

                          <div className="min-w-0">
                            <div className="font-medium text-sm max-w-[260px] 2xl:max-w-[380px] truncate" title={product.name}>
                              {product.name}
                            </div>

                            {product.barcode && (
                              <div className="text-xs text-slate-400 mt-0.5 max-w-[260px] 2xl:max-w-[380px] truncate" title={product.barcode}>
                                {product.barcode}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="hidden lg:table-cell px-4 py-2 text-sm text-slate-600">
                        {product.sku ||
                          "—"}
                      </td>

                      <td className="hidden lg:table-cell px-4 py-2">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                          {product.category}
                        </span>
                      </td>

                      <td className="px-4 py-2 text-right font-semibold text-sm">
                        £
                        {Number(
                          product.price || 0
                        ).toFixed(2)}
                      </td>

                      <td className="px-4 py-2 text-right">
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

                      <td className="px-4 py-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
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

                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => openEditForm(product)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                          title="Edit product"
                        >
                          <Edit
                            size={16}
                          />
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
    availableOnUber: product?.availableOnUber ?? false,
    availableOnDeliveroo: product?.availableOnDeliveroo ?? false,
    uberItemId: product?.uberItemId || "",
    deliverooItemId: product?.deliverooItemId || "",
  });

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  /*
   * EAN master lookup (create mode only). Calls the EXISTING read-only
   * GET /api/ean-lookup/:ean and fills ONLY reference fields — pricing,
   * stock and supplier stay user-entered. Not-found / offline results never
   * block manual creation. Scanners behave like keyboards: Enter triggers
   * the lookup.
   */
  const [eanInput, setEanInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState(null);

  const runEanLookup = async () => {
    if (lookingUp || saving) return;

    const ean = eanInput.trim();
    if (!/^([0-9]{8}|[0-9]{12,14})$/.test(ean)) {
      setLookupResult({ type: "invalid", message: "EAN must be 8, 12, 13 or 14 digits — nothing was looked up." });
      return;
    }

    setLookingUp(true);
    setLookupResult(null);
    try {
      const response = await apiRequest(`/api/ean-lookup/${ean}`);
      const ref = response?.data || null;

      const referenceNames = [ref?.category, ref?.subcategory]
        .filter(Boolean)
        .map((name) => String(name).toLowerCase());
      const categoryMatch = referenceNames.length
        ? categories.find(
            (category) =>
              referenceNames.includes(String(category.name).toLowerCase()) ||
              referenceNames.some((name) =>
                String(category.name).toLowerCase().includes(name)
              )
          )
        : null;

      setForm((current) => ({
        ...current,
        name: ref?.product_name || current.name,
        barcode: ean,
        categoryId: categoryMatch ? categoryMatch.id : current.categoryId,
      }));
      setLookupResult({ type: "found", ref, message: "Reference details added below — enter your own pricing and stock." });
    } catch (err) {
      if (err?.status === 404) {
        setForm((current) => ({ ...current, barcode: current.barcode || ean }));
        setLookupResult({ type: "not-found", message: "EAN not found in the product master — continue creating the product manually." });
      } else if (err?.status === 400) {
        setLookupResult({ type: "invalid", message: err?.message || "EAN must be 8, 12, 13 or 14 digits." });
      } else {
        setLookupResult({ type: "error", message: "Lookup unavailable — you can still create the product manually." });
      }
    } finally {
      setLookingUp(false);
    }
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
      availableOnUber: Boolean(form.availableOnUber),
      availableOnDeliveroo: Boolean(form.availableOnDeliveroo),
      uberItemId: form.uberItemId.trim() || null,
      deliverooItemId: form.deliverooItemId.trim() || null,
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
      <div className="bg-white rounded-xl w-[620px] max-w-full shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">
              {product ? "Edit Product" : "Add Product"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Product details are saved to the onePOS database.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 hover:bg-slate-100 rounded"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="p-4">
          {!product && (
            <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="block text-xs font-medium text-slate-600 mb-1.5">
                EAN / barcode lookup
                <span className="font-normal text-slate-400"> — scan or type, then press Enter</span>
              </span>
              <div className="flex gap-2">
                <input
                  value={eanInput}
                  onChange={(event) => setEanInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runEanLookup();
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Scan or type EAN / barcode (8, 12–14 digits)"
                  className="flex-1 h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
                <button
                  type="button"
                  onClick={runEanLookup}
                  disabled={lookingUp || saving}
                  className="h-9 px-3 bg-slate-800 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-60 flex items-center gap-1.5 shrink-0"
                >
                  {lookingUp ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                  {lookingUp ? "Looking up…" : "Lookup"}
                </button>
              </div>
              {lookupResult && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-2 text-xs rounded px-2.5 py-1.5 ${
                    lookupResult.type === "found"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : lookupResult.type === "not-found"
                        ? "bg-slate-100 border border-slate-200 text-slate-600"
                        : "bg-amber-50 border border-amber-200 text-amber-700"
                  }`}
                >
                  {lookupResult.type === "found" && (
                    <>
                      <span className="font-medium">{lookupResult.ref?.product_name}</span>
                      {[lookupResult.ref?.brand, lookupResult.ref?.category, lookupResult.ref?.subcategory, lookupResult.ref?.unit_description]
                        .filter(Boolean)
                        .join(" · ") && (
                        <span> — {[lookupResult.ref?.brand, lookupResult.ref?.category, lookupResult.ref?.subcategory, lookupResult.ref?.unit_description].filter(Boolean).join(" · ")}</span>
                      )}
                      {" — "}{lookupResult.message}
                    </>
                  )}
                  {lookupResult.type !== "found" && lookupResult.message}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
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
                className="w-full h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
              <Toggle
                checked={form.trackStock}
                onChange={(event) =>
                  updateField("trackStock", event.target.checked)
                }
              />
              Track stock for this product
            </label>
          </div>          <div className="mt-4 pt-3 border-t border-slate-200">
            <p className="text-sm font-semibold text-slate-700 mb-3">
              Online platforms (Uber Eats / Deliveroo)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <Toggle
                    checked={form.availableOnUber}
                    onChange={(event) =>
                      updateField("availableOnUber", event.target.checked)
                    }
                  />
                  Available on Uber Eats
                </label>
                {form.availableOnUber && (
                  <input
                    placeholder="Uber item ID (optional)"
                    value={form.uberItemId}
                    onChange={(event) => updateField("uberItemId", event.target.value)}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                )}
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <Toggle
                    checked={form.availableOnDeliveroo}
                    onChange={(event) =>
                      updateField("availableOnDeliveroo", event.target.checked)
                    }
                  />
                  Available on Deliveroo
                </label>
                {form.availableOnDeliveroo && (
                  <input
                    placeholder="Deliveroo item ID (optional)"
                    value={form.deliverooItemId}
                    onChange={(event) => updateField("deliverooItemId", event.target.value)}
                    className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
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
