import React from "react";

export default function ObjectPageRenderer({
  layout,
  components = {},
  context = {},
  renderComponent,
}) {
  const definition =
    layout?.components ??
    layout?.definition ??
    layout;

  if (!definition) return null;

  const items = Array.isArray(definition)
    ? definition
    : Array.isArray(definition?.components)
      ? definition.components
      : [];

  return (
    <div className="object-page-renderer">
      {items.map((component, index) => {
        if (renderComponent) {
          return (
            <React.Fragment key={component.id ?? index}>
              {renderComponent(component, context)}
            </React.Fragment>
          );
        }

        const type =
          component.type ??
          component.component ??
          "unknown";

        return (
          <div
            key={component.id ?? index}
            className="object-page-renderer-placeholder"
          >
            {type}
          </div>
        );
      })}

      <style>{`
        .object-page-renderer {
          display:flex;
          flex-direction:column;
          gap:12px;
          width:100%;
        }
        .object-page-renderer-placeholder {
          padding:12px;
          border:1px dashed #d1d5db;
          border-radius:6px;
          color:#6b7280;
          font-size:10px;
        }
      `}</style>
    </div>
  );
}