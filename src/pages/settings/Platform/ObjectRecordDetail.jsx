import React, { useMemo } from "react";
import FormRenderer from "./FormRenderer.jsx";

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

function getFieldSourceColumn(field) {
  return (
    field?.sourceColumn ||
    field?.source_column ||
    field?.databaseColumn ||
    field?.database_column ||
    ""
  );
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
    getFieldSourceColumn(field);

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

function formatDate(value, includeTime = false) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return includeTime
    ? date.toLocaleString()
    : date.toLocaleDateString();
}

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return String(value);
  }

  return new Intl.NumberFormat().format(number);
}

function formatValue(value, field) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "—";
  }

  const type = getFieldType(field);

  switch (type) {
    case "boolean":
      return value ? "Yes" : "No";

    case "date":
      return formatDate(value);

    case "datetime":
      return formatDate(value, true);

    case "number":
    case "decimal":
      return formatNumber(value);

    case "email":
      return String(value);

    case "phone":
      return String(value);

    case "url":
      return String(value);

    case "long_text":
      return String(value);

    case "select":
      return String(value);

    case "lookup":
      if (
        typeof value === "object" &&
        value !== null
      ) {
        return (
          value.label ||
          value.name ||
          value.id ||
          JSON.stringify(value)
        );
      }

      return String(value);

    default:
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }

      return String(value);
  }
}

function isUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  return /^https?:\/\//i.test(value);
}

function getRecordIdentifier(record) {
  if (!record) {
    return "";
  }

  return (
    record.id ??
    record.record_id ??
    record.uuid ??
    record.key ??
    ""
  );
}

export default function ObjectRecordDetail({
  record,
  fields = [],
  objectLabel = "Record",
  objectKey = "",
  definition = null,
  embedded = false,
  onBack,
}) {
  const activeFields = useMemo(
    () =>
      Array.isArray(fields)
        ? fields.filter(
            (field) => field?.active !== false
          )
        : [],
    [fields]
  );

  const recordIdentifier =
    getRecordIdentifier(record);

  if (!record) {
    return (
      <div className={`platform-record-detail${embedded ? " platform-record-detail-embedded" : ""}`}>
        <div className="platform-record-detail-empty">
          <strong>No record selected</strong>
          <span>
            Select a record to view its details.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="platform-record-detail">
      <div className="platform-record-detail-header">
        <div className="platform-record-detail-title">
          {onBack ? (
            <button
              type="button"
              className="platform-record-detail-back"
              onClick={onBack}
            >
              ← Back
            </button>
          ) : null}

          <div>
            <div className="platform-record-detail-eyebrow">
              {objectKey || "OBJECT"}
            </div>

            <h3>{objectLabel}</h3>

            {recordIdentifier !== "" ? (
              <span className="platform-record-detail-id">
                ID: {String(recordIdentifier)}
              </span>
            ) : null}
          </div>
        </div>

        <span className="platform-read-only-badge">
          Read only
        </span>
      </div>

      <div className="platform-record-detail-body">
        {definition ? (
          <FormRenderer
            definition={definition}
            fields={activeFields}
            initialValues={record}
            mode="view"
          />
        ) : activeFields.length === 0 ? (
          <div className="platform-record-detail-empty compact">
            <strong>No active fields</strong>
            <span>
              This object does not currently have any
              active metadata fields.
            </span>
          </div>
        ) : (
          <div className="platform-record-field-grid">
            {activeFields.map((field) => {
              const key =
                field?.id ||
                getFieldKey(field);

              const label =
                field?.label ||
                field?.name ||
                getFieldKey(field);

              const value = getValue(
                record,
                field
              );

              const formatted =
                formatValue(value, field);

              const url =
                getFieldType(field) === "url" &&
                isUrl(value)
                  ? String(value)
                  : null;

              return (
                <div
                  className="platform-record-field"
                  key={key}
                >
                  <div className="platform-record-field-label">
                    <span>{label}</span>

                    {field?.required ? (
                      <span className="platform-record-required">
                        *
                      </span>
                    ) : null}
                  </div>

                  <div className="platform-record-field-value">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {formatted}
                      </a>
                    ) : (
                      formatted
                    )}
                  </div>

                  {getFieldSourceColumn(
                    field
                  ) ? (
                    <div className="platform-record-field-source">
                      {getFieldSourceColumn(field)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .platform-record-detail {
          width: 100%;
          min-width: 0;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          overflow: hidden;
        }

        .platform-record-detail-embedded {
          border: 0;
          border-radius: 0;
          background: transparent;
        }

        .platform-record-detail-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-record-detail-title {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
        }

        .platform-record-detail-back {
          flex: 0 0 auto;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 7px 10px;
          font-size: 11px;
          cursor: pointer;
        }

        .platform-record-detail-eyebrow {
          margin-bottom: 4px;
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .platform-record-detail-header h3 {
          margin: 0;
          font-size: 16px;
        }

        .platform-record-detail-id {
          display: block;
          margin-top: 4px;
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 9px;
        }

        .platform-read-only-badge {
          flex: 0 0 auto;
          padding: 5px 8px;
          border-radius: 999px;
          background: #f3f4f6;
          color: #6b7280;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .platform-record-detail-body {
          padding: 18px;
        }

        .platform-record-field-grid {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fit,
              minmax(220px, 1fr)
            );
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 9px;
          background: var(--border-color, #e5e7eb);
        }

        .platform-record-field {
          min-width: 0;
          padding: 13px;
          background: var(--card-background, #fff);
        }

        .platform-record-field-label {
          display: flex;
          align-items: center;
          gap: 3px;
          margin-bottom: 5px;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          font-weight: 600;
        }

        .platform-record-required {
          color: #dc2626;
        }

        .platform-record-field-value {
          min-height: 18px;
          color: var(--text-primary, #1f2937);
          font-size: 12px;
          line-height: 1.5;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        .platform-record-field-value a {
          color: inherit;
          text-decoration: underline;
        }

        .platform-record-field-source {
          margin-top: 5px;
          color: var(--text-secondary, #9ca3af);
          font-family: monospace;
          font-size: 8px;
        }

        .platform-record-detail-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          min-height: 180px;
          padding: 30px;
          color: var(--text-secondary, #6b7280);
          text-align: center;
          font-size: 11px;
        }

        .platform-record-detail-empty strong {
          color: inherit;
          font-size: 13px;
        }

        .platform-record-detail-empty.compact {
          min-height: 120px;
        }

        @media (max-width: 650px) {
          .platform-record-detail-header {
            flex-direction: column;
          }

          .platform-record-detail-title {
            width: 100%;
          }

          .platform-record-field-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
