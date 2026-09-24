import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";

function keyOf(object) { return String(object?.object_key || object?.api_name || object?.key || ""); }

/** Shared metadata resource picker for Flow, Approval, Form/Page and Button builders.
 * Stores canonical dotted API paths while showing friendly labels. UUID/FK values are never typed by admins.
 */
export default function MetadataResourcePicker({ objectKey = "", value = "", onChange, label = "Resource", allowVariables = true, className = "" }) {
  const [objects, setObjects] = useState([]);
  const [paths, setPaths] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { apiRequest("/api/platform/objects").then(r => setObjects(r?.data?.objects || r?.data || [])).catch(() => setObjects([])); }, []);
  const object = useMemo(() => objects.find(o => keyOf(o) === objectKey), [objects, objectKey]);
  useEffect(() => {
    if (!object?.id) return setPaths([]);
    let live = true; setLoading(true);
    apiRequest(`/api/platform/objects/${encodeURIComponent(object.id)}/record-paths?depth=4`)
      .then(r => { if (live) setPaths(Array.isArray(r?.data) ? r.data : []); })
      .catch(() => { if (live) setPaths([]); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [object?.id]);

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    const friendly = paths.filter(p => p.kind === "field").map(p => {
      const parts = p.path.split(".");
      return { value: p.path, label: `${parts.slice(1, -1).join(" → ")}${parts.length > 2 ? " → " : ""}${p.label || parts.at(-1)}`, type: p.fieldType || "field" };
    });
    const vars = allowVariables ? [
      { value: "$record.id", label: "Current Record → Record ID", type: "record" },
      { value: "$previous", label: "Previous Record", type: "record" },
      { value: "$user.id", label: "Current User → User ID", type: "global" },
      { value: "$now", label: "Current Date/Time", type: "global" },
    ] : [];
    return [...vars, ...friendly].filter(o => !q || `${o.label} ${o.value}`.toLowerCase().includes(q));
  }, [paths, search, allowVariables]);

  return <div className={`space-y-1 ${className}`}>
    <label className="block text-xs font-medium text-slate-600">{label}</label>
    <input className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search fields or related records…" />
    <select className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm" value={value || ""} onChange={e => onChange?.(e.target.value)} disabled={!objectKey || loading}>
      <option value="">{loading ? "Loading metadata…" : "Select resource"}</option>
      {value && !options.some(o => o.value === value) ? <option value={value}>{value}</option> : null}
      {options.map(o => <option key={o.value} value={o.value}>{o.label} · {o.type}</option>)}
    </select>
    {value ? <div className="truncate text-[11px] text-slate-400" title={value}>API path: {value}</div> : null}
  </div>;
}
