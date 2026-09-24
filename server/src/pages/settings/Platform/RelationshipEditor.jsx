import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

const RELATIONSHIP_TYPES = [
  {
    value: "lookup",
    label: "Lookup",
    description: "One object references another object.",
  },
  {
    value: "one_to_many",
    label: "One to Many",
    description: "One parent object can have many child records.",
  },
  {
    value: "many_to_many",
    label: "Many to Many",
    description: "Records from both objects can be related to multiple records.",
  },
];

const DELETE_POLICIES = [
  {
    value: "restrict",
    label: "Restrict",
    description: "Prevent deletion when dependent records exist.",
  },
  {
    value: "cascade",
    label: "Cascade",
    description: "Delete dependent records with the parent.",
  },
  {
    value: "set_null",
    label: "Set Null",
    description: "Clear the relationship when the parent is deleted.",
  },
];

const UPDATE_POLICIES = [
  {
    value: "restrict",
    label: "Restrict",
  },
  {
    value: "cascade",
    label: "Cascade",
  },
  {
    value: "set_null",
    label: "Set Null",
  },
];

const EMPTY_RELATIONSHIP = {
  name: "",
  relationship_key: "",
  relationship_type: "lookup",
  parent_object_id: "",
  child_object_id: "",
  parent_field_id: "",
  child_field_id: "",
  on_delete: "restrict",
  on_update: "restrict",
  active: true,
  description: "",
};

export default function RelationshipEditor({
  relationship = null,
  objects = [],
  initialObjectId = "",
  onSave,
  onCancel,
}) {
  const isNew =
    !relationship?.id &&
    !relationship?.relationship_id;

  const [form, setForm] = useState({
    ...EMPTY_RELATIONSHIP,
    ...(relationship || {}),
    ...(isNew && initialObjectId ? { parent_object_id: initialObjectId } : {}),
  });

  const [availableObjects, setAvailableObjects] = useState(objects);
  const [parentFields, setParentFields] = useState([]);
  const [childFields, setChildFields] = useState([]);

  const [loadingObjects, setLoadingObjects] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const relationshipId =
    relationship?.id ||
    relationship?.relationship_id;

  useEffect(() => {
    if (objects?.length) {
      setAvailableObjects(objects);
      return;
    }

    loadObjects();
  }, [objects]);

  useEffect(() => {
    if (form.parent_object_id) {
      loadFields(
        form.parent_object_id,
        "parent"
      );
    } else {
      setParentFields([]);
    }
  }, [form.parent_object_id]);

  useEffect(() => {
    if (form.child_object_id) {
      loadFields(
        form.child_object_id,
        "child"
      );
    } else {
      setChildFields([]);
    }
  }, [form.child_object_id]);

  async function loadObjects() {
    setLoadingObjects(true);
    setError("");

    try {
      const data = await apiRequest("/api/platform/objects");

      const loaded =
        data?.data ||
        [];

      setAvailableObjects(
        Array.isArray(loaded) ? loaded : []
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load available objects."
      );
    } finally {
      setLoadingObjects(false);
    }
  }

  async function loadFields(objectId, target) {
    setLoadingFields(true);

    try {
      const data = await apiRequest(`/api/platform/objects/${objectId}/fields`);

      const loaded =
        data?.data ||
        [];

      const safeFields = Array.isArray(loaded)
        ? loaded
        : [];

      if (target === "parent") {
        setParentFields(safeFields);
      } else {
        setChildFields(safeFields);
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load object fields."
      );

      if (target === "parent") {
        setParentFields([]);
      } else {
        setChildFields([]);
      }
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

  function objectId(object) {
    return object?.id || object?.object_id;
  }

  function objectName(object) {
    return (
      object?.name ||
      object?.label ||
      object?.object_name ||
      object?.object_key ||
      `Object ${objectId(object) || ""}`
    );
  }

  function fieldId(field) {
    return field?.id || field?.field_id;
  }

  function fieldName(field) {
    return (
      field?.label ||
      field?.name ||
      field?.field_name ||
      field?.field_key ||
      `Field ${fieldId(field) || ""}`
    );
  }

  async function saveRelationship(event) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      if (!form.parent_object_id) {
        throw new Error(
          "Select the parent object."
        );
      }

      if (!form.child_object_id) {
        throw new Error(
          "Select the child object."
        );
      }

      if (
        String(form.parent_object_id) ===
        String(form.child_object_id)
      ) {
        throw new Error(
          "Parent and child objects cannot be the same."
        );
      }

      const payload = {
        relationshipKey: form.relationship_key,
        relationshipType: form.relationship_type,
        parentObjectId: form.parent_object_id,
        childObjectId: form.child_object_id,
        childFieldId: form.child_field_id || null,
        onDelete: form.on_delete || "restrict",
        onUpdate: form.on_update || "restrict",
      };

      const url = isNew
        ? "/api/platform/relationships"
        : `/api/platform/relationships/${relationshipId}`;

      const response = await apiRequest(url, {
        method: isNew ? "POST" : "PUT",
        body: JSON.stringify(payload),
      });
      const saved = response?.data || response;

      if (typeof onSave === "function") {
        onSave(saved);
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to save relationship."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="platform-relationship-editor">
      <div className="platform-relationship-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / RELATIONSHIPS
          </div>

          <h2>
            {isNew
              ? "New Relationship"
              : "Edit Relationship"}
          </h2>

          <p>
            Define how two platform objects are connected.
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

      <form onSubmit={saveRelationship}>
        <section className="platform-relationship-card">
          <div className="platform-card-heading">
            <div>
              <h3>Relationship Information</h3>
              <p>
                The relationship itself is metadata.
                Existing business tables remain authoritative.
              </p>
            </div>
          </div>

          <div className="platform-relationship-grid">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={form.name || ""}
                onChange={(event) =>
                  update(
                    "name",
                    event.target.value
                  )
                }
                placeholder="Customer Sales"
                required
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                type="text"
                value={
                  form.relationship_key || ""
                }
                onChange={(event) =>
                  update(
                    "relationship_key",
                    event.target.value
                  )
                }
                placeholder="customer_sales"
                required
              />
            </label>

            <label>
              <span>Relationship Type</span>
              <select
                value={
                  form.relationship_type ||
                  "lookup"
                }
                onChange={(event) =>
                  update(
                    "relationship_type",
                    event.target.value
                  )
                }
              >
                {RELATIONSHIP_TYPES.map(
                  (type) => (
                    <option
                      key={type.value}
                      value={type.value}
                    >
                      {type.label}
                    </option>
                  )
                )}
              </select>

              <small>
                {
                  RELATIONSHIP_TYPES.find(
                    (type) =>
                      type.value ===
                      form.relationship_type
                  )?.description
                }
              </small>
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
          </div>
        </section>

        <section className="platform-relationship-card">
          <div className="platform-card-heading">
            <div>
              <h3>Object Connection</h3>
              <p>
                Select the two metadata objects involved
                in this relationship.
              </p>
            </div>
          </div>

          <div className="platform-relationship-grid">
            <label>
              <span>Parent Object</span>

              <select
                value={
                  form.parent_object_id || ""
                }
                onChange={(event) => {
                  update(
                    "parent_object_id",
                    event.target.value
                  );

                  update(
                    "parent_field_id",
                    ""
                  );
                }}
                required
              >
                <option value="">
                  {loadingObjects
                    ? "Loading objects…"
                    : "Select parent object"}
                </option>

                {availableObjects.map(
                  (object) => {
                    const id =
                      objectId(object);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {objectName(object)}
                      </option>
                    );
                  }
                )}
              </select>
            </label>

            <label>
              <span>Child Object</span>

              <select
                value={
                  form.child_object_id || ""
                }
                onChange={(event) => {
                  update(
                    "child_object_id",
                    event.target.value
                  );

                  update(
                    "child_field_id",
                    ""
                  );
                }}
                required
              >
                <option value="">
                  {loadingObjects
                    ? "Loading objects…"
                    : "Select child object"}
                </option>

                {availableObjects.map(
                  (object) => {
                    const id =
                      objectId(object);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {objectName(object)}
                      </option>
                    );
                  }
                )}
              </select>
            </label>

            <label>
              <span>Parent Field</span>

              <select
                value={
                  form.parent_field_id || ""
                }
                onChange={(event) =>
                  update(
                    "parent_field_id",
                    event.target.value
                  )
                }
                disabled={
                  !form.parent_object_id ||
                  loadingFields
                }
              >
                <option value="">
                  {loadingFields
                    ? "Loading fields…"
                    : "Select field"}
                </option>

                {parentFields.map(
                  (field) => {
                    const id =
                      fieldId(field);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {fieldName(field)}
                      </option>
                    );
                  }
                )}
              </select>
            </label>

            <label>
              <span>Child Field</span>

              <select
                value={
                  form.child_field_id || ""
                }
                onChange={(event) =>
                  update(
                    "child_field_id",
                    event.target.value
                  )
                }
                disabled={
                  !form.child_object_id ||
                  loadingFields
                }
              >
                <option value="">
                  {loadingFields
                    ? "Loading fields…"
                    : "Select field"}
                </option>

                {childFields.map(
                  (field) => {
                    const id =
                      fieldId(field);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {fieldName(field)}
                      </option>
                    );
                  }
                )}
              </select>
            </label>
          </div>
        </section>

        <section className="platform-relationship-card">
          <div className="platform-card-heading">
            <div>
              <h3>Relationship Policies</h3>
              <p>
                These settings describe what should happen
                when related records change.
              </p>
            </div>
          </div>

          <div className="platform-relationship-grid">
            <label>
              <span>When Parent Is Deleted</span>

              <select
                value={
                  form.on_delete || "restrict"
                }
                onChange={(event) =>
                  update(
                    "on_delete",
                    event.target.value
                  )
                }
              >
                {DELETE_POLICIES.map(
                  (policy) => (
                    <option
                      key={policy.value}
                      value={policy.value}
                    >
                      {policy.label}
                    </option>
                  )
                )}
              </select>

              <small>
                {
                  DELETE_POLICIES.find(
                    (policy) =>
                      policy.value ===
                      form.on_delete
                  )?.description
                }
              </small>
            </label>

            <label>
              <span>When Parent Is Updated</span>

              <select
                value={
                  form.on_update || "restrict"
                }
                onChange={(event) =>
                  update(
                    "on_update",
                    event.target.value
                  )
                }
              >
                {UPDATE_POLICIES.map(
                  (policy) => (
                    <option
                      key={policy.value}
                      value={policy.value}
                    >
                      {policy.label}
                    </option>
                  )
                )}
              </select>
            </label>

            <label className="platform-relationship-wide">
              <span>Description</span>

              <textarea
                value={
                  form.description || ""
                }
                onChange={(event) =>
                  update(
                    "description",
                    event.target.value
                  )
                }
                rows={3}
                placeholder="Describe why these objects are related."
              />
            </label>
          </div>
        </section>

        <div className="platform-relationship-footer">
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
            {saving
              ? "Saving…"
              : "Save Relationship"}
          </button>
        </div>
      </form>

      <style>{`
        .platform-relationship-editor {
          max-width: 1100px;
          margin: 0 auto;
          padding: 20px;
          color: var(--text-primary, #1f2937);
        }

        .platform-relationship-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 20px;
        }

        .platform-eyebrow {
          margin-bottom: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
        }

        .platform-relationship-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-relationship-header p {
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-relationship-card {
          margin-bottom: 16px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #ffffff);
          overflow: hidden;
        }

        .platform-card-heading {
          padding: 17px 18px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
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

        .platform-relationship-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 17px;
          padding: 18px;
        }

        .platform-relationship-grid > label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .platform-relationship-grid > label > span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-relationship-grid input,
        .platform-relationship-grid select,
        .platform-relationship-grid textarea {
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

        .platform-relationship-grid textarea {
          resize: vertical;
        }

        .platform-relationship-grid input:focus,
        .platform-relationship-grid select:focus,
        .platform-relationship-grid textarea:focus {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-relationship-grid select:disabled {
          opacity: 0.6;
        }

        .platform-relationship-grid small {
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          line-height: 1.4;
        }

        .platform-relationship-wide {
          grid-column: 1 / -1;
        }

        .platform-relationship-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding-top: 4px;
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
          .platform-relationship-editor {
            padding: 14px;
          }

          .platform-relationship-header {
            flex-direction: column;
          }

          .platform-relationship-grid {
            grid-template-columns: 1fr;
          }

          .platform-relationship-wide {
            grid-column: auto;
          }
        }
      `}</style>
    </div>
  );
}
