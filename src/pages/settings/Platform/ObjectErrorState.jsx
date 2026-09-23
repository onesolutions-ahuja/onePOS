import React from "react";

export default function ObjectErrorState({
  title = "Unable to load data",
  message = "An unexpected error occurred.",
  error,
  onRetry,
}) {
  const detail =
    message ||
    error?.message ||
    "An unexpected error occurred.";

  return (
    <div className="object-error-state">
      <div className="object-error-title">{title}</div>
      <div className="object-error-message">{detail}</div>

      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}

      <style>{`
        .object-error-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 160px;
          padding: 24px;
          text-align: center;
        }

        .object-error-title {
          color: #991b1b;
          font-size: 12px;
          font-weight: 700;
        }

        .object-error-message {
          max-width: 500px;
          margin-top: 6px;
          color: #6b7280;
          font-size: 10px;
        }

        .object-error-state button {
          margin-top: 12px;
          height: 30px;
          padding: 0 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          color: #374151;
          font-size: 10px;
          cursor: pointer;
        }

        .object-error-state button:hover {
          background: #f9fafb;
        }
      `}</style>
    </div>
  );
}