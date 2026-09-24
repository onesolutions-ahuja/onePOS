import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_COMPONENTS, componentForFieldType, getPlatformComponent, validateComponentRegistry } from "../services/platformComponentRegistry.js";

test("component registry has unique canonical component keys", () => {
  const validation = validateComponentRegistry();
  assert.equal(validation.valid, true);
  assert.ok(validation.count >= 17);
});

test("existing platform field controls map to canonical components", () => {
  assert.equal(componentForFieldType("text").key, "text_input");
  assert.equal(componentForFieldType("decimal").key, "currency");
  assert.equal(componentForFieldType("boolean").key, "checkbox");
  assert.equal(componentForFieldType("select").key, "picklist");
  assert.equal(componentForFieldType("lookup").key, "lookup");
});

test("custom button is reserved in the same registry", () => {
  const button = getPlatformComponent("button");
  assert.equal(button?.kind, "action");
  assert.equal(button?.reserved, true);
  assert.ok(PLATFORM_COMPONENTS.some((component) => component.key === "related_list"));
});
