import React from "react";

export default function ObjectDetailSection({
  title,
  description,
  children,
}) {
  return (
    <section className="object-detail-section">
      {(title || description) ? (
        <div className="object-detail-section-header">
          {title ? <h3>{title}</h3> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}

      <div className="object-detail-section-content">
        {children}
      </div>
    </section>
  );
}
