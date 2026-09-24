import React from "react";

export default function ObjectFieldGroup({
  title,
  description,
  children,
  columns = 1,
}) {
  return (
    <section className="object-field-group">
      {(title || description) && (
        <div className="object-field-group-header">
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
        </div>
      )}

      <div
        className="object-field-group-grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
        }}
      >
        {children}
      </div>

      <style>{`
        .object-field-group {
          width: 100%;
          box-sizing: border-box;
        }

        .object-field-group-header {
          margin-bottom: 12px;
        }

        .object-field-group-header h3 {
          margin: 0;
          color: #111827;
          font-size: 13px;
          font-weight: 700;
        }

        .object-field-group-header p {
          margin: 4px 0 0;
          color: #6b7280;
          font-size: 10px;
        }

        .object-field-group-grid {
          display: grid;
          gap: 12px;
          width: 100%;
        }
      `}</style>
    </section>
  );
}