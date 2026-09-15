import { useEffect, useState } from "react";
import { Package, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { normaliseProduct } from "../../utils/formatters.js";
function PurchasesAdmin() {
  const [purchases, setPurchases] = useState([]);
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Purchases</h1>
          <p className="text-sm text-slate-500 mt-1">Receive supplier stock into the inventory ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadPurchases} className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
          <button onClick={() => { setError(""); setMessage(""); setShowForm(true); }} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700">
            <Plus size={17} /> Add Purchase
          </button>
        </div>
      </div>

      {message && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading purchases...</div>
        ) : purchases.length === 0 ? (
          <div className="p-12 text-center text-slate-400"><Package size={40} className="mx-auto mb-3" /><div>No purchases recorded yet.</div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {["Reference", "Supplier", "Store", "Purchase date", "Status", "Total", "Created by", "Created date", ""].map((heading) => <th key={heading} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase whitespace-nowrap">{heading}</th>)}
              </tr></thead>
              <tbody>{purchases.map((purchase) => (
                <tr key={purchase.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-4 text-sm font-medium">{purchase.reference_number || purchase.id.slice(0, 8)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{purchase.supplier_name || "-"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{purchase.store_name || "-"}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{purchase.purchase_date}</td>
                  <td className="px-4 py-4"><span className={`px-2.5 py-1 rounded-full text-xs font-medium ${purchase.status === "RECEIVED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{purchase.status}</span></td>
                  <td className="px-4 py-4 text-sm font-semibold">£{Number(purchase.total || 0).toFixed(2)}</td>
                  <td className="px-4 py-4 text-sm text-slate-600">{purchase.created_by_username || "-"}</td>
                  <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">{new Date(purchase.created_at).toLocaleString()}</td>
                  <td className="px-4 py-4"><button onClick={() => viewPurchase(purchase)} className="px-3 py-2 text-blue-700 bg-blue-50 rounded-lg text-sm hover:bg-blue-100">View</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && <PurchaseFormModal products={products} suppliers={suppliers} onClose={() => setShowForm(false)} onSave={createPurchase} />}
      {selectedPurchase && <PurchaseDetailModal purchase={selectedPurchase} onClose={() => setSelectedPurchase(null)} />}
    </div>
  );
}

function PurchaseFormModal({ products, suppliers, onClose, onSave }) {
  const [supplierId, setSupplierId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ productId: "", quantity: 1, unitCost: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateLine = (index, field, value) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  const addLine = () => setLines((current) => [...current, { productId: "", quantity: 1, unitCost: 0 }]);
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
      await onSave({ supplierId: supplierId || null, referenceNumber: referenceNumber.trim() || null, purchaseDate, notes: notes.trim() || null, items: lines.map((line) => ({ productId: line.productId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })) });
    } catch (err) {
      setError(err.message || "Unable to receive stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[900px] max-w-full max-h-[90vh] shadow-2xl flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><h2 className="font-bold text-xl">Add Purchase / Receive Stock</h2><p className="text-sm text-slate-500 mt-1">Receiving stock creates PURCHASE ledger movements.</p></div><button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div>
        <form onSubmit={submit} className="p-5 overflow-auto">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Supplier</span><select required value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg bg-white"><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Reference / invoice number</span><input value={referenceNumber} onChange={(event) => setReferenceNumber(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Purchase date</span><input required type="date" value={purchaseDate} onChange={(event) => setPurchaseDate(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
            <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>
          </div>
          <div className="border border-slate-200 rounded-lg overflow-hidden"><table className="w-full"><thead><tr className="bg-slate-50">{["Product", "SKU", "Quantity", "Unit cost", "Line total", ""].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{lines.map((line, index) => { const selected = products.find((product) => product.id === line.productId); const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitCost) || 0); return <tr key={index} className="border-t border-slate-100"><td className="px-3 py-2"><select required value={line.productId} onChange={(event) => updateLine(index, "productId", event.target.value)} className="w-full h-9 border border-slate-200 rounded px-2 text-sm"><option value="">Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></td><td className="px-3 py-2 text-sm text-slate-500">{selected?.sku || "-"}</td><td className="px-3 py-2"><input required type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} className="w-24 h-9 border border-slate-200 rounded px-2 text-sm" /></td><td className="px-3 py-2"><input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(index, "unitCost", event.target.value)} className="w-28 h-9 border border-slate-200 rounded px-2 text-sm" /></td><td className="px-3 py-2 text-sm font-semibold">£{lineTotal.toFixed(2)}</td><td className="px-3 py-2"><button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1} className="p-2 text-red-500 hover:bg-red-50 rounded" title="Remove line"><X size={16} /></button></td></tr>; })}</tbody></table></div>
          <button type="button" onClick={addLine} className="mt-3 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"><Plus size={15} className="inline mr-1" />Add product line</button>
          <div className="flex justify-end text-lg font-bold mt-5">Total: £{total.toFixed(2)}</div>
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200"><button type="button" onClick={onClose} disabled={saving} className="h-10 px-4 border border-slate-200 rounded-lg text-sm">Cancel</button><button type="submit" disabled={saving} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">{saving ? "Receiving..." : "Receive Stock"}</button></div>
        </form>
      </div>
    </div>
  );
}

function PurchaseDetailModal({ purchase, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[900px] max-w-full max-h-[90vh] shadow-2xl flex flex-col"><div className="p-5 border-b border-slate-200 flex items-center justify-between"><div><h2 className="font-bold text-xl">Purchase {purchase.reference_number || purchase.id.slice(0, 8)}</h2><p className="text-sm text-slate-500 mt-1">{purchase.supplier_name || "No supplier"} · {purchase.purchase_date} · {purchase.status}</p></div><button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div><div className="p-5 overflow-auto"><table className="w-full mb-6"><thead><tr className="bg-slate-50">{["Product", "SKU", "Quantity", "Unit cost", "Line total"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{(purchase.items || []).map((item) => <tr key={item.id} className="border-b border-slate-100"><td className="px-3 py-3 text-sm font-medium">{item.product_name}</td><td className="px-3 py-3 text-sm text-slate-500">{item.sku || "-"}</td><td className="px-3 py-3 text-sm">{item.quantity}</td><td className="px-3 py-3 text-sm">£{Number(item.unit_cost).toFixed(2)}</td><td className="px-3 py-3 text-sm font-semibold">£{Number(item.line_total).toFixed(2)}</td></tr>)}</tbody></table><div className="text-right font-bold mb-6">Total: £{Number(purchase.total || 0).toFixed(2)}</div><h3 className="font-semibold mb-3">Generated inventory movements</h3>{(purchase.movements || []).length === 0 ? <div className="text-sm text-slate-500">No movements generated.</div> : <table className="w-full"><thead><tr className="bg-slate-50">{["Product", "Movement", "Quantity", "Balance", "Date"].map((heading) => <th key={heading} className="text-left px-3 py-2 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{purchase.movements.map((movement) => <tr key={movement.id} className="border-b border-slate-100"><td className="px-3 py-3 text-sm">{(purchase.items || []).find((item) => item.product_id === movement.product_id)?.product_name || movement.product_id}</td><td className="px-3 py-3 text-sm font-semibold">{movement.movement_type}</td><td className="px-3 py-3 text-sm text-emerald-600">+{movement.quantity_change}</td><td className="px-3 py-3 text-sm font-semibold">{movement.balance_after}</td><td className="px-3 py-3 text-xs text-slate-500">{new Date(movement.created_at).toLocaleString()}</td></tr>)}</tbody></table>}</div></div></div>
  );
}

export default PurchasesAdmin;
