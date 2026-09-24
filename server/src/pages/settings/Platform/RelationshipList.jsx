import { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

function displayObject(relationship, side) {
  return relationship[`${side}_object_key`] || relationship[`${side}_object_id`] || "—";
}

export default function RelationshipList({ onNavigate, onMessage, onError, objectId = null }) {
  const [relationships, setRelationships] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/platform/relationships");
      const loaded = response.data || [];
      setRelationships(objectId
        ? loaded.filter((relationship) =>
            String(relationship.parent_object_id || relationship.parent_object_key) === String(objectId) ||
            String(relationship.child_object_id || relationship.child_object_key) === String(objectId))
        : loaded);
    } catch (error) {
      onError(error.message || "Unable to load relationships");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load();   }, [objectId]);

  const deactivate = async (relationship) => {
    try {
      await apiRequest(`/api/platform/relationships/${relationship.id}`, { method: "DELETE" });
      onMessage("Relationship deactivated.");
      await load();
    } catch (error) { onError(error.message || "Unable to deactivate relationship"); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold">Relationships</h1><p className="text-sm text-slate-500 mt-1">Connect metadata objects without changing existing business tables.</p></div>
        <button type="button" onClick={() => onNavigate("new-relationship")} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm">+ New Relationship</button>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        {loading ? <div className="p-8 text-sm text-slate-500">Loading relationships...</div> : relationships.length === 0 ? <div className="p-8 text-sm text-slate-500">No relationships configured.</div> : <table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-4">Name / API key</th><th>Type</th><th>Parent object</th><th>Child object</th><th>Status</th><th /></tr></thead><tbody>{relationships.map((relationship) => <tr key={relationship.id} className="border-b last:border-0"><td className="p-4"><div className="font-medium">{relationship.name || relationship.relationship_key}</div><code className="text-xs text-slate-500">{relationship.relationship_key}</code></td><td>{relationship.relationship_type}</td><td>{displayObject(relationship, "parent")}</td><td>{displayObject(relationship, "child")}</td><td>{relationship.active === false ? "Inactive" : "Active"}</td><td className="p-4 text-right whitespace-nowrap"><button type="button" onClick={() => onNavigate("edit-relationship", relationship)} className="text-blue-600 mr-3">Edit</button>{relationship.active !== false && <button type="button" onClick={() => deactivate(relationship)} className="text-red-600">Deactivate</button>}</td></tr>)}</tbody></table>}
      </div>
    </div>
  );
}
