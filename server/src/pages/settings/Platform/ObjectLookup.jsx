import React from "react";

export default function ObjectLookup({
  label,
  value = "",
  options = [],
  onChange,
  placeholder = "Select...",
  disabled = false,
}) {
  return (
    <div className="object-lookup-field">
      {label ? <label>{label}</label> : null}

      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
      >
        <option value="">{placeholder}</option>

        {options.map((option) => {
          const optionValue =
            typeof option === "object"
              ? option.value ?? option.id
              : option;

          const optionLabel =
            typeof option === "object"
              ? option.label ?? option.name ?? optionValue
              : option;

          return (
            <option
              key={String(optionValue)}
              value={optionValue}
            >
              {optionLabel}
            </option>
          );
        })}
      </select>

      <style>{`
        .object-lookup-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .object-lookup-field label {
          color: #374151;
          font-size: 11px;
          font-weight: 600;
        }

        .object-lookup-field select {
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

        .object-lookup-field select:focus {
          outline: none;
          border-color: #6b7280;
        }
      `}</style>
    </div>
  );
}