import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const runtime = fs.readFileSync(new URL("../src/components/CustomPageRuntime.jsx", import.meta.url), "utf8");
test("global onePOS theme exposes shared macOS-inspired motion and control primitives", () => {
  for (const token of ["--onepos-motion-fast", "--onepos-motion-normal", "--onepos-motion-ease", ".onepos-control", ".onepos-overlay-panel", ".onepos-page-enter"]) assert.ok(css.includes(token), token);
  assert.match(css, /prefers-reduced-motion/);
});
test("custom page runtime uses canonical component registry keys", () => {
  for (const key of ["text_input", "datetime", "button", "picklist", "lookup"]) assert.ok(runtime.includes(`\"${key}\"`), key);
  assert.ok(!runtime.includes('key === "custom_button"'));
  assert.ok(!runtime.includes('key === "date_time"'));
});


test("macOS category icon palette and spring motion are shared and reduced-motion safe", () => {
  for (const token of [
    "--onepos-spring",
    "settings-category-icon[data-icon-tone=\"blue\"]",
    "settings-category-icon[data-icon-tone=\"orange\"]",
    "settings-category-icon[data-icon-tone=\"green\"]",
    "onepos-macos-sheet-in",
    "prefers-reduced-motion: reduce",
  ]) assert.ok(css.includes(token), token);
  assert.ok(css.includes('-apple-system, BlinkMacSystemFont, "SF Pro Text"'), "system font stack must prefer macOS system typography");
});
