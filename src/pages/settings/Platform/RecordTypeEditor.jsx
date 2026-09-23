import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import { toSafeApiName } from "./safeApiName.js";

export default function RecordTypeEditor({ object, fields = [] }) {
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ label: "", recordTypeKey: "", description: "", isDefault: false, defaultValues: "{}" });
  const picklistFields = fields.filter((field) => ["picklist", "select"].includes(field.field_type));
  const [picklistRestrictions, setPicklistRestrictions] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await apiRequest(`/api/platform/objects/${object.id}/record-types`);
    setTypes(response?.data || []);
  }
  useEffect(() => { load().catch((err) => setError(err?.message || "Unable to load record types.")); }, [object.id]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let defaultValues;
      try { defaultValues = JSON.parse(form.defaultValues || "{}"); } catch { throw new Error("Default values must be valid JSON."); }
      await apiRequest(`/api/platform/objects/${object.id}/record-types`, {
        method: "POST",
        body: JSON.stringify({ ...form, defaultValues, picklistRestrictions, recordTypeKey: form.recordTypeKey || toSafeApiName(form.label, "record_type") }),
      });
      setForm({ label: "", recordTypeKey: "", description: "", isDefault: false, defaultValues: "{}" });
      setPicklistRestrictions({});
      await load();
    } catch (err) {
      setError(err?.message || "Unable to save record type.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="platform-editor-card">
      <div className="platform-editor-card-header"><div><h2>Record Types</h2><p>Define tenant-specific record categories and defaults for this object.</p></div></div>
      {error ? <div className="platform-alert platform-alert-error">{error}</div> : null}
      {types.length ? <ul className="platform-record-type-list">{types.map((type) => <li key={type.id}><strong>{type.label}</strong> <code>{type.record_type_key}</code>{type.is_default ? " (default)" : ""}</li>)}</ul> : <div className="platform-editor-empty">No record types configured.</div>}
      <form className="platform-form-grid" onSubmit={save}>
        <label className="platform-form-field"><span>Label</span><input value={form.label} required onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
        <label className="platform-form-field"><span>API Key</span><input value={form.recordTypeKey} onChange={(event) => setForm({ ...form, recordTypeKey: event.target.value })} placeholder="Generated from label" /></label>
        <label className="platform-form-field platform-form-field-wide"><span>Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={2} /></label>
        <label className="platform-form-field platform-form-field-wide"><span>Default field values (JSON)</span><textarea value={form.defaultValues} onChange={(event) => setForm({ ...form, defaultValues: event.target.value })} rows={2} placeholder='{"status":"active"}' /></label>
        <label className="platform-toggle-field"><input type="checkbox" checked={form.isDefault} onChange={(event) => setForm({ ...form, isDefault: event.target.checked })} /><span><strong>Default record type</strong><small>Used when a create form explicitly selects this type.</small></span></label>
        <button type="submit" className="platform-primary-button" disabled={saving}>{saving ? "Saving…" : "Add Record Type"}</button>
      </form>
      {picklistFields.length ? (
        <div className="platform-form-field-wide">
          <strong>Available picklist values</strong>
          {picklistFields.map((field) => {
            const options = Array.isArray(field.options) ? field.options.filter((option) => option.active !== false) : [];
            return (
              <label key={field.id || field.field_id} className="platform-form-field">
                <span>{field.label}</span>
                <select
                  multiple
                  value={picklistRestrictions[field.id || field.field_id] || []}
                  onChange={(event) => setPicklistRestrictions({
                    ...picklistRestrictions,
                    [field.id || field.field_id]: Array.from(event.target.selectedOptions, (option) => option.value),
                  })}
                >
                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
