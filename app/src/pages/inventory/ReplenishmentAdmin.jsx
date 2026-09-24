import { useEffect, useMemo, useState } from "react";
import { Package, Plus, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, Label, PageHeader, Select } from "../../components/ui.jsx";

/* T10H — replenishment suggestions: read-only planning layer. Never
 * writes stock. Optional PO action reuses POST /api/purchases. */
function PurchaseFromSuggestionsModal({ lines, onClose, onCreated }) {
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(lines.map((line) => [line.id, String(line.suggestedReorder ?? "")]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    apiRequest("/api/suppliers").then((data) => {
      if (alive && data.success && Array.isArray(data.data)) setSuppliers(data.data.filter((s) => s.active));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(quantities[line.id]) || 0), 0),
    [lines, quantities]
  );

  const submit = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError("");
      const items = lines.map((line) => ({
        productId: line.id, quantity: Number(quantities[line.id]), unitCost: 0,
      })).filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
      if (!items.length) throw new Error("Enter a quantity greater than zero for at least one product.");
      await apiRequest("/api/purchases", {
        method: "POST",
        body: JSON.stringify({ supplierId: supplierId || null, items, receiveNow: false }),
      });
      onCreated(`Draft purchase order created with ${items.length} line(s). Stock is unchanged until it is received in Purchases.`);
    } catch (err) {
      setError(err.message || "Unable to create purchase order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[640px] max-w-full max-h-[90vh] shadow-2xl flex flex-col">
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-bold text-xl">Create Purchase Order</h2>
          <p className="text-sm text-slate-500 mt-1">Draft order pre-filled from suggestions. Stock is unchanged until received in Purchases.</p>
        </div>
        <form onSubmit={submit} className="p-5 overflow-auto">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          <Label>Supplier (optional)
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1">
              <option value="">No supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Label>
          <table className="onepos-table mt-4">
            <thead><tr><th>Product</th><th className="text-right">Suggested</th><th className="text-right">Order qty</th></tr></thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="text-sm font-medium">{line.name}</td>
                  <td className="text-right text-sm text-slate-500">{line.suggestedReorder}</td>
                  <td className="text-right">
                    <input type="number" min="0" step="1" value={quantities[line.id]}
                      onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                      className="w-24 h-9 border border-slate-200 rounded px-2 text-sm text-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-200">
            <span className="text-sm text-slate-500">Total units: <strong className="text-slate-800">{total}</strong></span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={saving || total <= 0}>{saving ? "Creating..." : "Create draft order"}</Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReplenishmentAdmin({ canCreatePurchase = false }) {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "all", category: "" });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPO, setShowPO] = useState(false);
  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [suggestions, cats] = await Promise.all([
        apiRequest("/api/inventory/replenishment"),
        apiRequest("/api/categories").catch(() => ({ success: false, data: [] })),
      ]);
      if (!suggestions.success) throw new Error("Unable to load suggestions");
      setRows(Array.isArray(suggestions.data) ? suggestions.data : []);
      if (cats.success && Array.isArray(cats.data)) setCategories(cats.data);
      setSelected([]);
    } catch (err) {
      setError(err.message || "Unable to load suggestions");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.status === "low" && row.status !== "Low stock") return false;
      if (filters.status === "out" && row.status !== "Out of stock") return false;
      if (filters.category && String(row.categoryId || "") !== String(filters.category)) return false;
      if (q && ![row.name, row.sku, row.barcode].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, filters]);
  const toggle = (id) => setSelected((c) => (c.includes(id) ? c.filter((s) => s !== id) : [...c, id]));
  const selectedLines = useMemo(() => filtered.filter((r) => selected.includes(r.id) && (r.suggestedReorder ?? 0) > 0), [filtered, selected]);
  const allChecked = filtered.length > 0 && filtered.every((row) => selected.includes(row.id));
  return (
    <div>
      <PageHeader
        title="Replenishment"
        subtitle="Low-stock reorder suggestions from live inventory."
        actions={<><Button variant="secondary" size="sm" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</Button>
          {canCreatePurchase && <Button variant="primary" size="sm" onClick={() => setShowPO(true)} disabled={selectedLines.length === 0}><Plus size={14} /> Create Purchase Order ({selectedLines.length})</Button>}</>}
      />
      {message && <Alert tone="success" className="mb-4">{message}</Alert>}
      <Card className="mb-4">
        <CardHeader title="Filters" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 px-4 pb-4">
          <Label>Search product / barcode
            <span className="relative block mt-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Name, SKU or barcode" className="pl-8" />
            </span>
          </Label>
          <Label>Low-stock status
            <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="mt-1">
              <option value="all">All low stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </Select>
          </Label>
          <Label>Category
            <Select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="mt-1">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Label>
          <Label>Brand
            <Input value="" disabled placeholder="Not in Product Master v1" className="mt-1" />
          </Label>
        </div>
      </Card>
      <Card>
        <CardHeader title={`Suggestions (${filtered.length})`} />
        {loading ? <div className="p-10 text-center text-sm text-slate-400">Loading suggestions...</div>
        : error ? <div className="p-6"><Alert tone="error">{error}</Alert></div>
        : filtered.length === 0 ? (
          <EmptyState title="No replenishment needed" hint="No products are at or below their low-stock threshold." />
        ) : (
          <div className="overflow-x-auto">
            <table className="onepos-table">
              <thead><tr>
                <th className="w-10"><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? [] : filtered.map((r) => r.id))} aria-label="Select all" className="w-4 h-4 accent-blue-600" /></th>
                <th>Product name</th><th>Barcode / EAN</th><th>Current stock</th><th>Low-stock threshold</th><th className="text-right">Suggested reorder qty</th><th>Status</th>
              </tr></thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} aria-label={`Select ${row.name}`} className="w-4 h-4 accent-blue-600" /></td>
                    <td><div className="font-medium text-sm">{row.name}</div><div className="text-xs text-slate-400">{row.category || "—"}</div></td>
                    <td className="font-mono text-xs">{row.barcode || "—"}</td>
                    <td className="text-sm font-semibold">{row.stock}</td>
                    <td className="text-sm text-slate-600">{row.lowStockLevel}</td>
                    <td className="text-right text-sm font-semibold">{row.hasSuggestion ? row.suggestedReorder : "No reorder quantity configured"}</td>
                    <td><Badge tone={row.status === "Out of stock" ? "danger" : "warning"}>{row.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {showPO && selectedLines.length > 0 && (
        <PurchaseFromSuggestionsModal lines={selectedLines} onClose={() => setShowPO(false)}
          onCreated={(msg) => { setShowPO(false); setSelected([]); setMessage(msg); }} />
      )}
    </div>
  );
}

export default ReplenishmentAdmin;