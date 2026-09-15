import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function CustomerFormModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", postcode: "", notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) { setError("Customer name is required"); return; }
    try {
      setSaving(true);
      const data = await apiRequest("/api/customers", { method: "POST", body: JSON.stringify(form) });
      if (!data.success) throw new Error(data.message || "Unable to save customer");
      onSaved(data.data.customer);
    } catch (err) { setError(err.message || "Unable to save customer"); } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[520px] max-w-full shadow-2xl"><div className="p-4 border-b flex justify-between items-center"><h2 className="font-bold text-lg">New Customer</h2><button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={18} /></button></div><form onSubmit={submit} className="p-4">{error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}<div className="grid grid-cols-2 gap-3">{[["name", "Name"], ["phone", "Phone"], ["email", "Email"], ["postcode", "Postcode"], ["address", "Address"], ["notes", "Notes"]].map(([field, label]) => <label key={field} className={`text-sm text-slate-600 ${field === "address" || field === "notes" ? "col-span-2" : ""}`}><span className="block mb-1 font-medium">{label}{field === "name" ? " *" : ""}</span>{field === "address" || field === "notes" ? <textarea rows="2" value={form[field]} onChange={(event) => update(field, event.target.value)} className="w-full px-2 py-2 border border-slate-200 rounded resize-none" /> : <input required={field === "name"} type={field === "email" ? "email" : "text"} value={form[field]} onChange={(event) => update(field, event.target.value)} className="w-full h-9 px-2 border border-slate-200 rounded" />}</label>)}</div><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} className="h-9 px-3 border rounded text-sm">Cancel</button><button disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm">{saving ? "Saving..." : "Save customer"}</button></div></form></div></div>;
}
