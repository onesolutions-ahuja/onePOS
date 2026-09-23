import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toSafeApiName, withGeneratedApiName } from "../src/pages/settings/Platform/safeApiName.js";

const objectEditorSource = readFileSync(new URL("../src/pages/settings/Platform/ObjectEditor.jsx", import.meta.url), "utf8");
const fieldEditorSource = readFileSync(new URL("../src/pages/settings/Platform/FieldEditor.jsx", import.meta.url), "utf8");
const layoutEditorSource = readFileSync(new URL("../src/pages/settings/Platform/LayoutEditor.jsx", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

// Lightest available component-state harness: the repo has no jsdom/React
// Testing Library, so the regression exercises the EXACT production state
// reducer (withGeneratedApiName from safeApiName.js) that ObjectEditor,
// FieldEditor and LayoutEditor execute inside their setForm updaters, with the
// same merge order they use: { ...current, ...patch, [name]: value }.
function createDraftHarness({ labelField, apiNameField, fallback }) {
  let state = { [labelField]: "", [apiNameField]: "" };
  return {
    get state() {
      return state;
    },
    change(field, value, { isNew = true } = {}) {
      state = {
        ...state,
        ...withGeneratedApiName(state, field, value, (label) => toSafeApiName(label, fallback), { labelField, apiNameField, isNew }),
        [field]: value,
      };
    },
  };
}

test("object API key follows the full label while typing (first-character-only regression)", () => {
  const draft = createDraftHarness({ labelField: "name", apiNameField: "object_key", fallback: "object" });

  // Real keystroke progression: every intermediate value must be derived from
  // the complete current label, not only the first character.
  const steps = [
    ["T", "t"],
    ["Te", "te"],
    ["Tes", "tes"],
    ["Test", "test"],
    ["Test ", "test"],
    ["Test v", "test_v"],
    ["Test ve", "test_ve"],
    ["Test veh", "test_veh"],
    ["Test vehi", "test_vehi"],
    ["Test vehic", "test_vehic"],
    ["Test vehicl", "test_vehicl"],
    ["Test vehicle", "test_vehicle"],
  ];
  for (const [label, expectedKey] of steps) {
    draft.change("name", label);
    assert.equal(draft.state.object_key, expectedKey, `label "${label}" must derive "${expectedKey}"`);
  }
  assert.equal(draft.state.name, "Test vehicle");
  assert.equal(draft.state.object_key, "test_vehicle");
});

test("backspacing, corrections and replacements regenerate from the current label before save", () => {
  const draft = createDraftHarness({ labelField: "name", apiNameField: "object_key", fallback: "object" });

  draft.change("name", "Test vehicl");
  assert.equal(draft.state.object_key, "test_vehicl");

  draft.change("name", "Test vehic"); // backspace
  assert.equal(draft.state.object_key, "test_vehic");

  draft.change("name", "Test vehicle"); // correction
  assert.equal(draft.state.object_key, "test_vehicle");

  draft.change("name", "Test Vehicle 2"); // different casing + number
  assert.equal(draft.state.object_key, "test_vehicle_2");

  draft.change("name", "Vehicle Register"); // full replacement
  assert.equal(draft.state.object_key, "vehicle_register");

  draft.change("name", ""); // delete the whole label -> shared helper default
  assert.equal(draft.state.object_key, toSafeApiName("", "object"));
  assert.equal(draft.state.object_key, "object");
});

test("editing an existing object never regenerates the saved API key", () => {
  const draft = createDraftHarness({ labelField: "name", apiNameField: "object_key", fallback: "object" });
  draft.change("name", "Test Vehicle");
  assert.equal(draft.state.object_key, "test_vehicle");

  // After creation the editor runs with isNew=false: label edits (and any other
  // field edit) must leave the stored key untouched.
  draft.change("name", "Vehicle Register", { isNew: false });
  draft.change("description", "Updated description", { isNew: false });

  assert.equal(draft.state.name, "Vehicle Register");
  assert.equal(draft.state.object_key, "test_vehicle");
});

test("field API names follow the full label and stay stable after creation", () => {
  const draft = createDraftHarness({ labelField: "label", apiNameField: "apiName", fallback: "field" });

  draft.change("label", "Credit");
  assert.equal(draft.state.apiName, "credit");

  draft.change("label", "Credit limit");
  assert.equal(draft.state.apiName, "credit_limit");

  draft.change("label", "Credit Limit"); // casing-only correction
  assert.equal(draft.state.apiName, "credit_limit");

  draft.change("label", "Total Due", { isNew: false }); // after the field exists
  assert.equal(draft.state.apiName, "credit_limit");
});

test("layout API keys follow the full label and stay stable after creation", () => {
  const draft = createDraftHarness({ labelField: "name", apiNameField: "layout_key", fallback: "layout" });

  for (const label of ["S", "St", "Sta", "Standard", "Standard Product", "Standard Product Layout"]) {
    draft.change("name", label);
  }
  assert.equal(draft.state.layout_key, "standard_product_layout");

  draft.change("name", "Renamed Layout", { isNew: false });
  assert.equal(draft.state.layout_key, "standard_product_layout");
});

test("all three editors wire the shared derivation and keep the API-key input read-only", () => {
  // ObjectEditor: shared helper with its own isNew (edit mode must be stable).
  assert.match(objectEditorSource, /import \{ toSafeApiName, withGeneratedApiName \} from "\.\/safeApiName\.js"/);
  assert.match(objectEditorSource, /withGeneratedApiName\(current, name, value[\s\S]{0,80}toSafeApiName\(label, "object"\)[\s\S]{0,20}\{ isNew \}\)/);
  assert.match(objectEditorSource, /const isNew = !object\?\.id && !object\?\.object_id/);
  assert.match(objectEditorSource, /<input[\s\S]*?readOnly[\s\S]*?placeholder="customer"/);
  assert.doesNotMatch(objectEditorSource, /!current\.object_key/);

  // FieldEditor: same shared helper with its field-specific wiring.
  assert.match(fieldEditorSource, /withGeneratedApiName\(current, name, value[\s\S]{0,40}\{ labelField: "label", apiNameField: "apiName", isNew \}\)/);
  assert.match(fieldEditorSource, /value=\{form\.apiName \|\| ""\}[\s\S]*?readOnly/);
  assert.doesNotMatch(fieldEditorSource, /!current\.apiName/);

  // LayoutEditor: same shared helper for the layout key.
  assert.match(layoutEditorSource, /withGeneratedApiName\(current, name, value[\s\S]{0,120}\{ apiNameField: "layout_key", isNew \}\)/);
  assert.doesNotMatch(layoutEditorSource, /name === "name" && isNew/);
});

test("object create backend stays authoritative: safe keys, derivation, duplicate 409", () => {
  // Independent derivation remains in place (used whenever no key is supplied).
  assert.match(routesSource, /const objectKey = req\.body\.objectKey \|\| toSafeApiName\(label, "object"\)/);
  // Safe-identifier validation is not weakened.
  assert.match(routesSource, /isSafeIdentifier\(body\.objectKey\)/);
  // Duplicates are rejected with a clear conflict; no silent _2/_3 suffixing.
  assert.match(routesSource, /error\.code === "23505"\) return res\.status\(409\)\.json\(\{ success: false, message: "An object with this key already exists" \}\)/);
  assert.doesNotMatch(routesSource, /objectKey[^\n]*\+ 1|objectKey[^\n]*suffix/i);
});

