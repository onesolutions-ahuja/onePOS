/*
 * Reports sidebar navigation contract (T10B-SMALL).
 *
 * The Admin sidebar must surface a Reports entry that:
 *  - exists in the nav with its own icon,
 *  - expands to the Overview page + every REPORT_MENU_ITEMS entry,
 *  - respects the existing granular permission model (no broad report.view),
 *  - keeps Administrator/Admin/Owner bypass behaviour,
 *  - hides the whole section when the user has no accessible report.
 *
 * Static contract test over AdminLayout.jsx source (verified through the
 * build for JSX syntax; this file pins the wiring, not the styling).
 *
 *   node --test tests/reportsSidebar.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = fs.readFileSync(
  new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url),
  "utf8"
);
const MENU = fs.readFileSync(
  new URL("../src/pages/reports/ReportPage.jsx", import.meta.url),
  "utf8"
);
const CATALOGUE = fs.readFileSync(
  new URL("../src/utils/navCatalogue.js", import.meta.url),
  "utf8"
);

test("Reports entry exists in the Admin sidebar items list", () => {
  /* The floating dock replaced the left sidebar; the ONE page catalogue
     (utils/navCatalogue.js) owns the Reports nav entry with its icon. */
  assert.match(CATALOGUE, /\["Reports",\s*BarChart3\]/, "nav items must include Reports with its icon");
});

test("every granular report carries a reports.* permission (no broad report.view)", () => {
  const match = MENU.match(/export const REPORT_MENU_ITEMS = \[([\s\S]*?)\];/);
  assert.ok(match, "REPORT_MENU_ITEMS must be exported from ReportPage.jsx");
  assert.ok(!match[1].includes('"report.view"'), "broad report.view must not be introduced");
  const perms = [...match[1].matchAll(/permission:\s*(\[[^\]]*\]|"[^"]+")/g)].map((m) => m[1]);
  assert.ok(perms.length >= 9, "all granular reports keep their permission codes");
  for (const p of perms) {
    assert.match(p, /reports\.[a-z_]+\.view|inventory\.movements\.view/, `permission ${p} must be a granular code`);
  }
});

test("submenu is built from REPORT_MENU_ITEMS and filtered per permission", () => {
  assert.match(SRC, /REPORT_MENU_ITEMS\.filter\(\(item\) => canViewReport\(item\.permission\)\)/,
    "visible submenu items must be permission-filtered");
  /* The dock navigation receives the same filtered list (floating dock replaced
   * the left sidebar; the guarantee is unchanged). */
  const DOCK = fs.readFileSync(
    new URL("../src/components/AdminNavDock.jsx", import.meta.url),
    "utf8"
  );
  assert.match(DOCK, /reportItems/, "the dock must render the permission-filtered report items");
  assert.match(SRC, /reportItems=\{canViewReports \?/, "AdminLayout gates the report items behind canViewReports");
});

test("Administrator/Admin/Owner bypass is preserved", () => {
  assert.match(SRC, /canViewReport = useCallback\(\(permission\) => \{[\s\S]*?isAdmin\) return true/,
    "isAdmin bypass inside canViewReport");
  assert.match(SRC, /onlinePermissions\.isAdmin \|\|[\s\S]*?canViewReports/,
    "isAdmin contributes to section visibility");
});

test("users with at least one reports.* permission can discover Reports", () => {
  assert.match(SRC, /code\)\s*=>\s*code\.startsWith\("reports\."\)/,
    "any granular reports.* code grants discoverability");
});

test("users with no accessible reports get no report items (section hidden)", () => {
  /* Sidebar era: the map skipped the section. Dock era: canViewReports=false
   * passes an EMPTY reportItems list AND Reports drops out of the nav items
   * only when the user cannot see any report (canViewReports drives both). */
  assert.match(SRC, /canViewReports \?\s*\(canViewOverview/, "report items are gated behind canViewReports");
  const DOCK = fs.readFileSync(
    new URL("../src/components/AdminNavDock.jsx", import.meta.url),
    "utf8"
  );
  assert.match(DOCK, /visibleReports\.length > 0/, "dock renders the Reports group only when items exist");
});

test("each submenu item opens its own report page behind the same permission", () => {
  assert.match(SRC, /REPORT_MENU_ITEMS\.some\(\(item\) => item\.key === page\)/,
    "report keys route to the report page renderer");
  assert.match(SRC, /canViewReport\(REPORT_MENU_ITEMS\.find\(\(item\) => item\.key === page\)\?\.permission\)/,
    "direct navigation to a report is permission-checked");
});

/*
 * Regression (T10B-SMALL): the permissions endpoint the sidebar depends on
 * must exist in server.js. AdminLayout calls GET /api/auth/me/permissions;
 * when it 404s, onlinePermissions stays {isAdmin:false, permissions:[]} and
 * EVERY permission-gated sidebar entry (Reports, Returns, Order Prep,
 * Integrations, Accounting) silently disappears — even for Administrators.
 */
const SERVER = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("GET /api/auth/me/permissions exists and feeds the sidebar permission model", () => {
  assert.ok(SERVER.includes('"/api/auth/me/permissions"'),
    "the endpoint must be registered in server.js (the AdminLayout fetch target)");
  assert.match(SRC, /apiRequest\("\/api\/auth\/me\/permissions"\)/,
    "AdminLayout must consume the endpoint");
});

test("permissions endpoint mirrors the authorize() model exactly", () => {
  const endpoint = SERVER.slice(SERVER.indexOf('"/api/auth/me/permissions"'));
  assert.match(endpoint, /authenticate/, "must require authentication");
  assert.match(endpoint, /canViewCompanyCustomers\(req\.user\)/,
    "admin bypass must use the SAME DB-verified helper as authorize() — never raw JWT claims");
  assert.match(endpoint, /getRolePermissionCodes\(req\.user\.roleId\)/,
    "non-admin codes must come from the SAME role_permissions source as authorize()");
});
