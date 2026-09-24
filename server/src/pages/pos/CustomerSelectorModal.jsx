import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import CustomerFormModal from "../../components/modals/CustomerFormModal.jsx";

export default function CustomerSelectorModal({ onClose, onSelected }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState([]);
  const [lookup, setLookup] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    if (!query.trim()) { setCustomers([]); setLookup([]); return; }
    const timer = setTimeout(async () => {
      try {
        setLoading(true); setError("");
        const [local, company] = await Promise.all([apiRequest(`/api/customers?search=${encodeURIComponent(query)}`), apiRequest(`/api/customer-lookup?search=${encodeURIComponent(query)}`)]);
        setCustomers(local.data || []);
        setLookup((company.data || []).filter((customer) => !customer.associated));
      } catch (err) { setError(err.message || "Unable to search customers"); } finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  const associate = async (customer) => { try { const data = await apiRequest(`/api/customers/${customer.id}/associate`, { method: "POST", body: JSON.stringify({}) }); if (!data.success) throw new Error(data.message); onSelected(customer); } catch (err) { setError(err.message || "Unable to associate customer"); } };
  if (showNew) return <CustomerFormModal onClose={() => setShowNew(false)} onSaved={onSelected} />;
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[520px] max-w-full shadow-2xl"><div className="p-4 border-b flex justify-between items-center"><div><h2 className="font-bold text-lg">Select Customer</h2><p className="text-xs text-slate-500 mt-1">Walk-in remains the default.</p></div><button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={18} /></button></div><div className="p-4"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone or email..." className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm" />{error && <div className="mt-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}{loading ? <div className="p-6 text-center text-slate-400">Searching...</div> : <div className="mt-3 max-h-60 overflow-y-auto">{customers.map((customer) => <button key={customer.id} onClick={() => onSelected(customer)} className="w-full text-left p-3 border-b hover:bg-slate-50"><div className="font-medium text-sm">{customer.name}</div><div className="text-xs text-slate-500">{customer.phone || customer.email || ""}</div></button>)}{lookup.map((customer) => <div key={customer.id} className="p-3 border-b bg-amber-50"><div className="font-medium text-sm">{customer.name}</div><div className="text-xs text-slate-500">Existing customer - not associated with this store</div><button onClick={() => associate(customer)} className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded text-xs">Add to this store</button></div>)}{query && !customers.length && !lookup.length && <div className="p-6 text-center text-slate-400 text-sm">No customers found.</div>}</div>}<button onClick={() => setShowNew(true)} className="mt-4 w-full h-9 border border-blue-200 text-blue-700 rounded text-sm font-medium">New Customer</button></div></div></div>;
}