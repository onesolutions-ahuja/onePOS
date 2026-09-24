import React from "react";

export default function ObjectDateField({
  label,
  value = "",
  onChange,
  required = false,
  disabled = false,
  readOnly = false,
  includeTime = false,
}) {
  return (
    <div className="object-field">
      {label ? (
        <label>
          {label}
          {required ? <span> *</span> : null}
        </label>
      ) : null}

      <input
        type={includeTime ? "datetime-local" : "date"}
        value={value ?? ""}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
      />

      <style>{`
        .object-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .object-field label {
          color: #374151;
          font-size: 11px;
          font-weight: 600;
        }

        .object-field label span {
          color: #b91c1c;
        }

        .object-field input {
          width: 100%;
          height: 36px;
          box-sizing: border-box;
          padding: 0 9px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          color: #111827;
          font: inherit;
          font-size: 11px;
        }

        .object-field input:focus {
          outline: none;
          border-color: #6b7280;
        }
      `}</style>
    </div>
  );
}