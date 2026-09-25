import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Lock, Plus, Search, Trash2, X } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import { toSafeApiName, withGeneratedApiName } from "./safeApiName.js";
import PlatformFieldPicker from "./PlatformFieldPicker.jsx";
import MetadataResourcePicker from "./MetadataResourcePicker.jsx";
import FormRenderer from "./FormRenderer.jsx";
import { diagnoseFormDefinition } from "./formDefinition.js";
import { FALLBACK_COMPONENT_REGISTRY, componentKeyForFieldType, paletteComponents } from "./componentRegistry.js";

const PAGE_TYPES = [
  { value: "list", label: "List" },
  { value: "detail", label: "View Details" },
  { value: "create", label: "Create" },
  { value: "edit", label: "Edit" },
  { value: "quick_create", label: "Quick Create" },
];

const FORM_PRESENTATION_MODES = [
  { key: "inline", label: "Inline form" },
  { key: "overlay_rectangle", label: "Rectangle overlay" },
  { key: "overlay_square", label: "Compact overlay" },
];

/* The compact builder renders at three preview widths. These are canvas frames
   only — no runtime sizing or responsive behaviour is implied. */
const DEVICE_WIDTHS = [
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "mobile", label: "Mobile" },
];

/* Palette components. Kept identical to the previous builder so nothing that
   could be placed before is no longer placeable. */


const RECORD_ACTIONS = [
  ["edit", "Edit Record"],
  ["delete", "Delete Record"],
  ["create_related", "Create Related Record"],
  ["open_related", "Open Related List"],
  ["run_workflow", "Run Workflow"],
  ["call_function", "Call Registered Function"],
];

/* Same operator vocabulary the Field editor already uses, so a condition
   authored here means exactly what it means there. */
const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
];

const WIDTHS = ["full", "1/2", "1/3", "2/3", "1/4"];

const WIDTH_FRACTIONS = { "1/4": 1 / 4, "1/3": 1 / 3, "1/2": 1 / 2, "2/3": 2 / 3 };

const EMPTY_LAYOUT = {
  name: "",
  layout_key: "",
  page_type: "detail",
  object_id: "",
  record_type_id: "",
  role_id: "",
  company_id: "",
  active: true,
  presentation_mode: "inline",
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

/* The one key used for every field reference in the builder. Mirrors the order
   the rest of the Platform uses so a placed field always matches its metadata. */
function getFieldKey(field) {
  return field?.field_key || field?.api_name || field?.apiName || field?.fieldKey || field?.name || "";
}

/* Stable identity for a placed component. Deliberately index-based as a last
   resort rather than random, so React keys and selection survive re-renders. */
function componentKey(component, index) {
  return String(component?.id || component?.key || component?.field_key || `component-${index}`);
}

function isReadOnly(component) {
  return component?.readOnly === true || component?.read_only === true;
}

/* How many grid columns a placed component spans inside its section. */
function spanFor(component, columns) {
  const total = Math.max(1, Number(columns) || 1);
  const width = component?.width || "full";
  if (width === "full" || !WIDTH_FRACTIONS[width]) return total;
  return Math.min(total, Math.max(1, Math.ceil(total * WIDTH_FRACTIONS[width])));
}

function getFieldType(field) {
  return field?.field_type || field?.fieldType || "text";
}

export default function LayoutEditor({
  layout = null,
  objects = [],
  initialObjectId = "",
  initialPageType = "detail",
  roles = [],
  companies = [],
  onSave,
  onCancel,
  onEditField,
  fieldRefreshKey = 0,
}) {
  const isNew =
    !layout?.id &&
    !layout?.layout_id;

  const [form, setForm] = useState({
    ...EMPTY_LAYOUT,
    ...(layout || {}),
    ...initialLayoutSections(layout),
    presentation_mode: layout?.definition?.presentation_mode || layout?.presentation_mode || "inline",
    ...(isNew && initialObjectId ? { object_id: initialObjectId } : {}),
    ...(isNew ? { page_type: initialPageType } : {}),
  });

  const [availableObjects, setAvailableObjects] =
    useState(objects || []);

  const [availableRoles, setAvailableRoles] =
    useState(roles || []);

  const [availableCompanies, setAvailableCompanies] =
    useState(companies || []);

  const [fields, setFields] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [relatedFieldsByRelationship, setRelatedFieldsByRelationship] = useState({});
  const [componentRegistry, setComponentRegistry] = useState(FALLBACK_COMPONENT_REGISTRY);
  const [buttonVariants, setButtonVariants] = useState([{ key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "outline", label: "Outline" }, { key: "destructive", label: "Destructive" }, { key: "icon", label: "Icon" }, { key: "icon_label", label: "Icon + Label" }]);
  const [registeredActions, setRegisteredActions] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [recordTypes, setRecordTypes] = useState([]);
  const [loadingObjects, setLoadingObjects] =
    useState(false);
  const [loadingFields, setLoadingFields] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewMode, setPreviewMode] = useState("");

  /* ---------------------------- builder UI state --------------------------- */
  /* Selection drives the right-hand properties panel: "form" (the canvas
     itself), "section", or a specific placed component. */
  const [selection, setSelection] = useState({ kind: "form", id: "" });
  const [fieldSearch, setFieldSearch] = useState("");
  const [pickerSectionId, setPickerSectionId] = useState("");
  const [device, setDevice] = useState("desktop");
  const [mobilePane, setMobilePane] = useState("canvas");
  const [dropHint, setDropHint] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [conditionFor, setConditionFor] = useState("");
  const [securityFor, setSecurityFor] = useState("");

  const layoutId =
    layout?.id ||
    layout?.layout_id;
  const diagnostics = diagnoseFormDefinition({
    sections: form.sections,
    components: form.components,
  }, fields);

  const fieldByKey = useMemo(
    () => new Map(fields.map((field) => [getFieldKey(field), field])),
    [fields]
  );

  const selectedIndex =
    selection.kind === "component"
      ? form.components.findIndex((component, index) => componentKey(component, index) === selection.id)
      : -1;
  const selectedComponent = selectedIndex >= 0 ? form.components[selectedIndex] : null;
  const selectedSectionIndex =
    selection.kind === "section"
      ? form.sections.findIndex((section) => String(section.id) === String(selection.id))
      : -1;
  const selectedSection = selectedSectionIndex >= 0 ? form.sections[selectedSectionIndex] : null;

  const firstSectionId = form.sections[0]?.id || "section-1";
  const sectionLabel = (id) => form.sections.find((section) => String(section.id) === String(id))?.label || "section";
  const objectLabel = getObjectName(availableObjects.find((object) => String(getId(object)) === String(form.object_id)));

  useEffect(() => {
    const nextIsNew = !layout?.id && !layout?.layout_id;
    const nextForm = {
      ...EMPTY_LAYOUT,
      ...(layout || {}),
      ...initialLayoutSections(layout),
      presentation_mode: layout?.definition?.presentation_mode || layout?.presentation_mode || "inline",
      ...(nextIsNew && initialObjectId ? { object_id: initialObjectId } : {}),
      ...(nextIsNew ? { page_type: initialPageType } : {}),
    };
    setForm(nextForm);
    setSelection({ kind: "form", id: "" });
    setPickerSectionId("");
    setPreviewMode("");
    setFieldSearch("");
    setMobilePane("canvas");
  }, [layoutId, initialObjectId, initialPageType]);

  useEffect(() => {
    let cancelled = false;
    apiRequest("/api/platform/component-registry")
      .then((result) => {
        if (!cancelled && Array.isArray(result?.data) && result.data.length) setComponentRegistry(result.data);
      })
      .catch(() => { /* fallback registry is intentionally retained */ });
    apiRequest("/api/platform/button-variants")
      .then((result) => { if (!cancelled && Array.isArray(result?.data) && result.data.length) setButtonVariants(result.data); })
      .catch(() => {});
    apiRequest("/api/platform/action-registry")
      .then((result) => { if (!cancelled && Array.isArray(result?.data)) setRegisteredActions(result.data); })
      .catch(() => {});
    apiRequest("/api/platform/rules")
      .then((result) => { if (!cancelled && Array.isArray(result?.data)) setWorkflows(result.data.filter((rule) => rule?.action?.type === "workflow")); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      setFields([]);
      setRelationships([]);
      setRelatedFieldsByRelationship({});
      setRecordTypes([]);
      loadFields(form.object_id);
    } else {
      setFields([]);
      setRelationships([]);
      setRelatedFieldsByRelationship({});
      setRecordTypes([]);
    }
  }, [form.object_id]);

  // The host bumps this after a field was edited elsewhere, so a changed
  // label/type/security is re-read without reloading the unsaved form.
  useEffect(() => {
    if (fieldRefreshKey && form.object_id) {
      loadFields(form.object_id);
    }
  }, [fieldRefreshKey]);

  /* Escape closes the add picker (the shared modal supplies the rest of the
     dialog behaviour: overlay, focus containment, background dimming). */
  useEffect(() => {
    if (!pickerSectionId) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setPickerSectionId("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerSectionId]);

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
      const recordTypesData = await apiRequest(`/api/platform/objects/${objectId}/record-types`);
      const recordTypesLoaded = recordTypesData?.data || [];
      setRecordTypes(Array.isArray(recordTypesLoaded) ? recordTypesLoaded : []);
      const relationshipsData = await apiRequest("/api/platform/relationships");
      const relationshipRows = relationshipsData?.data || [];
      const scopedRelationships = Array.isArray(relationshipRows)
        ? relationshipRows.filter((relationship) => String(relationship.parent_object_id) === String(objectId))
        : [];
      setRelationships(scopedRelationships);
      const relatedFieldEntries = await Promise.all(scopedRelationships.map(async (relationship) => {
        const response = await apiRequest(`/api/platform/objects/${encodeURIComponent(relationship.child_object_id)}/fields`);
        return [relationship.relationship_key, Array.isArray(response?.data) ? response.data : []];
      }));
      setRelatedFieldsByRelationship(Object.fromEntries(relatedFieldEntries));
      const customActionsData = await apiRequest(`/api/platform/objects/${objectId}/registered-actions`);
      const customActions = Array.isArray(customActionsData?.data) ? customActionsData.data.map((action) => ({ key: action.action_key, displayName: action.label })) : [];
      const coreActionsData = await apiRequest("/api/platform/action-registry");
      const coreActions = Array.isArray(coreActionsData?.data) ? coreActionsData.data : [];
      setRegisteredActions([...coreActions, ...customActions].filter((action, index, all) => all.findIndex((candidate) => candidate.key === action.key) === index));
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

  function addComponent(component, targetSectionId = firstSectionId) {
    const id = `${component.type || "component"}-${Date.now()}`;
    const next = [...form.components, { ...component, id, section_id: targetSectionId || firstSectionId, order: form.components.length }];
    update("components", next);
    setSelection({ kind: "component", id });
    setPickerSectionId("");
  }

  function addSection() {
    const id = `section-${Date.now()}`;
    update("sections", [...form.sections, { id, label: `Section ${form.sections.length + 1}`, order: form.sections.length, columns: 1, visible: true }]);
    setSelection({ kind: "section", id });
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
    if (selection.kind === "section" && String(selection.id) === String(removed.id)) {
      setSelection({ kind: "form", id: "" });
    }
  }

  function addField(field, targetSectionId = firstSectionId) {
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

    const id = `field-${fieldKey}-${Date.now()}`;
    const next = [
      ...form.components,
      {
        type: "field",
        component_key: componentKeyForFieldType(getFieldType(field), componentRegistry),
        field_key: fieldKey,
        label:
          field?.label ||
          field?.name ||
          fieldKey,
        visible: true,
        required: false,
        width: "full",
        id,
        order: form.components.length,
        section_id: targetSectionId || firstSectionId,
      },
    ];

    update("components", next);
    setSelection({ kind: "component", id });
    setPickerSectionId("");
  }

  function removeComponent(index) {
    update(
      "components",
      form.components.filter(
        (_, itemIndex) =>
          itemIndex !== index
      )
    );
    if (selection.kind === "component") {
      setSelection({ kind: "form", id: "" });
    }
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

    update("components", next.map((component, order) => ({ ...component, order })));
  }

  function updateComponentPatch(index, patch) {
    update("components", form.components.map((component, itemIndex) => itemIndex === index ? { ...component, ...patch } : component));
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

  /* Drag/drop: a chip is dropped before another chip (reorder and/or move
     between sections), or onto section whitespace to append to that section. */
  function dropComponent(targetIndex, event) {
    event.preventDefault();
    event.stopPropagation();
    setDropHint(null);
    const sourceIndex = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(sourceIndex) || !form.components[sourceIndex]) return;
    if (sourceIndex === targetIndex) return;
    const next = [...form.components];
    const [moved] = next.splice(sourceIndex, 1);
    const insertAt = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const targetSectionId = form.components[targetIndex]?.section_id || moved.section_id || firstSectionId;
    next.splice(insertAt, 0, { ...moved, section_id: targetSectionId });
    update("components", next.map((component, order) => ({ ...component, order })));
  }

  function dropOnSection(sectionId, event) {
    event.preventDefault();
    event.stopPropagation();
    setDropHint(null);
    const sourceIndex = Number(event.dataTransfer.getData("text/plain"));
    if (!Number.isInteger(sourceIndex) || !form.components[sourceIndex]) return;
    update("components", form.components.map((component, index) => index === sourceIndex ? { ...component, section_id: sectionId } : component));
  }

  function dropOnSectionHeader(targetIndex, event) {
    event.preventDefault();
    event.stopPropagation();
    const raw = event.dataTransfer.getData("text/plain");
    // Dropping a field on a section header moves it into that section.
    if (!raw.startsWith("section:")) {
      const targetSection = form.sections[targetIndex];
      if (targetSection) dropOnSection(targetSection.id, event);
      return;
    }
    const sourceIndex = Number(raw.replace("section:", ""));
    if (!Number.isInteger(sourceIndex) || sourceIndex === targetIndex) return;
    const next = [...form.sections];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, moved);
    update("sections", next.map((section, order) => ({ ...section, order })));
  }

  /* Keyboard reordering keeps the builder usable without a mouse. */
  function onChipKeyDown(event, index) {
    if (!event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveComponent(index, "up");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveComponent(index, "down");
    }
  }

  function updateCondition(index, condition) {
    updateComponent(index, "visibilityCondition", condition?.conditions?.length ? condition : null);
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
          presentation_mode: form.presentation_mode || "inline",
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

  /* ------------------------------ palette ---------------------------------- */

  function renderFieldList(targetSectionId) {
    if (loadingFields) {
      return <div className="pfb-note">Loading fields…</div>;
    }
    if (!fields.length) {
      return <div className="pfb-note">Select an object with available metadata fields.</div>;
    }
    const query = fieldSearch.trim().toLowerCase();
    const added = new Set(form.components.filter((component) => component.type === "field").map((component) => component.field_key));
    const rows = fields.filter((field) => {
      if (!query) return true;
      return `${getFieldName(field)} ${getFieldKey(field)}`.toLowerCase().includes(query);
    });
    if (!rows.length) {
      return <div className="pfb-note">No fields match “{fieldSearch}”.</div>;
    }
    return rows.map((field) => {
      const key = getFieldKey(field);
      const alreadyAdded = added.has(key);
      return (
        <button
          type="button"
          key={getFieldKey(field) || getId(field)}
          className="pfb-palette-item"
          disabled={alreadyAdded}
          onClick={() => addField(field, targetSectionId)}
          aria-label={alreadyAdded ? `${getFieldName(field)} — Already added` : `Add ${getFieldName(field)}`}
        >
          <span className={"pfb-check" + (alreadyAdded ? " pfb-check-on" : "")} aria-hidden="true">
            <span className="pfb-check-dot" />
          </span>
          <span className="pfb-palette-label">{getFieldName(field)}</span>
          {alreadyAdded
            ? <span className="pfb-palette-hint">Already added</span>
            : <span className="pfb-palette-hint pfb-palette-api">{key}</span>}
        </button>
      );
    });
  }

  function renderComponentPalette(targetSectionId) {
    return (
      <>
        {paletteComponents(componentRegistry).map((item) => (
          <button
            type="button"
            key={item.key || item.type}
            className="pfb-palette-item"
            onClick={() => {
              if ((item.key || item.type) === "button") {
                addComponent({ type: "button", component_key: "button", label: "Button", variant: "primary", target_type: "action", target_key: "", input_mappings: {}, visibility_rule: {}, visible: true }, targetSectionId);
                return;
              }
              if ((item.key || item.type) === "section") {
                addSection();
                setPickerSectionId("");
                return;
              }
              if ((item.key || item.type) === "header") {
                addComponent({ type: "header", label: "Header", text: "New section heading", visible: true }, targetSectionId);
                return;
              }
              if ((item.key || item.type) === "text") {
                addComponent({ type: "text", label: "Info text", text: "Add helpful context", visible: true }, targetSectionId);
                return;
              }
              addComponent({ type: item.key || item.type, label: item.label, text: "", visible: true }, targetSectionId);
            }}
          >
            <span className="pfb-check pfb-check-empty" aria-hidden="true" />
            <span className="pfb-palette-label">{item.label}</span>
          </button>
        ))}
      </>
    );
  }

  function renderRecordComponents(targetSectionId) {
    if (form.page_type !== "detail") return null;
    return (
      <>
        <div className="pfb-panel-title">Page Actions</div>
        <div className="pfb-palette-list">
          {RECORD_ACTIONS.map(([action, label]) => (
            <button
              type="button"
              key={action}
              className="pfb-palette-item"
              onClick={() => addComponent({ type: "action", action, label, visible: true, confirmation: action === "delete" }, targetSectionId)}
            >
              <span className="pfb-check pfb-check-empty" aria-hidden="true" />
              <span className="pfb-palette-label">{label}</span>
            </button>
          ))}
        </div>
        {relationships.length ? (
          <>
            <div className="pfb-panel-title">Related Lists</div>
            <div className="pfb-palette-list">
              {relationships.map((relationship) => (
                <button
                  type="button"
                  key={relationship.id}
                  className="pfb-palette-item"
                  onClick={() => addComponent({
                    type: "related_list",
                    relationship_key: relationship.relationship_key,
                    label: relationship.relationship_key,
                    columns: [],
                    visible: true,
                  }, targetSectionId)}
                >
                  <span className="pfb-check pfb-check-empty" aria-hidden="true" />
                  <span className="pfb-palette-label">{relationship.relationship_key}</span>
                  <span className="pfb-palette-hint">Related list</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
      </>
    );
  }

  function renderSearchBox() {
    return (
      <div className="pfb-search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          className="onepos-input pfb-search-input"
          value={fieldSearch}
          onChange={(event) => setFieldSearch(event.target.value)}
          placeholder="Search fields..."
          aria-label="Search fields"
        />
      </div>
    );
  }

  /* ------------------------------- canvas ---------------------------------- */

  function renderChip(component, index, section) {
    const id = componentKey(component, index);
    const isSelected = selection.kind === "component" && selection.id === id;
    const fieldKey = component.field_key;
    const hint = dropHint && String(dropHint.sectionId) === String(section.id) && dropHint.index === index;
    return (
      <div
        key={id}
        className={
          "pfb-chip"
          + (isSelected ? " pfb-chip-selected" : "")
          + (component.visible === false ? " pfb-chip-hidden" : "")
        }
        style={{ gridColumn: `span ${spanFor(component, section.columns)}` }}
        draggable
        tabIndex={0}
        role="button"
        aria-pressed={isSelected}
        aria-label={`${component.label || fieldKey || component.type}. ${component.type === "field" ? "Field" : "Component"}. Alt plus arrow keys to reorder.`}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", String(index));
          event.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => {
          setDragging(false);
          setDropHint(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDropHint({ sectionId: section.id, index });
        }}
        onDrop={(event) => dropComponent(index, event)}
        onClick={(event) => {
          event.stopPropagation();
          setSelection({ kind: "component", id });
        }}
        onKeyDown={(event) => onChipKeyDown(event, index)}
      >
        {hint ? <span className="pfb-drop-line" aria-hidden="true" /> : null}
        <span className="pfb-grip" aria-hidden="true"><GripVertical size={11} /></span>
        <span className="pfb-chip-label">{component.label || fieldKey || component.type}</span>
        {component.type === "field" && isReadOnly(component) ? <Lock size={10} aria-hidden="true" /> : null}
        {component.type === "field" && component.required === true ? <span className="pfb-chip-req" title="Required">*</span> : null}
        {component.type === "field" && component.width && component.width !== "full"
          ? <span className="pfb-chip-width">{component.width}</span>
          : null}
      </div>
    );
  }

  function renderSection(section, sectionIndex) {
    const isSelected = selection.kind === "section" && String(selection.id) === String(section.id);
    const placed = form.components
      .map((component, index) => ({ component, index }))
      .filter(({ component }) => String(component.section_id || firstSectionId) === String(section.id));
    return (
      <section
        key={section.id}
        className={"pfb-section" + (isSelected ? " pfb-section-selected" : "")}
        onClick={(event) => {
          event.stopPropagation();
          setSelection({ kind: "section", id: section.id });
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => dropOnSection(section.id, event)}
      >
        <header
          className="pfb-section-head"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", `section:${sectionIndex}`);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => dropOnSectionHeader(sectionIndex, event)}
        >
          <span className="pfb-grip" aria-hidden="true"><GripVertical size={11} /></span>
          <span className="pfb-section-title">{section.label || section.id}</span>
          <span className="pfb-section-meta">
            {Number(section.columns) === 2 ? "2 columns" : "1 column"}
            {section.visible === false ? " · hidden" : ""}
          </span>
        </header>
        <div className="pfb-grid" data-columns={Number(section.columns) === 2 ? 2 : 1}>
          {placed.map(({ component, index }) => renderChip(component, index, section))}
          <button
            type="button"
            className="pfb-add-btn"
            onClick={(event) => {
              event.stopPropagation();
              setSelection({ kind: "section", id: section.id });
              setPickerSectionId(section.id);
            }}
          >
            <Plus size={11} aria-hidden="true" /> Add
          </button>
        </div>
      </section>
    );
  }

  function renderCanvas() {
    return (
      <div className="pfb-canvas-inner" onClick={() => setSelection({ kind: "form", id: "" })}>
        <div className="pfb-canvas-toolbar">
          <span className="pfb-canvas-object">{objectLabel}</span>
          <span className="pfb-canvas-hint">
            {dragging ? "Drop to place" : "Click an item to configure it"}
          </span>
        </div>
        {form.sections.map((section, index) => renderSection(section, index))}
        <button
          type="button"
          className="pfb-add-section"
          onClick={(event) => {
            event.stopPropagation();
            addSection();
          }}
        >
          <Plus size={12} aria-hidden="true" /> Add Section
        </button>
      </div>
    );
  }

  function renderPreview() {
    return (
      <div className="pfb-preview">
        <div className="pfb-preview-head">
          <span className="pfb-panel-title">Runtime Preview</span>
          <label className="pfb-field pfb-field-inline">
            <span className="pfb-field-label">Mode</span>
            <select
              className="onepos-input"
              value={previewMode}
              onChange={(event) => setPreviewMode(event.target.value)}
            >
              {PAGE_TYPES.filter((page) => page.value !== "list").map((page) => (
                <option key={page.value} value={page.value}>{page.label}</option>
              ))}
            </select>
          </label>
          <label className="pfb-field">
            <span className="pfb-field-label">Presentation</span>
            <select
              className="onepos-input"
              value={form.presentation_mode || "inline"}
              onChange={(event) => update("presentation_mode", event.target.value)}
            >
              {FORM_PRESENTATION_MODES.map((mode) => (
                <option key={mode.key} value={mode.key}>{mode.label}</option>
              ))}
            </select>
            <span className="pfb-help">Controls how this form is presented when opened at runtime.</span>
          </label>
        </div>
        <div className="pfb-preview-body">
          <FormRenderer
            definition={{ sections: form.sections, components: form.components }}
            fields={fields}
            mode={previewMode}
            initialValues={Object.fromEntries(fields.map((field) => [field.api_name || field.field_key || field.name, field.default_value ?? ""]))}
          />
        </div>
      </div>
    );
  }

  /* ----------------------------- properties -------------------------------- */

  function renderMoveRail({ index, kind }) {
    const isFirst = index === 0;
    const lastIndex = kind === "section" ? form.sections.length - 1 : form.components.length - 1;
    const moveUp = () => (kind === "section" ? moveSection(index, "up") : moveComponent(index, "up"));
    const moveDown = () => (kind === "section" ? moveSection(index, "down") : moveComponent(index, "down"));
    const remove = () => (kind === "section" ? removeSection(index) : removeComponent(index));
    return (
      <div className="pfb-props-actions">
        <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" disabled={isFirst} onClick={moveUp}>
          <ArrowUp size={12} aria-hidden="true" /> Move up
        </button>
        <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" disabled={index === lastIndex} onClick={moveDown}>
          <ArrowDown size={12} aria-hidden="true" /> Move down
        </button>
        <button
          type="button"
          className="onepos-btn onepos-btn-sm onepos-btn-secondary"
          disabled={kind === "section" && form.sections.length === 1}
          onClick={remove}
        >
          <Trash2 size={12} aria-hidden="true" /> Remove
        </button>
      </div>
    );
  }

  function renderFormProperties() {
    return (
      <div className="pfb-props-body">
        <p className="pfb-note">Form settings. Nothing is selected — pick a section or field on the canvas to configure it.</p>
        <label className="pfb-field">
          <span className="pfb-field-label">Layout Name</span>
          <input
            type="text"
            className="onepos-input"
            value={form.name || ""}
            onChange={(event) => update("name", event.target.value)}
            placeholder="Customer Detail"
            required
          />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">API Key (generated from name)</span>
          <input
            type="text"
            className="onepos-input"
            value={form.layout_key || ""}
            placeholder="standard_product_layout"
            readOnly
          />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Object</span>
          <select
            className="onepos-input"
            value={form.object_id || ""}
            onChange={(event) => update("object_id", event.target.value)}
            disabled={loadingObjects}
            required
          >
            <option value="">{loadingObjects ? "Loading objects…" : "Select object"}</option>
            {availableObjects.map((object) => {
              const id = getId(object);
              return <option key={id} value={id}>{getObjectName(object)}</option>;
            })}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Record Type</span>
          <select
            className="onepos-input"
            value={form.record_type_id || ""}
            onChange={(event) => update("record_type_id", event.target.value)}
            disabled={!form.object_id || loadingFields}
          >
            <option value="">All record types</option>
            {recordTypes.map((recordType) => (
              <option key={recordType.id} value={recordType.id}>{recordType.label}</option>
            ))}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Purpose</span>
          <select className="onepos-input" value={form.page_type || "detail"} onChange={(event) => update("page_type", event.target.value)}>
            {PAGE_TYPES.map((page) => <option key={page.value} value={page.value}>{page.label}</option>)}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Role</span>
          <select className="onepos-input" value={form.role_id || ""} onChange={(event) => update("role_id", event.target.value)}>
            <option value="">All roles</option>
            {availableRoles.map((role) => {
              const id = getId(role);
              return <option key={id} value={id}>{role?.name || role?.label || `Role ${id}`}</option>;
            })}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Company</span>
          <select className="onepos-input" value={form.company_id || ""} onChange={(event) => update("company_id", event.target.value)}>
            <option value="">All companies</option>
            {availableCompanies.map((company) => {
              const id = getId(company);
              return <option key={id} value={id}>{company?.name || company?.label || `Company ${id}`}</option>;
            })}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Status</span>
          <select
            className="onepos-input"
            value={form.active === false ? "inactive" : "active"}
            onChange={(event) => update("active", event.target.value === "active")}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
    );
  }

  function renderSectionProperties() {
    const section = selectedSection;
    const index = selectedSectionIndex;
    return (
      <div className="pfb-props-body">
        <label className="pfb-field">
          <span className="pfb-field-label">Section name</span>
          <input
            type="text"
            className="onepos-input"
            value={section.label || ""}
            onChange={(event) => updateSection(index, "label", event.target.value)}
          />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Columns</span>
          <select
            className="onepos-input"
            value={Number(section.columns) === 2 ? 2 : 1}
            onChange={(event) => updateSection(index, "columns", Number(event.target.value))}
          >
            <option value="1">1 column</option>
            <option value="2">2 columns</option>
          </select>
        </label>
        <label className="pfb-check-row">
          <input
            type="checkbox"
            checked={section.visible !== false}
            onChange={(event) => updateSection(index, "visible", event.target.checked)}
          />
          <span>Visible</span>
        </label>
        <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => setPickerSectionId(section.id)}>
          <Plus size={12} aria-hidden="true" /> Add to section
        </button>
      </div>
    );
  }

  function renderFieldProperties(component, index) {
    const field = component.field_key ? fieldByKey.get(component.field_key) : null;
    const conditions = component.visibilityCondition?.conditions?.length
      ? component.visibilityCondition.conditions
      : null;
    const editorOpen = conditionFor === componentKey(component, index);
    const securityOpen = securityFor === componentKey(component, index);
    const fallback = { field: fields.find((candidate) => getFieldKey(candidate) !== component.field_key) ? getFieldKey(fields.find((candidate) => getFieldKey(candidate) !== component.field_key)) : "", operator: "equals", value: "" };
    const working = conditions || [fallback];
    return (
      <>
        <div className="pfb-field">
          <span className="pfb-field-label">Field type</span>
          <div className="pfb-readonly">
            <span>{getFieldType(field)}</span>
            {typeof onEditField === "function" && (field?.id || field?.field_id) ? (
              <button
                type="button"
                className="pfb-link"
                onClick={() => onEditField(field, fields)}
              >
                Edit Field
              </button>
            ) : null}
          </div>
        </div>
        <label className="pfb-field">
          <span className="pfb-field-label">Label</span>
          <input type="text" className="onepos-input" value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Width</span>
          <select className="onepos-input" value={component.width || "full"} onChange={(event) => updateComponent(index, "width", event.target.value)}>
            {WIDTHS.map((width) => <option key={width} value={width}>{width}</option>)}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Placeholder</span>
          <input type="text" className="onepos-input" value={component.placeholder || ""} onChange={(event) => updateComponent(index, "placeholder", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Help Text</span>
          <input type="text" className="onepos-input" value={component.help_text || ""} onChange={(event) => updateComponent(index, "help_text", event.target.value)} />
        </label>
        <div className="pfb-checks">
          <label className="pfb-check-row">
            <input type="checkbox" checked={component.required === true} onChange={(event) => updateComponent(index, "required", event.target.checked)} />
            <span>Required</span>
          </label>
          <label className="pfb-check-row">
            <input type="checkbox" checked={isReadOnly(component)} onChange={(event) => updateComponent(index, "readOnly", event.target.checked)} />
            <span>Read-only</span>
          </label>
          <label className="pfb-check-row">
            <input type="checkbox" checked={component.visible !== false} onChange={(event) => updateComponent(index, "visible", event.target.checked)} />
            <span>Visible</span>
          </label>
        </div>
        <div className="pfb-readonly">
          <span>Visibility Condition</span>
          <button
            type="button"
            className="pfb-link"
            onClick={() => setConditionFor(editorOpen ? "" : componentKey(component, index))}
          >
            {editorOpen ? "Close" : conditions ? "Edit" : "Configure"}
          </button>
        </div>
        {editorOpen ? (
          <div className="pfb-cond">
            <label className="pfb-field">
              <span className="pfb-field-label">Match</span>
              <select
                className="onepos-input"
                value={component.visibilityCondition?.match || "all"}
                onChange={(event) => updateCondition(index, { match: event.target.value, conditions: working })}
              >
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </select>
            </label>
            {working.map((condition, conditionIndex) => (
              <div className="pfb-cond-row" key={`condition-${conditionIndex}`}>
                <select
                  className="onepos-input"
                  value={condition.field || ""}
                  onChange={(event) => updateCondition(index, {
                    match: component.visibilityCondition?.match || "all",
                    conditions: working.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, field: event.target.value } : item),
                  })}
                >
                  <option value="">Select field</option>
                  {fields.filter((candidate) => getFieldKey(candidate) !== component.field_key).map((candidate) => (
                    <option key={getFieldKey(candidate)} value={getFieldKey(candidate)}>{getFieldName(candidate)}</option>
                  ))}
                </select>
                <select
                  className="onepos-input"
                  value={condition.operator || "equals"}
                  onChange={(event) => updateCondition(index, {
                    match: component.visibilityCondition?.match || "all",
                    conditions: working.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, operator: event.target.value } : item),
                  })}
                >
                  {CONDITION_OPERATORS.map((operator) => (
                    <option key={operator} value={operator}>{operator.replaceAll("_", " ")}</option>
                  ))}
                </select>
                {!["is_empty", "is_not_empty"].includes(condition.operator) ? (
                  <input
                    type="text"
                    className="onepos-input"
                    value={condition.value ?? ""}
                    onChange={(event) => updateCondition(index, {
                      match: component.visibilityCondition?.match || "all",
                      conditions: working.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, value: event.target.value } : item),
                    })}
                  />
                ) : null}
                <button
                  type="button"
                  className="pfb-link"
                  onClick={() => updateCondition(index, {
                    match: component.visibilityCondition?.match || "all",
                    conditions: working.filter((_, itemIndex) => itemIndex !== conditionIndex),
                  })}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="onepos-btn onepos-btn-sm onepos-btn-secondary"
              onClick={() => updateCondition(index, { match: component.visibilityCondition?.match || "all", conditions: [...working, fallback] })}
            >
              <Plus size={12} aria-hidden="true" /> Condition
            </button>
          </div>
        ) : null}
        <div className="pfb-readonly">
          <span>Field Security</span>
          <button
            type="button"
            className="pfb-link"
            onClick={() => setSecurityFor(securityOpen ? "" : componentKey(component, index))}
          >
            {securityOpen ? "Close" : "View / Configure"}
          </button>
        </div>
        {securityOpen ? (
          <div className="pfb-cond">
            <p className="pfb-note">Security is defined on the field metadata. Placing a field on a form cannot grant access to it.</p>
            <div className="pfb-readonly"><span>Field required</span><strong>{field?.required === true ? "Yes" : "No"}</strong></div>
            <div className="pfb-readonly"><span>Writable</span><strong>{field?.writable === false ? "No" : "Yes"}</strong></div>
          </div>
        ) : null}
      </>
    );
  }

  function renderRelatedListProperties(component, index) {
    const relationship = relationships.find((item) => item.relationship_key === component.relationship_key);
    const relatedFields = relatedFieldsByRelationship[component.relationship_key] || [];
    const objectKey = relationship?.child_object_key || "";
    return (
      <>
        <div className="pfb-field">
          <span className="pfb-field-label">Visible columns</span>
          {(component.columns || []).map((column, columnIndex) => (
            <div className="pfb-column-row" key={`${column}-${columnIndex}`}>
              <PlatformFieldPicker
                selectedObjectKey={objectKey}
                availableFields={relatedFields}
                value={column}
                label="Select column"
                onChange={(value) => updateComponent(index, "columns", (component.columns || []).map((item, itemIndex) => itemIndex === columnIndex ? value : item).filter(Boolean))}
              />
              <button type="button" className="pfb-link" onClick={() => updateComponent(index, "columns", (component.columns || []).filter((_, itemIndex) => itemIndex !== columnIndex))}>Remove</button>
            </div>
          ))}
          <button type="button" className="pfb-link" onClick={() => updateComponent(index, "columns", [...(component.columns || []), ""])}>+ Add column</button>
        </div>
        <label className="pfb-field">
          <span className="pfb-field-label">Related List Label</span>
          <input type="text" className="onepos-input" value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Sort Field</span>
          <input type="text" className="onepos-input" value={component.sort_field || ""} placeholder="Optional API name" onChange={(event) => updateComponent(index, "sort_field", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Sort Direction</span>
          <select className="onepos-input" value={component.sort_direction || "asc"} onChange={(event) => updateComponent(index, "sort_direction", event.target.value)}>
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Row Limit</span>
          <input
            type="number"
            min="1"
            max="100"
            className="onepos-input"
            value={component.limit || 25}
            onChange={(event) => updateComponent(index, "limit", Math.min(Math.max(Number(event.target.value) || 25, 1), 100))}
          />
        </label>
        <label className="pfb-check-row">
          <input type="checkbox" checked={component.visible !== false} onChange={(event) => updateComponent(index, "visible", event.target.checked)} />
          <span>Visible</span>
        </label>
      </>
    );
  }

  function renderButtonProperties(component, index) {
    const targetType = component.target_type || "action";
    return (
      <>
        <label className="pfb-field">
          <span className="pfb-field-label">Label</span>
          <input type="text" className="onepos-input" value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Style</span>
          <select className="onepos-input" value={component.variant || "primary"} onChange={(event) => updateComponent(index, "variant", event.target.value)}>
            {buttonVariants.map((variant) => <option key={variant.key} value={variant.key}>{variant.label}</option>)}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Icon</span>
          <input type="text" className="onepos-input" value={component.icon || ""} placeholder="Lucide icon name" onChange={(event) => updateComponent(index, "icon", event.target.value)} />
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Target</span>
          <select className="onepos-input" value={targetType} onChange={(event) => updateComponentPatch(index, { target_type: event.target.value, target_key: "" })}>
            <option value="action">Registered Action</option>
            <option value="workflow">Workflow</option>
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">{targetType === "workflow" ? "Workflow" : "Action"}</span>
          <select className="onepos-input" value={component.target_key || ""} onChange={(event) => updateComponent(index, "target_key", event.target.value)}>
            <option value="">Select {targetType}</option>
            {targetType === "workflow"
              ? workflows.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)
              : registeredActions.map((action) => <option key={action.key} value={action.key}>{action.displayName || action.label || action.key}</option>)}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Required permission</span>
          <input type="text" className="onepos-input" value={component.required_permission || ""} placeholder="Optional permission key" onChange={(event) => updateComponent(index, "required_permission", event.target.value)} />
        </label>
        <div className="pfb-field">
          <span className="pfb-field-label">Visibility condition</span>
          <MetadataResourcePicker objectKey={availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.object_key || availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.objectKey || ""} label="Field / related field" value={component.visibility_rule?.path || ""} onChange={(path) => updateComponentPatch(index, { visibility_rule: { ...(component.visibility_rule || {}), path } })} />
          <select className="onepos-input" value={component.visibility_rule?.operator || "equals"} onChange={(event) => updateComponentPatch(index, { visibility_rule: { ...(component.visibility_rule || {}), operator: event.target.value } })}>
            {CONDITION_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
          </select>
          <input type="text" className="onepos-input" value={component.visibility_rule?.value ?? ""} placeholder="Value" onChange={(event) => updateComponentPatch(index, { visibility_rule: { ...(component.visibility_rule || {}), value: event.target.value } })} />
        </div>
        <div className="pfb-field">
          <span className="pfb-field-label">Input mappings</span>
          {Object.entries(component.input_mappings || {}).map(([inputKey, resourcePath], mappingIndex) => {
            const objectKey = availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.object_key
              || availableObjects.find((object) => String(getId(object)) === String(form.object_id))?.objectKey || "";
            return <div className="pfb-column-row" key={`${inputKey}-${mappingIndex}`}>
              <input className="onepos-input" value={inputKey} placeholder="Action input" onChange={(event) => {
                const next = { ...(component.input_mappings || {}) }; const current = next[inputKey]; delete next[inputKey]; next[event.target.value] = current; updateComponent(index, "input_mappings", next);
              }} />
              <MetadataResourcePicker objectKey={objectKey} label="Record value" value={typeof resourcePath === "string" ? resourcePath : resourcePath?.path || ""} onChange={(path) => updateComponent(index, "input_mappings", { ...(component.input_mappings || {}), [inputKey]: path })} />
              <button type="button" className="pfb-link" onClick={() => { const next = { ...(component.input_mappings || {}) }; delete next[inputKey]; updateComponent(index, "input_mappings", next); }}>Remove</button>
            </div>;
          })}
          <button type="button" className="pfb-link" onClick={() => updateComponent(index, "input_mappings", { ...(component.input_mappings || {}), [`input_${Object.keys(component.input_mappings || {}).length + 1}`]: "" })}>+ Add input mapping</button>
        </div>
        <p className="pfb-note">Choose related records and fields visually. UUIDs and API paths are resolved by metadata; buttons cannot contain JavaScript.</p>
        <label className="pfb-check-row">
          <input type="checkbox" checked={component.visible !== false} onChange={(event) => updateComponent(index, "visible", event.target.checked)} />
          <span>Visible</span>
        </label>
      </>
    );
  }

  function renderActionProperties(component, index) {
    return (
      <>
        <label className="pfb-field">
          <span className="pfb-field-label">Action Type</span>
          <select className="onepos-input" value={component.action || "edit"} onChange={(event) => updateComponent(index, "action", event.target.value)}>
            {RECORD_ACTIONS.map(([action, label]) => <option key={action} value={action}>{label}</option>)}
          </select>
        </label>
        <label className="pfb-field">
          <span className="pfb-field-label">Label</span>
          <input type="text" className="onepos-input" value={component.label || ""} onChange={(event) => updateComponent(index, "label", event.target.value)} />
        </label>
        {["create_related", "open_related"].includes(component.action) ? (
          <label className="pfb-field">
            <span className="pfb-field-label">Relationship Key</span>
            <select className="onepos-input" value={component.relationship_key || ""} onChange={(event) => updateComponent(index, "relationship_key", event.target.value)}>
              <option value="">Select relationship</option>
              {relationships.map((relationship) => <option key={relationship.id} value={relationship.relationship_key}>{relationship.relationship_key}</option>)}
            </select>
          </label>
        ) : null}
        {component.action === "run_workflow" ? (
          <label className="pfb-field">
            <span className="pfb-field-label">Workflow ID</span>
            <input type="text" className="onepos-input" value={component.workflow_id || ""} placeholder="Existing workflow ID" onChange={(event) => updateComponent(index, "workflow_id", event.target.value)} />
          </label>
        ) : null}
        {component.action === "call_function" ? (
          <label className="pfb-field">
            <span className="pfb-field-label">Registered Function Key</span>
            <input type="text" className="onepos-input" value={component.function_key || ""} placeholder="Registered function key" onChange={(event) => updateComponent(index, "function_key", event.target.value)} />
          </label>
        ) : null}
        <label className="pfb-check-row">
          <input type="checkbox" checked={component.visible !== false} onChange={(event) => updateComponent(index, "visible", event.target.checked)} />
          <span>Visible</span>
        </label>
      </>
    );
  }

  function renderContentProperties(component, index) {
    const isSpacer = component.type === "spacer";
    return (
      <>
        <label className="pfb-field">
          <span className="pfb-field-label">{component.type === "header" ? "Header text" : component.type === "text" ? "Information text" : "Label"}</span>
          <input
            type="text"
            className="onepos-input"
            value={component.text ?? component.label ?? ""}
            onChange={(event) => updateComponent(index, component.type === "divider" || isSpacer ? "label" : "text", event.target.value)}
          />
        </label>
        {isSpacer ? (
          <label className="pfb-field">
            <span className="pfb-field-label">Height (px)</span>
            <input
              type="number"
              min="4"
              max="200"
              className="onepos-input"
              value={component.height || 16}
              onChange={(event) => updateComponent(index, "height", Math.min(Math.max(Number(event.target.value) || 16, 4), 200))}
            />
          </label>
        ) : null}
        {component.type !== "divider" ? (
          <label className="pfb-field">
            <span className="pfb-field-label">Width</span>
            <select className="onepos-input" value={component.width || "full"} onChange={(event) => updateComponent(index, "width", event.target.value)}>
              {WIDTHS.map((width) => <option key={width} value={width}>{width}</option>)}
            </select>
          </label>
        ) : null}
        <label className="pfb-check-row">
          <input type="checkbox" checked={component.visible !== false} onChange={(event) => updateComponent(index, "visible", event.target.checked)} />
          <span>Visible</span>
        </label>
      </>
    );
  }

  function renderComponentProperties() {
    const component = selectedComponent;
    const index = selectedIndex;
    return (
      <div className="pfb-props">
        <div className="pfb-props-head">
          <span className="pfb-props-kind">
            {component.type === "field" ? "Field properties" : component.type === "related_list" ? "Related list" : component.type === "action" ? "Action" : "Component"}
          </span>
          <strong className="pfb-props-title">{component.label || component.field_key || component.type}</strong>
        </div>
        {renderMoveRail({ index, kind: "component" })}
        <div className="pfb-props-body">
          {component.type === "field" ? renderFieldProperties(component, index) : null}
          {component.type === "related_list" ? renderRelatedListProperties(component, index) : null}
          {component.type === "action" ? renderActionProperties(component, index) : null}
          {component.type === "button" ? renderButtonProperties(component, index) : null}
          {["header", "text", "divider", "spacer"].includes(component.type) ? renderContentProperties(component, index) : null}
        </div>
      </div>
    );
  }

  function renderProperties() {
    if (selection.kind === "component" && selectedComponent) {
      return renderComponentProperties();
    }
    if (selection.kind === "section" && selectedSection) {
      return (
        <div className="pfb-props">
          <div className="pfb-props-head">
            <span className="pfb-props-kind">Section properties</span>
            <strong className="pfb-props-title">{selectedSection.label || selectedSection.id}</strong>
          </div>
          {renderMoveRail({ index: selectedSectionIndex, kind: "section" })}
          {renderSectionProperties()}
        </div>
      );
    }
    return (
      <div className="pfb-props">
        <div className="pfb-props-head">
          <span className="pfb-props-kind">Form properties</span>
          <strong className="pfb-props-title">{form.name || (isNew ? "New Form" : "Untitled form")}</strong>
        </div>
        {renderFormProperties()}
      </div>
    );
  }

  const paletteSectionId = selection.kind === "section" ? selection.id : firstSectionId;

  return (
    <form className="platform-form-builder" onSubmit={saveLayout}>
      <header className="pfb-header">
        <div className="pfb-header-left">
          <span className="pfb-eyebrow">PLATFORM / FORM BUILDER</span>
          <div className="pfb-title-row">
            <h2 className="pfb-title">{form.name || (isNew ? "New Form" : "Untitled form")}</h2>
            <span className="onepos-badge onepos-badge-neutral">{objectLabel}</span>
            {isNew ? null : <span className="onepos-badge onepos-badge-neutral">{form.layout_key}</span>}
          </div>
        </div>
        <div className="pfb-header-right">
          <label className="pfb-purpose">
            <span className="pfb-purpose-label">Purpose</span>
            <select
              className="onepos-input pfb-purpose-select"
              value={form.page_type || "detail"}
              onChange={(event) => update("page_type", event.target.value)}
            >
              {PAGE_TYPES.map((page) => <option key={page.value} value={page.value}>{page.label}</option>)}
            </select>
          </label>
          <div className="pfb-devices" role="group" aria-label="Canvas width">
            {DEVICE_WIDTHS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={"pfb-device" + (device === item.value ? " pfb-device-active" : "")}
                aria-pressed={device === item.value}
                onClick={() => setDevice(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="onepos-btn onepos-btn-sm onepos-btn-secondary"
            onClick={() => setPreviewMode(previewMode ? "" : (form.page_type === "detail" ? "view" : form.page_type))}
          >
            {previewMode ? "Close Preview" : "Preview"}
          </button>
          <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="onepos-btn onepos-btn-sm onepos-btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="onepos-alert onepos-alert-error pfb-alert">{error}</div>
      ) : null}
      {diagnostics.length ? (
        <div className="onepos-alert onepos-alert-warning pfb-alert" role="status">
          <strong>Configuration diagnostics</strong>
          <ul>{diagnostics.map((issue, index) => <li key={`${issue.message}-${index}`}>{issue.severity}: {issue.message}</li>)}</ul>
        </div>
      ) : null}

      <div className="pfb-body" data-mobile-pane={mobilePane}>
        <nav className="pfb-mobile-tabs" aria-label="Builder workspace pane">
          {[
            ["palette", "Fields"],
            ["canvas", "Canvas"],
            ["properties", "Properties"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={"pfb-mobile-tab" + (mobilePane === key ? " pfb-mobile-tab-active" : "")}
              aria-pressed={mobilePane === key}
              onClick={() => setMobilePane(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <aside className="pfb-panel" aria-label="Fields and components">
          <div className="pfb-panel-title">Fields</div>
          {renderSearchBox()}
          <div className="pfb-palette-list">
            {renderFieldList(paletteSectionId)}
          </div>
          <div className="pfb-panel-title">Components</div>
          <div className="pfb-palette-list">
            {renderComponentPalette(paletteSectionId)}
          </div>
          {renderRecordComponents(paletteSectionId)}
        </aside>

        <main className="pfb-canvas" data-device={device}>
          {previewMode ? renderPreview() : renderCanvas()}
        </main>

        <aside className="pfb-properties" aria-label="Properties">
          {renderProperties()}
        </aside>
      </div>

      {pickerSectionId ? (
        <div
          className="onepos-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPickerSectionId("");
          }}
        >
          <div className="onepos-modal onepos-modal-md" role="dialog" aria-modal="true" aria-labelledby="pfb-picker-title">
            <div className="onepos-modal-header">
              <div>
                <div className="onepos-modal-title" id="pfb-picker-title">Add to form</div>
                <div className="onepos-modal-subtitle">{sectionLabel(pickerSectionId)}</div>
              </div>
              <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary onepos-modal-close" aria-label="Close" onClick={() => setPickerSectionId("")}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="onepos-modal-body">
              {renderSearchBox()}
              <div className="pfb-panel-title">Fields</div>
              <div className="pfb-palette-list">
                {renderFieldList(pickerSectionId)}
              </div>
              <div className="pfb-panel-title">Components</div>
              <div className="pfb-palette-list">
                {renderComponentPalette(pickerSectionId)}
              </div>
              {renderRecordComponents(pickerSectionId)}
            </div>
            <div className="onepos-modal-footer">
              <button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => setPickerSectionId("")}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        /* ==================================================================
           Compact three-pane form builder.
           Palette (left) / canvas (centre) / properties (right). All colour
           comes from the shared tokens the Platform studio is already bridged
           onto (--border-color, --card-background, --text-primary,
           --text-secondary, --primary-color, --muted-background), so Modern,
           Enterprise, Compact, Light, Dark and every accent apply with no
           preset branching in here.
           ================================================================== */

        .platform-form-builder {
          display: flex;
          flex-direction: column;
          gap: 10px;
          color: var(--text-primary);
        }

        /* ---------------------------------- header ------------------------- */
        .pfb-header {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding-bottom: 9px;
          border-bottom: 1px solid var(--border-color);
        }
        .pfb-eyebrow {
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }
        .pfb-title-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
        .pfb-title { margin: 0; font-size: 16.5px; font-weight: 700; }
        .pfb-header-right { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .pfb-purpose { display: flex; align-items: center; gap: 5px; }
        .pfb-purpose-label {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--text-secondary);
        }
        .pfb-purpose-select { height: 28px; min-width: 128px; font-size: 12px; }
        .pfb-devices { display: inline-flex; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; }
        .pfb-device {
          border: 0; background: var(--card-background); color: var(--text-secondary);
          font-size: 11px; padding: 5px 9px; cursor: pointer;
        }
        .pfb-device + .pfb-device { border-left: 1px solid var(--border-color); }
        .pfb-device-active { background: var(--muted-background); color: var(--text-primary); font-weight: 600; }
        .pfb-alert { margin-bottom: 0; }
        .pfb-alert ul { margin: 4px 0 0; padding-left: 16px; }

        /* ----------------------------------- body -------------------------- */
        .pfb-body {
          display: grid;
          grid-template-columns: 226px minmax(0, 1fr) 284px;
          gap: 10px;
          align-items: start;
          min-height: 0;
        }
        .pfb-mobile-tabs { display: none; }

        /* --------------------------------- palette ------------------------- */
        .pfb-panel {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background: var(--card-background);
          position: sticky;
          top: 0;
          max-height: calc(100dvh - 190px);
          overflow: auto;
          padding-bottom: 4px;
        }
        .pfb-panel-title {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.11em;
          text-transform: uppercase; color: var(--text-secondary);
          padding: 8px 10px 3px;
        }
        .pfb-search { display: flex; align-items: center; gap: 6px; padding: 7px 10px 3px; color: var(--text-secondary); }
        .pfb-search-input { height: 30px; font-size: 12.5px; }
        .pfb-palette-list { display: flex; flex-direction: column; padding: 2px 6px 6px; }
        .pfb-palette-item {
          display: flex; align-items: center; gap: 7px;
          padding: 4px 6px; border: 0; border-radius: 6px;
          background: transparent; color: var(--text-primary);
          font-size: 12.5px; text-align: left; cursor: pointer; min-height: 26px;
        }
        .pfb-palette-item:hover:not(:disabled) { background: var(--muted-background); }
        .pfb-palette-item:disabled { color: var(--text-secondary); cursor: default; }
        .pfb-palette-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pfb-palette-hint { margin-left: auto; font-size: 10px; color: var(--text-secondary); white-space: nowrap; }
        .pfb-check {
          width: 13px; height: 13px; flex-shrink: 0;
          border: 1px solid var(--border-color); border-radius: 3px;
          display: grid; place-items: center;
        }
        .pfb-check-empty { border-style: dashed; }
        .pfb-check-on { border-color: transparent; background: var(--primary-color); }
        .pfb-check-dot { width: 5px; height: 5px; border-radius: 1px; background: var(--card-background); }
        .pfb-note { margin: 0; font-size: 11.5px; color: var(--text-secondary); padding: 10px; }

        /* ---------------------------------- canvas ------------------------- */
        .pfb-canvas { min-width: 0; display: flex; justify-content: center; }
        .pfb-canvas-inner { width: 100%; min-width: 0; }
        .pfb-canvas[data-device="tablet"] .pfb-canvas-inner { max-width: 834px; }
        .pfb-canvas[data-device="mobile"] .pfb-canvas-inner { max-width: 390px; }
        .pfb-canvas[data-device="tablet"] .pfb-canvas-inner,
        .pfb-canvas[data-device="mobile"] .pfb-canvas-inner {
          border: 1px solid var(--border-color);
          border-radius: 10px;
          background: var(--card-background);
          padding: 10px;
        }
        .pfb-canvas-toolbar {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 0 2px 6px;
        }
        .pfb-canvas-object { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
        .pfb-canvas-hint { font-size: 10.5px; color: var(--text-secondary); }
        .pfb-section {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background: var(--card-background);
          margin-bottom: 8px;
        }
        .pfb-section-selected { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
        .pfb-section-head {
          display: flex; align-items: center; gap: 6px;
          padding: 5px 8px;
          border-bottom: 1px solid var(--border-color);
          background: var(--muted-background);
          border-radius: 7px 7px 0 0;
          cursor: grab;
        }
        .pfb-section-title { font-size: 12.5px; font-weight: 600; }
        .pfb-section-meta { margin-left: auto; font-size: 10px; color: var(--text-secondary); }
        .pfb-grid { display: grid; gap: 5px; padding: 8px; }
        .pfb-grid[data-columns="1"] { grid-template-columns: 1fr; }
        .pfb-grid[data-columns="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .pfb-chip {
          position: relative;
          display: flex; align-items: center; gap: 5px;
          min-height: 27px; padding: 3px 6px;
          border: 1px solid var(--border-color); border-radius: 6px;
          background: var(--card-background);
          font-size: 12px; cursor: grab;
        }
        .pfb-chip:hover { border-color: var(--text-secondary); }
        .pfb-chip-selected { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
        .pfb-chip-hidden { opacity: 0.55; }
        .pfb-chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pfb-chip-req { font-weight: 700; }
        .pfb-chip-width { margin-left: auto; font-size: 9.5px; color: var(--text-secondary); }
        .pfb-grip { color: var(--text-secondary); flex-shrink: 0; display: inline-grid; place-items: center; }
        .pfb-drop-line {
          position: absolute; left: -3px; top: 2px; bottom: 2px; width: 2px;
          border-radius: 2px; background: var(--primary-color);
        }
        .pfb-add-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 4px;
          min-height: 27px; padding: 3px 6px;
          border: 1px dashed var(--border-color); border-radius: 6px;
          background: transparent; color: var(--text-secondary);
          font-size: 11.5px; cursor: pointer;
        }
        .pfb-add-btn:hover { border-color: var(--primary-color); color: var(--text-primary); }
        .pfb-add-section {
          display: inline-flex; align-items: center; gap: 5px;
          margin-top: 2px; padding: 5px 9px;
          border: 1px dashed var(--border-color); border-radius: 7px;
          background: transparent; color: var(--text-secondary);
          font-size: 12px; cursor: pointer;
        }
        .pfb-add-section:hover { border-color: var(--primary-color); color: var(--text-primary); }

        /* -------------------------------- preview -------------------------- */
        .pfb-preview {
          width: 100%;
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background: var(--card-background);
        }
        .pfb-preview-head {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          padding: 6px 10px; border-bottom: 1px solid var(--border-color);
        }
        .pfb-preview-head .pfb-panel-title { padding: 0; }
        .pfb-preview-body { padding: 12px; }

        /* ------------------------------- properties ------------------------ */
        .pfb-properties { min-width: 0; }
        .pfb-props {
          border: 1px solid var(--border-color);
          border-radius: 8px;
          background: var(--card-background);
          position: sticky;
          top: 0;
          max-height: calc(100dvh - 190px);
          overflow: auto;
        }
        .pfb-props-head {
          display: flex; flex-direction: column; gap: 1px;
          padding: 8px 10px; border-bottom: 1px solid var(--border-color);
        }
        .pfb-props-kind {
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.11em;
          text-transform: uppercase; color: var(--text-secondary);
        }
        .pfb-props-title { font-size: 13px; }
        .pfb-props-actions {
          display: flex; flex-wrap: wrap; gap: 5px;
          padding: 7px 10px; border-bottom: 1px solid var(--border-color);
        }
        .pfb-props-body { display: flex; flex-direction: column; gap: 8px; padding: 9px 10px; }
        .pfb-props-body .pfb-note { padding: 0; }
        .pfb-field { display: flex; flex-direction: column; gap: 3px; }
        .pfb-field-inline { flex-direction: row; align-items: center; gap: 6px; }
        .pfb-field-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--text-secondary);
        }
        .pfb-field input, .pfb-field select { height: 30px; font-size: 12.5px; }
        .pfb-checks { display: flex; flex-direction: column; gap: 4px; }
        .pfb-check-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
        .pfb-readonly {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          padding: 5px 8px; border: 1px solid var(--border-color); border-radius: 6px;
          background: var(--muted-background); font-size: 12px;
        }
        .pfb-link {
          border: 0; background: transparent; color: var(--primary-color);
          font-size: 11.5px; font-weight: 600; cursor: pointer; padding: 0;
        }
        .pfb-cond {
          display: flex; flex-direction: column; gap: 6px;
          padding: 7px; border: 1px solid var(--border-color); border-radius: 6px;
          background: var(--muted-background);
        }
        .pfb-cond-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; align-items: center; }
        .pfb-column-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }

        /* ------------------------------- responsive ------------------------ */
        @media (max-width: 1180px) {
          .pfb-body { grid-template-columns: 200px minmax(0, 1fr) 250px; }
        }
        @media (max-width: 1023px) {
          .pfb-body { grid-template-columns: minmax(0, 1fr); }
          .pfb-mobile-tabs {
            display: flex; gap: 4px; padding: 4px;
            border: 1px solid var(--border-color); border-radius: 8px;
            background: var(--muted-background);
          }
          .pfb-mobile-tab {
            flex: 1; border: 0; border-radius: 6px; padding: 7px 8px;
            background: transparent; color: var(--text-secondary);
            font-size: 11px; font-weight: 600; cursor: pointer;
          }
          .pfb-mobile-tab-active {
            background: var(--card-background); color: var(--text-primary);
            box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1);
          }
          .pfb-body[data-mobile-pane="palette"] .pfb-canvas,
          .pfb-body[data-mobile-pane="palette"] .pfb-properties,
          .pfb-body[data-mobile-pane="canvas"] .pfb-panel,
          .pfb-body[data-mobile-pane="canvas"] .pfb-properties,
          .pfb-body[data-mobile-pane="properties"] .pfb-panel,
          .pfb-body[data-mobile-pane="properties"] .pfb-canvas { display: none; }
          .pfb-panel, .pfb-props { position: static; max-height: none; }
          .pfb-canvas { order: 1; }
          .pfb-panel { order: 2; }
          .pfb-properties { order: 3; }
        }
        @media (max-width: 639px) {
          .pfb-grid[data-columns="2"] { grid-template-columns: 1fr; }
          .pfb-cond-row { grid-template-columns: 1fr; }
          .pfb-header-right { width: 100%; }
          .pfb-purpose-select { min-width: 0; flex: 1 1 auto; }
        }
      `}</style>
    </form>
  );
}
