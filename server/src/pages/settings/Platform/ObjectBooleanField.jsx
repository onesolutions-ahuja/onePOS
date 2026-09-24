import React from "react";

export default function ObjectBooleanField({
  label,
  value = false,
  onChange,
  disabled = false,
}) {
  return (
    <label className="object-boolean-field">
      <input
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>{label}</span>

      <style>{`
        .object-boolean-field {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 36px;
          color: #374151;
          font-size: 11px;
          cursor: pointer;
        }

        .object-boolean-field input {
          width: 15px;
          height: 15px;
          margin: 0;
        }

        .object-boolean-field input:disabled {
          cursor: not-allowed;
        }
      `}</style>
    </label>
  );
}