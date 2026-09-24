import React from "react";

export default function ObjectComponentRenderer({
  component,
  context = {},
  renderComponent,
}) {
  if (!component) return null;

  if (typeof renderComponent === "function") {
    return renderComponent(component, context);
  }

  if (typeof component === "function") {
    const Component = component;
    return <Component {...context} />;
  }

  if (React.isValidElement(component)) {
    return component;
  }

  return null;
}
