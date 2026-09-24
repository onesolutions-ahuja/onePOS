import React from "react";

export default function ObjectRecordActions({
  actions = [],
  record,
  onAction,
}) {
  if (!actions.length) return null;

  return (
    <div className="object-record-actions">
      {actions.map((action, index) => (
        <button
          key={action?.key ?? action?.id ?? index}
          type="button"
          onClick={() => onAction?.(action, record)}
          disabled={Boolean(action?.disabled)}
        >
          {action?.label ?? action?.name ?? "Action"}
        </button>
      ))}
    </div>
  );
}
