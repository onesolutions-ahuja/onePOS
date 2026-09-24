import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../services/api.js";
import ObjectForm from "../../pages/settings/Platform/ObjectForm.jsx";

export default function PlatformExtensionFields({ objectKey, recordId, coreValues, onChange, onReady }) {
  const [configuration, setConfiguration] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [typeId, setTypeId] = useState("");
  const [initialValues, setInitialValues] = useState({});
  useEffect(() => {
    let cancelled = false;
    onReady(false); setConfiguration(null); setError("");
    apiRequest(`/api/platform/system/${objectKey}/configuration${recordId ? `?recordId=${encodeURIComponent(recordId)}` : ""}`)
      .then(({ data }) => {
        if (cancelled) return;
        const selected = data.recordTypeId || (!recordId && data.recordTypes.find(type => type.is_default)?.id) || "";
        const defaults = recordId ? {} : data.recordTypes.find(type => type.id === selected)?.default_values || {};
        const editable = new Set(data.fields.filter(field => field.config?.storage === "extension" && field.writable !== false).map(field => field.api_name));
        const values = { ...data.customFields, ...Object.fromEntries(Object.entries(defaults).filter(([name]) => editable.has(name))) };
        setConfiguration(data); setTypeId(selected); setInitialValues(values);
        onChange({ customFields: Object.fromEntries(Object.entries(values).filter(([name]) => editable.has(name))), recordTypeId: selected || null });
        onReady(true);
      }).catch(error => { if (!cancelled) setError(error.message || "Unable to load configured fields"); });
    return () => { cancelled = true; };
  }, [objectKey, recordId, attempt, onChange, onReady]);
  const fields = useMemo(() => {
    if (!configuration) return [];
    const fields = configuration.fields.filter(field => field.config?.storage === "extension");
    const layout = configuration.layouts.find(layout => layout.page_type === (recordId ? "edit" : "create") && (!layout.record_type_id || layout.record_type_id === typeId));
    const components = layout?.definition?.components?.filter(component => component.type === "field") || [];
    if (!components.length) return fields;
    const order = new Map(components.map((component, index) => [component.field_key, { ...component, index }]));
    return fields.filter(field => order.get(field.api_name)?.visible !== false).sort((a, b) => (order.get(a.api_name)?.index ?? 10000) - (order.get(b.api_name)?.index ?? 10000));
  }, [configuration, recordId, typeId]);
  function changed(values) {
    const editable = new Set(configuration.fields.filter(field => field.config?.storage === "extension" && field.writable !== false).map(field => field.api_name));
    onChange({ customFields: Object.fromEntries(Object.entries(values).filter(([name]) => editable.has(name))), recordTypeId: typeId || null });
  }
  if (error) return <div role="alert" className="my-3 text-sm text-red-700">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!configuration) return <p role="status" className="my-3 text-sm text-slate-500">Loading configured fields…</p>;
  return <section className="my-3">
    {configuration.recordTypes.length > 0 && <label className="block mb-3 text-sm">Record type
      <select className="ml-2 rounded border p-2" value={typeId} onChange={event => {
        const id = event.target.value; setTypeId(id);
        onChange(previous => ({ ...previous, recordTypeId: id || null }));
      }}><option value="">Default</option>{configuration.recordTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
    </label>}
    {fields.length > 0 && <ObjectForm embedded title="Additional details" fields={fields} initialValues={initialValues} onChange={changed} conditionFields={configuration.fields} contextValues={coreValues} />}
  </section>;
}
