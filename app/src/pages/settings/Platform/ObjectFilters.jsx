import React from "react";

export default function ObjectFilters({
  filters = [],
  values = {},
  onChange,
  onClear,
  children,
}) {
  function updateFilter(key, value) {
    if (typeof onChange === "function") {
      onChange({
        ...values,
        [key]: value,
      });
    }
  }

  function clearFilters() {
    if (typeof onClear === "function") {
      onClear();
      return;
    }

    if (typeof onChange === "function") {
      onChange({});
    }
  }

  const hasActiveFilters = Object.entries(values).some(
    ([, value]) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
  );

  return (
    <div className="platform-object-filters">
      <div className="platform-object-filters-row">
        {filters.map((filter) => {
          const key = filter.key || filter.apiName;
          const type = filter.type || filter.fieldType || "text";
          const value = values[key] ?? "";

          if (!key) return null;

          return (
            <div
              className="platform-object-filter"
              key={key}
            >
              {filter.label ? (
                <label htmlFor={`object-filter-${key}`}>
                  {filter.label}
                </label>
              ) : null}

              {type === "select" ||
              type === "picklist" ? (
                <select
                  id={`object-filter-${key}`}
                  value={value}
                  onChange={(event) =>
                    updateFilter(
                      key,
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    {filter.placeholder ||
                      `All ${filter.label || ""}`}
                  </option>

                  {(filter.options || []).map(
                    (option) => {
                      const optionValue =
                        typeof option === "object"
                          ? option.value
                          : option;

                      const optionLabel =
                        typeof option === "object"
                          ? option.label
                          : option;

                      return (
                        <option
                          key={String(
                            optionValue
                          )}
                          value={optionValue}
                        >
                          {optionLabel}
                        </option>
                      );
                    }
                  )}
                </select>
              ) : type === "boolean" ? (
                <select
                  id={`object-filter-${key}`}
                  value={value}
                  onChange={(event) =>
                    updateFilter(
                      key,
                      event.target.value
                    )
                  }
                >
                  <option value="">
                    All
                  </option>
                  <option value="true">
                    Yes
                  </option>
                  <option value="false">
                    No
                  </option>
                </select>
              ) : type === "date" ? (
                <input
                  id={`object-filter-${key}`}
                  type="date"
                  value={value}
                  onChange={(event) =>
                    updateFilter(
                      key,
                      event.target.value
                    )
                  }
                />
              ) : (
                <input
                  id={`object-filter-${key}`}
                  type={
                    type === "number"
                      ? "number"
                      : "text"
                  }
                  value={value}
                  placeholder={
                    filter.placeholder || ""
                  }
                  onChange={(event) =>
                    updateFilter(
                      key,
                      event.target.value
                    )
                  }
                />
              )}
            </div>
          );
        })}

        {children}

        {hasActiveFilters ? (
          <button
            type="button"
            className="platform-object-filters-clear"
            onClick={clearFilters}
          >
            Clear
          </button>
        ) : null}
      </div>

      <style>{`
        .platform-object-filters {
          width: 100%;
          min-width: 0;
        }

        .platform-object-filters-row {
          display: flex;
          align-items: flex-end;
          flex-wrap: wrap;
          gap: 10px;
        }

        .platform-object-filter {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 150px;
        }

        .platform-object-filter label {
          color: #6b7280;
          font-size: 10px;
          font-weight: 700;
        }

        .platform-object-filter input,
        .platform-object-filter select {
          height: 34px;
          min-width: 150px;
          box-sizing: border-box;
          padding: 0 9px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          color: #111827;
          font-family: inherit;
          font-size: 11px;
          outline: none;
        }

        .platform-object-filter input:focus,
        .platform-object-filter select:focus {
          border-color: #6b7280;
          box-shadow:
            0 0 0 2px
            rgba(107, 114, 128, 0.12);
        }

        .platform-object-filters-clear {
          height: 34px;
          padding: 0 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          color: #374151;
          font-family: inherit;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
        }

        .platform-object-filters-clear:hover {
          background: #f9fafb;
          border-color: #9ca3af;
        }

        @media (max-width: 700px) {
          .platform-object-filter {
            flex: 1 1 180px;
          }

          .platform-object-filter input,
          .platform-object-filter select {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
