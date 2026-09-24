import React from "react";

export default function ObjectLongTextField({
  label,
  value = "",
  onChange,
  placeholder = "",
  required = false,
  disabled = false,
  readOnly = false,
  rows = 5,
}) {
  return (
    <div className="object-long-field">
      {label ? (
        <label>
          {label}
          {required ? <span> *</span> : null}
        </label>
      ) : null}

      <textarea
        value={value ?? ""}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        rows={rows}
        onChange={(e) => onChange?.(e.target.value)}
      />

      <style>{`
        .object-long-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .object-long-field label {
          color: #374151;
          font-size: 11px;
          font-weight: 600;
        }

        .object-long-field label span {
          color: #b91c1c;
        }

        .object-long-field textarea {
          width: 100%;
          box-sizing: border-box;
          padding: 8px 9px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          resize: vertical;
          background: #fff;
          color: #111827;
          font: inherit;
          font-size: 11px;
        }

        .object-long-field textarea:focus {
          outline: none;
          border-color: #6b7280;
        }

        .object-long-field textarea:disabled,
        .object-long-field textarea[readonly] {
          background: #f3f4f6;
        }
      `}</style>
    </div>
  );
}