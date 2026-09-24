import React from "react";

export default function ObjectRecordCard({
  record,
  title,
  fields = [],
  onClick,
}) {
  const recordTitle =
    title ??
    record?.name ??
    record?.label ??
    record?.id ??
    "Record";

  return (
    <div
      className="object-record-card"
      onClick={onClick ? () => onClick(record) : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="object-record-card-title">
        {recordTitle}
      </div>

      <div className="object-record-card-fields">
        {fields.map((field, index) => {
          const key = field?.apiName ?? field?.name ?? index;
          const label =
            field?.label ??
            field?.name ??
            field?.apiName ??
            "Field";
          const value = record?.[key];

          return (
            <div key={key} className="object-record-card-field">
              <span>{label}</span>
              <strong>
                {value === null || value === undefined || value === ""
                  ? "—"
                  : String(value)}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
