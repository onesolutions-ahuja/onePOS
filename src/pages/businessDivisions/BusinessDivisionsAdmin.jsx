import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";

export default function BusinessDivisionsAdmin() {
  const [divisions, setDivisions] = useState([]);
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const response = await apiRequest("/api/business-divisions");
      setDivisions(response.data || []);
    } catch (err) { setError(err.message || "Unable to load business divisions"); }
  };
  useEffect(() => { load(); }, []);

  const create = async (event) => {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await apiRequest("/api/business-divisions", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", description: "" }); await load();
    } catch (err) { setError(err.message || "Unable to create business division"); }
    finally { setSaving(false); }
  };

  const toggle = async (division) => {
    try {
      await apiRequest(`/api/business-divisions/${division.id}/status`, { method: "PATCH", body: JSON.stringify({ active: !division.active }) });
      await load();
    } catch (err) { setError(err.message || "Unable to update business division"); }
  };

  return <section className="space-y-5">
    <div><h1 className="text-2xl font-bold text-slate-900">Business Divisions</h1><p className="text-sm text-slate-500">Organise company stores into independent business divisions.</p></div>
    {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <form onSubmit={create} className="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-end">
      <label className="text-sm">Name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="block mt-1 border rounded px-3 py-2" /></label>
      <label className="text-sm">Description<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="block mt-1 border rounded px-3 py-2" /></label>
      <button disabled={saving} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">{saving ? "Saving..." : "Create division"}</button>
    </form>
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="text-left p-3">Code</th><th className="text-left p-3">Name</th><th className="text-left p-3">Stores</th><th className="text-left p-3">Status</th><th /></tr></thead>
        <tbody>{divisions.map(d => <tr key={d.id} className="border-t"><td className="p-3 font-mono">{d.code}</td><td className="p-3">{d.name}</td><td className="p-3">{d.store_count}</td><td className="p-3">{d.active ? "Active" : "Inactive"}</td><td className="p-3 text-right"><button onClick={() => toggle(d)} className="text-blue-600">{d.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody>
      </table>
      {!divisions.length && <p className="p-6 text-slate-500">No business divisions have been created.</p>}
    </div>
  </section>;
}
