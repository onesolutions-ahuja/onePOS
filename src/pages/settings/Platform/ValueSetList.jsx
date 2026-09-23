import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import { toSafeApiName } from "./safeApiName.js";

export default function ValueSetList({ onBack, onMessage, onError }) {
  const [valueSets, setValueSets] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ label: "", description: "", valueSetKey: "" });
  const [value, setValue] = useState({ label: "", value: "" });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await apiRequest("/api/platform/value-sets");
      const loaded = Array.isArray(response?.data) ? response.data : [];
      setValueSets(loaded);
      if (selected) setSelected(loaded.find((valueSet) => valueSet.id === selected.id) || null);
    } catch (error) {
      onError?.(error.message || "Unable to load value sets.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateSet(name, next) {
    setForm((current) => ({
      ...current,
      ...(name === "label" && !current.valueSetKey ? { valueSetKey: toSafeApiName(next, "value_set") } : {}),
      [name]: next,
    }));
  }

  async function saveSet(event) {
    event.preventDefault();
    try {
      const response = await apiRequest(selected ? `/api/platform/value-sets/${selected.id}` : "/api/platform/value-sets", {
        method: selected ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      const saved = response?.data;
      onMessage?.(selected ? "Value set updated." : "Value set created.");
      await load();
      if (!selected && saved) setSelected(saved);
    } catch (error) {
      onError?.(error.message || "Unable to save value set.");
    }
  }

  async function addValue(event) {
    event.preventDefault();
    if (!selected) return;
    try {
      await apiRequest(`/api/platform/value-sets/${selected.id}/values`, {
        method: "POST",
        body: JSON.stringify({ ...value, value: value.value || toSafeApiName(value.label) }),
      });
      setValue({ label: "", value: "" });
      await load();
      onMessage?.("Value added.");
    } catch (error) {
      onError?.(error.message || "Unable to add value.");
    }

    async function updateValue(item, changes) {
      try {
        await apiRequest(`/api/platform/value-set-values/${item.id}`, {
          method: "PUT",
          body: JSON.stringify(changes),
        });
        await load();
        onMessage?.("Value updated.");
      } catch (error) {
        onError?.(error.message || "Unable to update value.");
      }

      async function toggleValueSet() {
        if (!selected) return;
        try {
          await apiRequest(`/api/platform/value-sets/${selected.id}`, {
            method: "PUT",
            body: JSON.stringify({ active: selected.active === false }),
          });
          await load();
          onMessage?.("Value set status updated.");
        } catch (error) {
          onError?.(error.message || "Unable to update value set status.");
        }
      }
    }
  }

  function selectSet(valueSet) {
    setSelected(valueSet);
    setForm({ label: valueSet.label, description: valueSet.description || "", valueSetKey: valueSet.value_set_key });
  }

  return (
    <div className="platform-object-page">
      <button type="button" className="platform-back-button" onClick={onBack}>← Platform settings</button>
      <div className="platform-object-header">
        <div><div className="platform-eyebrow">PLATFORM / VALUE SETS</div><h1>Reusable Value Sets</h1><p>Define tenant-scoped controlled values shared by Platform picklist fields.</p></div>
        <button type="button" className="platform-primary-button" onClick={() => { setSelected(null); setForm({ label: "", description: "", valueSetKey: "" }); }}>+ New Value Set</button>
      </div>
      <div className="platform-editor-card">
        {loading ? <div className="platform-empty-state">Loading value sets…</div> : valueSets.length === 0 ? <div className="platform-empty-state">No reusable value sets configured.</div> : (
          <div className="platform-field-table-wrap"><table className="platform-field-table"><thead><tr><th>Label</th><th>API Key</th><th>Status</th><th /></tr></thead><tbody>
            {valueSets.map((valueSet) => <tr key={valueSet.id}><td><button type="button" className="platform-object-name" onClick={() => selectSet(valueSet)}>{valueSet.label}</button></td><td><code>{valueSet.value_set_key}</code></td><td>{valueSet.active === false ? "Inactive" : "Active"}</td><td>{(valueSet.values || []).length} values</td></tr>)}
          </tbody></table></div>
        )}
      </div>
      {(selected || form.label !== "") && (
        <div className="platform-editor-card">
          <form onSubmit={saveSet} className="platform-form-grid">
            <label><span>Value Set Label</span><input value={form.label} onChange={(event) => updateSet("label", event.target.value)} required /></label>
            <label><span>API Key (stable)</span><input value={form.valueSetKey} readOnly required /></label>
            <label className="platform-form-field-wide"><span>Description</span><textarea value={form.description} onChange={(event) => updateSet("description", event.target.value)} rows={2} /></label>
            <button type="submit" className="platform-primary-button">{selected ? "Save Value Set" : "Create Value Set"}</button>
            {selected ? <button type="button" className="platform-secondary-button" onClick={toggleValueSet}>{selected.active === false ? "Activate Value Set" : "Deactivate Value Set"}</button> : null}
          </form>
          {selected ? <><h2>Values</h2><form onSubmit={addValue} className="platform-form-grid"><label><span>Label</span><input value={value.label} onChange={(event) => setValue((current) => ({ ...current, label: event.target.value, value: current.value || toSafeApiName(event.target.value) }))} required /></label><label><span>Stable Value</span><input value={value.value} readOnly required /></label><button type="submit" className="platform-secondary-button">Add Value</button></form><ul>{(selected.values || []).map((item, index, items) => <li key={item.id}>{item.label} (<code>{item.value}</code>) <button type="button" onClick={() => updateValue(item, { active: item.active === false })}>{item.active === false ? "Activate" : "Deactivate"}</button> <button type="button" disabled={index === 0} onClick={() => updateValue(item, { displayOrder: index - 1 })}>↑</button> <button type="button" disabled={index === items.length - 1} onClick={() => updateValue(item, { displayOrder: index + 1 })}>↓</button></li>)}</ul></> : null}
        </div>
      )}
    </div>
  );
}
