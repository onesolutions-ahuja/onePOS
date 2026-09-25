import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import { toSafeApiName, withGeneratedApiName } from "./safeApiName.js";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "decimal", label: "Decimal" },
  { value: "currency", label: "Currency" },
  { value: "boolean", label: "Checkbox / Boolean" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "picklist", label: "Picklist" },
  { value: "select", label: "Picklist / Select (legacy)" },
  { value: "lookup", label: "Lookup" },
  { value: "multiselect", label: "Multi-select" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "formula", label: "Formula (read-only)" },
  { value: "rollup", label: "Rollup (read-only)" },
];

const EMPTY_FIELD = {
  label: "",
  apiName: "",
  field_type: "text",
  sourceColumn: "",
  required: false,
  readable: true,
  writable: true,
  active: true,
  description: "",
};

export default function FieldEditor({
  object,
  field = null,
  fields = [],
  onSave,
  onCancel,
}) {
  const isNew = !field?.id && !field?.field_id;

  const [form, setForm] = useState({
    ...EMPTY_FIELD,
    ...(field || {}),
    apiName: field?.apiName || field?.api_name || "",
    sourceColumn: field?.sourceColumn || field?.source_column || "",
    expression: field?.config?.expression || "",
    resultType: field?.config?.resultType || "decimal",
    visibilityCondition: field?.config?.visibilityCondition || null,
    requiredCondition: field?.config?.requiredCondition || null,
    valueSource: field?.config?.valueSetId ? "reusable" : "local",
    valueSetId: field?.config?.valueSetId || "",
    rollupOperation: field?.config?.operation || "COUNT",
    rollupRelationshipKey: field?.config?.relationshipKey || "",
    rollupSourceField: field?.config?.field || "",
    rollupResultType: field?.config?.resultType || "number",
    rollupCondition: field?.config?.condition || null,
    lookupRelationshipKey: field?.config?.relationshipKey || "",
    lookupRelatedObjectKey: field?.config?.relatedObjectKey || field?.config?.related_object_key || "",
    options: Array.isArray(field?.options) ? field.options : [],
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [valueSets, setValueSets] = useState([]);
  const [relationships, setRelationships] = useState([]);

  useEffect(() => {
    if (!["picklist", "select"].includes(form.field_type)) return;
    apiRequest("/api/platform/value-sets")
      .then((response) => setValueSets(Array.isArray(response?.data) ? response.data : []))
      .catch((err) => setError(err?.message || "Unable to load reusable value sets."));
  }, [form.field_type]);

  useEffect(() => {
    if (form.field_type !== "lookup" || !object?.id) return;
    apiRequest("/api/platform/relationships")
      .then((response) => setRelationships(Array.isArray(response?.data) ? response.data : []))
      .catch((err) => setError(err?.message || "Unable to load relationships."));
  }, [form.field_type, object?.id]);

  function update(name, value) {
    setForm((current) => ({
      ...current,
      ...withGeneratedApiName(current, name, value, (label) => toSafeApiName(label), { labelField: "label", apiNameField: "apiName", isNew }),
      [name]: value,
    }));
  }

  function updateCondition(name, next) {
    setForm((current) => ({ ...current, [name]: next }));
  }

  function addOption() {
    setForm((current) => ({
      ...current,
      options: [...current.options, { id: `new-${Date.now()}-${current.options.length}`, label: "", value: "", active: true }],
    }));
  }

  function updateOption(index, key, value) {
    setForm((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) => {
        if (optionIndex !== index) return option;
        if (key === "label" && !option.id?.toString().startsWith("new-")) {
          return { ...option, label: value };
        }
        return {
          ...option,
          [key]: value,
          ...(key === "label" && option.id?.toString().startsWith("new-") ? { value: toSafeApiName(value) } : {}),
        };
      }),
    }));
  }

  function removeOption(index) {
    setForm((current) => ({ ...current, options: current.options.filter((_, optionIndex) => optionIndex !== index) }));
  }

  function conditionEditor(name, title) {
    const condition = form[name];
    const availableFields = fields.filter((candidate) => candidate.api_name !== (field?.api_name || field?.apiName));
    const fallback = {
      field: availableFields[0]?.api_name || "",
      operator: "equals",
      value: "",
    };
    const conditions = condition?.conditions?.length ? condition.conditions : [fallback];
    const updateAt = (index, key, value) => updateCondition(name, {
      match: condition?.match || "all",
      conditions: conditions.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item),
    });
    const addCondition = () => updateCondition(name, {
      match: condition?.match || "all",
      conditions: [...conditions, fallback],
    });
    const removeCondition = (index) => updateCondition(name, {
      match: condition?.match || "all",
      conditions: conditions.filter((_, itemIndex) => itemIndex !== index),
    });

    return (
      <fieldset className="platform-field-editor-wide">
        <legend>{title}</legend>
        <label>
          <span>Match</span>
          <select
            value={condition?.match || "all"}
            onChange={(event) => updateCondition(name, {
              match: event.target.value,
              conditions,
            })}
          >
            <option value="all">ALL conditions</option>
            <option value="any">ANY conditions</option>
          </select>
        </label>
        {conditions.map((item, index) => (
          <React.Fragment key={`${name}-${index}`}>
            <label>
              <span>Controlling field</span>
              <select value={item.field} onChange={(event) => updateAt(index, "field", event.target.value)}>
                <option value="">Select a field</option>
                {availableFields.map((candidate) => (
                  <option key={candidate.api_name} value={candidate.api_name}>
                    {candidate.label} ({candidate.api_name})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Operator</span>
              <select value={item.operator} onChange={(event) => updateAt(index, "operator", event.target.value)}>
                {["equals", "not_equals", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "is_empty", "is_not_empty"].map((operator) => (
                  <option key={operator} value={operator}>{operator.replaceAll("_", " ")}</option>
                ))}
              </select>
            </label>
            {!["is_empty", "is_not_empty"].includes(item.operator) ? (
              <label>
                <span>Comparison value</span>
                <input value={item.value ?? ""} onChange={(event) => updateAt(index, "value", event.target.value)} />
              </label>
            ) : null}
            {conditions.length > 1 ? <button type="button" onClick={() => removeCondition(index)}>Remove condition</button> : null}
          </React.Fragment>
        ))}
        <button type="button" onClick={addCondition}>Add condition</button>
        <button type="button" onClick={() => updateCondition(name, null)}>Clear condition</button>
      </fieldset>
    );
  }

  async function saveField(event) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      if (!object?.id && !object?.object_id) {
        throw new Error("Save the object before adding fields.");
      }

      const objectId = object.id || object.object_id;

      const payload = {
        label: form.label,
        apiName: form.apiName,
        fieldType: form.field_type,
        sourceColumn: ["formula", "rollup"].includes(form.field_type) ? null : form.sourceColumn || null,
        required: ["formula", "rollup"].includes(form.field_type) ? false : Boolean(form.required),
        readable: form.readable !== false,
        writable: ["formula", "rollup"].includes(form.field_type) ? false : form.writable !== false,
        ...(form.field_type === "formula" ? { writable: false, config: { ...(field?.config || {}), expression: form.expression, resultType: form.resultType } } : {}),
        active: form.active !== false,
        description: form.description || "",
        config: {
          ...(field?.config || {}),
          ...(form.field_type === "formula" ? { expression: form.expression, resultType: form.resultType } : {}),
          ...(form.field_type === "rollup" ? {
            operation: form.rollupOperation,
            relationshipKey: form.rollupRelationshipKey,
            field: form.rollupSourceField || null,
            resultType: form.rollupResultType,
            ...(form.rollupCondition ? { condition: form.rollupCondition } : {}),
          } : {}),
          ...(form.field_type === "lookup" ? {
            relationshipKey: form.lookupRelationshipKey || null,
            relatedObjectKey: form.lookupRelatedObjectKey || null,
          } : {}),
          ...(form.visibilityCondition ? { visibilityCondition: form.visibilityCondition } : {}),
          ...(form.requiredCondition ? { requiredCondition: form.requiredCondition } : {}),
          ...(form.field_type === "picklist" || form.field_type === "select"
            ? form.valueSource === "reusable"
              ? { valueSetId: form.valueSetId }
              : {}
            : {}),
        },
        options: (form.field_type === "picklist" || form.field_type === "select") && form.valueSource === "local" ? form.options : [],
      };

      const fieldId = field?.id || field?.field_id;

      const url = isNew
        ? `/api/platform/objects/${objectId}/fields`
        : `/api/platform/fields/${fieldId}`;

      const response = await apiRequest(url, {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify(payload),
      });
      const savedField = response?.data || response;

      if (typeof onSave === "function") {
        onSave(savedField);
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to save the field."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="platform-field-editor">
      <div className="platform-field-editor-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / FIELD
          </div>

          <h2>
            {isNew ? "New Field" : "Edit Field"}
          </h2>

          <p>
            Object:{" "}
            <strong>
              {object?.name ||
                object?.label ||
                object?.object_key ||
                "Unknown"}
            </strong>
          </p>
        </div>

        <button
          type="button"
          className="platform-secondary-button"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div className="platform-alert platform-alert-error">
          {error}
        </div>
      ) : null}

      <form onSubmit={saveField}>
        <div className="platform-field-editor-grid">
          <label>
            <span>Field Label</span>
            <input
              type="text"
              value={form.label || ""}
              onChange={(event) =>
                update("label", event.target.value)
              }
              placeholder="Customer Name"
              required
            />
          </label>

          <label>
            <span>API Key (stable)</span>
            <input
              type="text"
              value={form.apiName || ""}
              readOnly
              placeholder="customer_name"
              required
            />
            <small>
              Generated from the label for new fields and kept stable after creation.
            </small>
          </label>

          <label>
            <span>Field Type</span>
            <select
              value={form.field_type || "text"}
              onChange={(event) =>
                update(
                  "field_type",
                  event.target.value
                )
              }
            >
              {FIELD_TYPES.map((type) => (
                <option
                  key={type.value}
                  value={type.value}
                >
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          {form.field_type !== "formula" && <label>
            <span>Existing Database Column</span>
            <input
              type="text"
              value={form.sourceColumn || ""}
              onChange={(event) =>
                update(
                  "sourceColumn",
                  event.target.value
                )
              }
              placeholder="Existing column name"
            />
            <small>
              Only map to an existing column. This editor
              must not create database columns.
            </small>
          </label>}

          {["picklist", "select"].includes(form.field_type) ? (
            <fieldset className="platform-field-editor-wide">
              <legend>Picklist values</legend>
              <label>
                <span>Value source</span>
                <select value={form.valueSource} onChange={(event) => update("valueSource", event.target.value)}>
                  <option value="local">Local values</option>
                  <option value="reusable">Reusable value set</option>
                </select>
              </label>
              {form.valueSource === "reusable" ? (
                <label>
                  <span>Reusable value set</span>
                  <select value={form.valueSetId} onChange={(event) => update("valueSetId", event.target.value)} required>
                    <option value="">Select a value set</option>
                    {valueSets.filter((valueSet) => valueSet.active !== false).map((valueSet) => (
                      <option key={valueSet.id} value={valueSet.id}>{valueSet.label} ({valueSet.value_set_key})</option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  {form.options.map((option, index) => (
                    <div key={option.id || `${option.value}-${index}`} className="platform-field-editor-option">
                      <input value={option.label || ""} placeholder="In Progress" onChange={(event) => updateOption(index, "label", event.target.value)} />
                      <input value={option.value || ""} readOnly placeholder="in_progress" />
                      <label><input type="checkbox" checked={option.active !== false} onChange={(event) => updateOption(index, "active", event.target.checked)} /> Active</label>
                      <button type="button" onClick={() => removeOption(index)}>Remove</button>
                    </div>
                  ))}
                  <button type="button" onClick={addOption}>Add value</button>
                </>
              )}
            </fieldset>
          ) : null}

          {form.field_type === "lookup" ? (
            <fieldset className="platform-field-editor-wide">
              <legend>Relationship target</legend>
              <label>
                <span>Relationship</span>
                <select
                  value={form.lookupRelationshipKey || ""}
                  onChange={(event) => {
                    const relationship = relationships.find((item) => item.relationship_key === event.target.value);
                    const targetObjectKey = relationship
                      ? String(relationship.parent_object_id) === String(object.id)
                        ? relationship.child_object_key
                        : relationship.parent_object_key
                      : "";
                    setForm((current) => ({
                      ...current,
                      lookupRelationshipKey: event.target.value,
                      lookupRelatedObjectKey: targetObjectKey,
                    }));
                  }}
                  required
                >
                  <option value="">Select a relationship</option>
                  {relationships
                    .filter((relationship) =>
                      String(relationship.parent_object_id) === String(object.id) ||
                      String(relationship.child_object_id) === String(object.id)
                    )
                    .map((relationship) => (
                      <option key={relationship.id} value={relationship.relationship_key}>
                        {relationship.relationship_key} ({relationship.parent_object_key} → {relationship.child_object_key})
                      </option>
                    ))}
                </select>
              </label>
              <small>
                Lookup values must come from an existing relationship. The relationship supplies the target object and tenant-safe reference.
              </small>
            </fieldset>
          ) : null}

          {form.field_type === "rollup" && <fieldset className="platform-field-editor-wide">
            <legend>Rollup configuration</legend>
            <label><span>Aggregate</span><select value={form.rollupOperation || "COUNT"} onChange={event => update("rollupOperation", event.target.value)}>{["COUNT", "SUM", "MIN", "MAX", "AVG"].map(operation => <option key={operation} value={operation}>{operation}</option>)}</select></label>
            <label><span>Relationship key</span><input value={form.rollupRelationshipKey || ""} onChange={event => update("rollupRelationshipKey", event.target.value)} placeholder="customer_orders" required /></label>
            <label><span>Child numeric field</span><input value={form.rollupSourceField || ""} onChange={event => update("rollupSourceField", event.target.value)} placeholder="total" required={form.rollupOperation !== "COUNT"} /></label>
            <label><span>Result type</span><select value={form.rollupResultType || "number"} onChange={event => update("rollupResultType", event.target.value)}>{["number", "decimal", "currency"].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
            <small>Values are calculated from related child records and cannot be written directly. Filters are configured through the existing condition format in metadata.</small>
          </fieldset>}

          {form.field_type === "formula" && <>
            <label>
              <span>Formula result type</span>
              <select value={form.resultType} onChange={event => update("resultType", event.target.value)}>
                {["number", "decimal", "currency", "text", "boolean"].map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="platform-field-editor-wide">
              <span>Formula expression</span>
              <textarea value={form.expression} onChange={event => update("expression", event.target.value)} required maxLength={2000} rows={4} placeholder="ROUND(price * quantity, 2)" />
              <small>Use field API names. Functions: IF, COALESCE, CONCAT, ROUND, ABS, MIN, MAX. Example: CONCAT(name, " - ", sku). Calculated from this record; never stored or editable. Blank inputs and division by zero return blank; use COALESCE for defaults.</small>
            </label>
          </>}

          {conditionEditor("visibilityCondition", "Conditional Visibility")}
          {conditionEditor("requiredCondition", "Conditional Required")}

          <label className="platform-field-editor-wide">
            <span>Description</span>
            <textarea
              value={form.description || ""}
              onChange={(event) =>
                update(
                  "description",
                  event.target.value
                )
              }
              rows={3}
              placeholder="Describe what this field represents."
            />
          </label>

          <div className="platform-field-options">
            <label className="platform-checkbox">
              <input
                type="checkbox"
                checked={!["formula", "rollup"].includes(form.field_type) && Boolean(form.required)}
                disabled={["formula", "rollup"].includes(form.field_type)}
                onChange={(event) =>
                  update(
                    "required",
                    event.target.checked
                  )
                }
              />
              <span>
                <strong>Required</strong>
                <small>
                  The field must contain a value.
                </small>
              </span>
            </label>

            <label className="platform-checkbox">
              <input
                type="checkbox"
                checked={form.readable !== false}
                onChange={(event) => update("readable", event.target.checked)}
              />
              <span>
                <strong>Readable</strong>
                <small>Include this field in generic record responses.</small>
              </span>
            </label>

            <label className="platform-checkbox">
              <input
                type="checkbox"
                checked={!["formula", "rollup"].includes(form.field_type) && form.writable !== false}
                disabled={["formula", "rollup"].includes(form.field_type)}
                onChange={(event) => update("writable", event.target.checked)}
              />
              <span>
                <strong>Writable</strong>
                <small>Allow generic record creates and updates to set this field.</small>
              </span>
            </label>

            <label className="platform-checkbox">
              <input
                type="checkbox"
                checked={form.active !== false}
                onChange={(event) =>
                  update(
                    "active",
                    event.target.checked
                  )
                }
              />
              <span>
                <strong>Active</strong>
                <small>
                  Available for normal platform use.
                </small>
              </span>
            </label>
          </div>
        </div>

        <div className="platform-field-editor-footer">
          <button
            type="button"
            className="platform-secondary-button"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="platform-primary-button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Field"}
          </button>
        </div>
      </form>

      <style>{`
        .platform-field-editor {
          padding: 20px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #ffffff);
        }

        .platform-field-editor-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 20px;
        }

        .platform-eyebrow {
          margin-bottom: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
        }

        .platform-field-editor-header h2 {
          margin: 0;
          font-size: 20px;
        }

        .platform-field-editor-header p {
          margin: 5px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-field-editor-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 17px;
        }

        .platform-field-editor-grid > label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .platform-field-editor-grid > label > span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-field-editor-grid input,
        .platform-field-editor-grid select,
        .platform-field-editor-grid textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 8px;
          background: var(--card-background, #ffffff);
          color: inherit;
          padding: 9px 10px;
          font: inherit;
          font-size: 13px;
          outline: none;
        }

        .platform-field-editor-grid textarea {
          resize: vertical;
        }

        .platform-field-editor-grid input:focus,
        .platform-field-editor-grid select:focus,
        .platform-field-editor-grid textarea:focus {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-field-editor-grid small {
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          line-height: 1.4;
        }

        .platform-field-editor-wide {
          grid-column: 1 / -1;
        }

        .platform-field-options {
          grid-column: 1 / -1;
          display: flex;
          gap: 25px;
          padding-top: 4px;
        }

        .platform-checkbox {
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }

        .platform-checkbox input {
          width: auto;
          margin-top: 2px;
        }

        .platform-checkbox strong,
        .platform-checkbox small {
          display: block;
        }

        .platform-checkbox strong {
          font-size: 12px;
        }

        .platform-checkbox small {
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
        }

        .platform-field-editor-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 22px;
          padding-top: 17px;
          border-top: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-primary-button,
        .platform-secondary-button {
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .platform-primary-button {
          border: 1px solid var(--primary-color, #2563eb);
          background: var(--primary-color, #2563eb);
          color: #fff;
        }

        .platform-secondary-button {
          border: 1px solid var(--border-color, #d1d5db);
          background: var(--card-background, #fff);
          color: inherit;
        }

        .platform-alert {
          margin-bottom: 15px;
          padding: 11px 13px;
          border-radius: 8px;
          font-size: 12px;
        }

        .platform-alert-error {
          border: 1px solid #fecaca;
          background: #fff7f7;
          color: #991b1b;
        }

        @media (max-width: 700px) {
          .platform-field-editor-grid {
            grid-template-columns: 1fr;
          }

          .platform-field-editor-wide {
            grid-column: auto;
          }

          .platform-field-options {
            flex-direction: column;
            gap: 12px;
          }
        }
      `}</style>
    </div>
  );
}
