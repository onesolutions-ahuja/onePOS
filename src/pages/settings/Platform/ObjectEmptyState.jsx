import React from "react";

export default function ObjectEmptyState({
  title = "No records found",
  message = "There is nothing to display.",
  action,
}) {
  return (
    <div className="object-empty-state">
      <div className="object-empty-icon">○</div>
      <div className="object-empty-title">{title}</div>
      <div className="object-empty-message">{message}</div>
      {action ? <div className="object-empty-action">{action}</div> : null}

      <style>{`
        .object-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 180px;
          padding: 24px;
          box-sizing: border-box;
          text-align: center;
        }

        .object-empty-icon {
          width: 34px;
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 10px;
          border: 1px solid #d1d5db;
          border-radius: 50%;
          color: #9ca3af;
          font-size: 18px;
        }

        .object-empty-title {
          color: #374151;
          font-size: 12px;
          font-weight: 700;
        }

        .object-empty-message {
          max-width: 420px;
          margin-top: 5px;
          color: #6b7280;
          font-size: 10px;
        }

        .object-empty-action {
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}