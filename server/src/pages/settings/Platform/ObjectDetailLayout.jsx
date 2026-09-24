import React from "react";

export default function ObjectDetailLayout({
  children,
  columns = 1,
  className = "",
}) {
  return (
    <div
      className={`object-detail-layout ${className}`.trim()}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}
