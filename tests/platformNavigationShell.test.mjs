import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_GROUPS,
  PLATFORM_SURFACES,
  SURFACE_BY_KEY,
  SURFACE_KEY_BY_VIEW,
} from "../src/pages/settings/Platform/platformNav.js";
import { PAGE_SLUGS, buildAppPath } from "../src/utils/adminRoutes.js";

/*
 * Platform navigation shell.
 *
 * Platform administration is ONE surface with ONE grouped rail. Global
 * Platform configuration and the configuration of a selected object are
 * separate contexts that never render together, every existing surface stays
 * reachable, and the rail is described by plain data (platformNav.js) so it can
 * be asserted without a DOM.
 */

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const platformAdmin = read("src/pages/settings/PlatformAdmin.jsx");
const platformNav = read("src/pages/settings/Platform/platformNav.js");
const adminLayout = read("src/pages/admin/AdminLayout.jsx");
const objectEditor = read("src/pages/settings/Platform/ObjectEditor.jsx");

const frameBlock = platformAdmin.slice(
  platformAdmin.indexOf("const platformFrame"),
  platformAdmin.indexOf("const objectLabel"),
);

const objectFrameBlock = platformAdmin.slice(
  platformAdmin.indexOf("const objectFrame"),
  platformAdmin.indexOf("function openSurface"),
);

/* ------------------------------------------- 1. one rail, existing surfaces */

test("the rail lists only surfaces that exist", () => {
  const keys = PLATFORM_SURFACES.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, "rail keys must be unique");

  for (const item of PLATFORM_SURFACES) {
    if (item.view) {
      assert.equal(SURFACE_KEY_BY_VIEW[item.view], item.key, `${item.key} must map to view ${item.view}`);
      assert.match(platformAdmin, new RegExp(`"${item.view}"`), `${item.view} must be handled by PlatformAdmin`);
      continue;
    }

    // Entries that leave Platform must name a real, existing app page.
    assert.ok(item.page, `${item.key} must name a view or an existing app page`);
    assert.ok(PAGE_SLUGS[item.page], `${item.page} must be an existing admin page`);
  }

  assert.equal(Object.keys(SURFACE_BY_KEY).length, keys.length);
});

test("every existing Platform surface stays reachable", () => {
  const branches = {
    "value-sets": '<ValueSetList',
    studio: '<PlatformStudio',
    workflow: '<WorkflowAdmin',
    "workflow-runs": '<WorkflowRunsAdmin',
    "app-catalog": '<InternalAppCatalog',
    "approval-builder": '<ApprovalProcessBuilder',
    relationships: '<RelationshipList',
    layouts: '<LayoutList',
    rules: '<RuleList',
    objects: '<ObjectList',
  };

  for (const [view, component] of Object.entries(branches)) {
    assert.match(platformAdmin, new RegExp(`if \\(view === "${view}"\\)|<ObjectList`), `${view} branch missing`);
    assert.match(platformAdmin, new RegExp(component.replace("<", "<")), `${component} not rendered`);
  }

  // The editors/record page reached from those surfaces are still wired.
  for (const component of ["ObjectEditor", "RelationshipEditor", "RuleEditor", "FieldEditor", "ObjectPage", "LayoutEditor"]) {
    assert.match(platformAdmin, new RegExp(component), `${component} must stay wired`);
  }
});

test("Approval Processes is registered to the existing builder inside PlatformAdmin", () => {
  assert.equal(SURFACE_BY_KEY["approval-builder"].view, "approval-builder");
  assert.equal(SURFACE_KEY_BY_VIEW["approval-builder"], "approval-builder");
  assert.match(platformAdmin, /import ApprovalProcessBuilder from "\.\/Platform\/ApprovalProcessBuilder\.jsx"/);
  assert.match(platformAdmin, /if \(view === "approval-builder"\)[\s\S]*?<ApprovalProcessBuilder onMessage=\{onMessage\} onError=\{onError\} \/>/);
  assert.match(read("src/pages/settings/SettingsAdmin.jsx"), /tab === "Platform" && access\["Platform"\] && <PlatformAdmin/);
});

test("nothing invents a new Platform surface", () => {
  // Only the four known groups, and no placeholder entries.
  assert.deepEqual(
    PLATFORM_GROUPS.map((group) => group.label),
    ["Metadata", "Across all objects", "Automation", "Apps", "Open in the main app"],
  );

  for (const item of PLATFORM_SURFACES) {
    assert.doesNotMatch(item.label, /coming soon|placeholder|TODO/i, `${item.key} must be real`);
  }
});

/* --------------------------------------------- 2. no competing tab systems */

test("the legacy flat Platform strip is gone", () => {
  assert.doesNotMatch(platformAdmin, /flex gap-2 border-b border-slate-200/);
  assert.doesNotMatch(platformAdmin, /Reports & Apps<\/button>/);
  assert.match(platformAdmin, /function PlatformSectionNav/);
  assert.match(platformAdmin, /aria-label="Platform configuration"/);
});

test("there is exactly one rail, and it never renders beside the object tabs", () => {
  const railUses = platformAdmin.match(/<PlatformSectionNav/g) || [];
  assert.equal(railUses.length, 1, "one rail component, used by one frame");

  assert.match(frameBlock, /<PlatformSectionNav activeKey=\{activeKey\} onSelect=\{openSurface\} \/>/);
  assert.doesNotMatch(objectFrameBlock, /PlatformSectionNav/, "object context must not show the global rail");
  assert.match(objectFrameBlock, /platform-object-crumb/);
});

test("the global rail does not repeat the object-level tabs", () => {
  const labels = PLATFORM_SURFACES.map((item) => item.label);

  for (const objectTab of ["Details", "Record Types"]) {
    assert.ok(!labels.includes(objectTab), `${objectTab} belongs to the object, not the platform rail`);
  }

  // The cross-object lists are intentionally kept out of the normal global rail
  // so the object-scoped configuration remains the canonical place to manage
  // them. The global shell is limited to the non-duplicated primary surfaces.
  const crossObject = PLATFORM_GROUPS.find((group) => group.label === "Across all objects");
  assert.deepEqual(crossObject.items.map((item) => item.key), []);

  const elsewhere = PLATFORM_GROUPS
    .filter((group) => group.label !== "Across all objects")
    .flatMap((group) => group.items.map((item) => item.key));
  for (const key of ["all-relationships", "all-forms", "all-rules"]) {
    assert.ok(!elsewhere.includes(key), `${key} must not be duplicated in the normal global rail`);
  }

  // The object's own tabs are still supplied by the object screen.
  assert.match(objectEditor, /key: "relationships", label: "Relationships"/);
  assert.match(objectEditor, /key: "layouts", label: "Forms"/);
  assert.match(objectEditor, /key: "rules", label: "Validation Rules"/);
});

/* ------------------------------------------------- 3. object context + back */

test("object configuration is a separate context with a predictable return path", () => {
  // Global surfaces clear the selected object, so the cross-object lists really
  // are cross-object.
  assert.match(platformAdmin, /function openSurface\(item\)/);
  assert.match(platformAdmin, /setSelectedObject\(null\);/);
  assert.match(platformAdmin, /setView\(item\.view\);/);

  // Object-scoped lists get the breadcrumb; global ones get the rail.
  assert.match(platformAdmin, /return selectedObject\s*\? objectFrame\(content\)\s*: platformFrame\("all-relationships", content\);/);
  assert.match(platformAdmin, /return selectedObject \? objectFrame\(list\) : platformFrame\("all-forms", list\);/);
  assert.match(platformAdmin, /return selectedObject \? objectFrame\(list\) : platformFrame\("all-rules", list\);/);
});

test("Platform → Objects → object → Forms → builder → back round-trips", () => {
  // Objects row → object configuration.
  assert.match(platformAdmin, /target === "edit-object"/);
  assert.match(platformAdmin, /setView\("editor"\)/);

  // The object's Forms tab opens the existing form list, scoped to the object.
  assert.match(objectEditor, /onNavigate\?\.\("layouts"\)/);
  assert.match(platformAdmin, /objectId=\{selectedObject\?\.id \|\| selectedObject\?\.object_id\}/);

  // The list opens the existing builder and both of its exits return to it.
  assert.match(platformAdmin, /onEdit=\{\(layout\) => navigate\("edit-layout", layout\)\}/);
  assert.match(platformAdmin, /<LayoutEditor/);
  assert.match(platformAdmin, /onCancel=\{\(\) => setView\("layouts"\)\}/);
  assert.match(platformAdmin, /setView\("layouts"\); \}/);

  // Back from a scoped list returns to the object; from a global list, Objects.
  const backHandlers = platformAdmin.match(/setView\(selectedObject \? "editor" : "objects"\)/g) || [];
  assert.ok(backHandlers.length >= 3, "every scoped list needs the object-aware back target");

  // And the record page returns to the object it belongs to.
  assert.match(platformAdmin, /onBack=\{\(\) => setView\("editor"\)\}/);
});

/* ----------------------------------------- 4. Reports / Dashboards entry points */

test("Reports and Dashboards use the existing implementations", () => {
  const reportsEntry = SURFACE_BY_KEY.reports;
  const dashboardsEntry = SURFACE_BY_KEY.dashboards;

  assert.equal(reportsEntry.page, "Reports");
  assert.equal(dashboardsEntry.page, "Dashboards");
  assert.equal(buildAppPath("Reports"), "/app/reports");
  assert.equal(buildAppPath("Dashboards"), "/app/dashboards");

  // The shell already renders both; Platform only navigates to them.
  assert.match(adminLayout, /const DashboardBuilder = lazy\(\(\) => import\("\.\.\/dashboard\/DashboardBuilder\.jsx"\)\)/);
  assert.match(adminLayout, /const ReportsAdmin = lazy\(\(\) => import\("\.\.\/reports\/ReportsAdmin\.jsx"\)\)/);
  assert.match(adminLayout, /"Dashboards" \? \(\s*\n?\s*<DashboardBuilder \/>/);
  assert.match(adminLayout, /<ReportsAdmin \/>/);
  assert.doesNotMatch(platformAdmin, /import DashboardBuilder|ReportsAdmin/);
});

test("leaving Platform reuses the shell's own URL contract, not a second router", () => {
  assert.match(platformAdmin, /import \{ buildAppPath \} from "\.\.\/\.\.\/utils\/adminRoutes\.js"/);
  assert.match(platformAdmin, /const target = buildAppPath\(page\);/);
  assert.match(platformAdmin, /window\.history\.pushState\(\{\}, "", target\)/);
  assert.match(platformAdmin, /new window\.PopStateEvent\("popstate"\)/);

  // The shell already listens for that event and re-resolves the page.
  assert.match(adminLayout, /window\.addEventListener\("popstate", onPopState\)/);

  // No hard redirect, and no new route table.
  assert.doesNotMatch(platformAdmin, /location\.href\s*=/);
  assert.doesNotMatch(platformAdmin, /createBrowserRouter|<Routes|<Route\s|<Route\b(?!r)/);
});

/* --------------------------------------------------------- 5. Automation */

test("Automation has a global entry point into the existing builders", () => {
  assert.equal(SURFACE_BY_KEY.automation.view, "workflow");
  assert.equal(SURFACE_BY_KEY["workflow-runs"].view, "workflow-runs");
  assert.match(platformAdmin, /<WorkflowAdmin onMessage=\{onMessage\} onError=\{onError\} \/>/);
  assert.match(platformAdmin, /<WorkflowRunsAdmin onMessage=\{onMessage\} onError=\{onError\} \/>/);
});

/* -------------------------------------------------- 6. responsive contract */

test("the setup pane stays usable on tablet and collapses to a menu on phone widths", () => {
  assert.match(platformAdmin, /\.platform-surface \{[\s\S]*?grid-template-columns: minmax\(210px, 250px\)/);
  assert.match(platformAdmin, /@media \(max-width: 900px\) \{[\s\S]*?\.platform-surface \{ grid-template-columns/);
  assert.match(platformAdmin, /@media \(max-width: 639px\) \{[\s\S]*?\.psnav-rail \{ display: none; \}/);
  assert.match(platformAdmin, /@media \(max-width: 639px\) \{[\s\S]*?\.psnav-compact \{[\s\S]*?display: flex;/);
  assert.match(platformAdmin, /aria-label="Platform section"/);
  // The compact menu is grouped exactly like the rail.
  assert.match(platformAdmin, /<optgroup key=\{group\.label\} label=\{group\.label\}>/);
});

test("Platform navigation provides a persistent setup pane and Quick Find", () => {
  assert.match(platformAdmin, /grid-template-columns: minmax\(210px, 250px\)/);
  assert.match(platformAdmin, /position: sticky/);
  assert.match(platformAdmin, /Quick Find/);
  assert.match(platformAdmin, /Search platform settings/);
  assert.match(platformAdmin, /visibleGroups/);
});

/* ------------------------------------------------- 7. presentation discipline */

test("the Platform chrome is token-driven and uses one icon library", () => {
  for (const [file, source] of Object.entries({ "PlatformAdmin.jsx": platformAdmin, "platformNav.js": platformNav })) {
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b/, `${file} must not hard-code a hex colour`);
    assert.doesNotMatch(source, /rgb\(|rgba\(/, `${file} must not hard-code an rgb colour`);
    assert.doesNotMatch(source, /data-onepos-preset/, `${file} must not branch on the preset`);
  }

  assert.match(platformAdmin, /var\(--border-color\)/);
  assert.match(platformAdmin, /var\(--text-secondary\)/);
  assert.match(platformAdmin, /var\(--primary-color\)/);
  assert.match(platformAdmin, /var\(--muted-background\)/);
  assert.match(platformAdmin, /var\(--onepos-control-height/);

  assert.match(platformAdmin, /from "lucide-react"/);
  assert.doesNotMatch(platformAdmin, /react-icons|@heroicons|feather/);

  // The developer company context now uses the shared alert + input primitives.
  assert.match(platformAdmin, /className="onepos-alert onepos-alert-warning psnav-banner"/);
  assert.match(platformAdmin, /className="onepos-input"\s*\r?\n\s+value=\{actingCompanyId\}/);
});

/* ----------------------------------------- 8. navigation is not authorization */

test("the setup pane is presentation-only and Quick Find does not grant access", () => {
  assert.doesNotMatch(platformAdmin, /permissions|hasPermission|role_id/);
  assert.doesNotMatch(platformAdmin, /\/api\/auth\/me\/permissions/);
  assert.doesNotMatch(platformNav, /permission|role|entitlement|licence/i);

  // Every rail entry is rendered for whoever can open Platform at all; the
  // surfaces themselves keep enforcing their own access.
  assert.match(platformAdmin, /visibleGroups\.map\(\(group\) => \(/);
  assert.match(platformAdmin, /item\.label\.toLowerCase\(\)\.includes\(normalizedQuery\)/);
});
