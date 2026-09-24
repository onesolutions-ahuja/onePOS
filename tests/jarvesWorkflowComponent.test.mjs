import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WORKFLOW_ACTION_MAP } from "../services/platformWorkflow.js";
import { getPlatformComponent } from "../services/platformComponentRegistry.js";

test("JARVES is a registered platform component with three behaviours and three interaction modes", () => {
  const component = getPlatformComponent("jarves");
  assert.ok(component);
  assert.deepEqual(component.behaviours, ["behaviour_1", "behaviour_2", "behaviour_3"]);
  assert.deepEqual(component.interactions, ["voice", "message", "ask_input"]);
});

test("JARVES workflow action emits a UI directive and pauses for input", async () => {
  const action = WORKFLOW_ACTION_MAP.get("JARVES_INTERACTION");
  assert.ok(action);
  const result = await action.executor({ action: { behaviour: "behaviour_2", interaction: "ask_input", content: "Enter reason", responseVariable: "$flow.reason" } });
  assert.equal(result.status, "awaiting_input");
  assert.equal(result.uiDirective.component, "jarves");
  assert.equal(result.uiDirective.responseVariable, "$flow.reason");
});

test("all three JARVES media slots default to the existing project video and stay independently replaceable", () => {
  const source = fs.readFileSync(new URL("../src/components/jarvis/JarvesMedia.jsx", import.meta.url), "utf8");
  for (const key of ["behaviour_1", "behaviour_2", "behaviour_3"]) assert.match(source, new RegExp(`${key}: "/jarves\\.mp4"`));
  assert.match(source, /sources\?\.\[safeBehaviour\]/);
  assert.doesNotMatch(source, /transform:|rotate\(|scale\(/);
});
