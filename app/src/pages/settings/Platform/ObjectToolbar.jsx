import React from "react";

export default function ObjectToolbar({
  title,
  description,
  left,
  right,
}) {
  return (
    <div className="object-toolbar">
      <div className="object-toolbar-main">
        {left}

        <div>
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </div>
      </div>

      {right ? (
        <div className="object-toolbar-right">
          {right}
        </div>
      ) : null}
    </div>
  );
}