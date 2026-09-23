import React from "react";

export default function ObjectFormHeader({
  title,
  description,
  actions,
}) {
  return (
    <div className="object-form-header">
      <div>
        {title ? <h2>{title}</h2> : null}
        {description ? <p>{description}</p> : null}
      </div>

      {actions ? (
        <div className="object-form-header-actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
