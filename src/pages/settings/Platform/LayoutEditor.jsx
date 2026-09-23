import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import { toSafeApiName, withGeneratedApiName } from "./safeApiName.js";
import PlatformFieldPicker from "./PlatformFieldPicker.jsx";

const PAGE_TYPES = [
  { value: "list", label: "List" },
  { value: "detail", label: "Detail" },
  { value: "create", label: "Create" },
  { value: "edit", label: "Edit" },
];

const EMPTY_LAYOUT = {
  name: "",
  layout_key: "",
  page_type: "detail",
  object_id: "",
  record_type_id: "",
  role_id: "",
  company_id: "",
  active: true,
  components: [],
  sections: [{ id: "section-1", label: "Details", order: 0, columns: 1, visible: true }],
};

function initialLayoutSections(layout) {
  const sourceSections = Array.isArray(layout?.definition?.sections) && layout.definition.sections.length
    ? layout.definition.sections
    : [{ id: "section-1", label: "Details", order: 0, columns: 1, visible: true }];
  const sourceComponents = Array.isArray(layout?.definition?.components) ? layout.definition.components : [];
  const sectionComponents = sourceSections.flatMap((section) => (section.items || section.components || []).map((component) => ({ ...component, section_id: section.id })));
  const components = sectionComponents.length ? sectionComponents : sourceComponents.map((component) => ({ ...component, section_id: sourceSections[0].id }));
  return { sections: sourceSections, components };
}

function getId(item, fallback = "") {
  return (
    item?.id ||
    item?.layout_id ||
    item?.object_id ||
    item?.field_id ||
    item?.role_id ||
    fallback
  );
}

function getObjectName(object) {
  return (
    object?.label ||
    object?.name ||
    object?.object_name ||
    object?.object_key ||
    "Unnamed Object"
  );
}

function getFieldName(field) {
  return (
    field?.label ||
    field?.name ||
    field?.field_name ||
    field?.field_key ||
    "Unnamed Field"
  );
}

export default function LayoutEditor({
  layout = null,
  objects = [],
  initialObjectId = "",
  roles = [],
  companies = [],
  onSave,
  onCancel,
}) {
  const isNew =
    !layout?.id &&
    !layout?.layout_id;

  const [form, setForm] = useState({
    ...EMPTY_LAYOUT,
    ...(layout || {}),
    ...initialLayoutSections(layout),
    ...(isNew && initialObjectId ? { object_id: initialObjectId } : {}),
  });

  const [availableObjects, setAvailableObjects] =
    useState(objects || []);

  const [availableRoles, setAvailableRoles] =
    useState(roles || []);

  const [availableCompanies, setAvailableCompanies] =
    useState(companies || []);

  const [fields, setFields] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [recordTypes, setRecordTypes] = useState([]);
  const [loadingObjects, setLoadingObjects] =
    useState(false);
  const [loadingFields, setLoadingFields] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const layoutId =
    layout?.id ||
    layout?.layout_id;

  useEffect(() => {
    if (!objects?.length) {
      loadObjects();
    } else {
      setAvailableObjects(objects);
    }
  }, [objects]);

  useEffect(() => {
    if (roles?.length) {
      setAvailableRoles(roles);
    }
  }, [roles]);

  useEffect(() => {
    if (companies?.length) {
      setAvailableCompanies(companies);
    }
  }, [companies]);

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
        err?.message ||
          "Unable to load objects."
      );
    } finally {
      setLoadingObjects(false);
    }
  }

  async function loadFields(objectId) {
    setLoadingFields(true);
    setError("");

    try {
      const data = await apiRequest(`/api/platform/objects/${objectId}/fields`);

      const loaded =
        data?.data || [];

      setFields(
        Array.isArray(loaded)
          ? loaded
          : []
      );
      const recordTypesData = await apiRequest(`/api/platform/objects/${form.object_id}/record-types`);
      const recordTypesLoaded = recordTypesData?.data || [];
      setRecordTypes(Array.isArray(recordTypesLoaded) ? recordTypesLoaded : []);
      const relationshipsData = await apiRequest("/api/platform/relationships");
      const relationshipRows = relationshipsData?.data || [];
      setRelationships(Array.isArray(relationshipRows) ? relationshipRows.filter((relationship) => String(relationship.parent_object_id) === String(objectId)) : []);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load object fields."
      );

      setFields([]);
    } finally {
      setLoadingFields(false);
    }

  }

  function update(name, value) {
    setForm((current) => ({
      ...current,
      // The layout API key is generated with the same shared safeApiName
      // convention as Platform objects and fields, and only while the layout is
      // new so an existing key is never renamed by a label edit.
      ...withGeneratedApiName(current, name, value, (label) => toSafeApiName(label, "layout"), { apiNameField: "layout_key", isNew }),
      [name]: value,
    }));
  }

  function addComponent(component) {
    const sectionId = form.sections[0]?.id || "section-1";
    update("components", [...form.components, { ...component, section_id: sectionId }]);
  }

  function addSection() {
    const id = `section-${Date.now()}`;
    update("sections", [...form.sections, { id, label: `Section ${form.sections.length + 1}`, order: form.sections.length, columns: 1, visible: true }]);
  }

  function updateSection(index, name, value) {
    update("sections", form.sections.map((section, itemIndex) => itemIndex === index ? { ...section, [name]: value } : section));
  }

  function moveSection(index, direction) {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= form.sections.length) return;
    const next = [...form.sections];
    [next[index], next[target]] = [next[target], next[index]];
    update("sections", next.map((section, order) => ({ ...section, order })));
  }

  function removeSection(index) {
    if (form.sections.length === 1) return;
    const removed = form.sections[index];
    const fallback = form.sections[index === 0 ? 1 : 0];
    update("sections", form.sections.filter((_, itemIndex) => itemIndex !== index));
    update("components", form.components.map((component) => component.section_id === removed.id ? { ...component, section_id: fallback.id } : component));
  }

  function componentKey(component) {
    return (
      component?.id ||
      component?.key ||
      component?.field_key ||
      `component-${Math.random()}`
    );
  }

  function addField(field) {
    const fieldKey =
      field?.field_key ||
      field?.api_name ||
      field?.name;

    if (!fieldKey) {
      return;
    }

    const exists = form.components.some(
      (component) =>
        component?.field_key === fieldKey
    );

    if (exists) {
      return;
    }

    const next = [
      ...form.components,
      {
        type: "field",
        field_key: fieldKey,
        label:
          field?.label ||
          field?.name ||
          fieldKey,
        visible: true,
        required: false,
        width: "full",
        section_id: form.sections[0]?.id || "section-1",
      },
    ];

    update("components", next);
  }

  function removeComponent(index) {
    update(
      "components",
      form.components.filter(
        (_, itemIndex) =>
          itemIndex !== index
      )
    );
  }

  function moveComponent(index, direction) {
    const target =
      direction === "up"
        ? index - 1
        : index + 1;

    if (
      target < 0 ||
      target >= form.components.length
    ) {
      return;
    }

    const next = [...form.components];

    [
      next[index],
      next[target],
    ] = [
      next[target],
      next[index],
    ];

    update("components", next);
  }

  function updateComponent(
    index,
    name,
    value
  ) {
    const next =
      form.components.map(
        (component, itemIndex) =>
          itemIndex === index
            ? {
                ...component,
                [name]: value,
              }
            : component
      );

    update("components", next);
  }

  async function saveLayout(event) {
    event.preventDefault();

    setSaving(true);
    setError("");

    try {
      if (!form.name?.trim()) {
        throw new Error(
          "Enter a layout name."
        );
      }

      if (!form.object_id) {
        throw new Error(
          "Select an object."
        );
      }

      const payload = {
        name: form.name.trim(),
        pageType: form.page_type,
        objectId: form.object_id,
        recordTypeId: form.record_type_id || null,
        roleId: form.role_id || null,
        companyId: form.company_id || null,
        active: form.active !== false,
        isDefault: form.is_default === true,
        definition: {
          components: Array.isArray(form.components) ? form.components : [],
          sections: form.sections.map((section) => ({
            ...section,
            items: form.components.filter((component) => component.section_id === section.id),
          })),
        },
      };

      const url = isNew
        ? "/api/platform/layouts"
        : `/api/platform/layouts/${layoutId}`;

      const data = await apiRequest(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(payload) });

      const saved =
        data?.data || data;

      if (
        typeof onSave ===
        "function"
      ) {
        onSave(saved);
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to save layout."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="platform-layout-editor">
      <div className="platform-layout-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / LAYOUT
          </div>

          <h2>
            {isNew
              ? "New Layout"
              : "Edit Layout"}
          </h2>

          <p>
            Configure which fields appear on
            an object's page.
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

      <form onSubmit={saveLayout}>
        <section className="platform-layout-card">
          <div className="platform-card-heading">
            <div>
              <h3>Sections</h3>
              <p>Organize fields into ordered one- or two-column sections.</p>
            </div>
            <button type="button" onClick={addSection}>+ Add Section</button>
          </div>
          <div className="platform-component-list">
            {form.sections.map((section, index) => (
              <div className="platform-component-row" key={section.id}>
                <div className="platform-component-position">{index + 1}</div>
                <label>
                  <span>Section name</span>
                  <input value={section.label || ""} onChange={(event) => updateSection(index, "label", event.target.value)} />
                </label>
                <label>
                  <span>Columns</span>
                  <select value={Number(section.columns) === 2 ? 2 : 1} onChange={(event) => updateSection(index, "columns", Number(event.target.value))}>
                    <option value="1">1 column</option>
                    <option value="2">2 columns</option>
                  </select>
                </label>
                <label className="platform-inline-checkbox">
                  <input type="checkbox" checked={section.visible !== false} onChange={(event) => updateSection(index, "visible", event.target.checked)} />
                  <span>Visible</span>
                </label>
                <div className="platform-component-actions">
                  <button type="button" onClick={() => moveSection(index, "up")} disabled={index === 0}>↑</button>
                  <button type="button" onClick={() => moveSection(index, "down")} disabled={index === form.sections.length - 1}>↓</button>
                  <button type="button" onClick={() => removeSection(index)} disabled={form.sections.length === 1}>×</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="platform-layout-card">
          <div className="platform-card-heading">
            <h3>Layout Information</h3>
            <p>
              A layout defines the page configuration
              for one metadata object.
            </p>
          </div>

          <div className="platform-layout-grid">
            <label>
              <span>Layout Name</span>

              <input
                type="text"
                value={
                  form.name || ""
                }
                onChange={(event) =>
                  update(
                    "name",
                    event.target.value
                  )
                }
                placeholder="Customer Detail"
                required
              />
            </label>

            <label>
              <span>API Key (generated from name)</span>

              <input
                type="text"
                value={
                  form.layout_key ||
                  ""
                }
                placeholder="standard_product_layout"
                readOnly
              />
            </label>

            <label>
              <span>Object</span>

              <select
                value={
                  form.object_id ||
                  ""
                }
                onChange={(event) =>
                  update(
                    "object_id",
                    event.target.value
                  )
                }
                disabled={
                  loadingObjects
                }
                required
              >
                <option value="">
                  {loadingObjects
                    ? "Loading objects…"
                    : "Select object"}
                </option>

                {availableObjects.map(
                  (object) => {
                    const id =
                      getId(object);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {getObjectName(
                          object
                        )}
                      </option>
                    );
                  }
                )}
              </select>
            </label>

            <label>
              <span>Record Type</span>
              <select
                value={form.record_type_id || ""}
                onChange={(event) => update("record_type_id", event.target.value)}
                disabled={!form.object_id || loadingFields}
              >
                <option value="">All record types</option>
                {recordTypes.map((recordType) => (
                  <option key={recordType.id} value={recordType.id}>
                    {recordType.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Page Type</span>

              <select
                value={
                  form.page_type ||
                  "detail"
                }
                onChange={(event) =>
                  update(
                    "page_type",
                    event.target.value
                  )
                }
              >
                {PAGE_TYPES.map(
                  (page) => (
                    <option
                      key={page.value}
                      value={
                        page.value
                      }
                    >
                      {page.label}
                    </option>
                  )
                )}
              </select>
            </label>

            <label>
              <span>Role</span>

              <select
                value={
                  form.role_id || ""
                }
                onChange={(event) =>
                  update(
                    "role_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  All roles
                </option>

                {availableRoles.map(
                  (role) => {
                    const id =
                      getId(role);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {role?.name ||
                          role?.label ||
                          `Role ${id}`}
                      </option>
                    );
                  }
                )}
              </select>
            </label>

            <label>
              <span>Company</span>

              <select
                value={
                  form.company_id ||
                  ""
                }
                onChange={(event) =>
                  update(
                    "company_id",
                    event.target.value
                  )
                }
              >
                <option value="">
                  All companies
                </option>

                {availableCompanies.map(
                  (company) => {
                    const id =
                      getId(company);

                    return (
                      <option
                        key={id}
                        value={id}
                      >
                        {company?.name ||
                          company?.label ||
                          `Company ${id}`}
                      </option>
                    );
                  }
                )}
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
          </div>
        </section>

        {form.page_type === "detail" ? (
          <section className="platform-layout-card">
            <div className="platform-card-heading">
              <h3>Record Page Components</h3>
              <p>Configure permitted standard actions and related lists for this page.</p>
            </div>
            <div className="platform-component-picker">
              {[
                ["edit", "Edit Record"],
                ["delete", "Delete Record"],
                ["create_related", "Create Related Record"],
                ["open_related", "Open Related List"],
                ["run_workflow", "Run Workflow"],
                ["call_function", "Call Registered Function"],
              ].map(([action, label]) => (
                <button type="button" key={action} onClick={() => addComponent({ type: "action", action, label, visible: true, confirmation: action === "delete" })}>
                  Add {label}
                </button>
              ))}
              {relationships.map((relationship) => (
                <button type="button" key={relationship.id} onClick={() => addComponent({
                  type: "related_list",
                  relationship_key: relationship.relationship_key,
                  label: relationship.relationship_key,
                  columns: [],
                  visible: true,
                })}>
                  Add {relationship.relationship_key} related list
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="platform-layout-card">
          <div className="platform-card-heading">
            <div>
              <h3>Available Fields</h3>
              <p>
                Select fields from the chosen object
                to add them to this layout.
              </p>
            </div>
          </div>

          <div className="platform-field-picker">
            {loadingFields ? (
              <div className="platform-muted">
                Loading fields…
              </div>
            ) : fields.length === 0 ? (
              <div className="platform-muted">
                Select an object with available
                metadata fields.
              </div>
            ) : (
              fields.map((field) => {
                const key =
                  field?.field_key ||
                  field?.api_name ||
                  field?.name;

                const alreadyAdded =
                  form.components.some(
                    (component) =>
                      component?.field_key ===
                      key
                  );

                return (
                  <button
                    type="button"
                    key={
                      getId(field, key)
                    }
                    className={
                      "platform-field-picker-item"
                    }
                    disabled={
                      alreadyAdded
                    }
                    onClick={() =>
                      addField(field)
                    }
                  >
                    <span>
                      {getFieldName(
                        field
                      )}
                    </span>

                    <small>
                      {key}
                    </small>

                    <strong>
                      {alreadyAdded
                        ? "Added"
                        : "Add"}
                    </strong>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="platform-layout-card">
          <div className="platform-card-heading">
            <div>
              <h3>Page Components</h3>
              <p>
                Arrange the fields that appear on the
                configured page.
              </p>
            </div>
          </div>

          <div className="platform-component-list">
            {form.components.length ===
            0 ? (
              <div className="platform-empty">
                No fields have been added to
                this layout yet.
              </div>
            ) : (
              form.components.map(
                (component, index) => (
                  <div
                    className="platform-component-row"
                    key={componentKey(
                      component
                    )}
                  >
                    <div className="platform-component-position">
                      {index + 1}
                    </div>

                    <div className="platform-component-main">
                      <strong>
                        {component.label ||
                            component.field_key ||
                            component.action ||
                            component.relationship_key}
                      </strong>

                      <small>
                        {component.type === "field"
                          ? component.field_key
                          : component.type === "action"
                            ? `Action: ${component.action}`
                            : `Related list: ${component.relationship_key}`}
                      </small>
                    </div>

                    <label>
                      <span>Section</span>
                      <select value={component.section_id || form.sections[0]?.id || ""} onChange={(event) => updateComponent(index, "section_id", event.target.value)}>
                        {form.sections.map((section) => <option key={section.id} value={section.id}>{section.label || section.id}</option>)}
                      </select>
                    </label>

                    {component.type === "related_list" ? (
                      <>
                        <div>
                          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Visible columns</span>
                          {(component.columns || []).map((column, columnIndex) => (
                            <div className="mb-2 flex gap-2" key={`${column}-${columnIndex}`}>
                              <PlatformFieldPicker selectedObjectKey={availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.object_key || availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.objectKey || ""} value={column} label="Select column" onChange={(value) => updateComponent(index, "columns", (component.columns || []).map((item, itemIndex) => itemIndex === columnIndex ? value : item).filter(Boolean))} />
                              <button type="button" onClick={() => updateComponent(index, "columns", (component.columns || []).filter((_, itemIndex) => itemIndex !== columnIndex))}>Remove</button>
                            </div>
                          ))}
                          <button type="button" className="text-sm text-blue-700" onClick={() => updateComponent(index, "columns", [...(component.columns || []), ""])}>+ Add column</button>
                        </div>
                        <label>
                          <span>Related List Label</span>
                          <input value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
                        </label>
                        <label>
                          <span>Sort Field</span>
                          <input value={component.sort_field || ""} placeholder="Optional API name" onChange={(event) => updateComponent(index, "sort_field", event.target.value)} />
                        </label>
                        <label>
                          <span>Sort Direction</span>
                          <select value={component.sort_direction || "asc"} onChange={(event) => updateComponent(index, "sort_direction", event.target.value)}>
                            <option value="asc">Ascending</option>
                            <option value="desc">Descending</option>
                          </select>
                        </label>
                        <label>
                          <span>Row Limit</span>
                          <input type="number" min="1" max="100" value={component.limit || 25} onChange={(event) => updateComponent(index, "limit", Math.min(Math.max(Number(event.target.value) || 25, 1), 100))} />
                        </label>
                      </>
                    ) : component.type === "action" ? (
                      <>
                        <label>
                          <span>Action Type</span>
                          <select value={component.action || "edit"} onChange={(event) => updateComponent(index, "action", event.target.value)}>
                            <option value="edit">Edit Record</option>
                            <option value="delete">Delete Record</option>
                            <option value="create_related">Create Related Record</option>
                            <option value="open_related">Open Related List</option>
                            <option value="run_workflow">Run Workflow</option>
                            <option value="call_function">Call Registered Function</option>
                          </select>
                        </label>
                        <label>
                          <span>Label</span>
                          <input value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
                        </label>
                        {["create_related", "open_related"].includes(component.action) ? (
                          <label>
                            <span>Relationship Key</span>
                            <select value={component.relationship_key || ""} onChange={(event) => updateComponent(index, "relationship_key", event.target.value)}>
                              <option value="">Select relationship</option>
                              {relationships.map((relationship) => <option key={relationship.id} value={relationship.relationship_key}>{relationship.relationship_key}</option>)}
                            </select>
                          </label>
                        ) : null}
                        {component.action === "run_workflow" ? (
                          <label><span>Workflow ID</span><input value={component.workflow_id || ""} onChange={(event) => updateComponent(index, "workflow_id", event.target.value)} placeholder="Existing workflow ID" /></label>
                        ) : null}
                        {component.action === "call_function" ? (
                          <label><span>Registered Function Key</span><input value={component.function_key || ""} onChange={(event) => updateComponent(index, "function_key", event.target.value)} placeholder="Registered function key" /></label>
                        ) : null}
                      </>
                    ) : null}

                    <label>
                      <span>Width</span>

                      <select
                        value={
                          component.width ||
                          "full"
                        }
                        onChange={(
                          event
                        ) =>
                          updateComponent(
                            index,
                            "width",
                            event.target
                              .value
                          )
                        }
                      >
                        <option value="full">
                          Full
                        </option>
                        <option value="half">
                          Half
                        </option>
                        <option value="third">
                          Third
                        </option>
                      </select>
                    </label>

                    {component.type === "field" ? (
                      <>
                        <label className="platform-inline-checkbox">
                          <input type="checkbox" checked={component.read_only === true} onChange={(event) => updateComponent(index, "read_only", event.target.checked)} />
                          <span>Read-only</span>
                        </label>
                        <label className="platform-inline-checkbox">
                          <input type="checkbox" checked={component.required === true} onChange={(event) => updateComponent(index, "required", event.target.checked)} />
                          <span>Required</span>
                        </label>
                      </>
                    ) : null}

                    <label className="platform-inline-checkbox">
                      <input
                        type="checkbox"
                        checked={
                          component.visible !==
                          false
                        }
                        onChange={(
                          event
                        ) =>
                          updateComponent(
                            index,
                            "visible",
                            event.target
                              .checked
                          )
                        }
                      />

                      <span>
                        Visible
                      </span>
                    </label>

                    <div className="platform-component-actions">
                      <button
                        type="button"
                        onClick={() =>
                          moveComponent(
                            index,
                            "up"
                          )
                        }
                        disabled={
                          index === 0
                        }
                        title="Move up"
                      >
                        ↑
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          moveComponent(
                            index,
                            "down"
                          )
                        }
                        disabled={
                          index ===
                          form.components
                            .length -
                            1
                        }
                        title="Move down"
                      >
                        ↓
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          removeComponent(
                            index
                          )
                        }
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )
              )
            )}
          </div>
        </section>

        <div className="platform-layout-footer">
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
              : "Save Layout"}
          </button>
        </div>
      </form>

      <style>{`
        .platform-layout-editor {
          max-width: 1150px;
          margin: 0 auto;
          padding: 20px;
          color: var(--text-primary, #1f2937);
        }

        .platform-layout-header {
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

        .platform-layout-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-layout-header p {
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-layout-card {
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

        .platform-card-heading h3 {
          margin: 0;
          font-size: 15px;
        }

        .platform-card-heading p {
          margin: 4px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
        }

        .platform-layout-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 17px;
          padding: 18px;
        }

        .platform-layout-grid > label {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .platform-layout-grid > label > span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-layout-grid input,
        .platform-layout-grid select,
        .platform-layout-grid textarea {
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
        }

        .platform-layout-grid input:focus,
        .platform-layout-grid select:focus {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-field-picker {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
          padding: 18px;
        }

        .platform-field-picker-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 3px 8px;
          text-align: left;
          padding: 10px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          background: var(--card-background, #fff);
          color: inherit;
          cursor: pointer;
        }

        .platform-field-picker-item:hover:not(:disabled) {
          border-color: var(--primary-color, #2563eb);
        }

        .platform-field-picker-item span {
          font-size: 12px;
          font-weight: 600;
        }

        .platform-field-picker-item small {
          grid-column: 1;
          color: var(--text-secondary, #6b7280);
          font-size: 9px;
        }

        .platform-field-picker-item strong {
          grid-column: 2;
          grid-row: 1 / 3;
          align-self: center;
          font-size: 10px;
        }

        .platform-field-picker-item:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .platform-muted,
        .platform-empty {
          padding: 20px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          text-align: center;
        }

        .platform-component-list {
          padding: 10px 18px 18px;
        }

        .platform-component-row {
          display: grid;
          grid-template-columns: 34px minmax(180px, 1fr) 100px auto auto;
          align-items: center;
          gap: 12px;
          padding: 10px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
        }

        .platform-component-row:last-child {
          border-bottom: 0;
        }

        .platform-component-position {
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted-background, #f3f4f6);
          font-size: 11px;
          font-weight: 700;
        }

        .platform-component-main strong,
        .platform-component-main small {
          display: block;
        }

        .platform-component-main strong {
          font-size: 12px;
        }

        .platform-component-main small {
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 9px;
        }

        .platform-component-row label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .platform-component-row label > span {
          font-size: 9px;
          color: var(--text-secondary, #6b7280);
        }

        .platform-component-row select {
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 6px;
          padding: 5px;
          font-size: 10px;
          background: var(--card-background, #fff);
          color: inherit;
        }

        .platform-inline-checkbox {
          flex-direction: row !important;
          align-items: center;
          gap: 5px !important;
        }

        .platform-inline-checkbox input {
          width: auto;
        }

        .platform-inline-checkbox span {
          color: inherit !important;
          font-size: 10px !important;
        }

        .platform-component-actions {
          display: flex;
          gap: 4px;
        }

        .platform-component-actions button {
          width: 26px;
          height: 26px;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 6px;
          background: var(--card-background, #fff);
          color: inherit;
          cursor: pointer;
        }

        .platform-component-actions button:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .platform-layout-footer {
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

        @media (max-width: 850px) {
          .platform-field-picker {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .platform-component-row {
            grid-template-columns: 30px 1fr auto;
          }

          .platform-component-row > label,
          .platform-component-actions {
            grid-column: 2 / -1;
          }
        }

        @media (max-width: 650px) {
          .platform-layout-header {
            flex-direction: column;
          }

          .platform-layout-grid {
            grid-template-columns: 1fr;
          }

          .platform-field-picker {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
