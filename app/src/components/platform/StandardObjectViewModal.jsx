import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import FormRenderer from "../../pages/settings/Platform/FormRenderer.jsx";

export default function StandardObjectViewModal({ objectKey, record, onClose, title, children }) {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    apiRequest(`/api/platform/runtime-forms/${encodeURIComponent(objectKey)}?pageType=detail`)
      .then((response) => { if (!cancelled) setRuntime(response?.data || null); })
      .catch((err) => { if (!cancelled) setError(err.message || "Unable to load platform detail form"); });
    return () => { cancelled = true; };
  }, [objectKey]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-[850px] max-w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-bold">{title || record?.name || "Details"}</h2>
          <button type="button" onClick={onClose} className="rounded p-2 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="overflow-auto p-5">
          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {runtime && <FormRenderer definition={runtime.layout?.definition || { components: [] }} fields={runtime.fields || []} initialValues={record} mode="view" />}
          {children}
        </div>
      </div>
    </div>
  );
}
