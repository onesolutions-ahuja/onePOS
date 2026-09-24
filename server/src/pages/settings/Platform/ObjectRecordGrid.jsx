import React from "react";

export default function ObjectRecordGrid({
  records = [],
  renderRecord,
  emptyMessage = "No records found.",
}) {
  if (!records.length) {
    return <div className="object-record-grid-empty">{emptyMessage}</div>;
  }

  return (
    <div
      className="object-record-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      {records.map((record, index) => (
        <React.Fragment key={record?.id ?? record?._id ?? index}>
          {renderRecord ? renderRecord(record, index) : (
            <div className="object-record-grid-item">
              {JSON.stringify(record)}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
