import React from "react";

export default function ObjectListColumns({
  columns = [],
  onChange,
}) {
  if (!columns.length) return null;

  return (
    <div className="object-list-columns">
      {columns.map((column, index) => {
        const key = column?.key ?? column?.apiName ?? column?.name ?? index;
        const label =
          column?.label ?? column?.name ?? column?.apiName ?? "Column";

        return (
          <label key={key}>
            <input
              type="checkbox"
              checked={column?.visible !== false}
              onChange={(event) =>
                onChange?.(column, event.target.checked)
              }
            />
            <span>{label}</span>
          </label>
        );
      })}
    </div>
  );
}
