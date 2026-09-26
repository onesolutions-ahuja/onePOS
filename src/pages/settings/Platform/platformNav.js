/*
 * GLOBAL PLATFORM NAVIGATION MODEL
 *
 * One description of the Platform administration surfaces, shared by the rail
 * in PlatformAdmin.jsx and by its tests. Plain data on purpose: this is a
 * navigation map, not a router and not an authorization source. Every entry
 * names an EXISTING surface — a PlatformAdmin view, or an existing main-app
 * page resolved through the shell's own URL contract.
 *
 * Configuration of ONE selected object is deliberately absent: it is a
 * different context, rendered as that object's own tabs with a breadcrumb back
 * to Objects, so the global rail and the object tabs never appear together.
 */
export const PLATFORM_GROUPS = [
  {
    label: "Metadata",
    items: [
      { key: "objects", label: "Objects", view: "objects" },
      { key: "value-sets", label: "Value Sets", view: "value-sets" },
    ],
  },
  {
    /* The platform-wide metadata lists remain available, but they are kept in
       the object-scoped editor experience rather than in the general platform
       sidebar. The global rail is intentionally limited to the non-duplicated
       surfaces the admin uses day-to-day. */
    label: "Across all objects",
    items: [],
  },
  {
    label: "Automation",
    items: [
      { key: "page-builder", label: "Page Builder", view: "page-builder" },
      { key: "custom-page-builder", label: "Custom Pages (Visual)", view: "custom-page-builder" },
      { key: "flow-builder", label: "Flow Builder", view: "flow-builder" },
      { key: "landing-flow", label: "Login / Landing Flow", view: "landing-flow" },
      { key: "approval-builder", label: "Approval Processes", view: "approval-builder" },
      { key: "automation", label: "Automation", view: "workflow" },
      { key: "workflow-runs", label: "Workflow Runs", view: "workflow-runs" },
    ],
  },
  {
    label: "Apps",
    items: [
      { key: "studio", label: "Platform Reports & Apps", view: "studio" },
      { key: "app-catalog", label: "Internal Apps", view: "app-catalog" },
    ],
  },
  {
    /* Entries that leave Platform for a page the main application already
       owns and renders — Reports, and the existing Dashboard Builder. */
    label: "Open in the main app",
    openInApp: true,
    items: [
      { key: "reports", label: "Reports", page: "Reports" },
      { key: "dashboards", label: "Dashboards", page: "Dashboards" },
    ],
  },
];

/** Which rail entry is current, per PlatformAdmin view. Object-scoped views
 *  (editor, object-page, and the object-scoped tool lists) are not part of the
 *  global rail at all, so they are intentionally not listed here. */
export const SURFACE_KEY_BY_VIEW = {
  objects: "objects",
  "value-sets": "value-sets",
  relationships: "all-relationships",
  layouts: "all-forms",
  rules: "all-rules",
  "page-builder": "page-builder",
  "custom-page-builder": "custom-page-builder",
  "flow-builder": "flow-builder",
  "landing-flow": "landing-flow",
  "approval-builder": "approval-builder",
  workflow: "automation",
  "workflow-runs": "workflow-runs",
  studio: "studio",
  "app-catalog": "app-catalog",
};

export const PLATFORM_SURFACES = PLATFORM_GROUPS.flatMap((group) => group.items);

export const SURFACE_BY_KEY = Object.fromEntries(
  PLATFORM_SURFACES.map((item) => [item.key, item])
);
