import React from "react";

export default function ObjectDetailHeader({
  title,
  subtitle,
  actions,
}) {
  return (
    <div className="object-detail-header">
      <div className="object-detail-title">
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>

      {actions ? (
        <div className="object-detail-actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
