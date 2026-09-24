import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as platformConditions from "../services/platformConditions.js";
import { toSafeApiName } from "../src/pages/settings/Platform/safeApiName.js";

const require = createRequire(import.meta.url);
function component(file, dependencies = {}) {
  const source = readFileSync(new URL(`../src/pages/settings/Platform/${file}.jsx`, import.meta.url), "utf8");
  const { code } = transformSync(source, { loader: "jsx", format: "cjs" });
  const module = { exports: {} };
  runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name] || (name === "react" ? require(name) : { apiRequest: () => { throw new Error("Unexpected API call during render"); } }) });
  return module.exports.default;
}

test("rule editor round-trips stored validation action, trigger, conditions and message", () => {
  const Editor = component("RuleEditor");
  const html = renderToStaticMarkup(React.createElement(Editor, {
    objects: [{ id: "object-a", label: "Sample" }],
    rule: { id: "rule-a", object_id: "object-a", name: "Positive", trigger_key: "before_update", active: true,
      action: { type: "validation", message: "Enter a positive amount", match: "any" },
      conditions: [{ field: "amount", operator: "less_than", value: "0" }] },
  }));
  assert.match(html, /value="validation" selected=""/);
  assert.match(html, /value="before_update" selected=""/);
  assert.match(html, /value="any" selected=""/);
  assert.match(html, /Enter a positive amount/);
  assert.doesNotMatch(html, /<span>API Key<\/span>/);
  assert.doesNotMatch(html, /value="after_create"/);
});

test("formula editor renders saved expression and hides physical column mapping", () => {
  const Editor = component("FieldEditor");
  const html = renderToStaticMarkup(React.createElement(Editor, {
    object: { id: "object-a", label: "Sample" },
    field: { id: "formula-id", label: "Total", api_name: "total", field_type: "formula", config: { expression: "price * quantity", resultType: "currency" } },
  }));
  assert.match(html, /price \* quantity/);
  assert.match(html, /value="currency" selected=""/);
  assert.doesNotMatch(html, /Existing Database Column/);
});

const hookReact = { ...React, useState: initial => [typeof initial === "function" ? initial() : initial, () => {}], useMemo: fn => fn(), useEffect: () => {} };

test("formula values render as output and are excluded from submitted record data", async () => {
  const Form = component("ObjectForm", { react: hookReact, "../../../../../server/services/platformConditions.js": platformConditions });
  let saved;
  const props = { fields: [{ api_name: "price", field_type: "decimal" }, { api_name: "total", field_type: "formula" }], initialValues: { price: 2, total: 10 }, onSubmit: values => { saved = values; } };
  const html = renderToStaticMarkup(React.createElement(Form, props));
  assert.match(html, /<output[^>]*>10<\/output>/);
  assert.doesNotMatch(html, /<input[^>]*name="total"/);
  await Form(props).props.onSubmit({ preventDefault() {} });
  assert.equal(saved.price, 2);
  assert.equal(Object.hasOwn(saved, "total"), false);
});

test("formula editor submits expression config and forces derived fields read-only", async () => {
  let sent;
  const Editor = component("FieldEditor", { react: hookReact, "../../../services/api.js": { apiRequest: async (url, options) => { sent = JSON.parse(options.body); return { data: {} }; } } });
  const element = Editor({ object: { id: "object-a" }, field: { id: "field-a", label: "Total", api_name: "total", field_type: "formula", source_column: "old_column", required: true, config: { expression: "price * 2", resultType: "currency", preserved: true } } });
  function findForm(node) {
    if (node?.type === "form") return node;
    for (const child of React.Children.toArray(node?.props?.children)) { const result = findForm(child); if (result) return result; }
    return null;
  }
  await findForm(element).props.onSubmit({ preventDefault() {} });
  assert.equal(sent.fieldType, "formula"); assert.equal(sent.sourceColumn, null);
  assert.equal(sent.required, false); assert.equal(sent.writable, false);
  assert.deepEqual(sent.config, { expression: "price * 2", resultType: "currency", preserved: true });
});

test("new formula fields keep the generated API name read-only", () => {
  const source = readFileSync(new URL("../src/pages/settings/Platform/FieldEditor.jsx", import.meta.url), "utf8");
  assert.match(source, /value=\{form\.apiName \|\| ""\}[\s\S]*?readOnly/);
});

test("new picklist option values regenerate across label keystrokes", () => {
  const states = [];
  const statefulReact = {
    ...React,
    useState: initial => {
      const index = states.length;
      let value = typeof initial === "function" ? initial() : initial;
      states.push(value);
      return [value, next => {
        value = typeof next === "function" ? next(value) : next;
        states[index] = value;
      }];
    },
    useEffect: () => {},
  };
  const Editor = component("FieldEditor", { react: statefulReact, "./safeApiName.js": { toSafeApiName } });
  const element = Editor({
    object: { id: "object-a" },
    field: { id: "field-a", label: "Status", api_name: "status", field_type: "picklist",
      options: [{ id: "new-option", label: "", value: "", active: true }] },
  });
  function findInput(node) {
    if (node?.props?.placeholder === "In Progress") return node;
    for (const child of React.Children.toArray(node?.props?.children)) {
      const result = findInput(child);
      if (result) return result;
    }
    return null;
  }
  const input = findInput(element);
  for (const label of ["I", "In", "In ", "In P", "In Pr", "In Pro", "In Prog", "In Progr", "In Progre", "In Progres", "In Progress"]) {
    input.props.onChange({ target: { value: label } });
  }
  assert.equal(states[0].options[0].value, "in_progress");
});

test("ObjectForm renders metadata-driven conditions without object-specific logic", () => {
  const source = readFileSync(new URL("../src/pages/settings/Platform/ObjectForm.jsx", import.meta.url), "utf8");
  assert.match(source, /evaluateFieldCondition/);
  assert.match(source, /visibilityCondition/);
  assert.match(source, /requiredCondition/);
  assert.match(source, /visibleFields/);
});

test("new rule editor defaults to validation on both create and update", () => {
  const Editor = component("RuleEditor");
  const html = renderToStaticMarkup(React.createElement(Editor));
  assert.match(html, /value="before_save" selected=""/);
  assert.match(html, /value="validation" selected=""/);
  assert.match(html, /Error message shown when save is blocked/);
});

test("record form renders server validation feedback accessibly without losing values", () => {
  const Form = component("ObjectForm", { "../../../../../server/services/platformConditions.js": platformConditions });
  const html = renderToStaticMarkup(React.createElement(Form, {
    fields: [{ api_name: "amount", label: "Amount", field_type: "decimal", active: true }],
    initialValues: { amount: -5 }, error: "Amount must not be negative", onSubmit: () => {},
  }));
  assert.match(html, /role="alert">Amount must not be negative/);
  assert.match(html, /value="-5"/);
});
