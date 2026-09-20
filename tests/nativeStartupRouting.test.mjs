/*
 * REGRESSION: native Android startup must route to the operational app.
 * Run with: node --test tests/nativeStartupRouting.test.mjs
 *
 * ROOT CAUSE (regressed here):
 *   Capacitor's webDir is "dist", so the Android WebView opens
 *   dist/index.html at "/", whose Vite entry is src/marketing-main.jsx.
 *   Nothing in the startup path distinguished the native shell from a
 *   browser visiting the public homepage, so the Android app booted into
 *   the marketing website instead of onePOS login -> POS.
 *
 * The fix branches the marketing entry on the existing isNativeApp()
 * helper (services/serverAddress.js — the same module that owns the
 * configurable Server Address feature, so no backend URL is hard-coded):
 * on native it lazily imports and renders the operational App component
 * (the same one the /app web entry uses); on web it renders the marketing
 * router exactly as before.
 *
 * These tests are static pins on that contract (the entry module touches
 * `document` on import, so it cannot be executed under plain Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = fs.readFileSync(path.join(root, "src", "marketing-main.jsx"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const capacitorConfig = JSON.parse(
  fs.readFileSync(path.join(root, "capacitor.config.json"), "utf8")
);

test("the marketing entry branches on the Capacitor shell before rendering anything", () => {
  assert.match(entry, /import\s*\{\s*isNativeApp\s*\}\s*from\s*"\.\/services\/serverAddress\.js"/);
  assert.match(entry, /if\s*\(\s*isNativeApp\(\)\s*\)/);
  /* The native branch must come first and guard ALL rendering. */
  assert.ok(
    entry.indexOf("if (isNativeApp())") < entry.indexOf("ReactDOM.createRoot"),
    "the native check must run before any ReactDOM.createRoot call"
  );
});

test("native startup renders the operational App (login -> auth -> POS), not marketing", () => {
  const nativeBranch = entry.slice(
    entry.indexOf("if (isNativeApp())"),
    entry.indexOf("} else {")
  );
  assert.match(nativeBranch, /import\("\.\/App\.jsx"\)/);
  assert.match(nativeBranch, /<App\s*\/>/);
  assert.doesNotMatch(nativeBranch, /MarketingRoutes|BrowserRouter|marketing/i,
    "no marketing UI may mount inside the native shell");
  /* The App component itself must be the /app entry's component. */
  const appEntry = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
  assert.match(appEntry, /import App from "\.\/App"/);
});

test("web behaviour is preserved: browsers still get the marketing site", () => {
  const webBranch = entry.slice(entry.indexOf("} else {"));
  assert.match(webBranch, /<MarketingRoutes\s*\/>/);
  assert.match(webBranch, /<BrowserRouter>/);
  /* index.html stays the marketing entry for the web, served by Express at /. */
  assert.match(indexHtml, /\/src\/marketing-main\.jsx/);
  /* The web branch must NOT depend on any server-address value. */
  assert.doesNotMatch(webBranch, /https?:\/\//, "no hard-coded backend URL in the web branch");
});

test("no hard-coded backend URL and the Server Address feature stays in charge", () => {
  assert.doesNotMatch(entry, /https?:\/\/(?!fonts\.googleapis|fonts\.gstatic)\S+/,
    "the startup routing must not hard-code a backend origin");
  const serverAddress = fs.readFileSync(path.join(root, "src", "services", "serverAddress.js"), "utf8");
  assert.match(serverAddress, /export function isNativeApp/);
  assert.match(serverAddress, /SERVER_ADDRESS_KEY\s*=\s*"onepos_server_address"/);
});

test("Capacitor still serves the dist bundle that contains the routing branch", () => {
  assert.equal(capacitorConfig.webDir, "dist");
  /* app/index.html remains the untouched /app web entry. */
  const appHtml = fs.readFileSync(path.join(root, "app", "index.html"), "utf8");
  assert.match(appHtml, /\/src\/main\.jsx/);
});
