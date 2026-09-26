import { useMemo } from "react";
import ObjectFieldRenderer from "./ObjectFieldRenderer.jsx";
import ObjectLayoutRenderer from "./ObjectLayoutRenderer.jsx";
import ObjectForm from "./ObjectForm.jsx";
import ObjectRecordView from "../../../components/records/ObjectRecordView.jsx";
import { fieldKey, normalizeFormDefinition } from "./formDefinition.js";
import { isTechnicalRecordField } from "../../../utils/recordDisplay.js";

function valueFor(record, field) {
  const key = fieldKey(field);
  const source = field?.sourceColumn || field?.source_column || field?.databaseColumn || field?.database_column;
  return record?.[key] ?? (source ? record?.[source] : undefined);
}

export default function FormRenderer({
  definition,
  fields = [],
  initialValues = {},
  mode = "view",
  onSubmit,
  onChange,
  loading = false,
  error = "",
  className = "",
  formId,
  embedded = false,
}) {
  const normalized = useMemo(() => normalizeFormDefinition(definition), [definition]);
  const visibleFields = useMemo(
    () => fields.filter((field) => field?.active !== false && !isTechnicalRecordField(field)),
    [fields]
  );
  const fieldMap = useMemo(() => new Map(visibleFields.map((field) => [fieldKey(field), field])), [visibleFields]);
  const editing = mode === "create" || mode === "edit" || mode === "quick_create";

  if (editing) {
    const configured = normalized.components
      .filter((component) => component.type === "field" && component.visible !== false &&
        normalized.sections.some((section) => section.id === component.section_id && section.visible))
      .map((component) => {
        const field = fieldMap.get(component.field_key);
        return field ? {
          ...field,
          label: component.label || field.label,
          help_text: component.help_text ?? field.help_text,
          description: component.help_text ?? field.description ?? field.help_text,
          placeholder: component.placeholder ?? field.placeholder,
          required: component.required === true || field.required === true,
          readOnly: component.readOnly === true,
          writable: component.readOnly === true ? false : field.writable,
          default_value: component.default_value ?? field.default_value,
          /* Layout width survives into the shared form grid: "full" (and any
             wide value) spans all columns; narrow values stay in flow. */
          layoutWidth: component.width,
          __spanAll: component.width === "full",
          section_id: component.section_id,
          order: component.order,
        } : null;
      }).filter(Boolean);
    const hasConfiguredFields = normalized.components.some((component) => component.type === "field");
    const configuredKeys = new Set(configured.map(fieldKey));
    const fallback = hasConfiguredFields ? configured : visibleFields.filter((field) => !configuredKeys.has(fieldKey(field)));
    const configuredSections = hasConfiguredFields
      ? normalized.sections.filter((section) => section.visible).map((section) => ({
          id: section.id,
          label: section.label,
          description: section.description,
          columns: section.columns,
          fields: configured.filter((field) => field.section_id === section.id).sort((a, b) => a.order - b.order),
        })).filter((section) => section.fields.length)
      : [];
    if (!hasConfiguredFields && fallback.length && configuredSections.length === 0) {
      configuredSections.push({
        id: "details",
        label: normalized.sections[0]?.label || "Details",
        columns: normalized.sections[0]?.columns || 1,
        fields: fallback,
      });
    }
    return (
      <div className={className}>
        <ObjectForm
          fields={hasConfiguredFields ? configured : fallback}
          sections={configuredSections}
          initialValues={initialValues}
          formId={formId}
          showActions={!formId}
          onChange={onChange}
          onSubmit={onSubmit}
          loading={loading}
          error={error}
          embedded={embedded}
          submitLabel={mode === "quick_create" ? "Quick Create" : "Save"}
        />
      </div>
    );
  }
  const hasConfiguredFields = normalized.components.some((component) => component.type === "field");
  if (!hasConfiguredFields) {
    return (
      <ObjectRecordView
        className={className}
        fields={visibleFields.map((field) => ({
          key: fieldKey(field),
          label: field.label || field.name || fieldKey(field),
          type: field.config?.resultType || field.fieldType || field.field_type || field.type,
          field,
          value: valueFor(initialValues, field),
        }))}
      />
    );
  }
  return (
    <div className={className} data-form-mode={mode}>
      <ObjectLayoutRenderer
        layout={normalized}
        renderComponent={(component) => {
          if (component.type === "field") {
            const field = fieldMap.get(component.field_key);
            return field ? <ObjectFieldRenderer field={{ ...field, label: component.label || field.label }} value={valueFor(initialValues, field)} mode="display" /> : null;
          }
          if (component.type === "text" || component.type === "header") return <div className={component.type === "header" ? "font-semibold" : "text-sm text-slate-600"}>{component.text || component.label}</div>;
          if (component.type === "divider") return <hr />;
          if (component.type === "spacer") return <div style={{ minHeight: component.height || 16 }} />;
          return null;
        }}
      />
    </div>
  );
}
