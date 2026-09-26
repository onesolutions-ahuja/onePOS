import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * COMPONENT REGISTRY screen — presentation contract.
 *
 * The screen is the ONE browsable map of the platform component vocabulary:
 * category navigation + search + cards + detail. It changes no registration,
 * stores nothing, and reads everything through the shared registry helpers so
 * it stays loosely coupled to the server contract.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const screen = read("src/pages/settings/Platform/ComponentRegistryAdmin.jsx");
const shared = read("src/pages/settings/Platform/componentRegistry.js");
const nav = read("src/pages/settings/Platform/platformNav.js");
const admin = read("src/pages/settings/PlatformAdmin.jsx");

test("the Component Registry surface is registered once in the global Platform rail", () => {
  assert.match(nav, /key: "component-registry", label: "Component Registry", view: "component-registry"/);
  assert.equal((nav.match(/component-registry/g) || []).length >= 3, true, "nav + view mapping + surface key");
  assert.match(admin, /ComponentRegistryAdmin/);
  assert.match(admin, /view === "component-registry"/);
});

test("the screen browses ONE shared registry — no private component list", () => {
  assert.match(screen, /useComponentRegistry/);
  assert.match(screen, /componentIcon/);
  assert.match(screen, /componentCategoryLabel/);
  assert.match(screen, /normalizedRegistry/);
  assert.doesNotMatch(screen, /key: "(section|text_input|kpi)"/, "no duplicated vocabulary");
});

test("search and category navigation cover label, API name and category", () => {
  assert.match(screen, /aria-label="Search components"/);
  assert.match(screen, /aria-label="Component categories"/);
  assert.match(screen, /component\.label\.toLowerCase\(\)\.includes\(needle\)/);
  assert.match(screen, /component\.key\.toLowerCase\(\)\.includes\(needle\)/);
});

test("the friendly category vocabulary never leaks snake_case", () => {
  assert.match(shared, /layout: "Layout"/);
  assert.match(shared, /dashboard: "Dashboard"/);
  assert.match(shared, /COMPONENT_CATEGORY_LABELS\[category\] \|\| "Other"/);
});

test("cards and detail expose consistent icon, label and accessible state", () => {
  assert.match(screen, /role="listitem"/);
  assert.match(screen, /aria-pressed=\{active\}/);
  assert.match(screen, /selected\.label\} details/);
  assert.match(screen, /data-testid="component-registry"/);
});

test("phone widths collapse to a single column with a wrapping category rail", () => {
  assert.match(screen, /@media \(max-width: 768px\)/);
  assert.match(screen, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(screen, /flex-direction: row; flex-wrap: wrap/);
});
