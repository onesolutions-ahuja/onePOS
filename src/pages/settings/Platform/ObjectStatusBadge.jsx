import React from "react";

export default function ObjectStatusBadge({
  active,
  label,
}) {
  const text =
    label ??
    (active ? "Active" : "Inactive");

  return (
    <span
      className={`object-status-badge ${
        active ? "active" : "inactive"
      }`}
    >
      {text}
    </span>
  );
}
