/*
 * onePOS — Platform Superadmin runtime access.
 *
 *   node --test tests/superadminRuntimeAccess.test.mjs
 *
 * Pins the fix for "Platform Superadmin only sees Business Divisions / Audit
 * Log / Licensing". Root cause: /api/platform/runtime/app-catalog required an
 * active company package installation AND a licence entitlement, so the
 * operator's own company (which has neither) produced an EMPTY catalogue and
 * the navigation filter then removed every module-mapped page.
 *
 * The rule now lives in ONE place (services/authorization.js) and is exercised
 * here directly, plus end-to-end through the real router with a fake db.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import {
  companyAdministrativeAccess,
  isPlatformSuperadmin,
  moduleRuntimeAccess,
  permissionAllows,
  MODULE_ACCESS_REASONS,
} from "../services/authorization.js";
import { resolveLandingPage, canAccessDestination, permittedCatalogEntries } from "../services/runtimeAccess.js";
import createPlatformRouter from "../routes/platform.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const AUTHORIZATION_SRC = read("../services/authorization.js");
const PLATFORM_SRC = read("../routes/platform.js");
const SERVER_SRC = read("../server.js");
const RUNTIME_ACCESS_SRC = read("../services/runtimeAccess.js");
const LAYOUT_SRC = read("../src/pages/admin/AdminLayout.jsx");
const ADMIN_ROUTER_SRC = read("../routes/admin.js");
const CUSTOMERS_ROUTER_SRC = read("../routes/customers.js");

/* The canAccessStore body: from its definition to the first closing brace at
   column 0 (the helper's own end), so ordering of surrounding helpers in
   server.js cannot affect the slice. */
const CAN_ACCESS_STORE_SRC = SERVER_SRC.match(/async function canAccessStore\(user, storeId\) \{[\s\S]*?\n\}/)[0];

/* ------------------------------------------------- 1. the shared predicate */

describe("1. Platform Superadmin detection is one shared rule", () => {
  test("accepts the DB column and the API field, and nothing else", () => {
    assert.equal(isPlatformSuperadmin({ is_superadmin: true }), true);
    assert.equal(isPlatformSuperadmin({ isSuperadmin: true }), true);
    assert.equal(isPlatformSuperadmin({ is_superadmin: false }), false);
    assert.equal(isPlatformSuperadmin({ isAdmin: true }), false, "a company admin is NOT a superadmin");
    assert.equal(isPlatformSuperadmin({}), false);
    assert.equal(isPlatformSuperadmin(null), false);
    assert.equal(isPlatformSuperadmin("true"), false, "a truthy string is not a superadmin");
    assert.equal(isPlatformSuperadmin(undefined), false);
  });

  test("a company Admin is never promoted to Superadmin", () => {
    assert.equal(isPlatformSuperadmin({ isAdmin: true, roleId: "role-admin" }), false);
  });

  test("the rule is defined once and reused", () => {
    assert.match(AUTHORIZATION_SRC, /export function isPlatformSuperadmin/);
    for (const [name, src] of [["server.js", SERVER_SRC], ["runtimeAccess.js", RUNTIME_ACCESS_SRC]]) {
      assert.match(src, /isPlatformSuperadmin/, `${name} should use the shared predicate`);
    }
  });
});

/* -------------------------------------------- 2. the runtime module gates */

describe("2. moduleRuntimeAccess reflects the intended Superadmin rule", () => {
  const entitled = { packageInstalled: true, licensed: true, permitted: true };

  test("an ordinary user needs BOTH entitlement gates", () => {
    assert.equal(moduleRuntimeAccess(entitled).allowed, true);
    assert.equal(moduleRuntimeAccess({ ...entitled, packageInstalled: false }).allowed, false);
    assert.equal(moduleRuntimeAccess({ ...entitled, licensed: false }).allowed, false);
    assert.equal(moduleRuntimeAccess({ ...entitled, permitted: false }).allowed, false);
    assert.equal(moduleRuntimeAccess({}).allowed, false);
  });

  test("an unlicensed company never behaves as licensed for ordinary users", () => {
    const decision = moduleRuntimeAccess({ packageInstalled: true, licensed: false, permitted: true });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, MODULE_ACCESS_REASONS.NOT_LICENSED);
  });

  test("Superadmin bypasses the entitlement gates (management capability)", () => {
    const decision = moduleRuntimeAccess({ packageInstalled: false, licensed: false, permitted: true, isSuperadmin: true });
    assert.equal(decision.allowed, true, "the operator's own company has no package/licence rows");
    assert.equal(decision.reason, MODULE_ACCESS_REASONS.ALLOWED_SUPERADMIN);
  });

  test("Superadmin is still bound by the permission model", () => {
    assert.equal(moduleRuntimeAccess({ permitted: false, isSuperadmin: true }).allowed, false);
  });

  test("company module activation is honoured for EVERY caller, Superadmin included", () => {
    const decision = moduleRuntimeAccess({
      enabledByCompany: false,
      packageInstalled: true,
      licensed: true,
      permitted: true,
      isSuperadmin: true,
    });
    assert.equal(decision.allowed, false, "a module the company switched off must not reappear as a page");
    assert.equal(decision.reason, MODULE_ACCESS_REASONS.COMPANY_DISABLED);
  });

  test("the three gates are not collapsed into one boolean", () => {
    assert.match(AUTHORIZATION_SRC, /enabledByCompany/);
    assert.match(AUTHORIZATION_SRC, /packageInstalled/);
    assert.match(AUTHORIZATION_SRC, /licensed/);
    assert.match(AUTHORIZATION_SRC, /permitted/);
  });
});

/* -------------------------------------- 3. the route agrees with the rule */

/*
 * Fake db matching the runtime catalogue route's four queries. Records the
 * company/store scope used for the module query so tenant scoping is provable.
 */
function createHarness({ isSuperadmin = false, permissions = [], modules = [], licence = null, entitlements = {} }) {
  const calls = [];
  const db = async (sql, params = []) => {
    if (sql.includes("FROM role_permissions")) return { rows: permissions.map((code) => ({ code })) };
    if (sql.startsWith("SELECT is_superadmin")) return { rows: [{ is_superadmin: isSuperadmin }] };
    if (sql.includes("FROM companies c")) {
      return {
        rows: [{
          active: licence?.active ?? false,
          starts_at: licence?.starts_at ?? null,
          expires_at: licence?.expires_at ?? null,
          entitlements: licence?.entitlements ?? entitlements,
        }],
      };
    }
    if (sql.includes("FROM platform_modules m")) {
      calls.push({ scope: params });
      return { rows: modules };
    }
    return { rows: [] };
  };
  return { db, calls };
}

async function requestCatalog(harness, user) {
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db: harness.db,
    authenticate: (req, res, next) => { req.user = user; next(); },
    authorize: () => (req, res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/platform/runtime/app-catalog`);
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/* Modules shaped exactly as the route's SELECT returns them. */
const unentitledModules = [
  { id: "m1", module_key: "retail_pos", name: "POS & Sales", installed: true, company_enabled: null, package_manifest: { entitlementKey: "pos" }, package_status: null },
  { id: "m2", module_key: "products", name: "Products", installed: true, company_enabled: null, package_manifest: { entitlementKey: "inventory" }, package_status: null },
  { id: "m3", module_key: "inventory", name: "Inventory", installed: true, company_enabled: null, package_manifest: { entitlementKey: "inventory" }, package_status: null },
  { id: "m4", module_key: "reports", name: "Reports", installed: true, company_enabled: null, package_manifest: { entitlementKey: "reports" }, package_status: null },
];

describe("3. /platform/runtime/app-catalog", () => {
  const user = { id: "user-a", companyId: "company-a", storeId: null, roleId: "role-a" };

  test("SUPERADMIN with no package installation and no licence still receives the catalogue (root-cause regression)", async () => {
    const harness = createHarness({ isSuperadmin: true, permissions: [], modules: unentitledModules, licence: { active: false } });
    const { status, body } = await requestCatalog(harness, user);
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(
      body.data.map((entry) => entry.module_key).sort(),
      ["inventory", "products", "reports", "retail_pos"],
      "an empty catalogue is what removed every module-mapped nav item",
    );
  });

  test("an ordinary unlicensed user still receives NOTHING", async () => {
    const harness = createHarness({ isSuperadmin: false, permissions: ["sale.view", "inventory.view"], modules: unentitledModules, licence: { active: false } });
    const { body } = await requestCatalog(harness, user);
    assert.deepEqual(body.data, [], "unlicensed companies must not expose modules to ordinary users");
  });

  test("ordinary user regression: licensed + installed + permitted is unchanged", async () => {
    const modules = [{ ...unentitledModules[0], package_status: "active" }];
    const licensed = createHarness({
      isSuperadmin: false, permissions: ["sale.view"], modules,
      licence: { active: true, entitlements: { pos: true } },
    });
    assert.equal((await requestCatalog(licensed, user)).body.data.length, 1);

    const unlicensed = createHarness({
      isSuperadmin: false, permissions: ["sale.view"], modules,
      licence: { active: true, entitlements: { pos: false } },
    });
    assert.equal((await requestCatalog(unlicensed, user)).body.data.length, 0);

    const notPermitted = createHarness({
      isSuperadmin: false, permissions: ["product.view"], modules,
      licence: { active: true, entitlements: { pos: true } },
    });
    assert.equal((await requestCatalog(notPermitted, user)).body.data.length, 0);
  });

  test("a company Admin WITHOUT the superadmin flag stays fully gated", async () => {
    const modules = [{ ...unentitledModules[0], package_status: null }];
    const harness = createHarness({ isSuperadmin: false, permissions: ["sale.view"], modules, licence: { active: true, entitlements: { pos: true } } });
    const { body } = await requestCatalog(harness, user);
    assert.deepEqual(body.data, [], "company Admins remain constrained by package installation");
  });

  test("an explicitly disabled module stays hidden even for Superadmin", async () => {
    const modules = unentitledModules.map((module) =>
      module.module_key === "inventory" ? { ...module, company_enabled: false } : module,
    );
    const harness = createHarness({ isSuperadmin: true, permissions: [], modules, licence: { active: false } });
    const { body } = await requestCatalog(harness, user);
    assert.deepEqual(body.data.map((entry) => entry.module_key).sort(), ["products", "reports", "retail_pos"]);
  });

  test("the catalogue query stays scoped to the caller's company and store", async () => {
    const harness = createHarness({ isSuperadmin: true, permissions: [], modules: unentitledModules, licence: { active: false } });
    await requestCatalog(harness, { ...user, companyId: "company-a", storeId: "store-a" });
    await requestCatalog(harness, { ...user, companyId: "company-b", storeId: null });
    assert.deepEqual(harness.calls[0].scope, ["company-a", "store-a"]);
    assert.deepEqual(harness.calls[1].scope, ["company-b", null], "Company B must never be queried with Company A's scope");
  });

  test("the route consumes the shared rule instead of an inline filter", () => {
    assert.match(PLATFORM_SRC, /import \{ moduleRuntimeAccess \} from "\.\.\/services\/authorization\.js"/);
    assert.match(PLATFORM_SRC, /moduleRuntimeAccess\(\{/);
    const route = PLATFORM_SRC.slice(
      PLATFORM_SRC.indexOf('router.get("/platform/runtime/app-catalog"'),
      PLATFORM_SRC.indexOf("async function getRecordMetadata"),
    );
    assert.doesNotMatch(route, /isSuperadmin \|\| definition\?\.permissions/, "the inline superadmin filter must be gone");
  });
});

/* ------------------------------------------------- 4. route/API agreement */

describe("4. the enforcement layers agree on Superadmin semantics", () => {
  test("authorize() bypasses for Superadmin and stays authoritative for everyone else", () => {
    assert.match(SERVER_SRC, /const isSuperadmin = await isSuperadminRequest\(req\);/);
    assert.match(SERVER_SRC, /if \(isSuperadmin\) \{\s*return next\(\);/);
    assert.match(SERVER_SRC, /permissionAllows\(\{ permissions: codes, requiredPermissions: permissionCodes \}\)/);
  });

  test("the superadmin flag is resolved once per request, not per check", () => {
    assert.match(SERVER_SRC, /if \(user\.__superadminChecked === true\) return user\.__superadmin === true;/);
    assert.match(SERVER_SRC, /user\.__superadminChecked = true;/);
  });

  test("permissions endpoint and route guards use the same resolution", () => {
    const endpoint = SERVER_SRC.slice(
      SERVER_SRC.indexOf('app.get("/api/auth/me/permissions"'),
      SERVER_SRC.indexOf("CURRENT USER UI PREFERENCES"),
    );
    assert.match(endpoint, /const isSuperadmin = await isSuperadminRequest\(req\);/);
    assert.match(endpoint, /const isAdmin = isSuperadmin \|\| await canViewCompanyCustomers\(req\.user\);/);
    assert.match(endpoint, /isSuperadmin,/);
  });

  test("ordinary permissionAllows semantics are untouched", () => {
    assert.equal(permissionAllows({ isSuperadmin: true, permissions: [], requiredPermissions: ["inventory.view"] }), true);
    assert.equal(permissionAllows({ permissions: ["inventory.view"], requiredPermissions: ["inventory.view"] }), true);
    assert.equal(permissionAllows({ permissions: [], requiredPermissions: ["inventory.view"] }), false);
    assert.equal(permissionAllows({ isAdmin: true, permissions: [], requiredPermissions: ["inventory.view"] }), false, "isAdmin is not a global bypass in the shared helper");
  });
});

/* ------------------------------------------------ 5. company/store context */

describe("5. store scoping never crosses the company boundary", () => {
  test("Superadmin store access is verified against the current company", () => {
    assert.match(CAN_ACCESS_STORE_SRC, /if \(await isSuperadminRequest\(\{ user \}\)\)/);
    assert.match(CAN_ACCESS_STORE_SRC, /FROM stores WHERE id=\$1 AND company_id=\$2/);
    assert.match(CAN_ACCESS_STORE_SRC, /\[storeId, user\.companyId\]/, "the store is verified in the caller's company, never assumed");
  });

  test("a missing store id is rejected before any bypass", () => {
    assert.match(CAN_ACCESS_STORE_SRC, /if \(!storeId\) return false;/);
    assert.ok(
      CAN_ACCESS_STORE_SRC.indexOf("if (!storeId) return false;") < CAN_ACCESS_STORE_SRC.indexOf("isSuperadminRequest"),
      "no store is fabricated",
    );
  });

  test("the Admin/Owner bypass and assigned-store fallback are preserved", () => {
    assert.match(CAN_ACCESS_STORE_SRC, /if \(await canViewCompanyCustomers\(user\)\)/);
    assert.match(CAN_ACCESS_STORE_SRC, /return user\.assignedStoreIds\.includes\(storeId\);/);
  });
});

/* ------------------------------------------------------- 6. landing page */

describe("6. Superadmin resolves a valid landing page", () => {
  test("an empty permission set cannot eliminate every candidate", () => {
    assert.equal(
      resolveLandingPage({ enabledModules: new Set(["retail_pos"]), permissions: [], isSuperadmin: true }),
      "/app/dashboard",
      "the platform operator must land somewhere valid",
    );
  });

  test("Superadmin still respects company module activation when resolving", () => {
    assert.equal(
      canAccessDestination("pos", { enabledModules: new Set(), permissions: [], isSuperadmin: true }),
      false,
      "a disabled POS module keeps the POS destination closed",
    );
    assert.equal(
      canAccessDestination("pos", { enabledModules: new Set(["retail_pos"]), permissions: [], isSuperadmin: true }),
      true,
    );
  });

  test("a normal user with no permissions still resolves nothing (unchanged)", () => {
    assert.equal(resolveLandingPage({ enabledModules: new Set(["retail_pos"]), permissions: [] }), null);
  });

  test("an unknown destination is still rejected for Superadmin", () => {
    assert.equal(canAccessDestination("not-a-page", { permissions: [], isSuperadmin: true }), false);
  });

  test("the catalogue helper consults the same rule", () => {
    const entries = permittedCatalogEntries({ enabledModules: new Set(["retail_pos"]), permissions: [], isSuperadmin: true });
    assert.deepEqual(entries.map((entry) => entry.key), ["retail_pos"]);
    assert.deepEqual(permittedCatalogEntries({ enabledModules: new Set(["retail_pos"]), permissions: [] }), []);
  });
});

/* ------------------------------------------------------- 7. JARVIS boundary */

describe("7. JARVIS stays core", () => {
  test("JARVIS is not a catalogue module and gains no licence filter here", () => {
    assert.doesNotMatch(AUTHORIZATION_SRC, /jarvis/i, "the app-visibility rule must not touch JARVIS licensing");
    assert.doesNotMatch(PLATFORM_SRC, /jarvis/i, "the runtime catalogue does not gate JARVIS");
  });
});

/* ------------------------------------------- 8. company-administrative gate */

describe("8. the administrative gate admits Superadmin without widening data scope", () => {
  test("company Administrator/Admin/Owner keeps the gate", () => {
    assert.equal(companyAdministrativeAccess({ isCompanyAdminRole: true }), true);
    assert.equal(companyAdministrativeAccess({ isCompanyAdminRole: false }), false);
  });

  test("a Platform Superadmin holds it without an Administrator role", () => {
    assert.equal(companyAdministrativeAccess({ isCompanyAdminRole: false, isSuperadmin: true }), true);
  });

  test("an ordinary user holds neither", () => {
    assert.equal(companyAdministrativeAccess({}), false);
    assert.equal(companyAdministrativeAccess(), false);
  });

  test("a company Admin is not thereby a Superadmin", () => {
    assert.equal(isPlatformSuperadmin({ isAdmin: true }), false);
    assert.equal(companyAdministrativeAccess({ isCompanyAdminRole: true, isSuperadmin: false }), true);
  });

  test("server.js resolves the gate from both inputs, never a hard-coded true", () => {
    assert.match(SERVER_SRC, /async function hasCompanyAdminAccess\(req\)/);
    assert.match(SERVER_SRC, /isCompanyAdminRole: await canViewCompanyCustomers\(req\.user\)/);
    assert.match(SERVER_SRC, /isSuperadmin: await isSuperadminRequest\(req\)/);
    assert.doesNotMatch(SERVER_SRC, /async function hasCompanyAdminAccess\(req\) \{\s*return true;/);
  });

  test("the gate is wired into the routers that enforce it", () => {
    assert.match(SERVER_SRC, /createAdminRouter\(\{[^}]*hasCompanyAdminAccess/);
    assert.match(SERVER_SRC, /createCustomersRouter\(\{[\s\S]*?hasCompanyAdminAccess/);
    for (const [name, src] of [["admin.js", ADMIN_ROUTER_SRC], ["customers.js", CUSTOMERS_ROUTER_SRC]]) {
      assert.match(src, /hasCompanyAdminAccess = async \(req\) => canViewCompanyCustomers\(req\.user\)/, `${name} must default safely`);
    }
  });

  test("no route still gates on the bare company-admin role check", () => {
    for (const [name, src] of [["admin.js", ADMIN_ROUTER_SRC], ["customers.js", CUSTOMERS_ROUTER_SRC]]) {
      assert.doesNotMatch(
        src,
        /!\(await canViewCompanyCustomers\(req\.user\)\)/,
        `${name} still 403s a Superadmin via the role check`,
      );
    }
  });

  test("data-scope uses of the role check are left alone", () => {
    /* customers.js uses canViewCompanyCustomers for company-wide vs
       store-restricted READS. That must not be widened to Superadmin. */
    assert.equal((CUSTOMERS_ROUTER_SRC.match(/const companyAdmin = await canViewCompanyCustomers\(req\.user\)/g) || []).length >= 5, true);
    assert.doesNotMatch(CUSTOMERS_ROUTER_SRC, /const companyAdmin = await hasCompanyAdminAccess/);
  });

  test("existing callers without the new dependency behave exactly as before", () => {
    /* The factories default the gate to the role check, so a test or caller
       that only supplies canViewCompanyCustomers is unchanged. */
    assert.match(ADMIN_ROUTER_SRC, /hasCompanyAdminAccess = async \(req\) => canViewCompanyCustomers\(req\.user\),/);
    assert.match(CUSTOMERS_ROUTER_SRC, /hasCompanyAdminAccess = async \(req\) => canViewCompanyCustomers\(req\.user\),/);
  });
});

/* ------------------------------------------------------- 9. frontend filter */

describe("9. the navigation filter still only consumes the catalogue", () => {
  test("no page is shown merely because the caller is a Superadmin", () => {
    const filter = LAYOUT_SRC.slice(
      LAYOUT_SRC.indexOf("export function filterNavigationByCatalog"),
      LAYOUT_SRC.indexOf("export default function AdminLayout"),
    );
    assert.doesNotMatch(filter, /isSuperadmin|isAdmin/, "visibility comes from the catalogue, not a role flag");
    assert.match(filter, /return !moduleKey \|\| catalogKeys\.has\(moduleKey\)/);
  });

  test("an unloaded catalogue still renders the permission-filtered items", () => {
    const filter = LAYOUT_SRC.slice(
      LAYOUT_SRC.indexOf("export function filterNavigationByCatalog"),
      LAYOUT_SRC.indexOf("export default function AdminLayout"),
    );
    assert.match(filter, /if \(!\(catalogKeys instanceof Set\)\) return items;/);
  });
});
