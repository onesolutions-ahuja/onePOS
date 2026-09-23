import React from "react";

export default function ObjectFormSection({
  title,
  description,
  children,
  columns = 1,
}) {
  return (
    <section className="object-form-section">
      {(title || description) ? (
        <div className="object-form-section-header">
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}

      <div
        className="object-form-section-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
          gap: 12,
        }}
      >
        {children}
      </div>
    </section>
  );
}
