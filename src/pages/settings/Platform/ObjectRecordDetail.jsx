import React, { useMemo } from "react";
import FormRenderer from "./FormRenderer.jsx";
import ObjectRecordView from "../../../components/records/ObjectRecordView.jsx";
import { formatRecordDisplayValue, getRecordDisplayTitle, isTechnicalRecordField } from "../../../utils/recordDisplay.js";

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

function formatValue(value, field) {
  return formatRecordDisplayValue(value, field);
}

function isUrl(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  return /^https?:\/\//i.test(value);
}

export default function ObjectRecordDetail({
  record,
  fields = [],
  objectLabel = "Record",
  objectKey = "",
  definition = null,
  embedded = false,
  showHeader = true,
  onEdit,
  onBack,
}) {
  const activeFields = useMemo(
    () =>
      Array.isArray(fields)
        ? fields.filter(
            (field) => field?.active !== false && !isTechnicalRecordField(field)
          )
        : [],
    [fields]
  );

  const recordTitle = getRecordDisplayTitle(record);

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
    <div className={`platform-record-detail${embedded ? " platform-record-detail-embedded" : ""}`}>
      {showHeader ? <div className="platform-record-detail-header">
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
              {objectLabel || objectKey || "Record"}
            </div>

            <h3>{recordTitle}</h3>
          </div>
        </div>

        {onEdit ? (
          <button type="button" className="onepos-btn onepos-btn-secondary onepos-btn-sm" onClick={onEdit} aria-label={`Edit ${recordTitle}`}>
            Edit
          </button>
        ) : (
          <span className="platform-read-only-badge">Read only</span>
        )}
      </div> : null}

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
          /* THE shared flat record view — label/value rows in a General
             section instead of a grid of bordered cards. */
          <ObjectRecordView
            fields={activeFields.map((field) => {
              const value = getValue(record, field);
              const type = getFieldType(field);
              const url = type === "url" && isUrl(value) ? String(value) : null;
              return {
                key: getFieldKey(field),
                label: field?.label || field?.name || getFieldKey(field),
                type,
                field,
                value: url ? undefined : value,
                ...(url ? { render: () => (<a href={url} target="_blank" rel="noreferrer">{formatValue(value, field)}</a>) } : {}),
              };
            })}
          />
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

        /* Flat record rows now come from the SHARED ObjectRecordView         */
        /* (index.css → .onepos-record-*); the old per-field boxed grid is    */
        /* intentionally gone.                                                */

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
        }
      `}</style>
    </div>
  );
}
