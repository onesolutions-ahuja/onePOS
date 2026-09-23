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
        <div className={`object-layout-item object-layout-width-${String(component?.width || "full").replace("/", "-")}`}>
          {typeof renderComponent === "function"
            ? renderComponent(component, context)
            : null}
        </div>
      </React.Fragment>
    ));

  return (
    <div className="object-layout-renderer">
      {sections
        ? sections.filter((section) => section?.visible !== false).map((section, sectionIndex) => {
          const items = Array.isArray(section.items)
            ? section.items
            : Array.isArray(section.components)
              ? section.components
              : components.filter((item) => item?.section_id === section.id);
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
                    <style>{`
                      .object-layout-columns { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
                      .object-layout-column { display:contents; }
                      .object-layout-item { min-width:0; }
                      .object-layout-width-full { grid-column:span 4; }
                      .object-layout-width-1-2 { grid-column:span 2; }
                      .object-layout-width-1-3,.object-layout-width-1-4 { grid-column:span 1; }
                      .object-layout-width-2-3 { grid-column:span 3; }
                      @media (max-width: 700px) {
                        .object-layout-columns { grid-template-columns:1fr; }
                        .object-layout-item { grid-column:span 1; }
                      }
                    `}</style>
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
