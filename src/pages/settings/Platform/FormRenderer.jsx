import React, { useMemo, useState } from "react";
import ObjectFieldRenderer from "./ObjectFieldRenderer.jsx";
import ObjectLayoutRenderer from "./ObjectLayoutRenderer.jsx";
import ObjectForm from "./ObjectForm.jsx";
import { fieldKey, normalizeFormDefinition } from "./formDefinition.js";

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
}) {
  const normalized = useMemo(() => normalizeFormDefinition(definition), [definition]);
  const fieldMap = useMemo(() => new Map(fields.map((field) => [fieldKey(field), field])), [fields]);
  const visibleFields = useMemo(() => fields.filter((field) => field?.active !== false), [fields]);
  const [values, setValues] = useState(initialValues || {});
  const editing = mode !== "view";

  if (editing) {
    const configured = normalized.components
      .filter((component) => component.type === "field" && component.visible !== false)
      .map((component) => {
        const field = fieldMap.get(component.field_key);
        return field ? {
          ...field,
          label: component.label || field.label,
          help_text: component.help_text ?? field.help_text,
          placeholder: component.placeholder ?? field.placeholder,
          required: component.required === true || field.required === true,
          readOnly: component.readOnly === true,
          default_value: component.default_value ?? field.default_value,
        } : null;
      }).filter(Boolean);
    const configuredKeys = new Set(configured.map(fieldKey));
    const fallback = configured.length ? configured : visibleFields.filter((field) => !configuredKeys.has(fieldKey(field)));
    return (
      <div className={className}>
        <ObjectForm
          fields={fallback}
          initialValues={initialValues}
          formId={formId}
          showActions={!formId}
          onChange={(next, field, value) => { setValues(next); onChange?.(next, field, value); }}
          onSubmit={onSubmit}
          loading={loading}
          error={error}
          readOnly={mode === "view"}
          embedded={false}
          submitLabel={mode === "quick_create" ? "Quick Create" : "Save"}
        />
      </div>
    );
  }
  return (
    <div className={className} data-form-mode={mode}>
      <ObjectLayoutRenderer
        layout={normalized}
        renderComponent={(component) => {
          if (component.type === "field") {
            const field = fieldMap.get(component.field_key);
            return field ? <ObjectFieldRenderer field={{ ...field, label: component.label || field.label }} value={initialValues?.[component.field_key]} mode="display" /> : null;
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
