import React from "react";

export default function ObjectListFilters({
  filters = [],
  values = {},
  onChange,
  onClear,
}) {
  return (
    <div className="object-list-filters">
      {filters.map((filter) => {
        const key =
          filter.key ??
          filter.apiName ??
          filter.name;

        const label =
          filter.label ??
          filter.name ??
          key;

        const type = filter.type ?? "text";

        return (
          <div className="object-list-filter" key={String(key)}>
            <label>{label}</label>

            <input
              type={type === "number" ? "number" : "text"}
              value={values[key] ?? ""}
              onChange={(e) =>
                onChange?.(key, e.target.value)
              }
            />
          </div>
        );
      })}

      {onClear ? (
        <button type="button" onClick={onClear}>
          Clear
        </button>
      ) : null}

      <style>{`
        .object-list-filters {
          display: flex;
          align-items: flex-end;
          gap: 9px;
          flex-wrap: wrap;
          padding: 10px;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          background: #f9fafb;
          margin-bottom: 12px;
        }

        .object-list-filter {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 150px;
        }

        .object-list-filter label {
          color: #6b7280;
          font-size: 9px;
          font-weight: 600;
        }

        .object-list-filter input {
          height: 30px;
          padding: 0 7px;
          box-sizing: border-box;
          border: 1px solid #d1d5db;
          border-radius: 5px;
          background: #fff;
          font-size: 10px;
        }

        .object-list-filter input:focus {
          outline: none;
          border-color: #6b7280;
        }

        .object-list-filters button {
          height: 30px;
          padding: 0 10px;
          border: 1px solid #d1d5db;
          border-radius: 5px;
          background: #fff;
          color: #374151;
          font-size: 10px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}