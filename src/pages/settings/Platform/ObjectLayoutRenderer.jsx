import React from "react";

export default function ObjectLayoutRenderer({
  layout,
  context = {},
  renderComponent,
}) {
  if (!layout) return null;

  const components = Array.isArray(layout)
    ? layout
    : Array.isArray(layout.components)
      ? layout.components
      : [];
  const sections = !Array.isArray(layout) && Array.isArray(layout.sections)
    ? [...layout.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : null;

  const renderItems = (items, sectionKey = "flat") => (items || [])
    .filter((component) => component?.visible !== false)
    .map((component, index) => (
      <React.Fragment key={component?.id ?? `${sectionKey}-${index}`}>
        {typeof renderComponent === "function"
          ? renderComponent(component, context)
          : null}
      </React.Fragment>
    ));

  return (
    <div className="object-layout-renderer">
      {sections
        ? sections.filter((section) => section?.visible !== false).map((section, sectionIndex) => {
          const items = Array.isArray(section.items)
            ? section.items
            : Array.isArray(section.components) ? section.components : [];
          const columns = Number(section.columns) === 2 ? 2 : 1;
          const columnItems = columns === 2
            ? [
              items.filter((item, index) => item?.column === 1 || (item?.column !== 2 && index % 2 === 0)),
              items.filter((item, index) => item?.column === 2 || (item?.column !== 1 && index % 2 === 1)),
            ]
            : [items];
          return (
            <section key={section.id ?? sectionIndex} className="object-layout-section">
              {section.label ? <h3>{section.label}</h3> : null}
              <div className={`object-layout-columns columns-${columns}`}>
                {columnItems.map((column, columnIndex) => (
                  <div key={columnIndex} className="object-layout-column">
                    {renderItems(column, `${sectionIndex}-${columnIndex}`)}
                  </div>
                ))}
              </div>
            </section>
          );
        })
        : renderItems(components)}
    </div>
  );
}
