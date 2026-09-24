import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

const TRIGGERS = [
  { value: "before_save", label: "Before Create and Update" },
  { value: "before_create", label: "Before Create" },
  { value: "after_create", label: "After Create" },
  { value: "before_update", label: "Before Update" },
  { value: "after_update", label: "After Update" },
  { value: "field_changed", label: "When a field changes" },
  { value: "before_delete", label: "Before Delete" },
  { value: "after_delete", label: "After Delete" },
];

const ACTIONS = [
  { value: "validation", label: "Validation — block save when conditions match" },
  { value: "validate", label: "Legacy Validate (configuration only)" },
  { value: "set_field", label: "Set Field" },
  { value: "show_message", label: "Show Message" },
  { value: "SEND_EMAIL", label: "Send Email" },
  { value: "SEND_SMS", label: "Send SMS" },
  { value: "SEND_WHATSAPP", label: "Send WhatsApp" },
  { value: "CALL_WEBHOOK", label: "Call Connector Webhook" },
  { value: "restrict", label: "Restrict" },
];

const EMPTY_RULE = {
  name: "",
  rule_key: "",
  object_id: "",
  trigger: "before_save",
  action: "validation",
  message: "",
  match: "all",
  conditions: [],
  active: true,
  description: "",
};
const EMPTY_OBJECTS = [];

export default function RuleEditor({
  rule = null,
  objects = EMPTY_OBJECTS,
  initialObjectId = "",
  onSave,
  onCancel,
}) {
  const isNew = !rule?.id && !rule?.rule_id;

  const [form, setForm] = useState({
    ...EMPTY_RULE,
    ...(rule || {}),
    ...(isNew && initialObjectId ? { object_id: initialObjectId } : {}),
    trigger: rule?.trigger_key || rule?.trigger || "before_save",
    action: rule?.action?.type || (typeof rule?.action === "string" ? rule.action : "validation"),
    message: rule?.action?.message || "",
    match: rule?.action?.match || "all",
  });

  const [availableObjects, setAvailableObjects] =
    useState(objects || []);

  const [fields, setFields] = useState([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ruleId = rule?.id || rule?.rule_id;

  useEffect(() => {
    if (objects?.length) {
      setAvailableObjects(objects);
    } else {
      loadObjects();
    }
  }, [objects]);

  useEffect(() => {
    if (form.object_id) {
      loadFields(form.object_id);
    } else {
      setFields([]);
    }
  }, [form.object_id]);

  async function loadObjects() {
    setLoadingObjects(true);
    setError("");

    try {
      const data = await apiRequest("/api/platform/objects");

      const loaded =
        data?.data || [];

      setAvailableObjects(
        Array.isArray(loaded) ? loaded : []
      );
    } catch (err) {
      setError(
        err?.message || "Unable to load objects."
      );
    } finally {
      setLoadingObjects(false);
    }
  }

  async function loadFields(objectId) {
    setLoadingFields(true);

    try {
      const data = await apiRequest(`/api/platform/objects/${objectId}/fields`);

      const loaded =
        data?.data || [];

      setFields(
        Array.isArray(loaded) ? loaded : []
      );
    } catch (err) {
      setError(
        err?.message || "Unable to load fields."
      );
      setFields([]);
    } finally {
      setLoadingFields(false);
    }
  }

  function update(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function addCondition() {
    update("conditions", [
      ...(Array.isArray(form.conditions)
        ? form.conditions
        : []),
      {
        field: "",
        operator: "equals",
        value: "",
      },
    ]);
  }

  function updateCondition(index, name, value) {
    const next = (
      Array.isArray(form.conditions)
        ? form.conditions
        : []
    ).map((condition, conditionIndex) =>
      conditionIndex === index
        ? {
            ...condition,
            [name]: value,
          }
        : condition
    );

    update("conditions", next);
  }

  function removeCondition(index) {
    update(
      "conditions",
      form.conditions.filter(
        (_, conditionIndex) =>
          conditionIndex !== index
      )
    );
  }

  async function saveRule(event) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      if (!form.name?.trim()) {
        throw new Error("Enter a rule name.");
      }

      if (!form.object_id) {
        throw new Error("Select an object.");
      }

      const payload = {
        name: form.name,
        objectId: form.object_id,
        triggerKey: form.trigger,
        action: { ...(typeof rule?.action === "object" ? rule.action : {}), type: form.action, ...(form.action === "validation" ? { message: form.message, match: form.match } : {}) },
        conditions: Array.isArray(form.conditions)
          ? form.conditions
          : [],
        active: form.active !== false,
        description: form.description || "",
      };

      const url = isNew
        ? "/api/platform/rules"
        : `/api/platform/rules/${ruleId}`;

      const data = await apiRequest(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });

      const saved =
        data?.data || data;

      if (typeof onSave === "function") {
        onSave(saved);
      }
    } catch (err) {
      setError(
        err?.message || "Unable to save rule."
      );
    } finally {
      setSaving(false);
    }
  }

  function objectLabel(object) {
    return (
      object?.label ||
      object?.name ||
      object?.object_name ||
      object?.object_key ||
      `Object ${object?.id || ""}`
    );
  }

  function fieldKey(field) {
    return (
      field?.api_name ||
      field?.field_key ||
      field?.name ||
      field?.id
    );
  }

  function fieldLabel(field) {
    return (
      field?.label ||
      field?.name ||
      field?.api_name ||
      field?.field_key ||
      "Field"
    );
  }

  return (
    <div className="platform-rule-editor">
      <div className="platform-rule-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / RULE
          </div>

          <h2>
            {isNew ? "New Rule" : "Edit Rule"}
          </h2>

          <p>
            Configure validation and workflow metadata
            for an object.
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

      <div className="platform-rule-notice">
        <strong>{form.action === "validation" ? "Validation rule" : "Configuration only"}</strong>
        <span>
          {form.action === "validation"
            ? "An active rule blocks Platform record saves when its conditions match. Other entry points keep their existing business validation."
            : "Workflow actions are stored as metadata and do not execute."}
        </span>
      </div>

      {error ? (
        <div className="platform-alert platform-alert-error">
          {error}
        </div>
      ) : null}

      <form onSubmit={saveRule}>
        <section className="platform-rule-card">
          <div className="platform-card-heading">
            <h3>Rule Information</h3>
            <p>
              Define when this rule applies and what
              configured action it represents.
            </p>
          </div>

          <div className="platform-rule-grid">
            <label>
              <span>Rule Name</span>
              <input
                type="text"
                value={form.name || ""}
                onChange={(event) =>
                  update("name", event.target.value)
                }
                placeholder="Customer Credit Validation"
                required
              />
            </label>

            <label>
              <span>Object</span>
              <select
                value={form.object_id || ""}
                onChange={(event) =>
                  update(
                    "object_id",
                    event.target.value
                  )
                }
                disabled={loadingObjects}
                required
              >
                <option value="">
                  {loadingObjects
                    ? "Loading objects…"
                    : "Select object"}
                </option>

                {availableObjects.map((object) => {
                  const id =
                    object?.id ||
                    object?.object_id;

                  return (
                    <option key={id} value={id}>
                      {objectLabel(object)}
                    </option>
                  );
                })}
              </select>
            </label>

            <label>
              <span>Trigger</span>
              <select
                value={
                  form.trigger ||
                  "before_create"
                }
                onChange={(event) =>
                  update(
                    "trigger",
                    event.target.value
                  )
                }
              >
                {TRIGGERS.filter(trigger => form.action !== "validation" || ["before_save", "before_create", "before_update"].includes(trigger.value)).map((trigger) => (
                  <option
                    key={trigger.value}
                    value={trigger.value}
                  >
                    {trigger.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Action</span>
              <select
                value={
                  form.action || "validate"
                }
                onChange={(event) => setForm(current => ({ ...current, action: event.target.value, ...(event.target.value === "validation" ? { trigger: "before_save" } : {}) }))}
              >
                {ACTIONS.map((action) => (
                  <option
                    key={action.value}
                    value={action.value}
                  >
                    {action.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Status</span>
              <select
                value={
                  form.active === false
                    ? "inactive"
                    : "active"
                }
                onChange={(event) =>
                  update(
                    "active",
                    event.target.value ===
                      "active"
                  )
                }
              >
                <option value="active">
                  Active
                </option>
                <option value="inactive">
                  Inactive
                </option>
              </select>
            </label>

            {form.action === "validation" && <label className="platform-rule-description">
              <span>Error message shown when save is blocked</span>
              <textarea
                value={form.message || ""}
                onChange={(event) =>
                  update(
                    "message",
                    event.target.value
                  )
                }
                placeholder="Explain what the user needs to correct."
                required
                maxLength={500}
                rows={3}
              />
            </label>}
            {form.action === "validation" && <label>
              <span>Block save when</span>
              <select value={form.match} onChange={event => update("match", event.target.value)}>
                <option value="all">All conditions match</option>
                <option value="any">Any condition matches</option>
              </select>
            </label>}
          </div>
        </section>

        <section className="platform-rule-card">
          <div className="platform-card-heading platform-card-heading-row">
            <div>
              <h3>Conditions</h3>
              <p>
                For example: Amount less than 0 blocks negative amounts. Use Is Empty to check missing values.
              </p>
            </div>

            <button
              type="button"
              className="platform-secondary-button"
              onClick={addCondition}
              disabled={!form.object_id}
            >
              + Add Condition
            </button>
          </div>

          {!form.object_id ? (
            <div className="platform-muted">
              Select an object first to configure
              field conditions.
            </div>
          ) : loadingFields ? (
            <div className="platform-muted">
              Loading fields…
            </div>
          ) : (
            <div className="platform-condition-list">
              {form.conditions.length === 0 ? (
                <div className="platform-empty">
                  No conditions configured.
                </div>
              ) : (
                form.conditions.map(
                  (condition, index) => (
                    <div
                      className="platform-condition-row"
                      key={`condition-${index}`}
                    >
                      <label>
                        <span>Field</span>

                        <select
                          value={
                            condition.field ||
                            ""
                          }
                          onChange={(event) =>
                            updateCondition(
                              index,
                              "field",
                              event.target.value
                            )
                          }
                        >
                          <option value="">
                            Select field
                          </option>

                          {fields.filter(field => field.active !== false && (field.source_column || field.field_type === "formula")).map((field) => {
                            const key =
                              fieldKey(field);

                            return (
                              <option
                                key={key}
                                value={key}
                              >
                                {fieldLabel(
                                  field
                                )}
                              </option>
                            );
                          })}
                        </select>
                      </label>

                      <label>
                        <span>Operator</span>

                        <select
                          value={
                            condition.operator ||
                            "equals"
                          }
                          onChange={(event) =>
                            updateCondition(
                              index,
                              "operator",
                              event.target.value
                            )
                          }
                        >
                          <option value="equals">
                            Equals
                          </option>
                          <option value="not_equals">
                            Not Equals
                          </option>
                          <option value="contains">
                            Contains
                          </option>
                          <option value="greater_than">
                            Greater Than
                          </option>
                          <option value="less_than">
                            Less Than
                          </option>
                          <option value="is_empty">
                            Is Empty
                          </option>
                          <option value="is_not_empty">
                            Is Not Empty
                          </option>
                        </select>
                      </label>

                      <label>
                        <span>Value</span>

                        <input
                          type="text"
                          value={
                            condition.value ??
                            ""
                          }
                          onChange={(event) =>
                            updateCondition(
                              index,
                              "value",
                              event.target.value
                            )
                          }
                          disabled={[
                            "is_empty",
                            "is_not_empty",
                          ].includes(
                            condition.operator
                          )}
                        />
                      </label>

                      <button
                        type="button"
                        className="platform-remove-button"
                        onClick={() =>
                          removeCondition(index)
                        }
                        title="Remove condition"
                      >
                        ×
                      </button>
                    </div>
                  )
                )
              )}
            </div>
          )}
        </section>

        <div className="platform-rule-footer">
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
            {saving ? "Saving…" : "Save Rule"}
          </button>
        </div>
      </form>

      <style>{`
        .platform-rule-editor {
          max-width: 1100px;
          margin: 0 auto;
          padding: 20px;
          color: var(--text-primary, #1f2937);
        }

        .platform-rule-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 18px;
        }

        .platform-eyebrow {
          margin-bottom: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
        }

        .platform-rule-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-rule-header p {
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-rule-notice {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 15px;
          padding: 11px 13px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          background: var(--muted-background, #f9fafb);
          font-size: 11px;
        }

        .platform-rule-notice strong {
          font-size: 11px;
        }

        .platform-rule-notice span {
          color: var(--text-secondary, #6b7280);
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

        .platform-rule-card {
          margin-bottom: 16px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          overflow: hidden;
        }

        .platform-card-heading {
          padding: 17px 18px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-card-heading-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
        }

        .platform-card-heading h3 {
          margin: 0;
          font-size: 15px;
        }

        .platform-card-heading p {
          margin: 4px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
        }

        .platform-rule-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 17px;
          padding: 18px;
        }

        .platform-rule-grid label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .platform-rule-grid label > span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-rule-grid input,
        .platform-rule-grid select,
        .platform-rule-grid textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 8px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 9px 10px;
          font: inherit;
          font-size: 13px;
          outline: none;
          resize: vertical;
        }

        .platform-rule-grid input:focus,
        .platform-rule-grid select:focus,
        .platform-rule-grid textarea:focus {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-rule-description {
          grid-column: 1 / -1;
        }

        .platform-condition-list {
          padding: 10px 18px 18px;
        }

        .platform-condition-row {
          display: grid;
          grid-template-columns: 1fr 160px 1fr 34px;
          gap: 10px;
          align-items: end;
          padding: 12px 0;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
        }

        .platform-condition-row:last-child {
          border-bottom: 0;
        }

        .platform-condition-row label {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .platform-condition-row label span {
          font-size: 9px;
          color: var(--text-secondary, #6b7280);
        }

        .platform-condition-row input,
        .platform-condition-row select {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 8px;
          font: inherit;
          font-size: 11px;
        }

        .platform-remove-button {
          width: 30px;
          height: 30px;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: inherit;
          cursor: pointer;
          font-size: 17px;
        }

        .platform-muted,
        .platform-empty {
          padding: 20px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          text-align: center;
        }

        .platform-rule-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
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

        .platform-primary-button:disabled,
        .platform-secondary-button:disabled {
          opacity: 0.6;
          cursor: default;
        }

        @media (max-width: 750px) {
          .platform-rule-grid {
            grid-template-columns: 1fr;
          }

          .platform-rule-description {
            grid-column: auto;
          }

          .platform-condition-row {
            grid-template-columns: 1fr;
          }

          .platform-remove-button {
            justify-self: end;
          }
        }
      `}</style>
    </div>
  );
}
