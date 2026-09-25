import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import FormRenderer from "../../pages/settings/Platform/FormRenderer.jsx";

function keyOf(value) {
  return value?.api_name || value?.apiName || value?.object_key || value?.api_name || "";
}

function valueFor(record, field) {
  const key = field.api_name;
  const source = field.source_column;
  return record?.[key] ?? record?.[source] ?? "";
}

export default function StandardObjectFormModal({
  objectKey,
  record = null,
  mode = "edit",
  title,
  onClose,
  onSaved,
  transformValues = (values) => values,
  fieldOptions = {},
  children,
}) {
  const [fields, setFields] = useState([]);
  const [definition, setDefinition] = useState(null);
  const [initialValues, setInitialValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const recordId = record?.id || record?.record_id || "";
  const fieldOptionsKey = useMemo(() => JSON.stringify(fieldOptions || {}), [fieldOptions]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const runtime = await apiRequest(`/api/platform/runtime-forms/${encodeURIComponent(objectKey)}?pageType=${mode === "quick_create" ? "quick_create" : mode === "view" ? "detail" : mode}`);
        const object = runtime?.data?.object;
        if (!object?.id) throw new Error(`Platform metadata for ${objectKey} is unavailable`);
        const loadedFields = runtime?.data?.fields || [];
        const activeFields = (Array.isArray(loadedFields) ? loadedFields : [])
          .filter((field) => field.active !== false)
          .map((field) => fieldOptions[field.api_name] ? { ...field, options: fieldOptions[field.api_name] } : field);
        if (!cancelled) {
          setFields(activeFields);
          setDefinition(runtime?.data?.layout?.definition || { components: [] });
          setInitialValues(Object.fromEntries(activeFields.map((field) => [field.api_name, valueFor(record, field)])));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Unable to load platform form");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [objectKey, mode, recordId, fieldOptionsKey]);

  const heading = title || `${mode === "create" || mode === "quick_create" ? "New" : mode === "view" ? "View" : "Edit"} ${objectKey.replaceAll("_", " ")}`;
  const presentationMode = definition?.presentation_mode || "inline";
  const presentationClass = presentationMode === "overlay_square"
    ? "standard-object-form-panel-compact"
    : presentationMode === "overlay_rectangle"
      ? "standard-object-form-panel-rectangle"
      : "standard-object-form-panel-inline";
  async function submit(values) {
    try {
      setSaving(true);
      setError("");
      const payload = transformValues(values);
      const id = record?.id || record?.record_id;
      const editing = mode === "edit" && id;
      const response = await apiRequest(`/api/platform/objects/${encodeURIComponent(objectKey)}/records${editing ? `/${encodeURIComponent(id)}` : ""}`, {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ data: payload }),
      });
      await onSaved?.(response?.data, response);
    } catch (err) {
      setError(err.message || "Unable to save record");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`standard-object-form-overlay standard-object-form-overlay-${presentationMode}`} data-presentation={presentationMode}>
      <div className={`standard-object-form-panel ${presentationClass}`}>
        <header className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-bold capitalize">{heading}</h2>
          <button type="button" onClick={onClose} disabled={saving} className="rounded p-2 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </header>
        <div className="overflow-auto p-5">
          {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {loading ? <div className="py-10 text-center text-sm text-slate-500">Loading platform form...</div> : (
            <FormRenderer
              definition={definition}
              fields={fields}
              initialValues={initialValues}
              mode={mode}
              loading={saving}
              error={error}
              onSubmit={submit}
            />
          )}
          {children}
        </div>
      </div>
      <style>{`
        .standard-object-form-overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgb(0 0 0 / 50%);
        }
        .standard-object-form-panel {
          display: flex;
          flex-direction: column;
          width: min(100%, 720px);
          max-height: 90vh;
          overflow: hidden;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: var(--onepos-radius, 12px);
          background: var(--card-background, #fff);
          box-shadow: var(--onepos-shadow-lg, 0 20px 50px rgb(0 0 0 / 20%));
        }
        .standard-object-form-panel-rectangle { width: min(100%, 860px); }
        .standard-object-form-panel-compact { width: min(100%, 540px); }
        .standard-object-form-overlay .standard-object-form-panel > header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          padding: 16px 20px;
        }
        .standard-object-form-overlay .standard-object-form-panel > header h2 {
          margin: 0;
          color: var(--text-primary, #111827);
          font-size: 18px;
          font-weight: 700;
        }
        .standard-object-form-overlay .standard-object-form-panel > div {
          overflow: auto;
          padding: 20px;
        }
        @media (max-width: 640px) {
          .standard-object-form-overlay { align-items: stretch; padding: 0; }
          .standard-object-form-panel {
            width: 100%;
            max-height: 100%;
            border-radius: 0;
          }
        }
      `}</style>
    </div>
  );
}
