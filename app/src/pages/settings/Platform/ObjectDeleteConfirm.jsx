import React from "react";

export default function ObjectDeleteConfirm({
  open = false,
  title = "Delete record?",
  message = "This action cannot be undone.",
  onConfirm,
  onCancel,
  deleting = false,
}) {
  if (!open) return null;

  return (
    <div className="object-delete-confirm">
      <div className="object-delete-confirm-dialog">
        <h3>{title}</h3>
        <p>{message}</p>

        <div className="object-delete-confirm-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
