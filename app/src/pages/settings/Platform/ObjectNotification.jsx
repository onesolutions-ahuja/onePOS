import React from "react";

export default function ObjectNotification({
  type = "info",
  message,
  onClose,
}) {
  if (!message) return null;

  return (
    <div className={`object-notification object-notification-${type}`}>
      <span>{message}</span>

      {onClose ? (
        <button type="button" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  );
}
