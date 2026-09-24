import React from "react";

export const PLATFORM_FIELD_TYPES = [
  { value: "formula", label: "Formula", description: "Read-only value calculated from this record" },
  {
    value: "text",
    label: "Text",
    description: "Short or general text value",
  },
  {
    value: "number",
    label: "Number",
    description: "Numeric value",
  },
  {
    value: "decimal",
    label: "Decimal",
    description: "Decimal or monetary value",
  },
  {
    value: "boolean",
    label: "Boolean",
    description: "Yes or no value",
  },
  {
    value: "date",
    label: "Date",
    description: "Calendar date",
  },
  {
    value: "datetime",
    label: "Date & Time",
    description: "Date with time",
  },
  {
    value: "email",
    label: "Email",
    description: "Email address",
  },
  {
    value: "phone",
    label: "Phone",
    description: "Telephone number",
  },
  {
    value: "select",
    label: "Select",
    description: "One value from a defined list",
  },
  {
    value: "lookup",
    label: "Lookup",
    description: "Reference another platform object",
  },
];

export default function FieldTypePicker({
  value = "",
  onChange,
  disabled = false,
  includeEmpty = true,
  className = "",
  name = "fieldType",
  id = "fieldType",
}) {
  return (
    <div className={`platform-field-type-picker ${className}`}>
      <select
        id={id}
        name={name}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange?.(event.target.value)
        }
      >
        {includeEmpty ? (
          <option value="">
            Select field type
          </option>
        ) : null}

        {PLATFORM_FIELD_TYPES.map((type) => (
          <option
            key={type.value}
            value={type.value}
          >
            {type.label}
          </option>
        ))}
      </select>

      {value ? (
        <div className="platform-field-type-description">
          {getFieldTypeDescription(value)}
        </div>
      ) : null}
    </div>
  );
}

export function getFieldTypeLabel(value) {
  const type = PLATFORM_FIELD_TYPES.find(
    (item) => item.value === value
  );

  return type?.label || value || "-";
}

export function getFieldTypeDescription(value) {
  const type = PLATFORM_FIELD_TYPES.find(
    (item) => item.value === value
  );

  return type?.description || "";
}

export function isSupportedFieldType(value) {
  return PLATFORM_FIELD_TYPES.some(
    (item) => item.value === value
  );
}

