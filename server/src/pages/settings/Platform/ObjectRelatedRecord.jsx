import React from "react";

export default function ObjectRelatedRecord({
  record,
  fields = [],
  onOpen,
}) {
  if (!record) return null;

  return (
    <div
      className={`object-related-record${onOpen ? " clickable" : ""}`}
      onClick={() => onOpen?.(record)}
    >
      {fields.map((field) => {
        const key = field.apiName ?? field.key ?? field.name;

        return (
          <span key={String(key)}>
            <strong>{field.label ?? field.name ?? key}:</strong>{" "}
            {String(record[key] ?? "—")}
          </span>
        );
      })}

      <style>{`
        .object-related-record {
          display:flex;
          flex-wrap:wrap;
          gap:8px 14px;
          padding:9px;
          border:1px solid #e5e7eb;
          border-radius:6px;
          background:#fff;
          color:#374151;
          font-size:9px;
        }
        .object-related-record.clickable {
          cursor:pointer;
        }
        .object-related-record.clickable:hover {
          border-color:#9ca3af;
        }
        .object-related-record strong {
          font-weight:700;
        }
      `}</style>
    </div>
  );
}