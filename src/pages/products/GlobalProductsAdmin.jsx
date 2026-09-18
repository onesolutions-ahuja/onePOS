import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Filter,
  Package,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Alert,
} from "../../components/ui.jsx";
import ProductFormModal from "../products/ProductFormModal.jsx";

function GlobalProductsAdmin() {
  const [rows, setRows] = useState([]);
  const [brands, setBrands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [productCategories, setProductCategories] = useState([]);
  const [filters, setFilters] = useState({
    search: "",
    ean: "",
    brand: "",
    category: "",
  });
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [presetGlobal, setPresetGlobal] = useState(null);

  const loadAll = async () => {
    try {
      setLoading(true);
      setError("");
      const [brandsRes, categoriesRes, productCatsRes] = await Promise.all([
        apiRequest("/api/global-products/brands"),
        apiRequest("/api/global-products/categories"),
        apiRequest("/api/categories"),
      ]);
      if (brandsRes.success) setBrands(brandsRes.data || []);
      if (categoriesRes.success) setCategories(categoriesRes.data || []);
      if (productCatsRes.success) setProductCategories(productCatsRes.data || []);
    } catch (err) {
      console.error("Global product metadata error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadRows = async (pageOverride = page, applied = filters, force = false) => {
    try {
      setLoading(force ? true : false);
      setError("");
      const qs = new URLSearchParams({
        page: String(pageOverride),
        limit: "50",
      });
      if (applied.search.trim()) qs.set("search", applied.search.trim());
      if (applied.ean.trim()) qs.set("ean", applied.ean.trim());
      if (applied.brand) qs.set("brand", applied.brand);
      if (applied.category) qs.set("category", applied.category);
      const data = await apiRequest(`/api/global-products?${qs.toString()}`);
      if (!data.success) {
        throw new Error(data.message || "Unable to load global products");
      }
      setRows(data.data || []);
      setMeta(data.meta || { page: pageOverride, limit: 50, total: 0, totalPages: 0 });
    } catch (err) {
      setError(err.message || "Unable to load global products");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows(page, filters, true);
     
  }, [filters.search, filters.ean, filters.brand, filters.category, page]);

  const addToMaster = async (form) => {
    return new Promise((resolve, reject) => {
      (async () => {
        try {
          setSaving(true);
          setSaveError("");
          const response = await apiRequest("/api/products", {
            method: "POST",
            body: JSON.stringify(form),
          });
          if (!response.success) {
            throw new Error(response.message || "Unable to create product");
          }
          setMessage(response.message || "Product added to master.");
          setPresetGlobal(null);
          await loadRows(page, filters);
          resolve();
        } catch (err) {
          setSaveError(err.message || "Unable to create product");
          reject(err);
        } finally {
          setSaving(false);
        }
      })();
    });
  };

  const totals = useMemo(() => {
    const existing = rows.filter((r) => r.existsInMaster).length;
    return {
      total: meta.total,
      inMaster: existing,
      available: rows.length - existing,
    };
  }, [rows, meta]);

  const setFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
    setMessage("");
  };

  return (
    <div className="admin-page">
      <PageHeader
        title="Global Product Database"
        subtitle="Browse the shared product catalogue.  Preview reference data to quickly add products to your Product Master."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadRows(1, filters, true)}
          >
            <RefreshCw size={15} />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Database size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Catalogue records</div>
            <div className="text-lg font-bold text-slate-800">{totals.total}</div>
          </div>
        </div>
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Package size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Already in your master (this page)</div>
            <div className="text-lg font-bold text-slate-800">
              {rows.filter((r) => r.existsInMaster).length} / {rows.length}
            </div>
          </div>
        </div>
        <div className="onepos-card px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
            <Plus size={18} />
          </div>
          <div>
            <div className="text-xs text-slate-500">Ready to add</div>
            <div className="text-lg font-bold text-slate-800">{totals.available}</div>
          </div>
        </div>
      </div>

      {message && (
        <div className="mb-3">
          <Alert tone="success">{message}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <span>Global catalogue</span>
              {rows.length > 0 && (
                <Badge tone="neutral">{meta.total}</Badge>
              )}
            </div>
          }
          actions={<span className="flex items-center gap-1.5 text-slate-500"><Filter size={14}/><span className="text-xs">Filtered</span></span>}
        />

        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
          <Search
            size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Label htmlFor="gp-search" className="sr-only">
            Search product name
          </Label>
          <Input
            id="gp-search"
            value={filters.search}
            onChange={(event) => setFilter("search", event.target.value)}
            placeholder="Search product name"
            className="pl-8"
          />
        </div>
          <div>
            <Label htmlFor="gp-ean" className="sr-only">Search EAN / barcode</Label>
            <Input
              id="gp-ean"
              value={filters.ean}
              onChange={(event) => setFilter("ean", event.target.value)}
              placeholder="Search EAN / barcode"
            />
          </div>
          <div>
            <Label htmlFor="gp-brand" className="sr-only">Brand</Label>
            <select
              id="gp-brand"
              value={filters.brand}
              onChange={(event) => setFilter("brand", event.target.value)}
              className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All brands</option>
              {brands.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} ({b.product_count})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="gp-category" className="sr-only">Category</Label>
            <select
              id="gp-category"
              value={filters.category}
              onChange={(event) => setFilter("category", event.target.value)}
              className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.product_count})
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <EmptyState
            title="Loading catalogue"
            hint="Fetching global product records"
          >
            <RefreshCw size={24} className="animate-spin" />
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
          title="No global products matched"
            hint={
              meta.total === 0
                ? "The global product catalogue is empty."
                : "Try adjusting your filters."
            }
          >
            <Database size={28}/>
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="onepos-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>EAN / Barcode</th>
                    <th>Brand</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="group">
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 shrink-0 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400">
                            {row.image_url ? (
                              <img
                                src={row.image_url}
                                alt=""
                                className="w-9 h-9 rounded-md object-cover"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              <Package size={16}/>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-800 text-sm leading-tight">
                              {row.name}
                            </div>
                            {row.unit_description && (
                              <div className="text-xs text-slate-400 mt-0.5">
                                {row.unit_description}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="font-mono text-xs">{row.ean}</td>
                      <td className="text-sm">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                          {row.brand || "—"}
                        </span>
                      </td>
                      <td className="text-xs text-slate-600">
                        {[row.category, row.subcategory]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {row.existsInMaster ? (
                          <Badge tone="success">Already in Master</Badge>
                        ) : (
                          <Badge tone="neutral">Not in Master</Badge>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {row.existsInMaster ? null : (
                          <Button
                            variant="primary"
                            size="sm"
                            title={`Import ${row.name} to Product Master`}
                            onClick={() => {
                              setSaveError("");
                              setPresetGlobal({
                                ean: row.ean,
                                name: row.name,
                                brand: row.brand,
                                category: row.category,
                                subcategory: row.subcategory,
                                unitDescription: row.unit_description,
                                imageUrl: row.image_url,
                                source: row.source,
                              });
                            }}
                          >
                            <Plus size={14} />
                            Add
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {meta.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between text-xs text-slate-500">
                <div>
                  Page {meta.page} of {meta.totalPages} · {meta.total} records
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setPage((p) => Math.min(meta.totalPages, p + 1))
                    }
                    disabled={page >= meta.totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {presetGlobal && (
        <ProductFormModal
          product={null}
          categories={productCategories}
          preset={presetGlobal}
          saving={saving}
          error={saveError}
          onClose={() => {
            if (!saving) {
              setPresetGlobal(null);
              setSaveError("");
            }
          }}
          onSave={addToMaster}
        />
      )}
    </div>
  );
}

export default GlobalProductsAdmin;
