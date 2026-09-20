/*
 * REGRESSION: marketing route table must never reference an undefined
 * component. Run with: node --test tests/marketingRoutes.test.mjs
 *
 * ROOT CAUSE (regressed here):
 *   src/routes.jsx used <LoginGate element={<OfflineQueueDebug />} /> on the
 *   /offline-queue diagnostics route, but LoginGate was never defined or
 *   imported anywhere in the repo. Vite left it as a bare global identifier
 *   in the marketing bundle, so rendering /offline-queue threw
 *   "Uncaught ReferenceError: LoginGate is not defined", React unmounted the
 *   whole tree and the Android WebView showed a white screen.
 *
 * This test statically parses src/routes.jsx and asserts that every
 * capitalized JSX component identifier is either imported or declared in
 * that file — the exact failure mode above is caught before build time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/routes.jsx", import.meta.url), "utf8");

test("every JSX component used in src/routes.jsx is imported or locally declared", () => {
  /* Components brought in by import statements. */
  const imported = new Set();
  for (const m of source.matchAll(/^import\s+(\w+)[\s,]/gm)) imported.add(m[1]);
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) imported.add(name);
    }
  }

  /* Components declared in the file itself. */
  const declared = new Set();
  for (const m of source.matchAll(/function\s+([A-Z]\w*)/g)) declared.add(m[1]);
  for (const m of source.matchAll(/(?:const|let|var)\s+([A-Z]\w*)\s*=/g)) declared.add(m[1]);

  const known = new Set([...imported, ...declared]);

  /* Capitalized JSX element openings: <Component or <Component ... */
  const used = new Set();
  for (const m of source.matchAll(/<([A-Z]\w*)[\s/>]/g)) used.add(m[1]);

  const unresolved = [...used].filter((name) => !known.has(name));
  assert.deepEqual(
    unresolved,
    [],
    `unresolved JSX components in src/routes.jsx (would become bare globals ` +
      `in the Vite bundle and throw ReferenceError at runtime): ${unresolved.join(", ")}`
  );
});

test("LoginGate (the undefined component that caused the Android white screen) is gone", () => {
  assert.equal(source.includes("LoginGate"), false);
});

test("the diagnostics route still renders OfflineQueueDebug and marketing paths survive", () => {
  assert.match(source, /path="offline-queue"\s+element=\{<OfflineQueueDebug\s*\/>\}/);
  for (const path of ["/", "/pos", "/inventory", "/faq"]) {
    assert.ok(
      source.includes(`"${path.slice(1) || "index"}"`) || path === "/",
      `marketing route ${path} must remain in the route table`
    );
  }
  assert.match(source, /export function MarketingRoutes/);
});
