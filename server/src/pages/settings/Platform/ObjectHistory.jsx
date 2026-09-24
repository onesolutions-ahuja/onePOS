import React from "react";

export default function ObjectHistory({
  items = [],
  title = "History",
}) {
  return (
    <section className="object-history">
      <h3>{title}</h3>

      {items.length === 0 ? (
        <div className="object-history-empty">No history available.</div>
      ) : (
        <div className="object-history-list">
          {items.map((item, index) => (
            <div className="object-history-item" key={item.id ?? index}>
              <div className="object-history-main">
                <strong>{item.title ?? item.action ?? "Change"}</strong>
                {item.description ? <span>{item.description}</span> : null}
              </div>
              {item.date || item.createdAt ? (
                <time>{item.date ?? item.createdAt}</time>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <style>{`
        .object-history h3 {
          margin:0 0 10px;
          font-size:12px;
          color:#111827;
        }
        .object-history-empty {
          padding:14px;
          color:#6b7280;
          font-size:10px;
          border:1px solid #e5e7eb;
          border-radius:6px;
        }
        .object-history-list {
          display:flex;
          flex-direction:column;
          gap:7px;
        }
        .object-history-item {
          display:flex;
          justify-content:space-between;
          gap:12px;
          padding:9px;
          border:1px solid #e5e7eb;
          border-radius:6px;
        }
        .object-history-main {
          display:flex;
          flex-direction:column;
          gap:3px;
        }
        .object-history-main strong {
          font-size:10px;
          color:#374151;
        }
        .object-history-main span,
        .object-history-item time {
          font-size:9px;
          color:#6b7280;
        }
      `}</style>
    </section>
  );
}