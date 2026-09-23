import React, { useMemo, useState } from "react";

function getFieldKey(field) {
  return (
    field?.apiName ||
    field?.api_name ||
    field?.fieldKey ||
    field?.field_key ||
    field?.name ||
    ""
  );
}

function getFieldLabel(field) {
  return (
    field?.label ||
    field?.name ||
    getFieldKey(field) ||
    "Field"
  );
}

function getFieldType(field) {
  if ((field?.fieldType || field?.field_type) === "formula") return field?.config?.resultType || "text";
  return (
    field?.fieldType ||
    field?.field_type ||
    field?.type ||
    "text"
  );
}

function getDisplayOrder(field, index) {
  const order =
    field?.displayOrder ??
    field?.display_order ??
    field?.order ??
    field?.position;

  return Number.isFinite(Number(order))
    ? Number(order)
    : index;
}

function getValue(record, field) {
  if (!record || !field) {
    return undefined;
  }

  const apiName = getFieldKey(field);

  if (
    apiName &&
    Object.prototype.hasOwnProperty.call(
      record,
      apiName
    )
  ) {
    return record[apiName];
  }

  const sourceColumn =
    field?.sourceColumn ||
    field?.source_column ||
    field?.databaseColumn ||
    field?.database_column;

  if (
    sourceColumn &&
    Object.prototype.hasOwnProperty.call(
      record,
      sourceColumn
    )
  ) {
    return record[sourceColumn];
  }

  return undefined;
}

function formatValue(value, field) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  const type = getFieldType(field);

  if (type === "boolean") {
    return value === true || value === "true" || value === 1
      ? "Yes"
      : "No";
  }

  if (type === "date") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }
  }

  if (type === "datetime") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  if (
    type === "number" ||
    type === "decimal"
  ) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return new Intl.NumberFormat().format(
        number
      );
    }
  }

  if (typeof value === "object") {
    try {
      if (value.label || value.name || value.title || value.value) {
        return String(
          value.label ||
            value.name ||
            value.title ||
            value.value
        );
      }

      return JSON.stringify(value);
    } catch {
      return String(value);
    }

  }

  return String(value);
}

function getRecordId(record, index) {
  return (
    record?.id ??
    record?.record_id ??
    record?.uuid ??
    record?.key ??
    index
  );
}

export default function ObjectRecordList({
  records = [],
  fields = [],
  objectLabel = "Records",
  objectKey = "",
  loading = false,
  error = "",
  onSelectRecord,
  selectedRecord,
  onRefresh,
  emptyMessage,
}) {
  const [search, setSearch] = useState("");

  const activeFields = useMemo(
    () =>
      (Array.isArray(fields)
        ? fields.filter(
            (field) =>
              field?.active !== false
          )
        : []
      )
        .map((field, index) => ({
          field,
          index,
          order: getDisplayOrder(field, index),
        }))
        .sort((left, right) => left.order - right.order || left.index - right.index)
        .map(({ field }) => field),
    [fields]
  );

  const safeRecords = useMemo(
    () =>
      Array.isArray(records)
        ? records
        : [],
    [records]
  );

  const filteredRecords = useMemo(() => {
    const query = search
      .trim()
      .toLowerCase();

    if (!query) {
      return safeRecords;
    }

    return safeRecords.filter((record) =>
      activeFields.some((field) => {
        const value = getValue(
          record,
          field
        );

        if (
          value === null ||
          value === undefined
        ) {
          return false;
        }

        return String(value)
          .toLowerCase()
          .includes(query);
      })
    );
  }, [
    search,
    safeRecords,
    activeFields,
  ]);

  function isSelected(record) {
    if (!selectedRecord || !record) {
      return false;
    }

    const selectedId =
      selectedRecord?.id ??
      selectedRecord?.record_id ??
      selectedRecord?.uuid ??
      selectedRecord?.key;

    const recordId =
      record?.id ??
      record?.record_id ??
      record?.uuid ??
      record?.key;

    if (
      selectedId !== undefined &&
      recordId !== undefined
    ) {
      return (
        String(selectedId) ===
        String(recordId)
      );
    }

    return selectedRecord === record;
  }

  return (
    <section className="platform-object-record-list">
      <div className="platform-record-list-header">
        <div>
          <div className="platform-record-list-eyebrow">
            {objectKey || "OBJECT"}
          </div>

          <h3>{objectLabel}</h3>

          <span>
            {filteredRecords.length} record
            {filteredRecords.length === 1
              ? ""
              : "s"}
          </span>
        </div>

        <div className="platform-record-list-actions">
          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(
                event.target.value
              )
            }
            placeholder="Search records..."
            aria-label="Search records"
          />

          {onRefresh ? (
            <button
              type="button"
              className="platform-record-refresh"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading
                ? "Loading..."
                : "Refresh"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="platform-record-list-error">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="platform-record-list-empty">
          <strong>
            Loading records…
          </strong>

          <span>
            Please wait while the object records
            are loaded.
          </span>
        </div>
      ) : activeFields.length === 0 ? (
        <div className="platform-record-list-empty">
          <strong>
            No active fields
          </strong>

          <span>
            Configure fields for this object
            before displaying records.
          </span>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="platform-record-list-empty">
          <strong>
            {search
              ? "No matching records"
              : "No records"}
          </strong>

          <span>
            {search
              ? "Try a different search."
              : emptyMessage ||
                "There are no records available for this object."}
          </span>
        </div>
      ) : (
        <div className="platform-record-table-container">
          <table className="platform-record-table">
            <thead>
              <tr>
                {activeFields.map(
                  (field) => (
                    <th
                      key={
                        field?.id ||
                        getFieldKey(
                          field
                        )
                      }
                    >
                      {getFieldLabel(
                        field
                      )}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {filteredRecords.map(
                (record, index) => {
                  const recordId =
                    getRecordId(
                      record,
                      index
                    );

                  const selected =
                    isSelected(record);

                  return (
                    <tr
                      key={recordId}
                      className={
                        selected
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        onSelectRecord?.(
                          record
                        )
                      }
                    >
                      {activeFields.map(
                        (field) => {
                          const value =
                            getValue(
                              record,
                              field
                            );

                          return (
                            <td
                              key={
                                field?.id ||
                                getFieldKey(
                                  field
                                )
                              }
                              title={
                                value !==
                                  null &&
                                value !==
                                  undefined
                                  ? String(
                                      value
                                    )
                                  : ""
                              }
                            >
                              {formatValue(value, field)}
                            </td>
                          );
                        }
                      )}
                    </tr>
                  );
                }
              )}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .platform-object-record-list {
          width: 100%;
          min-width: 0;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          overflow: hidden;
        }

        .platform-record-list-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 15px 17px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-record-list-eyebrow {
          margin-bottom: 3px;
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .platform-record-list-header h3 {
          margin: 0;
          font-size: 15px;
        }

        .platform-record-list-header span {
          display: block;
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 9px;
        }

        .platform-record-list-actions {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .platform-record-list-actions input {
          width: 210px;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 8px 10px;
          outline: none;
          font-size: 11px;
        }

        .platform-record-list-actions input:focus {
          border-color: #9ca3af;
        }

        .platform-record-refresh {
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 8px 11px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
        }

        .platform-record-refresh:disabled {
          cursor: default;
          opacity: 0.55;
        }

        .platform-record-list-error {
          margin: 12px 14px 0;
          padding: 10px 12px;
          border: 1px solid #fecaca;
          border-radius: 7px;
          background: #fff7f7;
          color: #991b1b;
          font-size: 11px;
        }

        .platform-record-table-container {
          width: 100%;
          overflow: auto;
          max-height: 620px;
        }

        .platform-record-table {
          width: 100%;
          min-width: 600px;
          border-collapse: collapse;
          font-size: 11px;
        }

        .platform-record-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          background: var(--muted-background, #f9fafb);
          color: var(--text-primary, #374151);
          text-align: left;
          font-size: 9px;
          font-weight: 700;
          white-space: nowrap;
        }

        .platform-record-table td {
          max-width: 300px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          color: var(--text-primary, #374151);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .platform-record-table tbody tr {
          cursor: pointer;
          transition: background 0.12s ease;
        }

        .platform-record-table tbody tr:hover {
          background: var(--muted-background, #f9fafb);
        }

        .platform-record-table tbody tr.selected {
          background: rgba(37, 99, 235, 0.07);
        }

        .platform-record-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .platform-record-list-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-height: 180px;
          padding: 30px 20px;
          color: var(--text-secondary, #6b7280);
          text-align: center;
          font-size: 11px;
        }

        .platform-record-list-empty strong {
          color: inherit;
          font-size: 13px;
        }

        @media (max-width: 700px) {
          .platform-record-list-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .platform-record-list-actions {
            width: 100%;
          }

          .platform-record-list-actions input {
            flex: 1;
            width: auto;
          }
        }
      `}</style>
    </section>
  );
}
