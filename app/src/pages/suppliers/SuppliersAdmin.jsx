import { useEffect, useState } from "react";
import { Edit, Package, Plus, RefreshCw, Search, Store, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import SupplierAccountsModal from "./SupplierAccountsModal.jsx";
import GenericSupplierFormModal from "./SupplierFormModal.jsx";
import StandardObjectViewModal from "../../components/platform/StandardObjectViewModal.jsx";
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

  const supplierSaved = async () => {
    const wasEditing = Boolean(formSupplier?.id);
    await loadSuppliers();
    setFormSupplier(null);
    setMessage(wasEditing ? "Supplier updated." : "Supplier created.");
  };

  const toggleSupplier = async (supplier) => {
    try {
      setError("");
      const data = await apiRequest(`/api/platform/objects/supplier/records/${encodeURIComponent(supplier.id)}`, {
        method: "PUT",
        body: JSON.stringify({ data: { active: !supplier.active } }),
      });
      if (!data.success) throw new Error(data.message || "Unable to update supplier status");
      await loadSuppliers();
      setMessage(supplier.active ? "Supplier deactivated." : "Supplier activated.");
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
      {formSupplier && <GenericSupplierFormModal supplier={formSupplier} onClose={() => setFormSupplier(null)} onSaved={supplierSaved} />}
      {viewSupplier && <StandardObjectViewModal objectKey="supplier" record={viewSupplier} title={viewSupplier.name} onClose={() => setViewSupplier(null)}><div className="mt-6 border-t pt-4"><h3 className="font-semibold mb-3">Purchase history</h3><p className="text-sm text-slate-500">{viewSupplier.purchase_count || 0} purchases · £{Number(viewSupplier.total_purchase_value || 0).toFixed(2)} total</p></div></StandardObjectViewModal>}
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

export default SuppliersAdmin;
