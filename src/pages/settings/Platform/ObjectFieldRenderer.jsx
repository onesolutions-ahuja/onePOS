import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

function getFieldType(field) {
  if ((field?.fieldType || field?.field_type) === "formula") return field?.config?.resultType || "text";
  return (
    field?.fieldType ||
    field?.field_type ||
    field?.type ||
    "text"
  );
}

function getFieldLabel(field) {
  return (
    field?.label ||
    field?.name ||
    field?.apiName ||
    field?.api_name ||
    "Field"
  );
}

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

function formatDate(value, includeTime = false) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat(
    undefined,
    includeTime
      ? {
          dateStyle: "medium",
          timeStyle: "short",
        }
      : {
          dateStyle: "medium",
        }
  ).format(date);
}

function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return String(value);
  }

  return new Intl.NumberFormat().format(number);
}

function formatLookupValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  if (
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return String(value);
  }

  return (
    value.label ??
    value.name ??
    value.displayName ??
    value.display_name ??
    value.value ??
    value.id ??
    "-"
  );
}

function formatValue(value, field) {
  const type = getFieldType(field);

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  switch (type) {
    case "boolean":
      return value === true ||
        value === 1 ||
        value === "true"
        ? "Yes"
        : "No";

    case "number":
    case "decimal":
    case "currency":
      return formatNumber(value);

    case "date":
      return formatDate(value);

    case "datetime":
      return formatDate(value, true);

    case "lookup":
      return formatLookupValue(value);

    case "long_text":
      return String(value);

    default:
      if (
        typeof value === "object"
      ) {
        return formatLookupValue(value);
      }

      return String(value);
  }
}

export default function ObjectFieldRenderer({
  field,
  value,
  mode = "display",
  onChange,
  disabled = false,
  error = "",
  placeholder = "",
  className = "",
}) {
  const fieldType = getFieldType(field);
  const label = getFieldLabel(field);
  const fieldKey = getFieldKey(field);
  const [lookupOptions, setLookupOptions] = useState([]);
  const [lookupError, setLookupError] = useState("");

  useEffect(() => {
    const targetKey = field?.config?.relatedObjectKey || field?.config?.related_object_key;
    if (mode === "display" || fieldType !== "lookup" || !targetKey) return;
    let active = true;
    apiRequest(`/api/platform/objects/${encodeURIComponent(targetKey)}/records?limit=100`)
      .then((response) => {
        if (!active) return;
        const records = response?.records || response?.data?.records || response?.data || [];
        setLookupOptions(Array.isArray(records) ? records : []);
      })
      .catch((error) => {
        if (active) setLookupError(error?.message || "Unable to load lookup records.");
      });
    return () => { active = false; };
  }, [fieldType, field?.config?.relatedObjectKey, field?.config?.related_object_key, mode]);

  if (!fieldKey) {
    return null;
  }

  if (mode === "display" || (field?.fieldType || field?.field_type) === "formula") {
    return (
      <div
        className={`platform-field-renderer platform-field-display ${className}`}
      >
        <div className="platform-field-display-label">
          {label}
        </div>

        <div className="platform-field-display-value">
          {formatValue(value, field)}
        </div>

        <style>{`
          .platform-field-display {
            min-width: 0;
          }

          .platform-field-display-label {
            margin-bottom: 5px;
            color: var(
              --text-secondary,
              #6b7280
            );
            font-size: 9px;
            font-weight: 700;
          }

          .platform-field-display-value {
            min-height: 20px;
            color: var(
              --text-primary,
              #1f2937
            );
            font-size: 11px;
            line-height: 1.45;
            word-break: break-word;
            white-space: pre-wrap;
          }
        `}</style>
      </div>
    );
  }

  function handleChange(nextValue) {
    onChange?.(
      nextValue,
      field
    );
  }

  let control;

  switch (fieldType) {
    case "boolean":
      control = (
        <label className="platform-field-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) =>
              handleChange(
                event.target.checked
              )
            }
          />

          <span>
            {field?.checkboxLabel ||
              label}
          </span>
        </label>
      );

      break;

    case "long_text":
      control = (
        <textarea
          value={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          rows={4}
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "number":
    case "decimal":
    case "currency":
      control = (
        <input
          type="number"
          value={value ?? ""}
          disabled={disabled}
          placeholder={placeholder}
          step={
            fieldType === "decimal"
              ? "any"
              : "1"
          }
          onChange={(event) => {
            const nextValue =
              event.target.value;

            if (nextValue === "") {
              handleChange("");
              return;
            }

            handleChange(
              Number(nextValue)
            );
          }}
        />
      );

      break;

    case "date":
      control = (
        <input
          type="date"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "datetime":
      control = (
        <input
          type="datetime-local"
          value={value ?? ""}
          disabled={disabled}
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "email":
      control = (
        <input
          type="email"
          value={value ?? ""}
          disabled={disabled}
          placeholder={
            placeholder ||
            `Enter ${label}`
          }
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "phone":
      control = (
        <input
          type="tel"
          value={value ?? ""}
          disabled={disabled}
          placeholder={
            placeholder ||
            `Enter ${label}`
          }
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "url":
      control = (
        <input
          type="url"
          value={value ?? ""}
          disabled={disabled}
          placeholder={
            placeholder ||
            `Enter ${label}`
          }
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "lookup":
      control = lookupOptions.length ? (
        <select value={typeof value === "object" ? value?.id ?? "" : value ?? ""} disabled={disabled} onChange={(event) => handleChange(event.target.value)}>
          <option value="">Select {label}</option>
          {lookupOptions.map((record) => {
            const recordId = record?.id ?? record?.record_id;
            const recordLabel = record?.label ?? record?.name ?? record?.display_name ?? recordId;
            return <option key={String(recordId)} value={String(recordId)}>{String(recordLabel)}</option>;
          })}
        </select>
      ) : (
        <input
          type="text"
          value={
            typeof value === "object" &&
            value !== null
              ? value?.label ??
                value?.name ??
                value?.id ??
                ""
              : value ?? ""
          }
          disabled={disabled}
          placeholder={
            placeholder ||
            `Select ${label}`
          }
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );

      break;

    case "select":
    case "picklist": {
      const options = Array.isArray(field?.options) ? field.options : [];
      control = (
        <select value={value ?? ""} disabled={disabled} onChange={(event) => handleChange(event.target.value)}>
          <option value="">Select {label}</option>
          {options.map((option) => {
            const optionValue = typeof option === "object" ? option.value ?? option.key ?? option.label : option;
            const optionLabel = typeof option === "object" ? option.label ?? option.name ?? optionValue : option;
            return <option key={String(optionValue)} value={String(optionValue)}>{String(optionLabel)}</option>;
          })}
        </select>
      );
      break;
    }

    case "multiselect": {
      const options = Array.isArray(field?.options) ? field.options : [];
      const selected = Array.isArray(value) ? value : [];
      control = (
        <select multiple value={selected.map(String)} disabled={disabled} onChange={(event) => handleChange(Array.from(event.target.selectedOptions, (option) => option.value))}>
          {options.map((option) => {
            const optionValue = typeof option === "object" ? option.value ?? option.key ?? option.label : option;
            const optionLabel = typeof option === "object" ? option.label ?? option.name ?? optionValue : option;
            return <option key={String(optionValue)} value={String(optionValue)}>{String(optionLabel)}</option>;
          })}
        </select>
      );
      break;
    }

    default:
      control = (
        <input
          type="text"
          value={value ?? ""}
          disabled={disabled}
          placeholder={
            placeholder ||
            `Enter ${label}`
          }
          onChange={(event) =>
            handleChange(
              event.target.value
            )
          }
        />
      );
  }

  return (
    <div
      className={`platform-field-renderer platform-field-editor ${className}`}
    >
      <label>
        {label}

        {field?.required ? (
          <span className="platform-field-required">
            *
          </span>
        ) : null}
      </label>

      {control}

      {field?.description ? (
        <div className="platform-field-help">
          {field.description}
        </div>
      ) : null}

      {error ? (
        <div className="platform-field-error">
          {error}
        </div>
      ) : null}
      {lookupError ? (
        <div className="platform-field-error">
          {lookupError}
        </div>
      ) : null}

      <style>{`
        .platform-field-editor {
          min-width: 0;
        }

        .platform-field-editor > label {
          display: block;
          margin-bottom: 6px;
          color: var(
            --text-primary,
            #374151
          );
          font-size: 10px;
          font-weight: 700;
        }

        .platform-field-required {
          margin-left: 3px;
          color: #dc2626;
        }

        .platform-field-editor input,
        .platform-field-editor textarea,
        .platform-field-editor select {
          box-sizing: border-box;
          width: 100%;
          border: 1px solid var(
            --border-color,
            #d1d5db
          );
          border-radius: 7px;
          background: var(
            --card-background,
            #fff
          );
          color: var(
            --text-primary,
            #1f2937
          );
          padding: 9px 10px;
          outline: none;
          font-family: inherit;
          font-size: 11px;
        }

        .platform-field-editor textarea {
          min-height: 90px;
          resize: vertical;
          line-height: 1.45;
        }

        .platform-field-editor
          input:focus,
        .platform-field-editor
          textarea:focus,
        .platform-field-editor
          select:focus {
          border-color: #9ca3af;
        }

        .platform-field-editor
          input:disabled,
        .platform-field-editor
          textarea:disabled,
        .platform-field-editor
          select:disabled {
          cursor: not-allowed;
          opacity: 0.65;
        }

        .platform-field-checkbox {
          display: flex !important;
          align-items: center;
          gap: 8px;
          min-height: 38px;
          box-sizing: border-box;
          padding: 8px 10px;
          border: 1px solid var(
            --border-color,
            #d1d5db
          );
          border-radius: 7px;
          background: var(
            --card-background,
            #fff
          );
          cursor: pointer;
        }

        .platform-field-checkbox
          input {
          width: auto;
          margin: 0;
        }

        .platform-field-checkbox
          span {
          color: var(
            --text-primary,
            #374151
          );
          font-size: 11px;
        }

        .platform-field-help {
          margin-top: 5px;
          color: var(
            --text-secondary,
            #9ca3af
          );
          font-size: 9px;
          line-height: 1.4;
        }

        .platform-field-error {
          margin-top: 4px;
          color: #dc2626;
          font-size: 9px;
        }
      `}</style>
    </div>
  );
}
