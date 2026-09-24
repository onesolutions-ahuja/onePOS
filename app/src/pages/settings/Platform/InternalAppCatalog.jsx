import { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

const inputClass = "rounded border border-slate-300 px-3 py-2 text-sm";

export default function InternalAppCatalog({ onMessage, onError, onBack }) {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/platform/app-catalog");
      setApps(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      onError(error.message || "Unable to load the internal app catalogue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (app) => {
    try {
      setWorking(app.module_key);
      await apiRequest(`/api/platform/app-catalog/${encodeURIComponent(app.module_key)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !app.enabled }),
      });
      onMessage(`${app.name} ${app.enabled ? "disabled" : "enabled"}.`);
      await load();
    } catch (error) {
      onError(error.message || "Unable to update application availability");
    } finally {
      setWorking("");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Platform / Internal Apps</div>
          <h2 className="mt-1 text-xl font-semibold text-slate-800">Internal App Catalogue</h2>
          <p className="mt-1 text-sm text-slate-500">Review the onePOS applications registered with Platform metadata and control company availability.</p>
        </div>
        <button type="button" className={inputClass} onClick={onBack}>Back</button>
      </div>

      {loading ? <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading applications...</div> : (
        <div className="grid gap-3 md:grid-cols-2">
          {apps.map((app) => (
            <article key={app.module_key} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-800">{app.name}</h3>
                  <div className="mt-1 font-mono text-xs text-slate-500">{app.module_key}</div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${app.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {app.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-3 min-h-10 text-sm text-slate-600">{app.description}</p>
              <dl className="mt-3 grid gap-2 text-xs text-slate-500">
                <div><dt className="inline font-medium text-slate-700">Route: </dt><dd className="inline">{app.route || "Existing application route"}</dd></div>
                <div><dt className="inline font-medium text-slate-700">Scope: </dt><dd className="inline">{app.storeScoped ? "Store-aware" : "Company-wide"}</dd></div>
                <div><dt className="inline font-medium text-slate-700">Permissions: </dt><dd className="inline">{app.permissions?.join(", ") || "Existing application permissions"}</dd></div>
              </dl>
              <button type="button" className={`mt-4 rounded px-3 py-2 text-sm ${app.enabled ? "border border-slate-300 text-slate-700" : "bg-blue-600 text-white"}`} disabled={working === app.module_key} onClick={() => toggle(app)}>
                {working === app.module_key ? "Saving..." : app.enabled ? "Disable for company" : "Enable for company"}
              </button>
            </article>
          ))}
        </div>
      )}
      {!loading && apps.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No internal applications are registered.</div> : null}
    </div>
  );
}
