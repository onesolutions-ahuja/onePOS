import { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

export default function LayoutList({ onNew, onEdit, onMessage, onError, onBack, objectId = null }) {
  const [layouts, setLayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/platform/layouts?includeInactive=true");
      const loaded = response.data || [];
      setLayouts(objectId
        ? loaded.filter((layout) => String(layout.object_id) === String(objectId))
        : loaded);
    } catch (error) {
      onError(error.message || "Unable to load layouts");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [objectId]);
  const deactivate = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}`, { method: "DELETE" });
      onMessage("Layout deactivated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to deactivate layout");
    }
  };
  const clone = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/clone`, {
        method: "POST",
        body: JSON.stringify({ name: `${layout.name || layout.layout_key} Copy` }),
      });
      onMessage("Layout cloned.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to clone layout");
    }
  };
  const setDefault = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/default`, { method: "POST" });
      onMessage("Default layout updated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to set default layout");
    }
  };
  const activate = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/activate`, { method: "POST" });
      onMessage("Layout activated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to activate layout");
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">{objectId ? "Forms" : "Layouts"}</h1><p className="text-sm text-slate-500 mt-1">{objectId ? "Manage Create, Edit, View Details and Quick Create forms for this object." : "Configure metadata-driven page layouts."}</p></div>
        <button type="button" onClick={onNew} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm">+ New Form</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {loading ? <div className="p-8 text-sm text-slate-500">Loading layouts...</div> : layouts.length === 0 ? <div className="p-8 text-sm text-slate-500">No layouts configured.</div> : (
          <table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-4">Name</th><th>Object</th><th>Purpose</th><th>Role</th><th>Company</th><th>Status</th><th /></tr></thead>
            <tbody>{layouts.map((layout) => <tr key={layout.id} className="border-b last:border-0"><td className="p-4 font-medium">{layout.name || layout.label || layout.layout_key}{layout.is_default ? <span className="ml-2 text-xs text-emerald-700">Default</span> : null}</td><td>{layout.object_label || layout.object_key || layout.object_id}</td><td>{layout.page_type || layout.pageType}</td><td>{layout.role_name || layout.role_id || "All roles"}</td><td>{layout.company_name || layout.company_id || "Global"}</td><td>{layout.active === false ? "Inactive" : "Active"}</td><td className="p-4 text-right whitespace-nowrap"><button type="button" onClick={() => onEdit(layout)} className="text-blue-600 mr-3">Edit</button>{layout.active !== false ? <><button type="button" onClick={() => clone(layout)} className="text-slate-600 mr-3">Clone</button>{!layout.role_id && !layout.is_default ? <button type="button" onClick={() => setDefault(layout)} className="text-emerald-700 mr-3">Set default</button> : null}<button type="button" onClick={() => deactivate(layout)} className="text-red-600">Deactivate</button></> : <button type="button" onClick={() => activate(layout)} className="text-emerald-700">Activate</button>}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {onBack && <button type="button" onClick={onBack} className="text-sm text-slate-600">← {objectId ? "Object configuration" : "Platform"}</button>}
    </div>
  );
}
