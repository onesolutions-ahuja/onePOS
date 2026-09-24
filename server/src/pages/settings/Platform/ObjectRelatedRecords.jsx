import React from "react";

export default function ObjectRelatedRecords({
  records = [],
  title = "Related Records",
  renderRecord,
  emptyMessage = "No related records.",
}) {
  return (
    <section className="object-related-records">
      {title ? <h3>{title}</h3> : null}

      {!records.length ? (
        <div className="object-related-records-empty">
          {emptyMessage}
        </div>
      ) : (
        <div className="object-related-records-list">
          {records.map((record, index) => (
            <React.Fragment key={record?.id ?? record?._id ?? index}>
              {renderRecord ? renderRecord(record, index) : (
                <div>{JSON.stringify(record)}</div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
