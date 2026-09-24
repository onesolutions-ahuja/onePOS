import React from "react";

export default function ObjectRelatedList({
  title = "Related Records",
  records = [],
  renderItem,
  emptyMessage = "No related records.",
}) {
  return (
    <section className="object-related-list">
      <h3>{title}</h3>

      {records.length === 0 ? (
        <div className="object-related-empty">
          {emptyMessage}
        </div>
      ) : (
        <div className="object-related-items">
          {records.map((record, index) => (
            <div key={record.id ?? index}>
              {renderItem
                ? renderItem(record, index)
                : String(record.name ?? record.id ?? record)}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .object-related-list h3 {
          margin:0 0 9px;
          color:#111827;
          font-size:12px;
        }
        .object-related-empty {
          padding:12px;
          border:1px solid #e5e7eb;
          border-radius:6px;
          color:#6b7280;
          font-size:10px;
        }
        .object-related-items {
          display:flex;
          flex-direction:column;
          gap:7px;
        }
      `}</style>
    </section>
  );
}