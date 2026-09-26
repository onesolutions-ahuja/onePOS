import React, { useEffect, useMemo, useState } from "react";
import { evaluateFieldCondition } from "../../../utils/platformConditions.js";
import { isUuid, parseBooleanValue } from "../../../utils/recordDisplay.js";
import BooleanField from "../../../components/records/BooleanField.jsx";

function getFieldKey(field) {
  return (
    field?.apiName ||
    field?.api_name ||
    field?.fieldKey ||
    field?.field_key ||
    field?.name ||
    ""
  );
}

function getFieldLabel(field) {
  return (
    field?.label ||
    field?.name ||
    getFieldKey(field) ||
    "Field"
  );
}

function getFieldType(field) {
  return (
    field?.fieldType ||
    field?.field_type ||
    field?.type ||
    "text"
  );
}

function getFieldOptions(field) {
  const options =
    field?.options ||
    field?.fieldOptions ||
    field?.field_options ||
    field?.choices ||
    [];

  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((option) => {
    if (
      typeof option === "string" ||
      typeof option === "number"
    ) {
      return {
        value: String(option),
        label: String(option),
      };
    }

    return {
      value:
        option?.value ??
        option?.key ??
        option?.id ??
        "",
      label:
        option?.label ??
        option?.name ??
        option?.value ??
        "",
    };
  });
}

function normalizeInitialValue(value, field) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const type = getFieldType(field);

  if (type === "boolean") {
    return parseBooleanValue(value);
  }

  if (
    type === "number" ||
    type === "decimal"
  ) {
    return value;
  }

  return value;
}

function buildInitialValues(fields, initialValues) {
  const result = {
    ...(initialValues || {}),
  };

  for (const field of fields) {
    const key = getFieldKey(field);

    if (!key) {
      continue;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        result,
        key
      )
    ) {
      result[key] = normalizeInitialValue(
        undefined,
        field
      );
    } else {
      result[key] = normalizeInitialValue(
        result[key],
        field
      );
    }
  }

  return result;
}

function getInputType(field) {
  const type = getFieldType(field);

  switch (type) {
    case "email":
      return "email";

    case "phone":
      return "tel";

    case "url":
      return "url";

    case "number":
    case "decimal":
      return "number";

    case "date":
      return "date";

    case "datetime":
      return "datetime-local";

    default:
      return "text";
  }
}

export default function ObjectForm({
  fields = [],
  initialValues = {},
  onChange,
  onSubmit,
  onCancel,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  readOnly = false,
  loading = false,
  error = "",
  title = "",
  description = "",
  embedded = false,
  conditionFields = null,
  contextValues = null,
  formId,
  showActions = true,
  sections = null,
}) {
  const Container = embedded ? "div" : "form";
  const activeFields = useMemo(
    () => (Array.isArray(fields) ? fields.filter((field) => field?.active !== false) : []),
    [fields]
  );
  const initialValuesKey = useMemo(
    () => JSON.stringify(initialValues || {}),
    [initialValues]
  );

  const [values, setValues] = useState(() =>
    buildInitialValues(
      activeFields,
      initialValues
    )
  );

  const [validationErrors, setValidationErrors] =
    useState({});
  const [saveError, setSaveError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setValues(
      buildInitialValues(
        activeFields,
        initialValues
      )
    );

    setValidationErrors({});
  }, [
    activeFields,
    initialValuesKey,
  ]);

  const visibleFields = useMemo(
    () =>
      activeFields.filter((field) => {
        try {
          return evaluateFieldCondition(field, "visibilityCondition", conditionFields || activeFields, { ...contextValues, ...values });
        } catch {
          return false;
        }
      }),
    [activeFields, values, conditionFields, contextValues]
  );
  const visibleFieldKeys = useMemo(() => new Set(visibleFields.map(getFieldKey)), [visibleFields]);
  const visibleSections = useMemo(
    () => (Array.isArray(sections) ? sections.map((section) => ({
      ...section,
      fields: (section.fields || []).filter((field) => visibleFieldKeys.has(getFieldKey(field))),
    })).filter((section) => section.fields.length) : []),
    [sections, visibleFieldKeys]
  );

  function updateValue(field, value) {
    const key = getFieldKey(field);

    if (!key || readOnly) {
      return;
    }

    const nextValues = {
      ...values,
      [key]: value,
    };

    setValues(nextValues);

    setValidationErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = {
        ...current,
      };

      delete next[key];

      return next;
    });

    onChange?.(
      nextValues,
      field,
      value
    );
  }

  function validate() {
    const errors = {};

    for (const field of activeFields) {
      const key = getFieldKey(field);

      if (!key) {
        continue;
      }

      let conditionallyRequired = false;
      try {
        conditionallyRequired = Boolean(field?.config?.requiredCondition) &&
          evaluateFieldCondition(field, "requiredCondition", activeFields, values);
      } catch {
        conditionallyRequired = false;
      }
      if ((!field?.required && !conditionallyRequired) || getFieldType(field) === "formula") {
        continue;
      }

      const value = values[key];

      const empty =
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) &&
          value.length === 0);

      if (empty) {
        errors[key] =
          `${getFieldLabel(field)} is required.`;
      }
    }

    setValidationErrors(errors);

    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (readOnly || loading || submitting) {
      return;
    }

    if (!validate()) {
      return;
    }

    setSaveError("");
    setSubmitting(true);
    try {
      const formulaKeys = new Set(activeFields.filter(field => getFieldType(field) === "formula").map(getFieldKey));
      await onSubmit?.(Object.fromEntries(Object.entries(values).filter(([key]) => !formulaKeys.has(key))));
    } catch (err) {
      setSaveError(err?.message || "Unable to save record.");
    } finally {
      setSubmitting(false);
    }
  }

  function renderField(field) {
    const key = getFieldKey(field);

    if (!key) {
      return null;
    }

    const label = getFieldLabel(field);
    const type = getFieldType(field);
    const value =
      values[key] ??
      (type === "boolean" ? false : "");

    const fieldError =
      validationErrors[key];

    const commonProps = {
      id: `platform-field-${key}`,
      name: key,
      disabled: readOnly || field.writable === false || loading || submitting,
      "aria-invalid": Boolean(fieldError),
      "aria-describedby": fieldError
        ? `platform-error-${key}`
        : undefined,
    };

    let control;

    switch (type) {
      case "formula":
        control = <output id={`platform-field-${key}`} aria-label={`${label} (calculated)`}>{value === "" ? "Calculated on save" : String(value)}</output>;
        break;
      case "boolean":
        /* THE global boolean renderer — the same shared toggle everywhere,
           never a page-specific checkbox or Yes/No dropdown. */
        control = (
          <div className="platform-form-toggle">
            <BooleanField
              value={parseBooleanValue(value)}
              onChange={(next) => updateValue(field, next)}
              mode="edit"
              disabled={readOnly || field.writable === false || loading || submitting}
              label={field?.checkboxLabel || label}
            />
            <span className="platform-form-toggle-label">
              {field?.checkboxLabel || `Enable ${label}`}
              {field?.required || field?.config?.requiredCondition ? <span className="platform-form-required"> *</span> : null}
            </span>
          </div>
        );

        break;

      case "long_text":
        control = (
          <textarea
            {...commonProps}
            value={value}
            rows={4}
            placeholder={
              field?.placeholder || ""
            }
            onChange={(event) =>
              updateValue(
                field,
                event.target.value
              )
            }
          />
        );

        break;

      case "select":
      case "picklist": {
        const options =
          getFieldOptions(field);

        control = (
          <select
            {...commonProps}
            value={value}
            onChange={(event) =>
              updateValue(
                field,
                event.target.value
              )
            }
          >
            <option value="">
              Select {label}
            </option>

            {options.map((option) => (
              <option
                key={String(option.value)}
                value={String(option.value)}
              >
                {option.label}
              </option>
            ))}
          </select>
        );

        break;
      }

      case "lookup":
        control = (
          <input
            {...commonProps}
            type="text"
            value={
              typeof value === "object" &&
              value !== null
                ? value?.label ??
                  value?.name ??
                  value?.display_name ??
                  value?.value ??
                  ""
                : isUuid(String(value ?? "")) ? "" : value
            }
            placeholder={
              field?.placeholder ||
              `Select ${label}`
            }
            onChange={(event) =>
              updateValue(
                field,
                event.target.value
              )
            }
          />
        );

        break;

      default:
        control = (
          <input
            {...commonProps}
            type={getInputType(field)}
            value={value}
            step={
              type === "decimal"
                ? "any"
                : undefined
            }
            placeholder={
              field?.placeholder || ""
            }
            onChange={(event) => {
              let nextValue =
                event.target.value;

              if (
                type === "number" ||
                type === "decimal"
              ) {
                if (nextValue === "") {
                  updateValue(
                    field,
                    ""
                  );
                } else {
                  updateValue(
                    field,
                    Number(nextValue)
                  );
                }

                return;
              }

              updateValue(
                field,
                nextValue
              );
            }}
          />
        );
    }

    return (
      <div
        className={`platform-form-field${
          fieldError
            ? " has-error"
            : ""
        }${
          field.__spanAll || field?.layoutWidth === "full"
            ? " onepos-form-span"
            : ""
        }`}
        key={
          field?.id ||
          key
        }
      >
        {type !== "boolean" ? (
          <label
            htmlFor={`platform-field-${key}`}
          >
            {label}

            {field?.required || field?.config?.requiredCondition ? (
              <span className="platform-form-required">
                *
              </span>
            ) : null}
          </label>
        ) : null}

        {control}

        {field?.description ? (
          <div className="platform-form-help">
            {field.description}
          </div>
        ) : null}

        {fieldError ? (
          <div
            id={`platform-error-${key}`}
            className="platform-form-error"
          >
            {fieldError}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Container
      id={formId}
      className="platform-object-form"
      onSubmit={embedded ? undefined : handleSubmit}
      noValidate={embedded ? undefined : true}
    >
      {(title || description) && (
        <div className="platform-form-header">
          {title ? (
            <h3>{title}</h3>
          ) : null}

          {description ? (
            <p>{description}</p>
          ) : null}
        </div>
      )}

      {error || saveError ? (
        <div
          className="platform-form-server-error"
          role="alert"
        >
          {error || saveError}
        </div>
      ) : null}

      {visibleFields.length === 0 ? (
        <div className="platform-form-empty">
          <strong>No active fields</strong>

          <span>
            Configure active metadata fields
            for this object before using the
            form.
          </span>
        </div>
      ) : visibleSections.length ? visibleSections.map((section) => (
          <section className="platform-form-section" key={section.id}>
            {section.label ? <h3 className="platform-form-section-title">{section.label}</h3> : null}
            {section.description ? <p className="platform-form-section-description">{section.description}</p> : null}
            <div className="platform-form-grid" style={{ "--platform-form-columns": Math.min(3, Math.max(1, Number(section.columns) || 1)) }}>
              {section.fields.map(renderField)}
            </div>
          </section>
        )) : (
          <div className="platform-form-grid">
            {visibleFields.map(renderField)}
          </div>
        )}

      {!embedded && !readOnly && visibleFields.length > 0 ? (
        <div className="platform-form-actions">
          {onCancel ? (
            <button
              type="button"
              className="platform-form-cancel"
              onClick={onCancel}
              disabled={loading || submitting}
            >
              {cancelLabel}
            </button>
          ) : null}

          {onSubmit && showActions ? (
            <button
              type="submit"
              className="platform-form-submit"
              disabled={loading || submitting}
            >
              {loading || submitting
                ? "Saving..."
                : submitLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <style>{`
        .platform-object-form {
          width: 100%;
          min-width: 0;
        }

        .platform-form-header {
          margin-bottom: 18px;
        }

        .platform-form-header h3 {
          margin: 0;
          color: var(--text-primary, #1f2937);
          font-size: 16px;
        }

        .platform-form-header p {
          margin: 5px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          line-height: 1.5;
        }

        .platform-form-server-error {
          margin-bottom: 14px;
          padding: 10px 12px;
          border: 1px solid #fecaca;
          border-radius: 8px;
          background: #fff7f7;
          color: #991b1b;
          font-size: 11px;
        }

        /* The 3/2/1 responsive field grid lives in the SHARED stylesheet
           (index.css → .platform-form-grid), so every metadata form renders
           with the same desktop-3 / tablet-2 / mobile-1 rhythm and wide
           fields span via .onepos-form-span. */
        .platform-form-grid {
          display: grid;
          grid-template-columns: repeat(var(--platform-form-columns, 3), minmax(0, 1fr));
          gap: 16px 18px;
        }

        .platform-form-section + .platform-form-section { margin-top: 22px; }
        .platform-form-section-title {
          margin: 0 0 12px;
          padding-bottom: 7px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          color: var(--text-primary, #1f2937);
          font-size: 13px;
          font-weight: 700;
        }
        .platform-form-section-description {
          margin: -6px 0 12px;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          line-height: 1.45;
        }

        .platform-form-field {
          min-width: 0;
        }

        .platform-form-field.has-error input,
        .platform-form-field.has-error select,
        .platform-form-field.has-error textarea {
          border-color: #dc2626;
        }

        .platform-form-field > label {
          display: block;
          margin-bottom: 6px;
          color: var(--text-primary, #374151);
          font-size: 10px;
          font-weight: 700;
        }

        .platform-form-required {
          margin-left: 3px;
          color: #dc2626;
        }

        .platform-form-field input,
        .platform-form-field select,
        .platform-form-field textarea {
          box-sizing: border-box;
          width: 100%;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: var(--text-primary, #1f2937);
          padding: 9px 10px;
          outline: none;
          font-family: inherit;
          font-size: 11px;
        }

        .platform-form-field textarea {
          min-height: 90px;
          resize: vertical;
          line-height: 1.45;
        }

        .platform-form-field input:focus,
        .platform-form-field select:focus,
        .platform-form-field textarea:focus {
          border-color: #9ca3af;
        }

        .platform-form-field
          input:disabled,
        .platform-form-field
          select:disabled,
        .platform-form-field
          textarea:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }

        .platform-form-toggle {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 38px;
        }

        .platform-form-toggle-label {
          color: var(--text-primary, #374151);
          font-size: 11px;
        }

        .platform-form-help {
          margin-top: 5px;
          color: var(--text-secondary, #9ca3af);
          font-size: 9px;
          line-height: 1.4;
        }

        .platform-form-error {
          margin-top: 4px;
          color: #dc2626;
          font-size: 9px;
        }

        .platform-form-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-height: 140px;
          padding: 25px;
          border: 1px dashed var(--border-color, #d1d5db);
          border-radius: 9px;
          color: var(--text-secondary, #6b7280);
          text-align: center;
          font-size: 10px;
        }

        .platform-form-empty strong {
          color: var(--text-primary, #374151);
          font-size: 12px;
        }

        .platform-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 20px;
          padding-top: 15px;
          border-top: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-form-actions button {
          border-radius: 7px;
          padding: 8px 13px;
          min-height: 36px;
          font-family: inherit;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
        }

        .platform-form-cancel {
          border: 1px solid var(--border-color, #d1d5db);
          background: var(--card-background, #fff);
          color: var(--text-primary, #374151);
        }

        .platform-form-submit {
          border: 1px solid #374151;
          background: #374151;
          color: #fff;
        }

        .platform-form-actions button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        @media (max-width: 760px) {
          .platform-form-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 650px) {
          .platform-form-grid {
            grid-template-columns: 1fr;
          }
          .platform-form-actions {
            flex-wrap: wrap;
          }
        }
      `}</style>
    </Container>
  );
}
