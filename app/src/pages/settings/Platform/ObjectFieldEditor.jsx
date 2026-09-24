import React from "react";

export default function ObjectFieldEditor({
  field,
  value,
  onChange,
  disabled = false,
}) {
  if (!field) return null;

  const type = String(
    field.fieldType ?? field.type ?? "text"
  ).toLowerCase();

  const label =
    field.label ??
    field.name ??
    field.apiName ??
    "Field";

  const required = Boolean(field.required);

  const common = {
    value: value ?? "",
    disabled,
    onChange: (e) => onChange?.(e.target.value),
  };

  let control;

  if (type === "boolean") {
    control = (
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
    );
  } else if (type === "number") {
    control = <input {...common} type="number" />;
  } else if (type === "date") {
    control = <input {...common} type="date" />;
  } else if (type === "datetime") {
    control = <input {...common} type="datetime-local" />;
  } else if (type === "longtext") {
    control = <textarea {...common} rows={4} />;
  } else if (type === "select" && Array.isArray(field.options)) {
    control = (
      <select {...common}>
        <option value="">Select...</option>
        {field.options.map((option, index) => {
          const optionValue =
            option.value ?? option.key ?? option;
          const optionLabel =
            option.label ?? option.name ?? optionValue;

          return (
            <option key={String(optionValue ?? index)} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    );
  } else {
    control = <input {...common} type="text" />;
  }

  return (
    <label className="object-field-editor">
      <span>
        {label}
        {required ? <b> *</b> : null}
      </span>
      {control}

      <style>{`
        .object-field-editor {
          display:flex;
          flex-direction:column;
          gap:5px;
        }
        .object-field-editor > span {
          color:#374151;
          font-size:10px;
          font-weight:600;
        }
        .object-field-editor b {
          color:#b91c1c;
        }
        .object-field-editor input,
        .object-field-editor textarea,
        .object-field-editor select {
          width:100%;
          box-sizing:border-box;
          min-height:30px;
          padding:6px 8px;
          border:1px solid #d1d5db;
          border-radius:5px;
          background:#fff;
          color:#111827;
          font-size:10px;
        }
        .object-field-editor textarea {
          resize:vertical;
        }
        .object-field-editor input[type="checkbox"] {
          width:auto;
          min-height:auto;
          align-self:flex-start;
        }
      `}</style>
    </label>
  );
}