import React from "react";

export default function ObjectSaveBar({
  onSave,
  onCancel,
  saving = false,
  disabled = false,
}) {
  return (
    <div className="object-save-bar">
      <div />
      <div className="object-save-actions">
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        ) : null}

        {onSave ? (
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        ) : null}
      </div>

      <style>{`
        .object-save-bar {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 0;
        }
        .object-save-actions {
          display:flex;
          gap:7px;
        }
        .object-save-actions button {
          height:30px;
          padding:0 12px;
          border:1px solid #d1d5db;
          border-radius:5px;
          background:#fff;
          color:#374151;
          font-size:10px;
          cursor:pointer;
        }
        .object-save-actions button:last-child {
          background:#111827;
          color:#fff;
          border-color:#111827;
        }
        .object-save-actions button:disabled {
          opacity:.5;
          cursor:not-allowed;
        }
      `}</style>
    </div>
  );
}