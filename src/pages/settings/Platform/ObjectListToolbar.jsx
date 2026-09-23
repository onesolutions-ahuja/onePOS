import React from "react";

export default function ObjectListToolbar({
  left,
  right,
  children,
}) {
  return (
    <div className="object-list-toolbar">
      <div className="object-list-toolbar-left">
        {left}
        {children}
      </div>

      {right ? (
        <div className="object-list-toolbar-right">
          {right}
        </div>
      ) : null}
    </div>
  );
}
