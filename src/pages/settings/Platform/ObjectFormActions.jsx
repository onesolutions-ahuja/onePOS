import React from "react";

export default function ObjectFormActions({
  onSave,
  onCancel,
  saving = false,
  disabled = false,
  saveLabel = "Save",
  cancelLabel = "Cancel",
}) {
  return (
    <div className="object-form-actions">
      <div className="object-form-actions-left" />

      <div className="object-form-actions-right">
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
          >
            {cancelLabel}
          </button>
        ) : null}

        {onSave ? (
          <button
            type="button"
            className="primary"
            onClick={onSave}
            disabled={disabled || saving}
          >
            {saving ? "Saving..." : saveLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
