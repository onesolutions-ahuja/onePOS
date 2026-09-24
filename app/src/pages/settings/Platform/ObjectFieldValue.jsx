import React from "react";

export default function ObjectFieldValue({
  label,
  value,
  emptyValue = "—",
  formatter,
}) {
  let displayValue = value;

  if (typeof formatter === "function") {
    displayValue = formatter(value);
  }

  if (
    displayValue === undefined ||
    displayValue === null ||
    displayValue === ""
  ) {
    displayValue = emptyValue;
  }

  return (
    <div className="object-field-value">
      {label ? (
        <div className="object-field-value-label">
          {label}
        </div>
      ) : null}

      <div className="object-field-value-content">
        {String(displayValue)}
      </div>

      <style>{`
        .object-field-value {
          min-width: 0;
        }

        .object-field-value-label {
          margin-bottom: 4px;
          color: #6b7280;
          font-size: 9px;
          font-weight: 700;
        }

        .object-field-value-content {
          min-height: 18px;
          color: #111827;
          font-size: 11px;
          line-height: 18px;
          overflow-wrap: anywhere;
        }
      `}</style>
    </div>
  );
}