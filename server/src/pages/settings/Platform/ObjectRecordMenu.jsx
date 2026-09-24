import React from "react";

export default function ObjectRecordMenu({
  record,
  items = [],
  onSelect,
}) {
  if (!items.length) return null;

  return (
    <div className="object-record-menu">
      {items.map((item, index) => (
        <button
          key={item?.key ?? item?.id ?? index}
          type="button"
          disabled={Boolean(item?.disabled)}
          onClick={() => onSelect?.(item, record)}
        >
          {item?.label ?? item?.name ?? "Action"}
        </button>
      ))}
    </div>
  );
}
