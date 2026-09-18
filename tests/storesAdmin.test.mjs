/*
 * T10A-SMALL - Stores / multi-store admin wiring audit
 *
 * Focused, database-free checks for the Stores page fix:
 *   - a successful 200 with [] keeps the CRUD entry points (never blank);
 *   - the Add/Edit form is the single existing T10A modal (no second one);
 *   - deletion is soft only (archive via the existing `active` flag), and the
 *     backend exposes no store DELETE route;
 *   - store routes stay company-scoped and the browser never sends a company id;
 *   - the UI gates actions on the existing permission model (backend authority).
 *
 * Run: node --test tests/storesAdmin.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Normalise CRLF so the source assertions below stay platform independent. */
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const page = read("src/pages/stores/StoresAdmin.jsx");
const routes = read("routes/admin.js");

test("T10A-SMALL: zero stores renders the empty state, not a blank page", () => {
  assert.match(page, /stores\.length === 0 \?/);
  assert.match(page, /title="No stores yet"/);
  assert.match(page, /Create your first store to start managing your locations\./);
});

test("T10A-SMALL: empty state and header both open the CRUD form", () => {
  /* Header entry point (always available to permitted users). */
  assert.match(page, /<Plus size=\{16\} \/> Add store/);
  /* Empty-state entry point opens the same handler as the header. */
  assert.match(page, /\+ Add Store/);
  const emptyState = page.slice(page.indexOf("title=\"No stores yet\""));
  assert.match(emptyState, /onClick=\{openAdd\}/);
});

test("T10A-SMALL: a single Add/Edit store form is used (no second modal)", () => {
  const formCount = (page.match(/<form /g) || []).length;
  assert.equal(formCount, 1, "expected exactly one store form");
  assert.match(page, /CardHeader title=\{editingStore \? "Edit store" : "Add new store"\}/);
  /* The same handler creates (POST) and updates (PUT). */
  assert.match(page, /apiRequest\("\/api\/admin\/stores", \{ method: "POST"/);
  assert.match(page, /apiRequest\(`\/api\/admin\/stores\/\$\{editingId\}`, \{\n\s+method: "PUT"/);
});

test("T10A-SMALL: archiving is a soft delete - no physical store delete", () => {
  /* Frontend: archive is a PUT of the active flag, never an HTTP DELETE. */
  assert.ok(!/method: "DELETE"/.test(page), "frontend must not issue DELETE requests");
  assert.match(page, /const handleArchive = async \(store\) => \{[\s\S]*?setStoreActive\(store, false\)/);
  /* The archive payload keeps the existing record fields (name included) so a
     soft delete can never blank out the stored store. */
  const activateFn = page.slice(page.indexOf("const setStoreActive"), page.indexOf("const handleArchive"));
  assert.match(activateFn, /method: "PUT"/);
  assert.match(activateFn, /name: store\.name \|\| ""/);
  assert.match(activateFn, /active,/);
  /* Archived stores leave the active list but stay restorable. */
  assert.match(page, /const activeStores = stores\.filter\(isActive\)/);
  assert.match(page, /setStoreActive\(store, true\)/);
});

test("T10A-SMALL: backend keeps store records and exposes no DELETE route", () => {
  assert.ok(!/DELETE\s+FROM\s+stores/i.test(routes), "stores must never be physically deleted");
  assert.ok(!/router\.delete\(\s*["'`]\/admin\/stores/.test(routes), "no store DELETE route");
  /* Deactivation reuses the existing columns. */
  assert.match(routes, /UPDATE stores SET name=\$1[\s\S]*?active=\$7/);
});

test("T10A-SMALL: store routes are company-scoped and the UI never sends a company id", () => {
  assert.match(routes, /router\.get\("\/admin\/stores", authenticate/);
  assert.match(routes, /WHERE s\.company_id=\$1/);
  assert.match(routes, /WHERE id=\$8 AND company_id=\$9/);
  assert.ok(!/companyId|company_id/.test(page), "company scope must come from the session only");
});

test("T10A-SMALL: actions follow the existing permission model", () => {
  /* Same session permission source as the sidebar / Order Prep / Reports. */
  assert.match(page, /apiRequest\("\/api\/auth\/me\/permissions"\)/);
  assert.match(page, /setCanManage\(data\.data\?\.isAdmin === true\)/);
  assert.match(page, /\{canManage \? \(\s*<Button onClick=\{openAdd\}/);
  assert.match(page, /\{canManage \? \(\n\s+<div className="px-4 py-3 border-t/);
});

test("T10A-SMALL: API failure keeps the error state with Retry", () => {
  assert.match(page, /if \(error && stores\.length === 0\)/);
  assert.match(page, /Unable to load stores/);
  assert.match(page, /<Button onClick=\{loadStores\} className="mt-5">Retry<\/Button>/);
  /* A 401/403 is a permission answer, not a network failure: no Retry loop. */
  assert.match(page, /if \(err\.status === 401 \|\| err\.status === 403\) setForbidden\(true\)/);
  assert.match(page, /\{forbidden \? null : \(\s*<Button onClick=\{loadStores\} className="mt-5">Retry<\/Button>/);
});
