import { useEffect, useState } from "react";
import { Eye, Edit, Plus, Power, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import ObjectList from "../../components/records/ObjectList.jsx";
import SupplierAccountsModal from "./SupplierAccountsModal.jsx";
import GenericSupplierFormModal from "./SupplierFormModal.jsx";
import StandardObjectViewModal from "../../components/platform/StandardObjectViewModal.jsx";

/* Column formatting for the shared global list — data shaping only, the
   presentation (header, spacing, pills, primary link, actions) is ObjectList. */
const SUPPLIER_COLUMNS = [
  { key: "name", label: "Supplier", primary: true },
  { key: "phone", label: "Phone", format: (value) => value || "-" },
  { key: "email", label: "Email", format: (value) => value || "-" },
  { key: "address", label: "Address", format: (value) => value || "-" },
  { key: "purchase_count", label: "Purchases", format: (value) => String(value ?? 0) },
  { key: "total_purchase_value", label: "Total value", format: (value) => `£${Number(value || 0).toFixed(2)}` },
  {
    key: "active",
    label: "Status",
    pill: (value) => (value ? "success" : "neutral"),
    format: (value) => (value ? "Active" : "Inactive"),
  },
];

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
        <div className="onepos-page-header-actions">
          <button onClick={loadSuppliers} className="onepos-btn onepos-btn-secondary"><RefreshCw size={16} /> Refresh</button>
          <button onClick={() => setFormSupplier({})} className="onepos-btn onepos-btn-primary"><Plus size={17} /> New Supplier</button>
        </div>
      </div>
      {message && <div className="onepos-alert onepos-alert-success mb-4">{message}</div>}
      {error && <div className="onepos-alert onepos-alert-error mb-4">{error}</div>}
      <div className="onepos-card overflow-hidden">
        {loading ? <div className="onepos-empty">Loading suppliers...</div> : <ObjectList records={filtered} columns={SUPPLIER_COLUMNS} searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search suppliers..." emptyMessage="No suppliers found." onOpenRecord={(supplier) => viewSupplierDetails(supplier)} renderActions={(supplier) => <div className="inline-flex items-center gap-0.5"><button onClick={() => viewSupplierDetails(supplier)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="View supplier"><Eye size={16} /></button><button onClick={() => setFormSupplier(supplier)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit supplier"><Edit size={16} /></button><button onClick={() => toggleSupplier(supplier)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title={supplier.active ? "Deactivate" : "Activate"}><Power size={16} /></button></div>} />}
      </div>
      {formSupplier && <GenericSupplierFormModal supplier={formSupplier} onClose={() => setFormSupplier(null)} onSaved={supplierSaved} />}
      {viewSupplier && <StandardObjectViewModal objectKey="supplier" record={viewSupplier} title={viewSupplier.name} onClose={() => setViewSupplier(null)} onEdit={() => { setViewSupplier(null); setFormSupplier(viewSupplier); }}><div className="mt-6 border-t pt-4"><h3 className="font-semibold mb-3">Purchase history</h3><p className="text-sm text-slate-500">{viewSupplier.purchase_count || 0} purchases · £{Number(viewSupplier.total_purchase_value || 0).toFixed(2)} total</p></div></StandardObjectViewModal>}
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
