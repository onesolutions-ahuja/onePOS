import React, { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import FieldEditor from "./FieldEditor.jsx";
import { toSafeApiName, withGeneratedApiName } from "./safeApiName.js";
import RecordTypeEditor from "./RecordTypeEditor.jsx";

const EMPTY_OBJECT = {
  label: "",
  object_key: "",
  description: "",
  module_id: "",
  active: true,
};

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

  async function saveObject(event) {
    event.preventDefault();

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

  if (loading) {
    return (
      <div className="platform-editor-page">
        <div className="platform-editor-loading">
          Loading object configuration…
        </div>
      </div>
    );
  }

  return (
    <div className="platform-editor-page">
      <div className="platform-editor-header">
        <div className="platform-editor-title">
          <button
            type="button"
            className="platform-back-button"
            onClick={handleBack}
          >
            ← Objects
          </button>

          <div className="platform-eyebrow">
            PLATFORM / OBJECTS
          </div>

          <h1>{objectName}</h1>

          <p>
            Configure the object definition and its metadata.
            Existing business tables remain the source of truth.
          </p>
        </div>

        <div className="platform-editor-actions">
          {!isNew ? (
            <>
              <button type="button" className="platform-secondary-button" onClick={() => onNavigate?.("records")}>
                Records
              </button>
              <button type="button" className="platform-secondary-button" onClick={() => onNavigate?.("relationships")}>
                Relationships
              </button>
              <button type="button" className="platform-secondary-button" onClick={() => onNavigate?.("layouts")}>
                Forms
              </button>
              <button type="button" className="platform-secondary-button" onClick={() => onNavigate?.("rules")}>
                Validation Rules
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="platform-secondary-button"
            onClick={handleBack}
          >
            Cancel
          </button>

          <button
            type="submit"
            form="platform-object-form"
            className="platform-primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Object"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="platform-alert platform-alert-error">
          <strong>Could not save.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {message ? (
        <div className="platform-alert platform-alert-success">
          {message}
        </div>
      ) : null}

      <form
        id="platform-object-form"
        onSubmit={saveObject}
      >
        <section className="platform-editor-card">
          <div className="platform-editor-card-header">
            <div>
              <h2>Object Information</h2>
              <p>
                Basic metadata used by the onePOS platform.
              </p>
            </div>
          </div>

          <div className="platform-form-grid">
            <label className="platform-form-field">
              <span>Object Label</span>
              <input
                type="text"
                value={form.name || ""}
                onChange={(event) =>
                  updateField("name", event.target.value)
                }
                placeholder="Customer"
                required
              />
            </label>

            <label className="platform-form-field">
              <span>API Key (stable)</span>
              <input
                type="text"
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

            <label className="platform-form-field platform-form-field-wide">
              <span>Description</span>
              <textarea
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

            <label className="platform-form-field">
              <span>Application / Module</span>
              <select
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

            <label className="platform-toggle-field">
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
        </section>
      </form>

      <section className="platform-editor-card">
        <div className="platform-editor-card-header">
          <div>
            <h2>Fields</h2>
            <p>
              Fields define the data shown by this object.
              Existing Retail POS fields can be mapped to
              existing database columns.
            </p>
          </div>

          <button
            type="button"
            className="platform-secondary-button"
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
          <div className="platform-editor-empty">
            Save the object first, then configure its fields.
          </div>
        ) : fields.length === 0 ? (
          <div className="platform-editor-empty">
            <strong>No fields configured.</strong>
            <span>
              Add metadata fields after the object has been
              saved.
            </span>
          </div>
        ) : (
          <div className="platform-field-table-wrap">
            <table className="platform-field-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>API Key</th>
                  <th>Type</th>
                  <th>Database Column</th>
                  <th>Required</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {fields.map((field) => {
                  const fieldId = getFieldId(field);

                  return (
                    <tr key={fieldId}>
                      <td>
                        <strong>
                          {getFieldName(field)}
                        </strong>
                      </td>

                      <td>
                        <code>
                          {getFieldKey(field)}
                        </code>
                      </td>

                      <td>
                        {getFieldType(field)}
                      </td>
                      <td>
                        {field.source_column ? <code>{field.source_column}</code> : "Metadata only"}
                      </td>

                      <td>
                        {field.required ||
                        field.is_required
                          ? "Yes"
                          : "No"}
                      </td>

                      <td>
                        <span
                          className={
                            field.active === false ||
                            field.is_active === false
                              ? "platform-status-disabled"
                              : "platform-status-active"
                          }
                        >
                          {field.active === false ||
                          field.is_active === false
                            ? "Inactive"
                            : "Active"}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="platform-row-button" onClick={() => setEditingField(field)}>Edit</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {!isNew ? <RecordTypeEditor object={{ id: objectId }} fields={fields} /> : null}
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

      <style>{`
        .platform-editor-page {
          max-width: 1500px;
          margin: 0 auto;
          padding: 24px;
          color: var(--text-primary, #1f2937);
        }

        .platform-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 20px;
          margin-bottom: 22px;
        }

        .platform-editor-title {
          min-width: 0;
        }

        .platform-back-button {
          border: 0;
          background: transparent;
          padding: 0;
          margin-bottom: 14px;
          color: var(--primary-color, #2563eb);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .platform-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
          margin-bottom: 6px;
        }

        .platform-editor-title h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.2;
        }

        .platform-editor-title p {
          margin: 8px 0 0;
          max-width: 800px;
          color: var(--text-secondary, #6b7280);
          line-height: 1.5;
          font-size: 13px;
        }

        .platform-editor-actions {
          display: flex;
          gap: 8px;
          flex: 0 0 auto;
        }

        .platform-primary-button,
        .platform-secondary-button {
          border-radius: 8px;
          padding: 10px 15px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .platform-primary-button {
          border: 1px solid var(--primary-color, #2563eb);
          background: var(--primary-color, #2563eb);
          color: #ffffff;
        }

        .platform-primary-button:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .platform-secondary-button {
          border: 1px solid var(--border-color, #d1d5db);
          background: var(--card-background, #ffffff);
          color: var(--text-primary, #1f2937);
        }

        .platform-secondary-button:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .platform-alert {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 13px 15px;
          margin-bottom: 18px;
          border-radius: 9px;
          font-size: 13px;
        }

        .platform-alert-error {
          border: 1px solid #fecaca;
          background: #fff7f7;
          color: #991b1b;
        }

        .platform-alert-success {
          border: 1px solid #bbf7d0;
          background: #f0fdf4;
          color: #166534;
        }

        .platform-editor-card {
          margin-bottom: 20px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 13px;
          background: var(--card-background, #ffffff);
          overflow: hidden;
        }

        .platform-editor-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          padding: 19px 20px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-editor-card-header h2 {
          margin: 0;
          font-size: 17px;
        }

        .platform-editor-card-header p {
          margin: 5px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          line-height: 1.5;
        }

        .platform-form-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          padding: 20px;
        }

        .platform-form-field {
          display: flex;
          flex-direction: column;
          gap: 7px;
          min-width: 0;
        }

        .platform-form-field-wide {
          grid-column: 1 / -1;
        }

        .platform-form-field > span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-form-field small {
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
        }

        .platform-form-field input,
        .platform-form-field textarea,
        .platform-form-field select {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 8px;
          background: var(--card-background, #ffffff);
          color: inherit;
          padding: 10px 11px;
          outline: none;
          font: inherit;
          font-size: 13px;
        }

        .platform-form-field textarea {
          resize: vertical;
          min-height: 75px;
        }

        .platform-form-field input:focus,
        .platform-form-field textarea:focus,
        .platform-form-field select:focus {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-toggle-field {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding-top: 25px;
        }

        .platform-toggle-field input {
          margin-top: 2px;
        }

        .platform-toggle-field strong,
        .platform-toggle-field small {
          display: block;
        }

        .platform-toggle-field strong {
          font-size: 12px;
        }

        .platform-toggle-field small {
          margin-top: 4px;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          line-height: 1.4;
        }

        .platform-field-table-wrap {
          overflow-x: auto;
        }

        .platform-field-table {
          width: 100%;
          min-width: 700px;
          border-collapse: collapse;
        }

        .platform-field-table th {
          padding: 11px 16px;
          text-align: left;
          background: var(--muted-background, #f8fafc);
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .platform-field-table td {
          padding: 13px 16px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          font-size: 12px;
        }

        .platform-field-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .platform-field-table code {
          padding: 3px 6px;
          border-radius: 5px;
          background: var(--muted-background, #f3f4f6);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11px;
        }

        .platform-status-active,
        .platform-status-disabled {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 999px;
          background: var(--muted-background, #f3f4f6);
          font-size: 11px;
          font-weight: 600;
        }

        .platform-status-active {
          color: #166534;
        }

        .platform-status-disabled {
          color: #991b1b;
        }

        .platform-editor-empty,
        .platform-editor-loading {
          padding: 45px 20px;
          text-align: center;
          color: var(--text-secondary, #6b7280);
          font-size: 13px;
        }

        .platform-editor-empty strong,
        .platform-editor-empty span {
          display: block;
        }

        .platform-editor-empty span {
          margin-top: 5px;
        }

        @media (max-width: 800px) {
          .platform-editor-page {
            padding: 16px;
          }

          .platform-editor-header {
            align-items: stretch;
            flex-direction: column;
          }

          .platform-editor-actions {
            justify-content: flex-end;
          }

          .platform-form-grid {
            grid-template-columns: 1fr;
          }

          .platform-form-field-wide {
            grid-column: auto;
          }

          .platform-toggle-field {
            padding-top: 0;
          }
        }
      `}</style>
    </div>
  );
}
