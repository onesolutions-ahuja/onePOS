import PlatformExtensionFields from "../../components/platform/PlatformExtensionFields.jsx";
import { useEffect, useState } from "react";
import { Edit, Package, Plus, RefreshCw, Search, Store, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import SupplierAccountsModal from "./SupplierAccountsModal.jsx";
function SuppliersAdmin({ permissions = [], isAdmin = false }) {
  const [suppliers, setSuppliers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [formSupplier, setFormSupplier] = useState(null);
  const [viewSupplier, setViewSupplier] = useState(null);
  const [accountsSupplier, setAccountsSupplier] = useState(null);
  const canManageAccounts = isAdmin || permissions.includes("purchase.edit") || permissions.includes("inventory.adjust");
  const canManagePayments = isAdmin || permissions.includes("payment.manage") || permissions.includes("purchase.edit") || permissions.includes("inventory.adjust");

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/suppliers");
      if (!data.success) throw new Error(data.message || "Unable to load suppliers");
      setSuppliers(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      setError(err.message || "Unable to load suppliers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const saveSupplier = async (form) => {
    const data = await apiRequest(form.id ? `/api/suppliers/${form.id}` : "/api/suppliers", {
      method: form.id ? "PUT" : "POST",
      body: JSON.stringify(form),
    });
    if (!data.success) throw new Error(data.message || "Unable to save supplier");
    await loadSuppliers();
    setFormSupplier(null);
    setMessage(form.id ? "Supplier updated." : "Supplier created.");
  };

  const toggleSupplier = async (supplier) => {
    try {
      setError("");
      const data = await apiRequest(`/api/suppliers/${supplier.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ active: !supplier.active }),
      });
      if (!data.success) throw new Error(data.message || "Unable to update supplier status");
      await loadSuppliers();
      setMessage(data.message);
    } catch (err) {
      setError(err.message || "Unable to update supplier status");
    }
  };

  const filtered = suppliers.filter((supplier) => {
    const query = search.toLowerCase().trim();
    return !query || [supplier.name, supplier.phone, supplier.email, supplier.address]
      .some((value) => (value || "").toLowerCase().includes(query));
  });

  return (
    <div>
      <div className="onepos-page-header">
        <div><h1 className="onepos-page-title">Suppliers</h1><p className="onepos-page-subtitle">Manage suppliers used by purchasing.</p></div>
        <div className="flex gap-2">
          <button onClick={loadSuppliers} className="onepos-btn onepos-btn-secondary"><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => setFormSupplier({})} className="onepos-btn onepos-btn-primary"><Plus size={17} /> Add Supplier</button>
        </div>
      </div>
      {message && <div className="onepos-alert onepos-alert-success mb-4">{message}</div>}
      {error && <div className="onepos-alert onepos-alert-error mb-4">{error}</div>}
      <div className="onepos-card overflow-hidden">
        <div className="onepos-toolbar relative max-w-md"><Search size={18} className="absolute left-7 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search suppliers..." className="onepos-input pl-10" /></div>
        {loading ? <div className="onepos-empty">Loading suppliers...</div> : filtered.length === 0 ? <div className="onepos-empty"><span className="onepos-empty-title">No suppliers found.</span></div> : <div className="overflow-x-auto"><table className="onepos-table"><thead><tr>{["Supplier", "Phone", "Email", "Address", "Purchases", "Total value", "Status", "Actions"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{filtered.map((supplier) => <tr key={supplier.id}><td className="px-4 py-4 text-sm font-medium">{supplier.name}</td><td className="px-4 py-4 text-sm text-slate-600">{supplier.phone || "-"}</td><td className="px-4 py-4 text-sm text-slate-600">{supplier.email || "-"}</td><td className="px-4 py-4 text-sm text-slate-600 max-w-[220px] truncate">{supplier.address || "-"}</td><td className="px-4 py-4 text-sm">{supplier.purchase_count}</td><td className="px-4 py-4 text-sm font-semibold">£{Number(supplier.total_purchase_value || 0).toFixed(2)}</td><td className="px-4 py-4"><span className={`onepos-badge ${supplier.active ? "onepos-badge-success" : "onepos-badge-neutral"}`}>{supplier.active ? "Active" : "Inactive"}</span></td><td className="px-4 py-4 whitespace-nowrap"><button onClick={() => viewSupplierDetails(supplier)} className="px-2 py-2 text-blue-700 bg-blue-50 rounded-lg text-sm mr-1">View</button><button onClick={() => setFormSupplier(supplier)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg" title="Edit supplier"><Edit size={16} /></button><button onClick={() => toggleSupplier(supplier)} className="ml-1 px-2 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">{supplier.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>}
      </div>
      {formSupplier && <SupplierFormModal supplier={formSupplier} onClose={() => setFormSupplier(null)} onSave={saveSupplier} />}
      {viewSupplier && <SupplierDetailModal supplier={viewSupplier} onClose={() => setViewSupplier(null)} onOpenAccounts={() => { setViewSupplier(null); setAccountsSupplier(viewSupplier); }} />}
      {accountsSupplier && <SupplierAccountsModal supplier={accountsSupplier} canManage={canManageAccounts} canManagePayments={canManagePayments} onClose={() => setAccountsSupplier(null)} />}
    </div>
  );

  async function viewSupplierDetails(supplier) {
    try {
      setError("");
      const data = await apiRequest(`/api/suppliers/${supplier.id}`);
      if (!data.success) throw new Error(data.message || "Unable to load supplier");
      setViewSupplier(data.data);
    } catch (err) {
      setError(err.message || "Unable to load supplier");
    }
  }
}

function SupplierFormModal({ supplier, onClose, onSave }) {
  const [platform, setPlatform] = useState(null);
  const [platformReady, setPlatformReady] = useState(false);
  const [form, setForm] = useState({ id: supplier.id, name: supplier.name || "", phone: supplier.phone || "", email: supplier.email || "", address: supplier.address || "", notes: supplier.notes || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => { event.preventDefault(); if (!platformReady) return; if (!form.name.trim()) { setError("Supplier name is required."); return; } try { setSaving(true); await onSave({ ...form, platform, name: form.name.trim() }); } catch (err) { setError(err.message || "Unable to save supplier"); } finally { setSaving(false); } };
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="onepos-card w-[560px] max-w-full"><div className="onepos-card-header"><h2 className="font-bold text-xl">{supplier.id ? "Edit Supplier" : "Add Supplier"}</h2><button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div><form onSubmit={submit} className="p-5">{error && <div className="onepos-alert onepos-alert-error mb-4">{error}</div>}<div className="grid grid-cols-2 gap-4">{[["name", "Name *"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"], ["notes", "Notes"]].map(([field, label]) => <label key={field} className={`text-sm text-slate-600 ${field === "address" || field === "notes" ? "col-span-2" : ""}`}><span className="block mb-1 font-medium">{label}</span>{field === "address" || field === "notes" ? <textarea rows="2" value={form[field]} onChange={(event) => update(field, event.target.value)} className="onepos-input resize-none" /> : <input required={field === "name"} type={field === "email" ? "email" : "text"} value={form[field]} onChange={(event) => update(field, event.target.value)} className="onepos-input" />}</label>)}</div><PlatformExtensionFields objectKey="supplier" recordId={supplier.id} coreValues={form} onChange={setPlatform} onReady={setPlatformReady} /><div className="flex justify-end gap-2 mt-6 pt-4 border-t"><button type="button" onClick={onClose} disabled={saving} className="onepos-btn onepos-btn-secondary">Cancel</button><button type="submit" disabled={saving || !platformReady} className="onepos-btn onepos-btn-primary">{saving ? "Saving..." : "Save supplier"}</button></div></form></div></div>;
}

function SupplierDetailModal({ supplier, onClose }) {
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="onepos-card w-[850px] max-w-full max-h-[85vh] flex flex-col"><div className="onepos-card-header"><div><h2 className="font-bold text-xl">{supplier.name}</h2><p className="text-sm text-slate-500 mt-1">{supplier.email || supplier.phone || "Supplier details"}</p></div><button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button></div><div className="p-5 overflow-auto"><div className="grid grid-cols-2 gap-3 text-sm mb-6"><div><span className="text-slate-500">Phone</span><div className="font-medium">{supplier.phone || "-"}</div></div><div><span className="text-slate-500">Email</span><div className="font-medium">{supplier.email || "-"}</div></div><div><span className="text-slate-500">Address</span><div className="font-medium">{supplier.address || "-"}</div></div><div><span className="text-slate-500">Status</span><div className="font-medium">{supplier.active ? "Active" : "Inactive"}</div></div></div><div className="flex gap-8 mb-5"><div><div className="text-sm text-slate-500">Purchases</div><div className="text-xl font-bold">{supplier.purchase_count}</div></div><div><div className="text-sm text-slate-500">Total purchased</div><div className="text-xl font-bold">£{Number(supplier.total_purchase_value || 0).toFixed(2)}</div></div></div><h3 className="font-semibold mb-3">Purchase history</h3>{supplier.purchases?.length ? <table className="onepos-table"><thead><tr>{["Reference", "Date", "Store", "Status", "Total"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{supplier.purchases.map((purchase) => <tr key={purchase.id}><td className="px-3 py-3 text-sm">{purchase.reference_number || purchase.id.slice(0, 8)}</td><td className="px-3 py-3 text-sm">{purchase.purchase_date}</td><td className="px-3 py-3 text-sm">{purchase.store_name || "-"}</td><td className="px-3 py-3 text-sm">{purchase.status}</td><td className="px-3 py-3 text-sm font-semibold">£{Number(purchase.total || 0).toFixed(2)}</td></tr>)}</tbody></table> : <div className="onepos-empty"><span className="onepos-empty-title">No purchases found.</span></div>}</div></div></div>;
}

export default SuppliersAdmin;
