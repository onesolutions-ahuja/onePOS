import React from "react";

export default function ObjectMultiSelect({
  label,
  value = [],
  options = [],
  onChange,
  disabled = false,
}) {
  const selected = Array.isArray(value) ? value : [];

  const handleChange = (event) => {
    const values = Array.from(
      event.target.selectedOptions
    ).map((option) => option.value);

    onChange?.(values);
  };

  return (
    <div className="object-select-field">
      {label ? <label>{label}</label> : null}

      <select
        multiple
        value={selected}
        disabled={disabled}
        onChange={handleChange}
      >
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
        .object-select-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .object-select-field label {
          color: #374151;
          font-size: 11px;
          font-weight: 600;
        }

        .object-select-field select {
          width: 100%;
          min-height: 90px;
          box-sizing: border-box;
          padding: 5px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          font: inherit;
          font-size: 11px;
        }

        .object-select-field select:focus {
          outline: none;
          border-color: #6b7280;
        }
      `}</style>
    </div>
  );
}