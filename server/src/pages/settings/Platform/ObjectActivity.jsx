import React from "react";

export default function ObjectActivity({
  activities = [],
  title = "Activity",
}) {
  return (
    <section className="object-activity">
      <h3>{title}</h3>

      {activities.length === 0 ? (
        <div className="object-activity-empty">
          No activity available.
        </div>
      ) : (
        <div className="object-activity-list">
          {activities.map((activity, index) => (
            <div className="object-activity-item" key={activity.id ?? index}>
              <strong>
                {activity.title ?? activity.type ?? "Activity"}
              </strong>
              <span>
                {activity.description ?? activity.message ?? ""}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`
        .object-activity h3 {
          margin:0 0 10px;
          font-size:12px;
          color:#111827;
        }
        .object-activity-empty {
          padding:14px;
          border:1px solid #e5e7eb;
          border-radius:6px;
          color:#6b7280;
          font-size:10px;
        }
        .object-activity-list {
          display:flex;
          flex-direction:column;
          gap:7px;
        }
        .object-activity-item {
          display:flex;
          flex-direction:column;
          gap:3px;
          padding:9px;
          border:1px solid #e5e7eb;
          border-radius:6px;
        }
        .object-activity-item strong {
          color:#374151;
          font-size:10px;
        }
        .object-activity-item span {
          color:#6b7280;
          font-size:9px;
        }
      `}</style>
    </section>
  );
}