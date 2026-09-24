import React from "react";

export default function ObjectListHeader({
  title,
  description,
  actions,
}) {
  return (
    <div className="object-list-header">
      <div>
        {title ? <h2>{title}</h2> : null}
        {description ? <p>{description}</p> : null}
      </div>

      {actions ? (
        <div className="object-list-header-actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
