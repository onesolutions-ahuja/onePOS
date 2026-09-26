import { useEffect, useState, useRef } from "react";
import { AlertTriangle, Clock, Edit, Eye, Package, Plus, Power, RefreshCw, X, Download, Upload, FileSpreadsheet, XCircle, CheckCircle } from "lucide-react";
import { PageHeader } from "../../components/ui.jsx";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct } from "../../utils/formatters.js";
import ObjectList from "../../components/records/ObjectList.jsx";
import ProductFormModal from "./ProductFormModal.jsx";
import ProductHistoryModal from "./ProductHistoryModal.jsx";
import StandardObjectViewModal from "../../components/platform/StandardObjectViewModal.jsx";

/* Column formatting for the shared global list — data shaping only, the
   presentation (header, spacing, pills, primary link, actions) is ObjectList. */
const PRODUCT_COLUMNS = [
  {
    key: "name",
    label: "Product",
    primary: true,
    render: (_value, product) => (
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <Package size={16} className="text-slate-400" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm" title={product.name}>
            {product.name}
          </div>
          {product.barcode && (
            <div className="text-xs text-slate-400 mt-0.5" title={product.barcode}>
              {product.barcode}
            </div>
          )}
        </div>
      </div>
    ),
  },
  { key: "sku", label: "SKU", format: (value) => value || "—" },
  { key: "category", label: "Category", format: (value) => value || "All" },
  { key: "price", label: "Price", format: (value) => `£${Number(value || 0).toFixed(2)}` },
  {
    key: "stock",
    label: "Stock",
    render: (_value, product) => (
      <div className="flex items-center justify-end gap-1 text-sm font-medium">
        <span className={product.stock <= 5 ? "text-orange-600" : ""}>{product.stock}</span>
        {product.stock <= 5 && <AlertTriangle size={14} className="text-orange-600" />}
      </div>
    ),
  },
  {
    key: "active",
    label: "Status",
    pill: (value) => (value ? "success" : "danger"),
    format: (value) => (value ? "Active" : "Inactive"),
  },
];

function ProductsAdmin({ openCreate = false, createPreset = null }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [editingProduct, setEditingProduct] = useState(null);
  const [presetProduct, setPresetProduct] = useState(null);
  const [viewProduct, setViewProduct] = useState(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importErrors, setImportErrors] = useState([]);
  const [importResult, setImportResult] = useState(null);
  const [exportLoading, setExportLoading] = useState(false);
  const fileInputRef = useRef(null);

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

  /* View = the canonical read-only record view (Batch 3 architecture), same
     pattern as Suppliers/Customers. The raw record is fetched because the
     list rows are normalised (camelCase) for the edit form, while the
     canonical viewer reads platform metadata (snake_case source columns). */
  async function openProductView(product) {
    try {
      setActionError("");
      const data = await apiRequest(`/api/products/${encodeURIComponent(product.id)}`);
      if (!data.success) throw new Error(data.message || "Unable to load product");
      setViewProduct(data.data);
    } catch (err) {
      setActionError(err.message || "Unable to load product");
    }
  }

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

  const productSaved = async () => {
    await loadProducts();
    setShowProductForm(false);
    setEditingProduct(null);
    setPresetProduct(null);
    setActionError("");
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Deactivate ${product.name}?`)) return;

    try {
      setActionError("");
      await apiRequest(`/api/platform/objects/product/records/${encodeURIComponent(product.id)}`, {
        method: "DELETE",
      });
      await loadProducts();
    } catch (err) {
      setActionError(err.message || "Unable to deactivate product");
    }
  };

  const handleExport = async () => {
    try {
      setExportLoading(true);
      setActionError("");
      const res = await fetch("/api/products/export", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token") || ""}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setActionError(err.message || "Export failed");
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportFile = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setImportPreview(null);
      setImportErrors([]);
      setImportResult(null);
    }
  };

  const handleImportValidate = async () => {
    if (!importFile) return;
    try {
      setImportLoading(true);
      setImportErrors([]);
      setImportPreview(null);
      setImportResult(null);

      const text = await importFile.text();
      const res = await apiRequest("/api/products/import/validate", {
        method: "POST",
        body: JSON.stringify({ csv: text }),
      });

      if (res.success && res.data) {
        setImportPreview(res.data.preview);
        setImportErrors(res.data.validationErrors || []);
      } else {
        setActionError(res.message || "Validation failed");
      }
    } catch (err) {
      setActionError(err.message || "Validation failed");
    } finally {
      setImportLoading(false);
    }
  };

  const handleImportExecute = async () => {
    if (!importFile || importLoading) return;
    try {
      setImportLoading(true);
      setImportResult(null);
      setImportErrors([]);

      const text = await importFile.text();
      const res = await apiRequest("/api/products/import", {
        method: "POST",
        body: JSON.stringify({ csv: text }),
      });

      if (res.success) {
        setImportResult(res.data);
        setImportPreview(null);
        await loadProducts();
      } else {
        setActionError(res.message || "Import failed");
      }
    } catch (err) {
      setActionError(err.message || "Import failed");
    } finally {
      setImportLoading(false);
    }
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFile(null);
    setImportPreview(null);
    setImportErrors([]);
    setImportResult(null);
    setImportLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  /* Shared row-action pattern: View · Edit · module extras · Deactivate, all
     quiet icon buttons; destructive uses the danger accent. */
  const renderProductActions = (product) => (
    <div className="inline-flex items-center gap-0.5">
      <button
        onClick={() => openProductView(product)}
        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
        title="View product"
      >
        <Eye size={16} />
      </button>
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
        <Power size={16} />
      </button>
    </div>
  );


  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Manage products available in your onePOS system."
        actions={
          <>
            <button
              onClick={loadProducts}
              className="onepos-btn onepos-btn-secondary"
            >
              <RefreshCw size={15} />
              <span className="hidden md:inline">Refresh</span>
            </button>

            <button
              onClick={handleExport}
              disabled={exportLoading}
              className="onepos-btn onepos-btn-secondary"
            >
              <Download size={15} />
              <span className="hidden md:inline">Export</span>
            </button>

            {/* Import stays secondary to the primary create action. */}
            <button
              onClick={() => setShowImportModal(true)}
              className="onepos-btn onepos-btn-secondary"
            >
              <Upload size={16} />
              <span className="hidden md:inline">Import</span>
            </button>

            <button
              onClick={() => openCreateForm()}
              className="onepos-btn onepos-btn-primary"
            >
              <Plus size={16} />
              <span className="hidden md:inline">Add Product</span>
            </button>
          </>
        }
      />

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

      {/* Shared stat/KPI card style (matches reports + dashboard). */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="onepos-stat">
          <div className="onepos-stat-label">Total Products</div>
          <div className="onepos-stat-value">{products.length}</div>
        </div>
        <div className="onepos-stat">
          <div className="onepos-stat-label">Active Products</div>
          <div className="onepos-stat-value">{activeCount}</div>
        </div>
        <div className="onepos-stat">
          <div className="onepos-stat-label">Low Stock</div>
          <div className="onepos-stat-value text-orange-600">{lowStockCount}</div>
        </div>
      </div>

      <div className="onepos-card overflow-hidden">
        {loading ? (
          <div className="onepos-empty">
            <RefreshCw size={24} className="animate-spin" />
            Loading products...
          </div>
        ) : error ? (
          <div className="onepos-empty text-red-600">
            <span className="onepos-empty-title">{error}</span>
            <button
              onClick={loadProducts}
              className="onepos-btn onepos-btn-secondary mt-3"
            >
              Try Again
            </button>
          </div>
        ) : (
          <ObjectList
            records={filteredProducts}
            columns={PRODUCT_COLUMNS}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search products, SKU, barcode..."
            emptyMessage="No products found"
            emptyHint={products.length === 0 ? "There are currently no products in the database." : "Try a different search."}
            onOpenRecord={openEditForm}
            renderActions={renderProductActions}
          />
        )}
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-[640px] max-w-[95vw] shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Import Products</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Import products via CSV. Two-stage: validate then confirm.
                </p>
              </div>
              <button
                onClick={closeImportModal}
                className="p-1.5 hover:bg-slate-100 rounded"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4">
              {importResult ? (
                <div>
                  <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle size={16} />
                    <span>Import completed successfully</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-white border border-slate-200 rounded px-3 py-2">
                      <div className="text-xs text-slate-500">Created</div>
                      <div className="text-lg font-bold text-emerald-600">{importResult.created?.length || 0}</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded px-3 py-2">
                      <div className="text-xs text-slate-500">Updated</div>
                      <div className="text-lg font-bold text-blue-600">{importResult.updated?.length || 0}</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded px-3 py-2">
                      <div className="text-xs text-slate-500">Store mappings</div>
                      <div className="text-lg font-bold text-purple-600">{importResult.storeMappings?.length || 0}</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded px-3 py-2">
                      <div className="text-xs text-slate-500">Errors</div>
                      <div className="text-lg font-bold text-red-600">{importResult.errors?.length || 0}</div>
                    </div>
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-semibold text-red-700 mb-2">Errors</h3>
                      {importResult.errors.slice(0, 20).map((err, i) => (
                        <div key={i} className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded mb-1">
                          Row {err.lineNumber}: {err.message}
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={closeImportModal}
                    className="onepos-btn onepos-btn-primary"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-4 border-2 border-dashed border-slate-300 rounded-lg p-6 text-center">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleImportFile}
                      className="hidden"
                    />
                    <FileSpreadsheet size={32} className="mx-auto mb-2 text-slate-400" />
                    <p className="text-sm text-slate-600 mb-2">
                      {importFile ? importFile.name : "Click or drag a CSV file here"}
                    </p>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 px-3 bg-white border border-slate-200 rounded text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Choose File
                    </button>
                    <p className="text-xs text-slate-400 mt-2">
                      Columns: product_id, sku, ean, name, description, category, vat_rate, cost_price, price, active, store_code, store_enabled, store_price, reorder_level, minimum_stock
                    </p>
                  </div>

                  {importPreview && (
                    <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      <h3 className="text-sm font-semibold text-slate-700 mb-2">Preview</h3>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="text-xs"><span className="text-slate-500">New:</span> <strong>{importPreview.summary?.new || 0}</strong></div>
                        <div className="text-xs"><span className="text-slate-500">Update:</span> <strong>{importPreview.summary?.update || 0}</strong></div>
                        <div className="text-xs"><span className="text-slate-500">Mappings:</span> <strong>{importPreview.summary?.storeMappings || 0}</strong></div>
                      </div>
                      {importErrors.length > 0 && (
                        <div>
                          <h4 className="text-xs font-semibold text-red-600 mb-1">Validation Errors</h4>
                          {importErrors.slice(0, 10).map((err, i) => (
                            <div key={i} className="text-xs text-red-600 px-2 py-1 bg-red-50 rounded mb-1">
                              Row {err.lineNumber} ({err.sku}): {err.errors.map((e) => e.message).join("; ")}
                            </div>
                          ))}
                          {importErrors.length > 10 && (
                            <div className="text-xs text-slate-400">...and {importErrors.length - 10} more errors</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={closeImportModal}
                      disabled={importLoading}
                      className="onepos-btn onepos-btn-secondary"
                    >
                      Cancel
                    </button>
                    {!importPreview ? (
                      <button
                        onClick={handleImportValidate}
                        disabled={importLoading || !importFile}
                        className="onepos-btn onepos-btn-primary"
                      >
                        {importLoading ? "Validating..." : "Validate"}
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => { setImportPreview(null); setImportErrors([]); }}
                          disabled={importLoading}
                          className="onepos-btn onepos-btn-secondary"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleImportExecute}
                          disabled={importLoading}
                          className="onepos-btn onepos-btn-primary"
                        >
                          {importLoading ? "Importing..." : "Confirm Import"}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {viewProduct && (
        <StandardObjectViewModal
          objectKey="product"
          record={viewProduct}
          onClose={() => setViewProduct(null)}
          onEdit={() => {
            setViewProduct(null);
            openEditForm(viewProduct);
          }}
        />
      )}

      {showProductForm && (
        <ProductFormModal
          product={editingProduct}
          categories={categories}
          preset={presetProduct}
          saving={saving}
          error={actionError}
          onClose={closeProductForm}
          onSaved={productSaved}
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
