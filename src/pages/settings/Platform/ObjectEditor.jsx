import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Box, ExternalLink, ShieldCheck, X } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import FieldEditor from "./FieldEditor.jsx";
import { toSafeApiName, withGeneratedApiName } from "./safeApiName.js";
import RecordTypeEditor from "./RecordTypeEditor.jsx";
import ObjectManagerNav from "./ObjectManagerNav.jsx";
import { objectTypeDescription, objectTypeLabel } from "../../../utils/platformObjectType.js";

const EMPTY_OBJECT = {
  label: "",
  object_key: "",
  description: "",
  module_id: "",
  active: true,
};

/*
 * Object configuration navigation.
 *
 * Two kinds of tab, because the underlying architecture already works that way:
 *
 *   INTERNAL_TABS — configuration that lives on this screen (details, fields,
 *                   record types). Switching is local state; nothing is lost.
 *   TOOL_TABS     — existing Platform tools that PlatformAdmin already renders
 *                   as their own views, scoped to the selected object. These
 *                   hand off through the existing onNavigate contract rather
 *                   than duplicating those lists inside the editor.
 *
 * Actions and automation reuse the existing object-scoped platform_rules
 * editor; no second automation metadata system is introduced.
 */
const INTERNAL_TABS = [
  { key: "details", label: "Details" },
  { key: "fields", label: "Fields & Relationships" },
  { key: "record-types", label: "Record Types" },
];

/* ONE object-scoped navigation model: object configuration stays in a single
   workspace, while the existing tool views remain exposed as the canonical
   entry points for the object-scoped features they already own. */
const TOOL_TABS = [
  { key: "relationships", label: "Relationships" },
  { key: "layouts", label: "Forms" },
  { key: "page-layouts", label: "Page Layouts / Record Pages" },
  { key: "rules", label: "Validation Rules" },
  { key: "actions", label: "Actions" },
  { key: "automation", label: "Automation" },
];

function FieldAccessDialog({ field, onClose, onMessage }) {
  const fieldId = field?.id || field?.field_id;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([apiRequest("/api/admin/roles"), apiRequest(`/api/platform/fields/${fieldId}/security`)]).then(([rolesResponse, securityResponse]) => {
      if (!live) return;
      const security = new Map((securityResponse?.data || []).map((item) => [item.role_id, item]));
      setRows((rolesResponse?.data || []).map((role) => {
        const saved = security.get(role.id);
        return { roleId: role.id, roleName: role.name, readable: saved ? saved.readable !== false : field.readable !== false, writable: saved ? saved.writable === true : field.writable === true, inherited: !saved };
      }));
    }).catch((err) => live && setError(err?.message || "Unable to load field access.")).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [fieldId]);

  const toggle = (roleId, key) => setRows((current) => current.map((row) => row.roleId === roleId ? { ...row, [key]: !row[key], inherited: false } : row));
  const save = async (row) => {
    try {
      await apiRequest(`/api/platform/fields/${fieldId}/security/${row.roleId}`, { method: "PUT", body: JSON.stringify({ readable: row.readable, writable: row.writable }) });
      setRows((current) => current.map((item) => item.roleId === row.roleId ? { ...item, inherited: false } : item));
      onMessage?.(`Field access saved for ${row.roleName}.`);
    } catch (err) { setError(err?.message || "Unable to save field access."); }
  };

  return <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={`Field access for ${field.label || field.api_name}`}>
      <header className="settings-dialog-header"><div><h2>Field Access</h2><p className="text-xs text-slate-500 mt-1">{field.label || field.api_name} · role-specific visibility and edit access</p></div><button type="button" className="onepos-btn onepos-btn-sm" onClick={onClose}><X size={15}/></button></header>
      <div className="settings-dialog-body">{error ? <div className="onepos-alert onepos-alert-error mb-3">{error}</div> : null}{loading ? <div className="onepos-empty">Loading field access…</div> : <div className="overflow-x-auto"><table className="onepos-table w-full"><thead><tr><th>Role</th><th>Visible</th><th>Editable</th><th>Source</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.roleId}><td>{row.roleName}</td><td><input type="checkbox" checked={row.readable} onChange={() => toggle(row.roleId, "readable")} /></td><td><input type="checkbox" checked={row.writable} disabled={!row.readable} onChange={() => toggle(row.roleId, "writable")} /></td><td><span className="text-xs text-slate-500">{row.inherited ? "Object default" : "Role override"}</span></td><td className="text-right"><button type="button" className="onepos-btn onepos-btn-sm onepos-btn-primary" onClick={() => save(row)}>Save</button></td></tr>)}</tbody></table></div>}</div>
    </section>
  </div>;
}

export default function ObjectEditor({
  object = null,
  onBack,
  onSaved,
  onNavigate,
}) {
  const isNew = !object?.id && !object?.object_id;

  const [form, setForm] = useState(() => ({
    ...EMPTY_OBJECT,
    ...(object || {}),
  }));

  const [fields, setFields] = useState([]);
  const [modules, setModules] = useState([]);

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingField, setEditingField] = useState(null);
  const [accessField, setAccessField] = useState(null);
  const [activeTab, setActiveTab] = useState("details");

  const objectId = object?.id || object?.object_id;

  const objectName = useMemo(() => {
    return (
      form.name ||
      form.label ||
      form.object_name ||
      form.object_key ||
      "New Object"
    );
  }, [form]);

  useEffect(() => {
    setActiveTab("details");
  }, [objectId, isNew]);

  useEffect(() => {
    if (isNew) {
      loadModules();
      return;
    }

    loadObject();
  }, [objectId, isNew]);

  async function loadModules() {
    try {
      const data = await apiRequest("/api/platform/modules");
      setModules(data?.data || []);
    } catch {
      // Module selection is optional.
    }
  }

  async function loadObject() {
    setLoading(true);
    setError("");

    try {
      const [objectData, modulesData] = await Promise.all([
        apiRequest(`/api/platform/objects/${objectId}`),
        apiRequest("/api/platform/modules"),
      ]);
      const loadedObject = objectData?.data || objectData;

      setForm({
        ...EMPTY_OBJECT,
        ...(loadedObject || {}),
        name: loadedObject?.label || "",
        object_key: loadedObject?.object_key || "",
        module_id: loadedObject?.module_id || "",
      });

      setModules(
        modulesData?.data || []
      );

      await loadFields(objectId);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load the object configuration."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadFields(id = objectId) {
    if (!id) {
      setFields([]);
      return;
    }

    try {
      const data = await apiRequest(`/api/platform/objects/${id}/fields`);

      const loadedFields =
        data?.data || [];

      setFields(Array.isArray(loadedFields) ? loadedFields : []);
    } catch {
      // Fields are optional while the object is loading.
    }
  }

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      ...withGeneratedApiName(current, name, value, (label) =>
        toSafeApiName(label, "object")
      , { isNew }),
      [name]: value,
    }));
  }

  async function saveObject() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = {
        label: form.name,
        objectKey: form.object_key,
        description: form.description || "",
        moduleId: form.module_id || null,
        active: form.active !== false,
      };

      const url = isNew
        ? "/api/platform/objects"
        : `/api/platform/objects/${objectId}`;

      const method = isNew ? "POST" : "PUT";
      const response = await apiRequest(url, {
        method,
        body: JSON.stringify(payload),
      });
      const savedObject = response?.data || response;

      setForm((current) => ({
        ...current,
        ...(savedObject || {}),
      }));

      setMessage("Object saved successfully.");

      if (typeof onSaved === "function") {
        onSaved(savedObject);
      }

      if (isNew && savedObject) {
        // Parent navigation can decide how to handle the newly created object.
        return;
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to save the object."
      );
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (typeof onBack === "function") {
      onBack();
    }
  }

  /*
   * Tab activation. Internal configuration stays on this screen and keeps the
   * object selected; the existing tools are opened through the unchanged
   * onNavigate contract so PlatformAdmin keeps owning the selected object.
   */
  function openTab(tab) {
    if (tab === "details") {
      setActiveTab("details");
      return;
    }

    if (tab === "fields") {
      setActiveTab("fields");
      return;
    }

    if (tab === "record-types") {
      setActiveTab("record-types");
      return;
    }

    if (tab === "records") {
      onNavigate?.("records");
      return;
    }

    if (tab === "relationships") {
      onNavigate?.("relationships");
      return;
    }

    if (tab === "layouts") {
      onNavigate?.("layouts");
      return;
    }

    if (tab === "page-layouts") {
      onNavigate?.("page-layouts");
      return;
    }

    if (tab === "rules") {
      onNavigate?.("rules");
      return;
    }

    if (tab === "actions") {
      // Actions are stored in the existing object-scoped platform_rules model.
      onNavigate?.("rules");
      return;
    }

    if (tab === "automation") {
      onNavigate?.("rules");
    }
  }

  function getFieldId(field) {
    return (
      field.id ||
      field.field_id ||
      field.api_name ||
      field.field_key ||
      field.key
    );
  }

  function getFieldName(field) {
    return (
      field.label ||
      field.name ||
      field.field_name ||
      field.api_name ||
      field.field_key ||
      "Unnamed field"
    );
  }

  function getFieldKey(field) {
    return (
      field.field_key ||
      field.key ||
      field.name ||
      "—"
    );
  }

  function getFieldType(field) {
    return (
      field.field_type ||
      field.type ||
      "unknown"
    );
  }

  function isFieldRequired(field) {
    return Boolean(field.required || field.is_required);
  }

  function isFieldActive(field) {
    return field.active !== false && field.is_active !== false;
  }

  function getObjectKey(object_) {
    return object_.object_key || object_.key || object_.api_name || "";
  }

  if (loading) {
    return (
      <div className="onepos-empty platform-object-detail">
        <span>Loading object configuration…</span>
      </div>
    );
  }

  const typeLabel = objectTypeLabel(form);
  const objectActive = form.active !== false;
  const apiKey = getObjectKey(form);

  return (
    <div className="platform-object-detail">
      <button
        type="button"
        className="pobj-back"
        onClick={handleBack}
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Objects
      </button>

      <header className="onepos-card pobj-detail-header">
        <div className="pobj-detail-identity">
          <span className="onepos-icon-chip pobj-detail-icon" aria-hidden="true">
            <Box size={16} />
          </span>

          <div className="pobj-detail-title">
            <div className="pobj-detail-title-row">
              <h1 className="onepos-page-title">{objectName}</h1>

              {!isNew ? (
                <>
                  <span
                    className={
                      "onepos-badge "
                      + (typeLabel === "Standard" ? "onepos-badge-neutral" : "onepos-badge-info")
                    }
                    title={objectTypeDescription(form)}
                  >
                    {typeLabel}
                  </span>

                  <span
                    className={
                      "onepos-badge "
                      + (objectActive ? "onepos-badge-success" : "onepos-badge-warning")
                    }
                  >
                    {objectActive ? "Active" : "Inactive"}
                  </span>
                </>
              ) : (
                <span className="onepos-badge onepos-badge-info">New</span>
              )}
            </div>

            <p className="onepos-page-subtitle pobj-detail-subtitle">
              {apiKey ? (
                <span className="pobj-detail-api">
                  API: <code>{apiKey}</code>
                </span>
              ) : null}

              {apiKey ? <span className="pobj-detail-sep" aria-hidden="true">·</span> : null}

              <span>
                {isNew
                  ? "Configure the object definition, then add its fields."
                  : objectTypeDescription(form)}
              </span>
            </p>
          </div>
        </div>

        <div className="onepos-page-header-actions pobj-detail-actions">
          {!isNew ? (
            <button
              type="button"
              className="onepos-btn onepos-btn-sm onepos-btn-secondary"
              onClick={() => onNavigate?.("records")}
            >
              <ExternalLink size={13} aria-hidden="true" />
              Records
            </button>
          ) : null}

          <button
            type="button"
            className="onepos-btn onepos-btn-sm onepos-btn-secondary"
            onClick={handleBack}
          >
            Cancel
          </button>

          <button
            type="button"
            className="onepos-btn onepos-btn-sm onepos-btn-primary"
            onClick={saveObject}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Object"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="onepos-alert onepos-alert-error">
          <strong>Could not save.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {message ? (
        <div className="onepos-alert onepos-alert-success">
          {message}
        </div>
      ) : null}

      <div className="pobj-config-layout">
        <ObjectManagerNav
          activeKey={activeTab}
          onSelect={openTab}
          disabled={isNew}
        />

        <main className="pobj-config-content">

      {activeTab === "details" ? (
        <form
          id="platform-object-form"
          className="onepos-card pobj-panel"
          onSubmit={(event) => {
            event.preventDefault();
            saveObject();
          }}
        >
          <div className="onepos-card-header">
            <div>
              <h2 className="onepos-card-title">Object information</h2>
              <p className="pobj-panel-hint">
                Basic metadata used by the onePOS platform. Existing business
                tables remain the source of truth.
              </p>
            </div>
          </div>

          <div className="onepos-card-body pobj-form-grid">
            <label className="pobj-field">
              <span className="onepos-label">Object Label</span>
              <input
                type="text"
                className="onepos-input"
                value={form.name || ""}
                onChange={(event) =>
                  updateField("name", event.target.value)
                }
                placeholder="Customer"
                required
              />
            </label>

            <label className="pobj-field">
              <span className="onepos-label">API Name (stable)</span>
              <input
                type="text"
                className="onepos-input"
                value={
                  form.object_key ||
                  form.key ||
                  ""
                }
                readOnly
                placeholder="customer"
                required
              />
              <small>
                Generated from the label for new objects and kept stable after creation.
              </small>
            </label>

            <label className="pobj-field pobj-field-wide">
              <span className="onepos-label">Description</span>
              <textarea
                className="onepos-input"
                value={form.description || ""}
                onChange={(event) =>
                  updateField(
                    "description",
                    event.target.value
                  )
                }
                rows={3}
                placeholder="Describe what this object represents."
              />
            </label>

            <label className="pobj-field">
              <span className="onepos-label">Application / Module</span>
              <select
                className="onepos-input"
                value={form.module_id || ""}
                onChange={(event) =>
                  updateField(
                    "module_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  Platform
                </option>

                {modules.map((module) => {
                  const key =
                    module.module_key ||
                    module.key ||
                    module.id;

                  return (
                    <option
                      key={key}
                      value={module.id || key}
                    >
                      {module.name ||
                        module.display_name ||
                        key}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="pobj-toggle">
              <input
                type="checkbox"
                checked={form.active !== false}
                onChange={(event) =>
                  updateField(
                    "active",
                    event.target.checked
                  )
                }
              />

              <span>
                <strong>Active</strong>
                <small>
                  Inactive objects remain in metadata but
                  are not available for normal platform use.
                </small>
              </span>
            </label>
          </div>
        </form>
      ) : null}

      {activeTab === "fields" ? (
        <section className="onepos-card pobj-panel">
          <div className="onepos-card-header">
            <div>
              <h2 className="onepos-card-title">Fields</h2>
              <p className="pobj-panel-hint">
                Fields define the data shown by this object. Field type and
                field security are owned by the field metadata — edit them from
                the field editor.
              </p>
            </div>

            <button
              type="button"
              className="onepos-btn onepos-btn-sm onepos-btn-primary"
              disabled={isNew}
              onClick={() => setEditingField({})}
              title={
                isNew
                  ? "Save the object before adding fields."
                  : ""
              }
            >
              + Add Field
            </button>
          </div>

          {isNew ? (
            <div className="onepos-empty">
              <span>Save the object first, then configure its fields.</span>
            </div>
          ) : fields.length === 0 ? (
            <div className="onepos-empty">
              <span className="onepos-empty-title">No fields configured.</span>
              <span className="pobj-empty-hint">
                Add metadata fields after the object has been saved.
              </span>
            </div>
          ) : (
            <div className="pobj-table-wrap">
              <table className="onepos-table pobj-fields-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>API Name</th>
                    <th>Type</th>
                    <th className="pobj-col-required">Required</th>
                    <th className="pobj-col-status">Status</th>
                    <th className="pobj-col-actions" />
                  </tr>
                </thead>

                <tbody>
                  {fields.map((field) => {
                    const fieldId = getFieldId(field);

                    return (
                      <tr key={fieldId}>
                        <td>
                          <button
                            type="button"
                            className="pobj-field-name"
                            onClick={() => setEditingField(field)}
                          >
                            <strong>{getFieldName(field)}</strong>
                            <small>
                              {field.source_column
                                ? `Column: ${field.source_column}`
                                : "Metadata only"}
                            </small>
                          </button>
                        </td>

                        <td>
                          <code className="pobj-code">{getFieldKey(field)}</code>
                        </td>

                        <td>{getFieldType(field)}</td>

                        <td className="pobj-col-required">
                          {isFieldRequired(field) ? "Yes" : "No"}
                        </td>

                        <td className="pobj-col-status">
                          <span
                            className={
                              "onepos-badge "
                              + (isFieldActive(field)
                                ? "onepos-badge-success"
                                : "onepos-badge-warning")
                            }
                          >
                            {isFieldActive(field) ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td className="pobj-col-actions">
                          <div className="flex gap-1 justify-end">
                            <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => setAccessField(field)} title="Configure role field access">
                              <ShieldCheck size={13} /> Access
                            </button>
                            <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => setEditingField(field)}>Edit</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "record-types" && !isNew ? (
        <section className="pobj-panel">
          <RecordTypeEditor object={{ id: objectId }} fields={fields} />
        </section>
      ) : null}
        </main>
      </div>

      {editingField && (
        <FieldEditor
          object={{ ...object, id: objectId, label: objectName }}
          field={editingField.id || editingField.field_id ? {
            ...editingField,
            apiName: editingField.api_name,
            sourceColumn: editingField.source_column,
          } : null}
          fields={fields}
          onCancel={() => setEditingField(null)}
          onSave={async () => {
            setEditingField(null);
            setMessage("Field saved successfully.");
            await loadFields(objectId);
          }}
        />
      )}

      {accessField ? (
        <FieldAccessDialog field={accessField} onClose={() => setAccessField(null)} onMessage={setMessage} />
      ) : null}

      <style>{`
        /* Object configuration — compact administration layout on the shared
           onePOS primitives. Layout only; every colour comes from a token so
           the screen follows the selected preset, appearance and accent. */

        .platform-object-detail {
          display: flex;
          flex-direction: column;
          gap: var(--onepos-section-gap, 16px);
          color: var(--text-primary);
        }

        .pobj-back {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          align-self: flex-start;
          border: 0;
          background: transparent;
          padding: 0;
          color: var(--text-secondary);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .pobj-back:hover { color: var(--primary-color); }

        .pobj-detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
          margin: 0;
          padding: calc(var(--onepos-card-pad, 16px) * 0.85) var(--onepos-card-pad, 16px);
        }

        .pobj-detail-identity {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .pobj-detail-icon {
          background-color: var(--muted-background);
          color: var(--text-secondary);
        }

        .pobj-detail-title { min-width: 0; }

        .pobj-detail-title-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .pobj-detail-title-row .onepos-page-title { margin: 0; }

        .pobj-detail-subtitle {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.5;
        }

        .pobj-detail-api code,
        .pobj-code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11.5px;
        }

        .pobj-detail-api code {
          padding: 1px 5px;
          border-radius: 5px;
          background-color: var(--muted-background);
        }

        .pobj-detail-actions { gap: 8px; }

        .pobj-config-layout {
          display: grid;
          grid-template-columns: minmax(190px, 230px) minmax(0, 1fr);
          align-items: start;
          gap: 18px;
          min-width: 0;
        }

        .pobj-tabs {
          display: flex;
          flex-direction: column;
          gap: 16px;
          position: sticky;
          top: 12px;
          min-width: 0;
          padding: 12px 10px;
          border: 1px solid var(--border-color);
          border-radius: var(--onepos-radius, 12px);
          background: var(--onepos-surface-raised);
        }

        .pobj-tabs-group {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .pobj-tabs-heading {
          padding: 0 9px 4px;
          color: var(--text-secondary);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .pobj-config-content {
          min-width: 0;
        }

        .pobj-tab-count {
          margin-left: auto;
          padding: 0 6px;
          border-radius: 999px;
          background-color: var(--muted-background);
          font-size: 11px;
        }

        .pobj-tab-tool:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .pobj-tabs .onepos-tab {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          width: 100%;
          min-height: 36px;
          padding: 7px 9px;
          border: 0;
          border-left: 3px solid transparent;
          border-radius: var(--onepos-radius-sm, 8px);
          background: transparent;
          color: var(--text-secondary);
          font: inherit;
          font-size: 12px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
        }

        .pobj-tabs .onepos-tab:hover:not(:disabled) {
          color: var(--primary-color);
          background: var(--muted-background);
        }

        .pobj-tabs .onepos-tab-active {
          border-left-color: var(--primary-color);
          color: var(--primary-color);
          background: var(--muted-background);
          font-weight: 600;
        }

        .pobj-panel { margin: 0; }

        .pobj-panel-hint {
          margin: 4px 0 0;
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
        }

        .pobj-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: var(--onepos-form-gap, 16px);
        }

        .pobj-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .pobj-field-wide { grid-column: 1 / -1; }

        .pobj-field small {
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.4;
        }

        .pobj-field textarea { resize: vertical; min-height: 72px; }

        .pobj-toggle {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding-top: 22px;
        }

        .pobj-toggle strong,
        .pobj-toggle small { display: block; }

        .pobj-toggle strong { font-size: 12px; }

        .pobj-toggle small {
          margin-top: 4px;
          color: var(--text-secondary);
          font-size: 11px;
          line-height: 1.4;
        }

        .pobj-table-wrap { overflow-x: auto; }

        .pobj-fields-table { min-width: 560px; }
        .pobj-fields-table td { vertical-align: middle; }

        .pobj-field-name {
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-width: 320px;
          border: 0;
          background: transparent;
          padding: 0;
          color: var(--text-primary);
          text-align: left;
          cursor: pointer;
        }

        .pobj-field-name strong { font-size: 13px; font-weight: 600; }

        .pobj-field-name small {
          color: var(--text-secondary);
          font-size: 11px;
        }

        .pobj-code {
          padding: 2px 6px;
          border-radius: 5px;
          background-color: var(--muted-background);
        }

        .pobj-col-actions { text-align: right; }
        .pobj-empty-hint { margin-top: 4px; font-size: 12.5px; }

        @media (max-width: 900px) {
          .pobj-config-layout { grid-template-columns: 1fr; }
          .pobj-tabs {
            position: static;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pobj-tabs-group { min-width: 0; }
          .pobj-col-status { display: none; }
        }

        @media (max-width: 700px) {
          .pobj-detail-header {
            flex-direction: column;
            align-items: stretch;
          }

          .pobj-tabs { grid-template-columns: 1fr; }
          .pobj-form-grid { grid-template-columns: 1fr; }
          .pobj-field-wide { grid-column: auto; }
          .pobj-toggle { padding-top: 0; }
          .pobj-col-required { display: none; }
          .pobj-fields-table { min-width: 0; }
        }
      `}</style>
    </div>
  );
}
