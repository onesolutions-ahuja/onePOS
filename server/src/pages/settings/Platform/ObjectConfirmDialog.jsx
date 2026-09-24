import React from "react";

export default function ObjectConfirmDialog({
  open = false,
  title = "Confirm",
  message,
  children,
  onConfirm,
  onCancel,
  confirming = false,
  confirmLabel = "Confirm",
}) {
  if (!open) return null;

  return (
    <div className="object-confirm-dialog">
      <div className="object-confirm-dialog-content">
        <h3>{title}</h3>

        {message ? <p>{message}</p> : null}

        {children}

        <div className="object-confirm-dialog-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
