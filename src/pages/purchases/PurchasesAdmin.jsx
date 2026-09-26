import { useEffect, useState } from "react";
import { Package, Plus, RefreshCw, X, Upload, Check, AlertCircle, Eye } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import ObjectList from "../../components/records/ObjectList.jsx";
import { parsePurchaseImport } from "../../services/purchaseImport.js";
import { buildPurchaseImportPreview } from "../../services/purchaseImportPreview.js";
import { mapPurchaseImport } from "../../services/purchaseImportMapper.js";
import { normaliseProduct } from "../../utils/formatters.js";
import { formatDateValue } from "../../utils/dateFormat.js";
import PurchaseImportModal from "./PurchaseImportModal.jsx";
import PlatformExtensionFields from "../../components/platform/PlatformExtensionFields.jsx";

/* Column formatting for the shared global list — data shaping only, the
   presentation (header, spacing, pills, primary link, actions) is ObjectList. */
const PURCHASE_COLUMNS = [
  { key: "reference_number", label: "Reference", primary: true, format: (value, purchase) => value || purchase.id.slice(0, 8) },
  { key: "supplier_name", label: "Supplier", format: (value) => value || "-" },
  { key: "store_name", label: "Store", format: (value) => value || "-" },
  { key: "purchase_date", label: "Purchase date", format: (value) => formatDateValue(value) || "-" },
  {
    key: "status",
    label: "Status",
    pill: (value) => (value === "RECEIVED" ? "success" : "neutral"),
    format: (value) => value || "-",
  },
  { key: "total", label: "Total", format: (value) => `£${Number(value || 0).toFixed(2)}` },
  { key: "created_by_username", label: "Created by", format: (value) => value || "-" },
  { key: "created_at", label: "Created date", format: (value) => new Date(value).toLocaleString() },
];

function PurchasesAdmin() {
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState(null);

  const loadPurchases = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/purchases");
      if (!data.success) throw new Error(data.message || "Unable to load purchases");
      setPurchases(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      setError(err.message || "Unable to load purchases");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPurchases();
    apiRequest("/api/products")
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setProducts(data.data.map(normaliseProduct));
        }
      })
      .catch((err) => setError(err.message || "Unable to load products"));
    apiRequest("/api/suppliers")
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setSuppliers(data.data.filter((supplier) => supplier.active));
        }
      })
      .catch((err) => setError(err.message || "Unable to load suppliers"));
  }, []);

  const createPurchase = async (purchase) => {
    try {
      setError("");
      const data = await apiRequest("/api/purchases", {
        method: "POST",
        body: JSON.stringify({ ...purchase, receiveNow: true }),
      });
      if (!data.success) throw new Error(data.message || "Unable to receive stock");
      await loadPurchases();
      setShowForm(false);
      setMessage("Purchase received and stock updated.");
    } catch (err) {
      throw err;
    }
  };

  const viewPurchase = async (purchase) => {
    try {
      setError("");
      const data = await apiRequest(`/api/purchases/${purchase.id}`);
      if (!data.success) throw new Error(data.message || "Unable to load purchase");
      setSelectedPurchase(data.data);
    } catch (err) {
      setError(err.message || "Unable to load purchase");
    }
  };

  const receivePurchase = async (purchase) => {
    try {
      setError("");
      const data = await apiRequest(`/api/purchases/${purchase.id}/receive`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!data.success) throw new Error(data.message || "Unable to receive purchase");
      await loadPurchases();
      await viewPurchase(purchase);
      setMessage("Remaining purchase stock received.");
    } catch (err) {
      setError(err.message || "Unable to receive purchase");
    }
  };

  return (
    <div>
      <div className="onepos-page-header">
        <div>
          <h1 className="onepos-page-title">Purchases</h1>
          <p className="onepos-page-subtitle">Receive supplier stock into the inventory ledger.</p>
        </div>
        <div className="onepos-page-header-actions">
          <button onClick={loadPurchases} className="onepos-btn onepos-btn-secondary">
            <RefreshCw size={16} /> Refresh
          </button>
          {/* Import stays secondary to the primary create action. */}
          <button onClick={() => { setError(""); setMessage(""); setShowImport(true); }} className="onepos-btn onepos-btn-secondary">
            <Upload size={17} /> Import
          </button>
          <button onClick={() => { setError(""); setMessage(""); setShowForm(true); }} className="onepos-btn onepos-btn-primary">
            <Plus size={17} /> New Purchase
          </button>
        </div>
      </div>

      {message && <div className="onepos-alert onepos-alert-success mb-4">{message}</div>}
      {error && <div className="onepos-alert onepos-alert-error mb-4">{error}</div>}

      <div className="onepos-card overflow-hidden">
        {loading ? (
          <div className="onepos-empty">Loading purchases...</div>
        ) : purchases.length === 0 ? (
          <div className="onepos-empty"><Package size={40} className="mb-3" /><span className="onepos-empty-title">No purchases recorded yet.</span><span>Record your first purchase to receive stock.</span></div>
        ) : (
          <ObjectList
            records={purchases}
            columns={PURCHASE_COLUMNS}
            showSearch={false}
            emptyMessage="No purchases recorded yet."
            onOpenRecord={viewPurchase}
            renderActions={(purchase) => (
              <button
                onClick={() => viewPurchase(purchase)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                title="View purchase"
              >
                <Eye size={16} />
              </button>
            )}
          />
        )}
      </div>

      {showForm && <PurchaseFormModal products={products} suppliers={suppliers} onClose={() => setShowForm(false)} onSave={createPurchase} />}
      {showImport && <PurchaseImportModal products={products} suppliers={suppliers} onClose={() => setShowImport(false)} />}
      {selectedPurchase && <PurchaseDetailModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} onReceive={() => receivePurchase(selectedPurchase)} />}
    </div>
  );
}

function PurchaseFormModal({ products, suppliers, onClose, onSave }) {
  const [supplierId, setSupplierId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [platform, setPlatform] = useState(null);
  const [platformReady, setPlatformReady] = useState(false);
  const [lines, setLines] = useState([{ productId: "", quantity: 1, unitCost: 0, batchNumber: "", manufacturingDate: "", expiryDate: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateLine = (index, field, value) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  const addLine = () => setLines((current) => [...current, { productId: "", quantity: 1, unitCost: 0, batchNumber: "", manufacturingDate: "", expiryDate: "" }]);
  const removeLine = (index) => setLines((current) => current.length === 1 ? current : current.filter((_, lineIndex) => lineIndex !== index));
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);

  const submit = async (event) => {
    event.preventDefault();
    if (lines.some((line) => !line.productId || Number(line.quantity) <= 0 || Number(line.unitCost) < 0)) {
      setError("Select a product and enter valid quantities and costs for every line.");
      return;
    }
    try {
      setSaving(true);
      setError("");
      if (!platformReady) {
        setError("Purchase configuration is still loading.");
        return;
      }
      await onSave({ supplierId: supplierId || null, referenceNumber: referenceNumber.trim() || null, purchaseDate, notes: notes.trim() || null, platform, items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: Number(line.unitCost), batchNumber: line.batchNumber.trim() || null, manufacturingDate: line.manufacturingDate || null, expiryDate: line.expiryDate || null })) });
    } catch (err) {
      setError(err.message || "Unable to receive stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[900px] max-w-full max-h-[90vh] shadow-2xl flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><h2 className="font-bold text-xl">New Purchase / Receive Stock</h2><p className="text-sm text-slate-500 mt-1">Receiving stock creates PURCHASE ledger movements.</p></div><button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div>
        <form onSubmit={submit} className="p-5 overflow-auto">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Supplier</span><select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg bg-white"><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Reference / invoice number</span><input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Purchase date</span><input required type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden"><table className="w-full"><thead><tr className="bg-slate-50">{["Product", "SKU", "Quantity", "Unit cost", "Batch", "MFG", "Expiry", "Line total", ""].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{lines.map((line, index) => { const selected = products.find((product) => product.id === line.productId); const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitCost) || 0); return <tr key={index} className="border-t border-slate-100"><td className="px-3 py-2"><select required value={line.productId} onChange={(event) => updateLine(index, "productId", event.target.value)} className="w-full h-9 border border-slate-200 rounded px-2 text-sm"><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td className="px-3 py-2 text-sm text-slate-500">{selected?.sku || "-"}</td><td className="px-3 py-2"><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="w-24 h-9 border border-slate-200 rounded px-2 text-sm" /></td><td className="px-3 py-2"><input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(index, "unitCost", event.target.value)} className="w-28 h-9 border border-slate-200 rounded px-2 text-sm" /></td><td className="px-3 py-2"><input value={line.batchNumber} onChange={(event) => updateLine(index, "batchNumber", event.target.value)} disabled={!selected?.batchTracking} placeholder={selected?.batchTracking ? "Batch no." : "-"} className="w-24 h-9 border border-slate-200 rounded px-2 text-sm disabled:bg-slate-50" /></td><td className="px-3 py-2"><input type="date" value={line.manufacturingDate} onChange={(event) => updateLine(index, "manufacturingDate", event.target.value)} disabled={!selected?.batchTracking} className="w-28 h-9 border border-slate-200 rounded px-2 text-sm disabled:bg-slate-50" /></td><td className="px-3 py-2"><input type="date" value={line.expiryDate} onChange={(event) => updateLine(index, "expiryDate", event.target.value)} disabled={!selected?.batchTracking} className="w-28 h-9 border border-slate-200 rounded px-2 text-sm disabled:bg-slate-50" /></td><td className="px-3 py-2 text-sm font-semibold">£{lineTotal.toFixed(2)}</td><td className="px-3 py-2"><button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1} className="p-2 text-red-500 hover:bg-red-50 rounded" title="Remove line"><X size={16} /></button></td></tr>; })}</tbody></table></div>
          <button type="button" onClick={addLine} className="mt-3 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"><Plus size={15} className="inline mr-1" />Add product line</button>
          <PlatformExtensionFields objectKey="purchase" coreValues={{ reference_number: referenceNumber, purchase_date: purchaseDate, notes }} onChange={setPlatform} onReady={setPlatformReady} />
          <div className="flex justify-end text-lg font-bold mt-5">Total: £{total.toFixed(2)}</div>
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200"><button type="button" onClick={onClose} disabled={saving} className="onepos-btn onepos-btn-secondary">Cancel</button><button type="submit" disabled={saving || !platformReady} className="onepos-btn onepos-btn-primary">{saving ? "Receiving..." : "Receive Stock"}</button></div>
        </form>
      </div>
    </div>
  );
}

function PurchaseDetailModal({ purchase, onClose, onReceive }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[900px] max-w-full max-h-[90vh] shadow-2xl flex flex-col"><div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><h2 className="font-bold text-xl">Purchase {purchase.reference_number || purchase.id.slice(0, 8)}</h2><p className="text-sm text-slate-500 mt-1">{purchase.supplier_name || "No supplier"} · {purchase.purchase_date} · {purchase.status}</p></div><div className="flex gap-2">{purchase.status !== "RECEIVED" && purchase.status !== "CANCELLED" && <button onClick={onReceive} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Receive remaining</button>}<button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div></div><div className="p-5 overflow-auto"><table className="w-full mb-6"><thead><tr className="bg-slate-50">{["Product", "SKU", "Ordered", "Received", "Remaining", "Unit cost", "Line total"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{(purchase.items || []).map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3 text-sm font-medium">{item.product_name}</td><td className="px-3 py-3 text-sm text-slate-500">{item.sku || "-"}</td><td className="px-3 py-3 text-sm">{item.quantity}</td><td className="px-3 py-3 text-sm">{item.received_quantity || 0}</td><td className="px-3 py-3 text-sm">{item.remaining_quantity || 0}</td><td className="px-3 py-3 text-sm">£{Number(item.unit_cost).toFixed(2)}</td><td className="px-3 py-3 text-sm font-semibold">£{Number(item.line_total).toFixed(2)}</td></tr>)}</tbody></table><div className="text-right font-bold mb-6">Total: £{Number(purchase.total || 0).toFixed(2)}</div><h3 className="font-semibold mb-3">Generated inventory movements</h3>{(purchase.movements || []).length === 0 ? <div className="text-sm text-slate-500">No movements generated.</div> : <table className="w-full"><thead><tr className="bg-slate-50">{["Product", "Movement", "Quantity", "Balance", "Date"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{purchase.movements.map((movement) => <tr key={movement.id} className="border-b border-slate-100"><td className="px-3 py-3 text-sm">{(purchase.items || []).find((item) => item.product_id === movement.product_id)?.product_name || movement.product_id}</td><td className="px-3 py-3 text-sm font-semibold">{movement.movement_type}</td><td className="px-3 py-3 text-sm text-emerald-600">+{movement.quantity_change}</td><td className="px-3 py-3 text-sm font-semibold">{movement.balance_after}</td><td className="px-3 py-3 text-xs text-slate-500">{new Date(movement.created_at).toLocaleString()}</td></tr>)}</tbody></table>}</div></div></div>
  );
}

export default PurchasesAdmin;
