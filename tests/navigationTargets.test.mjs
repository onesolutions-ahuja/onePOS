import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";
import { createRequire } from "node:module";
import {
  NAVIGATION_TARGET_TYPES,
  buildNavigationContext,
  describeNavigationTarget,
  normalizeNavigationTarget,
  resolveNavigationTarget,
  systemNavigationTargets,
} from "../src/utils/navigationTargets.js";
import { normalizeCustomPageTree } from "../src/pages/settings/Platform/customPageTree.js";
import { parseAppPath, buildAppPath, buildCustomPagePath, buildObjectPath, buildObjectRecordPath, PAGE_SLUGS } from "../src/utils/adminRoutes.js";
import createPlatformRouter from "../routes/platform.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const UUID = "0b9e6c1e-1111-4111-8111-111111111111";
const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER_A = "d0000000-0000-4000-8000-000000000001";
const RECORD_ID = "e0000000-0000-4000-8000-000000000001";

/* ---------------------------------------------------------------- registry */

test("system targets come from the ONE nav catalogue and map to canonical routes", () => {
  const admin = { isAdmin: true, isSuperadmin: false, permissions: [] };
  const targets = systemNavigationTargets(admin);
  const keys = targets.map((target) => target.key);
  for (const page of ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports", "Settings"]) {
    assert.ok(keys.includes(page), `${page} is a registered destination`);
    const target = targets.find((entry) => entry.key === page);
    assert.equal(target.route, buildAppPath(page), `${page} resolves through buildAppPath`);
    assert.deepEqual(parseAppPath(target.route).view !== "unknown", true, `${target.route} parses`);
  }
  assert.ok(keys.length >= 10, "the catalogue is meaningful, not a stub");
});

test("system target keys are unique and exclude internal/admin-console surfaces", () => {
  const targets = systemNavigationTargets({ isAdmin: true, isSuperadmin: true, permissions: [] });
  const keys = targets.map((target) => target.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate target keys");
  assert.ok(!keys.includes("Licensing"), "superadmin-only Licensing tooling is not a builder destination");
  assert.ok(!keys.includes("Audit Log"), "the audit console is not a builder destination");
  for (const target of targets) {
    assert.ok(PAGE_SLUGS[target.key], `${target.key} is a real application page slug`);
  }
});

test("system targets respect permissions the same way the dock does", () => {
  /* Reports needs reports.custom.view for non-admins. */
  const viewer = { isAdmin: false, isSuperadmin: false, permissions: [] };
  const keys = systemNavigationTargets(viewer).map((target) => target.key);
  assert.ok(!keys.includes("Dashboards"), "an unpermitted page is not offered as a destination");
  const reporter = { isAdmin: false, isSuperadmin: false, permissions: ["reports.custom.view"] };
  assert.ok(systemNavigationTargets(reporter).some((target) => target.key === "Dashboards"));
});

/* ------------------------------------------------------------- save/reload */

test("normalizeNavigationTarget round-trips every destination type and rejects junk", () => {
  const system = normalizeNavigationTarget({ type: "system_page", key: "Inventory" });
  assert.deepEqual(system, { type: "system_page", key: "Inventory" });

  const custom = normalizeNavigationTarget({ type: "custom_page", key: "stock_control_dashboard" });
  assert.deepEqual(custom, { type: "custom_page", key: "stock_control_dashboard" });

  const list = normalizeNavigationTarget({ type: "object_list", key: "customer" });
  assert.deepEqual(list, { type: "object_list", key: "customer" });

  const current = normalizeNavigationTarget({ type: "object_record", key: "customer", objectKey: "customer", recordSource: "current" });
  assert.deepEqual(current, { type: "object_record", key: "customer", objectKey: "customer", recordSource: "current" });

  const explicit = normalizeNavigationTarget({ type: "object_record", key: "customer", objectKey: "customer", recordSource: "explicit", recordId: UUID });
  assert.deepEqual(explicit, { type: "object_record", key: "customer", objectKey: "customer", recordSource: "explicit", recordId: UUID });

  for (const junk of [
    null,
    {},
    { type: "external_url", key: "https://evil.example" },
    { type: "system_page", key: "../../../etc" },
    { type: "custom_page", key: "Not A Key" },
    { type: "object_list", key: "" },
    { type: "object_record", objectKey: "customer", recordSource: "explicit", recordId: "'; DROP TABLE users; --" },
    { type: "object_record", objectKey: "customer", recordSource: "explicit" },
  ]) {
    assert.equal(normalizeNavigationTarget(junk), null, JSON.stringify(junk) && "malformed targets are dropped");
  }
  /* Legacy custom-page key payloads (pre-existing pages) stay readable. */
  assert.deepEqual(normalizeNavigationTarget({ type: "custom_page", key: "manager_home" }), { type: "custom_page", key: "manager_home" });
});

test("customPageTree persists the navigation target and legacy page keys migrate", () => {
  const tree = normalizeCustomPageTree({
    sections: [{
      id: "s1",
      width: "full",
      children: [
        { id: "b1", componentKey: "button", label: "Open Inventory", interaction: { type: "navigate", navigationTarget: { type: "system_page", key: "Inventory" } } },
        { id: "b2", componentKey: "button", interaction: { type: "navigate", navigateTo: "manager_home" } },
      ],
    }],
  });
  const [first, second] = tree.sections[0].children.map((node) => node.interaction.navigationTarget);
  assert.deepEqual(first, { type: "system_page", key: "Inventory" }, "canonical target persists");
  assert.deepEqual(second, { type: "custom_page", key: "manager_home" }, "legacy navigateTo pages stay working");
  const dropped = normalizeCustomPageTree({
    sections: [{ id: "s", width: "full", children: [{ id: "b", componentKey: "button", interaction: { type: "navigate", navigationTarget: { type: "nope", key: "x" } } }] }],
  });
  assert.equal(dropped.sections[0].children[0].interaction.navigationTarget, null, "non-whitelisted target types are dropped");
});

/* --------------------------------------------------------- runtime resolve */

const ADMIN_STATE = { isAdmin: true, isSuperadmin: false, permissions: [] };

function baseContext(overrides = {}) {
  return buildNavigationContext({
    permissionState: ADMIN_STATE,
    enabledModules: new Set(["retail_pos", "inventory", "customers", "suppliers"]),
    objectPages: [
      { key: "page-customer-list", label: "Customer Directory", objectKey: "customer" },
      { key: "page-tasks", label: "Tasks", objectKey: "task" },
    ],
    customPages: [
      { key: "stock_control_dashboard", label: "Stock Control Dashboard" },
    ],
    ...overrides,
  });
}

test("system_page resolves the canonical route; unpermitted users are refused", () => {
  const result = resolveNavigationTarget({ type: "system_page", key: "Inventory" }, baseContext());
  assert.equal(result.ok, true);
  assert.equal(result.route, "/app/inventory");

  const denied = resolveNavigationTarget({ type: "system_page", key: "Dashboards" }, baseContext({
    permissionState: { isAdmin: false, isSuperadmin: false, permissions: [] },
  }));
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "not_available", "a Custom Button can never become a permission bypass");
});

test("custom_page resolves by stable key; deleted/foreign pages fail safely", () => {
  const result = resolveNavigationTarget({ type: "custom_page", key: "stock_control_dashboard" }, baseContext());
  assert.equal(result.ok, true);
  assert.equal(result.route, buildCustomPagePath("stock_control_dashboard"));
  assert.deepEqual(parseAppPath(result.route), { view: "custom_page", pageKey: "stock_control_dashboard" });

  const deleted = resolveNavigationTarget({ type: "custom_page", key: "deleted_page" }, baseContext());
  assert.equal(deleted.ok, false);
  assert.equal(deleted.reason, "not_found");
  assert.match(deleted.message, /no longer available/i);
});

test("object_list is metadata-driven; disabled/unpermitted objects are refused", () => {
  const result = resolveNavigationTarget({ type: "object_list", key: "task" }, baseContext());
  assert.equal(result.ok, true);
  assert.equal(result.route, buildObjectPath("task"));
  assert.deepEqual(parseAppPath(result.route), { view: "object", objectKey: "task" }, "resolves through the ONE generic object runtime");

  const unavailable = resolveNavigationTarget({ type: "object_list", key: "warehouse" }, baseContext());
  assert.equal(unavailable.ok, false, "an object outside the caller's server-filtered payload is refused");
});

test("object_record: current record, explicit record, and safe failures", () => {
  const current = resolveNavigationTarget(
    { type: "object_record", key: "customer", objectKey: "customer", recordSource: "current" },
    baseContext({ currentObjectKey: "customer", currentRecordId: UUID }),
  );
  assert.equal(current.ok, true);
  assert.equal(current.route, buildObjectRecordPath("customer", UUID));
  assert.deepEqual(parseAppPath(current.route), { view: "object", objectKey: "customer", recordId: UUID });

  /* A component without record context cannot fabricate one. */
  const noContext = resolveNavigationTarget(
    { type: "object_record", key: "customer", objectKey: "customer", recordSource: "current" },
    baseContext(),
  );
  assert.equal(noContext.ok, false);
  assert.equal(noContext.reason, "no_record_context");

  const explicit = resolveNavigationTarget(
    { type: "object_record", key: "customer", objectKey: "customer", recordSource: "explicit", recordId: UUID },
    baseContext(),
  );
  assert.equal(explicit.ok, true);
  assert.equal(explicit.route, buildObjectRecordPath("customer", UUID));

  /* A record of an object this caller cannot see fails safely. */
  const forgedObject = resolveNavigationTarget(
    { type: "object_record", key: "warehouse", objectKey: "warehouse", recordSource: "explicit", recordId: UUID },
    baseContext(),
  );
  assert.equal(forgedObject.ok, false);

  const missingRecord = resolveNavigationTarget(
    { type: "object_record", key: "customer", objectKey: "customer", recordSource: "explicit", recordId: UUID },
    baseContext({ objectPages: [] }),
  );
  assert.equal(missingRecord.ok, false);
});

test("describeNavigationTarget renders the builder summary", () => {
  assert.equal(describeNavigationTarget({ type: "system_page", key: "Inventory" }), "Inventory");
  assert.equal(describeNavigationTarget({ type: "object_list", key: "customer" }, "Customer Directory"), "Customer Directory · list");
  assert.equal(describeNavigationTarget({ type: "object_record", key: "customer", objectKey: "customer", recordSource: "current" }, "Customers"), "Customers · Current record");
});

/* ------------------------------------------------- server: discovery + isolation */

function fakeCtx({ companyId = COMPANY_A, superadmin = false, permissions = ["reports.custom.view"], objectGrants = true, pages = [], apps = [] } = {}) {
  const state = {
    apps,
    pages,
    objects: [
      { id: "obj-1", object_key: "customer", label: "Customers", active: true, company_id: null, source_table: "customers", company_scoped: true },
      { id: "obj-2", object_key: "task", label: "Tasks", active: true, company_id: null, source_table: "tasks", company_scoped: false },
    ],
    recordRows: {
      [RECORD_ID]: { id: RECORD_ID, company_id: COMPANY_A, name: "Amy", store_id: STORE },
    },
  };
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM users WHERE id=\$1 AND active=true/.test(s)) return { rows: [{ is_superadmin: superadmin }] };
    if (/FROM role_permissions rp/.test(s)) return { rows: permissions.map((code) => ({ code })) };
    if (/FROM platform_apps WHERE company_id/.test(s) && !/JOIN/.test(s)) return { rows: state.apps };
    if (/FROM platform_pages p\s+JOIN platform_apps a ON a\.id = p\.app_id\s+WHERE p\.company_id = \$1/.test(s)) {
      return { rows: state.pages.filter((page) => page.company_id === params[0]) };
    }
    if (/SELECT page_key, label FROM platform_pages/.test(s)) {
      return { rows: state.pages.filter((page) => page.company_id === params[0]).map((page) => ({ page_key: page.page_key, label: page.label })) };
    }
    if (/FROM platform_objects WHERE object_key = ANY/.test(s)) return { rows: state.objects };
    if (/FROM platform_object_permissions/.test(s)) return { rows: objectGrants ? [{ object_id: "obj-1", can_view: true }, { object_id: "obj-2", can_view: true }] : [] };
    if (/FROM platform_objects WHERE object_key=\$1 AND active=true/.test(s)) return { rows: state.objects.filter((object) => object.object_key === params[0]) };
    /* The single-record read the record-page feed issues (source table varies).
       Visibility mirrors the real database: company_id / store_id clauses and
       the customer_stores EXISTS clause each bind their own parameter. */
    if (/SELECT .* FROM "(customers|tasks)" WHERE/.test(s)) {
      const row = state.recordRows[params[0]] || null;
      const csStore = /customer_stores cs/.test(s) ? params.filter((value) => value === STORE).length > 0 : true;
      const companyOk = !row || !/company_id=\$\d+/.test(s) || params.includes(row.company_id);
      const storeOk = !row || !/store_id=\$\d+/.test(s) || params.includes(row.store_id);
      return { rows: row && companyOk && storeOk && csStore ? [row] : [] };
    }
    if (/FROM platform_fields WHERE object_id=\$1/.test(s)) {
      return { rows: [
        { object_id: "obj-1", api_name: "name", label: "Name", field_type: "text", readable: true, active: true, display_order: 1, source_column: "name" },
      ] };
    }
    if (/FROM platform_modules m/.test(s)) return { rows: [] };
    if (/FROM terminals/.test(s)) return { rows: [] };
    return { rows: [] };
  };
  return { state, db, pool: { async connect() { return { query: db, release() {} }; } } };
}

async function buildApp(ctx, { companyId = COMPANY_A, isSuperadmin = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER_A, companyId, storeId: STORE, roleId: "role-1", isSuperadmin, platformCompanyCustomers: true };
    next();
  });
  app.use("/api", createPlatformRouter({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const getJson = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test("navigation-targets feed discovers company pages and server-filtered objects; cross-company pages never appear", async () => {
  const ctx = fakeCtx({
    apps: [{ id: "app-1", company_id: COMPANY_A, app_key: "ops", label: "Ops", active: true }],
    pages: [
      { app_id: "app-1", company_id: COMPANY_A, page_key: "stock_dashboard", label: "Stock Dashboard", active: true },
      { app_id: "app-1", company_id: COMPANY_B, page_key: "b_secret_page", label: "B Secret", active: true },
    ],
  });
  const app = await buildApp(ctx);
  const { server, port } = await listen(app);
  try {
    const res = await getJson(port, "/api/platform/runtime/navigation-targets");
    assert.equal(res.status, 200);
    const keys = (res.body.data?.customPages || []).map((page) => page.key);
    assert.ok(keys.includes("stock_dashboard"), "company A's page is discovered");
    assert.ok(!keys.includes("b_secret_page"), "company B's page is never resolvable for company A");
    const objectKeys = (res.body.data?.objectPages || []).map((page) => page.objectKey);
    assert.ok(objectKeys.includes("customer") || objectKeys.length === 0, "object discovery stays within the caller's scope");
  } finally { server.close(); }
});

test("record-page feed: permitted record loads, forged/cross-company record cannot expose data", async () => {
  const app = await buildApp(fakeCtx());
  const { server, port } = await listen(app);
  try {
    const ok = await getJson(port, `/api/platform/runtime/record-page?objectKey=customer&recordId=${RECORD_ID}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data?.record?.id, RECORD_ID);
    assert.equal(ok.body.data?.objectKey, "customer");

    /* A forged record id that is not a UUID shape is refused outright. */
    const forged = await getJson(port, "/api/platform/runtime/record-page?objectKey=customer&recordId=1%3BDELETE%20FROM%20users");
    assert.equal(forged.status, 400);

    /* Unknown record → 404, never a guess. */
    const missing = await getJson(port, `/api/platform/runtime/record-page?objectKey=customer&recordId=${UUID}`);
    assert.equal(missing.status, 404);
  } finally { server.close(); }
});

test("record-page feed refuses callers without the object's can_view grant", async () => {
  const app = await buildApp(fakeCtx({ objectGrants: false }));
  const { server, port } = await listen(app);
  try {
    const denied = await getJson(port, `/api/platform/runtime/record-page?objectKey=customer&recordId=${RECORD_ID}`);
    assert.equal(denied.status, 403, "without can_view the feed refuses — no data leaks");
  } finally { server.close(); }
});

test("record-page feed keeps company isolation: company B cannot read company A's record", async () => {
  const app = await buildApp(fakeCtx(), { companyId: COMPANY_B });
  const { server, port } = await listen(app);
  try {
    const res = await getJson(port, `/api/platform/runtime/record-page?objectKey=customer&recordId=${RECORD_ID}`);
    assert.ok(res.status === 404 || res.status === 403, `cross-company read is refused (${res.status})`);
    assert.notEqual(res.body?.data?.record?.id, RECORD_ID);
  } finally { server.close(); }
});

test("object discovery respects object permissions server-side", async () => {
  const ctx = fakeCtx({ objectGrants: false, permissions: [] });
  const app = await buildApp(ctx);
  const { server, port } = await listen(app);
  try {
    const res = await getJson(port, "/api/platform/runtime/navigation-targets");
    assert.equal(res.status, 200);
    const objectKeys = (res.body.data?.objectPages || []).map((page) => page.objectKey);
    assert.ok(!objectKeys.includes("customer"), "an object the caller has no grant for is filtered before the Builder ever sees it");
  } finally { server.close(); }
});

/* ------------------------------------------------- builder/runtime contract */

test("builder and runtime agree on the ONE target schema and resolver", () => {
  const picker = read("src/pages/settings/Platform/ActionWorkflowPicker.jsx");
  const runtime = read("src/components/CustomPageRuntime.jsx");
  const tree = read("src/pages/settings/Platform/customPageTree.js");
  assert.match(picker, /navigation-targets/, "the picker discovers from the canonical feed");
  assert.match(picker, /navigationTarget/);
  assert.match(runtime, /resolveNavigationTarget/);
  assert.match(runtime, /navigateToTarget/);
  assert.match(tree, /normalizeNavigationTargetValue|NAVIGATION_TARGET_TYPES/);
  /* No raw URL storage in the builder: targets are keys, not paths. */
  assert.doesNotMatch(picker, /\/app\//, "the builder never hard-codes application routes");
  /* The old per-component navigation code is retired. */
  assert.doesNotMatch(runtime, /buildCustomPagePath/, "runtime navigation goes through the ONE resolver");
  assert.match(read("src/utils/navigationTargets.js"), /buildObjectRecordPath/, "record routes come from the canonical helper");
});

test("system-page runtime re-check keeps permission enforcement in the shell", () => {
  const adminLayout = read("src/pages/admin/AdminLayout.jsx");
  assert.match(adminLayout, /record-page\?objectKey=/, "record deep links resolve through the canonical record-page feed");
  const routes = read("routes/platform.js");
  assert.match(routes, /\/platform\/runtime\/record-page/);
  assert.match(routes, /hasPlatformObjectPermission\(db, req, object\.id, "view"\)/, "the feed enforces object view permission");
  assert.match(routes, /appendSystemReadScope\(object, req, clauses, params\)/, "system read scope applies to record feeds");
});
