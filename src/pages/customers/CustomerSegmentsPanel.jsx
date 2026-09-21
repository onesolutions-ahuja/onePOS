import { useEffect, useState } from "react";
import { Plus, Trash2, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Customer segment management — create/edit/activate/deactivate segments,
 * view members, assign and remove customers. Company-scoped server-side;
 * segment CRUD requires the segment.manage permission and membership
 * changes require customer.edit (existing permission model).
 */
export default function CustomerSegmentsPanel({ customers = [], onClose, onChanged }) {
  const [segments, setSegments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState(null); // { id?, name, description, active }
  const [openSegment, setOpenSegment] = useState(null); // segment whose members are listed
  const [members, setMembers] = useState([]);
  const [assignId, setAssignId] = useState("");

  const loadSegments = async () => {
    try {
      setLoading(true);
      const data = await apiRequest("/api/customer-segments");
      if (!data.success) throw new Error(data.message || "Unable to load segments");
      setSegments(data.data || []);
    } catch (err) {
      setError(err.message || "Unable to load segments");
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async (segment) => {
    try {
      const data = await apiRequest(`/api/customer-segments/${segment.id}/members`);
      if (!data.success) throw new Error(data.message || "Unable to load members");
      setOpenSegment(segment);
      setMembers(data.data.members || []);
    } catch (err) {
      setError(err.message || "Unable to load segment members");
    }
  };

  useEffect(() => {
    loadSegments();
  }, []);

  const saveDraft = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const payload = { name: draft.name, description: draft.description || "", ...(draft.id ? { active: draft.active } : {}) };
      const data = await apiRequest(draft.id ? `/api/customer-segments/${draft.id}` : "/api/customer-segments", {
        method: draft.id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      if (!data.success) throw new Error(data.message || "Unable to save segment");
      setDraft(null);
      setMessage(draft.id ? "Segment updated." : "Segment created.");
      await loadSegments();
      if (onChanged) onChanged();
    } catch (err) {
      setError(err.message || "Unable to save segment");
    }
  };

  const toggleActive = async (segment) => {
    setError("");
    try {
      const data = await apiRequest(`/api/customer-segments/${segment.id}`, {
        method: "PUT",
        body: JSON.stringify({ active: !segment.active }),
      });
      if (!data.success) throw new Error(data.message);
      await loadSegments();
    } catch (err) {
      setError(err.message || "Unable to update segment");
    }
  };

  const assign = async (segment) => {
    setError("");
    setMessage("");
    try {
      const data = await apiRequest(`/api/customer-segments/${segment.id}/members`, {
        method: "POST",
        body: JSON.stringify({ customerId: assignId }),
      });
      if (!data.success) throw new Error(data.message || "Unable to assign customer");
      setAssignId("");
      setMessage(data.message || "Customer assigned.");
      if (openSegment && openSegment.id === segment.id) await loadMembers(segment);
      await loadSegments();
    } catch (err) {
      setError(err.message || "Unable to assign customer");
    }
  };

  const removeMember = async (segment, customerId) => {
    setError("");
    try {
      const data = await apiRequest(`/api/customer-segments/${segment.id}/members/${customerId}`, { method: "DELETE" });
      if (!data.success) throw new Error(data.message || "Unable to remove customer");
      await loadMembers(segment);
      await loadSegments();
    } catch (err) {
      setError(err.message || "Unable to remove customer");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-lg">Customer Segments</h2>
            <p className="text-sm text-slate-500">Group customers for reporting. Segments do not change pricing.</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {error && <div role="alert" className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          {message && <div className="mb-3 p-2 bg-emerald-50 text-emerald-700 rounded text-sm">{message}</div>}

          {draft && (
            <form onSubmit={saveDraft} className="mb-4 p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-2">
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Segment name (e.g. Wholesale)"
                className="w-full h-9 px-3 border border-slate-200 rounded text-sm"
                required
              />
              <input
                value={draft.description || ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Description (optional)"
                className="w-full h-9 px-3 border border-slate-200 rounded text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setDraft(null)} className="h-8 px-3 border border-slate-200 rounded text-sm">Cancel</button>
                <button type="submit" className="h-8 px-4 bg-blue-600 text-white rounded text-sm">{draft.id ? "Save" : "Create"}</button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="p-6 text-center text-slate-400">Loading…</div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <th className="px-3 py-2">Segment</th><th className="px-3 py-2">Customers</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {segments.map((segment) => (
                    <tr key={segment.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium">{segment.name}</div>
                        {segment.description && <div className="text-xs text-slate-500">{segment.description}</div>}
                      </td>
                      <td className="px-3 py-2">{Number(segment.member_count) || 0}</td>
                      <td className="px-3 py-2">{segment.active ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => loadMembers(segment)} title="View customers" className="p-1.5 hover:bg-slate-100 rounded"><Users size={15} /></button>
                        <button onClick={() => setDraft({ id: segment.id, name: segment.name, description: segment.description || "", active: segment.active })} title="Edit" className="p-1.5 hover:bg-slate-100 rounded">✎</button>
                        <button onClick={() => toggleActive(segment)} title={segment.active ? "Deactivate" : "Activate"} className="p-1.5 hover:bg-slate-100 rounded">{segment.active ? "◉" : "○"}</button>
                      </td>
                    </tr>
                  ))}
                  {!segments.length && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">No segments yet.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          <button onClick={() => setDraft({ name: "", description: "" })} className="mt-3 inline-flex items-center gap-1 h-9 px-3 border border-blue-200 text-blue-700 rounded text-sm font-medium">
            <Plus size={15} /> New segment
          </button>

          {openSegment && (
            <div className="mt-5 border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-sm">Customers in “{openSegment.name}”</h3>
                <button onClick={() => { setOpenSegment(null); setMembers([]); }} title="Close" className="p-1 hover:bg-slate-100 rounded"><X size={15} /></button>
              </div>
              <div className="flex gap-2 mb-2">
                <select value={assignId} onChange={(e) => setAssignId(e.target.value)} className="flex-1 h-9 px-2 border border-slate-200 rounded text-sm">
                  <option value="">Select a customer to assign…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => assign(openSegment)} disabled={!assignId} className="h-9 px-3 bg-blue-600 text-white rounded text-sm disabled:opacity-50">Assign</button>
              </div>
              <ul className="divide-y divide-slate-100">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span>{m.name}{m.active === false ? " (inactive)" : ""}</span>
                    <button onClick={() => removeMember(openSegment, m.id)} title="Remove from segment" className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                  </li>
                ))}
                {!members.length && <li className="py-3 text-center text-slate-400 text-sm">No customers in this segment.</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
