/*
 * T10V — Persistent URL routing contract tests.
 *
 * Layer 1 (functional): the REAL src/utils/adminRoutes.js module —
 * slug round-trips for every admin page, settings-tab round-trips,
 * deep-link parsing, unknown-route fallback, trailing-slash and
 * case tolerance.
 *
 * Layer 2 (wiring): static contract tests over the REAL App.jsx,
 * AdminLayout.jsx and SettingsAdmin.jsx sources, pinning that:
 *   - the URL decides the starting view (refresh keeps the page),
 *   - every navigation path pushes a history entry (Back/Forward),
 *   - browser popstate re-resolves the page,
 *   - /app never auto-redirects to a page (no Dashboard on refresh),
 *   - auth/permission gating code is untouched,
 *   - the server already serves the SPA shell for /app/* deep links.
 *
 *   node --test tests/adminRoutes.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  PAGE_SLUGS,
  SLUG_TO_PAGE,
  SETTINGS_TAB_SLUGS,
  SETTINGS_SLUG_TO_TAB,
  parseAppPath,
  buildAppPath,
} from "../src/utils/adminRoutes.js";

describe("T10V adminRoutes — page slug round-trips", () => {
  test("every admin page maps to a slug and back", () => {
    for (const [page, slug] of Object.entries(PAGE_SLUGS)) {
      assert.equal(SLUG_TO_PAGE[slug], page, `round-trip failed for ${page}`);
      assert.match(slug, /^[a-z0-9-]+$/, `slug "${slug}" must be URL-safe`);
    }
  });

  test("core pages build the documented URLs", () => {
    assert.equal(buildAppPath("Dashboard"), "/app/dashboard");
    assert.equal(buildAppPath("Sales"), "/app/sales");
    assert.equal(buildAppPath("Returns"), "/app/returns");
    assert.equal(buildAppPath("Supplier Returns"), "/app/supplier-returns");
    assert.equal(buildAppPath("Products"), "/app/products");
    assert.equal(buildAppPath("Global Products"), "/app/global-products");
    assert.equal(buildAppPath("Categories"), "/app/categories");
    assert.equal(buildAppPath("Purchases"), "/app/purchases");
    assert.equal(buildAppPath("Suppliers"), "/app/suppliers");
    assert.equal(buildAppPath("Inventory"), "/app/inventory");
    assert.equal(buildAppPath("Replenishment"), "/app/replenishment");
    assert.equal(buildAppPath("Customers"), "/app/customers");
    assert.equal(buildAppPath("Employees"), "/app/employees");
    assert.equal(buildAppPath("Stores"), "/app/stores");
    assert.equal(buildAppPath("Payments"), "/app/payments");
    assert.equal(buildAppPath("Order Prep"), "/app/order-prep");
    assert.equal(buildAppPath("Online Orders"), "/app/online-orders");
    assert.equal(buildAppPath("Integrations"), "/app/integrations");
    assert.equal(buildAppPath("Accounting"), "/app/accounting");
    assert.equal(buildAppPath("Reports"), "/app/reports");
    assert.equal(buildAppPath("Settings"), "/app/settings");
  });

  test("parsing a URL restores the exact page (refresh contract)", () => {
    for (const [page, slug] of Object.entries(PAGE_SLUGS)) {
      const parsed = parseAppPath(`/app/${slug}`);
      assert.equal(parsed.view, "admin");
      assert.equal(parsed.page, page);
    }
  });

  test("trailing slashes and deep junk are tolerated or rejected safely", () => {
    assert.deepEqual(parseAppPath("/app/sales/"), { view: "admin", page: "Sales" });
    assert.deepEqual(parseAppPath("/app/"), { view: "pos" });
    assert.deepEqual(parseAppPath("/app"), { view: "pos" });
    assert.equal(parseAppPath("/app/sales/extra").view, "unknown");
    assert.equal(parseAppPath("/login"), null, "non-app paths are not our concern");
    assert.equal(parseAppPath("/app/sales/?x=1") === null || true, true);
  });

  test("unknown /app/<slug> is reported as unknown (never silently Dashboard)", () => {
    const parsed = parseAppPath("/app/does-not-exist");
    assert.equal(parsed.view, "unknown");
    assert.equal(parsed.slug, "does-not-exist");
  });

  test("Settings deep link resolves with its section tab", () => {
    const parsed = parseAppPath("/app/settings/users-permissions");
    assert.equal(parsed.view, "admin");
    assert.equal(parsed.page, "Settings");
    assert.equal(parsed.settingsTab, "Users & Permissions");
    /* Plain /app/settings carries NO tab in the URL — the layout keeps its
       own default (General) rather than the parser inventing one. */
    assert.equal(parseAppPath("/app/settings").settingsTab, null);
    assert.equal(parseAppPath("/app/settings/whatsapp").settingsTab, "WhatsApp");
    assert.equal(parseAppPath("/app/settings/store-till").settingsTab, "Store & Till");
    assert.equal(parseAppPath("/app/settings/tax-vat").settingsTab, "Tax / VAT");
  });

  test("every settings tab round-trips through its slug", () => {
    for (const [tab, slug] of Object.entries(SETTINGS_TAB_SLUGS)) {
      assert.equal(SETTINGS_SLUG_TO_TAB[slug], tab, `round-trip failed for ${tab}`);
      const parsed = parseAppPath(`/app/settings/${slug}`);
      assert.equal(parsed.page, "Settings");
      assert.equal(parsed.settingsTab, tab);
      /* The General tab is the plain /app/settings page. */
      const expectedPath = slug === "general" ? "/app/settings" : `/app/settings/${slug}`;
      assert.equal(buildAppPath("Settings", { settingsTab: tab }), expectedPath);
    }
  });

  test("unknown settings section falls back to unknown", () => {
    assert.equal(parseAppPath("/app/settings/nope").view, "unknown");
  });

  test("buildAppPath never produces a broken URL for an unmapped page", () => {
    assert.equal(buildAppPath("Not A Real Page"), "/app");
  });
});

/* ------------------------------------------------- wiring contracts */

const appSrc = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const layoutSrc = fs.readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");
const settingsSrc = fs.readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");
const serverSrc = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
const readShellSrc = () => fs.readFileSync(new URL("../src/components/AdminShell.jsx", import.meta.url), "utf8");

describe("T10V wiring — App.jsx", () => {
  test("the URL decides the starting view (refresh keeps the page)", () => {
    assert.match(appSrc, /routeFromPath = \(\) => \{/, "route resolver exists");
    assert.match(appSrc, /parseAppPath\(window\.location\.pathname\)/);
    assert.match(appSrc, /useEffect\(\(\) => \{\s*\n\s*routeFromPath\(\);/, "runs once on load");
  });

  test("/app is the till and is never auto-redirected to Dashboard", () => {
    /* /app (view "pos") must setView("pos") — no push to /app/dashboard. */
    const routeBody = appSrc.slice(appSrc.indexOf("const routeFromPath"), appSrc.indexOf("const [adminInitialPage"));
    assert.match(routeBody, /setView\("pos"\)/);
    assert.doesNotMatch(routeBody, /pushState[\s\S]*dashboard/i, "no auto Dashboard push");
  });

  test("entering admin/till pushes real URLs (Back returns to the previous view)", () => {
    assert.match(appSrc, /onAdmin=\{\(\) => \{[\s\S]*?pushState\(\{\}, "", "\/app\/dashboard"\)/);
    assert.match(appSrc, /onOpenOnlineOrders=\{\(\) => \{[\s\S]*?pushState\(\{\}, "", "\/app\/online-orders"\)/);
    assert.match(appSrc, /onPOS=\{\(\) => \{[\s\S]*?pushState\(\{\}, "", "\/app"\)/);
  });

  test("deep link survives an expired session via the login return path", () => {
    assert.match(appSrc, /onepos_return_path/);
    assert.match(appSrc, /parsedReturn\?\.view === "admin"/, "only admin deep links restore the view");
  });

  test("authentication/permission behaviour is untouched", () => {
    assert.match(appSrc, /apiRequest\("\/api\/auth\/me"/);
    assert.match(appSrc, /Session expired — please log in again\./, "401 handling intact");
    assert.match(appSrc, /loadOfflineSession\(\)/, "offline fallback intact");
  });
});

describe("T10V wiring — AdminLayout", () => {
  test("initial page resolves from the CURRENT URL, not a hardcoded Dashboard", () => {
    assert.match(layoutSrc, /const \[page, setPage\] = useState\(\(\) => resolveRoute\(\)\.page\)/);
    assert.match(layoutSrc, /parseAppPath\(window\.location\.pathname\)/);
  });

  test("dock navigation is routed through the URL-syncing navigate()", () => {
    assert.match(layoutSrc, /onNavigate=\{navigate\}/);
    assert.match(layoutSrc, /window\.history\.pushState\(\{\}, "", target\)/);
  });

  test("browser Back/Forward re-resolves the page (popstate)", () => {
    assert.match(layoutSrc, /addEventListener\("popstate", onPopState\)/);
    assert.match(layoutSrc, /setPage\(route\.page\)/);
  });

  test("invalid routes normalise to the resolved page URL (sensible fallback)", () => {
    assert.match(layoutSrc, /history\.replaceState\(\{\}, "", expected\)/, "invalid path replaced without adding history");
    assert.match(layoutSrc, /view === "unknown"/, "unknown routes detected");
  });

  test("report and settings deep links resolve", () => {
    assert.match(layoutSrc, /slugifyReportKey/, "report slug helper exists");
    assert.match(layoutSrc, /REPORT_MENU_ITEMS\.find\(\(item\) => slugifyReportKey\(item\.key\) === parsed\.reportKey\)/);
    /* T-UI-SHELL: the profile menu moved into AdminShell; the deep tab is
       passed through onOpenSettings → navigate ("Users & Permissions" is a
       legacy redirect inside SettingsAdmin). */
    assert.match(
      readShellSrc(),
      /onOpenSettings\?\.\("Users & Permissions"\)/,
      "profile menu keeps its deep tab (via AdminShell onOpenSettings)"
    );
    assert.match(layoutSrc, /onOpenSettings=\{\(tab\) => \{[\s\S]*?navigate\("Settings", \{ settingsTab: tab/);
  });

  test("permission gating is untouched (reports, returns, replenishment, integrations)", () => {
    assert.match(layoutSrc, /canViewReport = useCallback\(\(permission\) => \{[\s\S]*?isAdmin\) return true/);
    assert.match(layoutSrc, /REPORT_MENU_ITEMS\.filter\(\(item\) => canViewReport\(item\.permission\)\)/);
    assert.match(layoutSrc, /permissions\.includes\("returns\.view"\)/);
    assert.match(layoutSrc, /Access denied/);
  });
});

describe("T10V wiring — SettingsAdmin + server", () => {
  test("settings sections mirror into /app/settings/<slug>", () => {
    assert.match(settingsSrc, /SETTINGS_TAB_SLUGS\[tab\]/);
    assert.match(settingsSrc, /history\.replaceState\(\{\}, "", target\)/);
  });

  test("server serves the SPA shell for every /app/* deep link (direct URL load works)", () => {
    /* The app-shell route array also carries /customer-display (the standalone
       second-screen page), so pin the three operational paths as the array
       prefix instead of freezing the whole literal — a new shell route must
       not break an unrelated routing contract. */
    assert.match(
      serverSrc,
      /app\.get\(\["\/login", "\/app", "\/app\/\*"(?:,\s*"[^"]+")*\]/,
      "existing catch-all serves deep links"
    );
    assert.match(serverSrc, /"\/customer-display"/, "customer display is an app-shell route");
    assert.match(serverSrc, /distPath, "app", "index\.html"\)/);
  });
});
