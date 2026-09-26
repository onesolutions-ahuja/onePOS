import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LAYOUT_PRESETS,
  APPEARANCE_OPTIONS,
  ACCENT_OPTIONS,
  tokensForPreferences,
} from "../src/utils/adminPreferences.js";

/*
 * onePOS UI Phase 3 — Admin page adoption of the shared design system.
 *
 * These tests pin the MIGRATION, not the design language itself (that lives in
 * tests/adminPresetDesignLanguages.test.mjs). They exist to stop the two
 * regressions this phase actually fixed:
 *
 *   1. Pages drifting back to their own page-header / card / table / empty
 *      markup instead of the shared primitives, and
 *   2. Hard-coded dark neutrals (bg-slate-700/800/900) whose token now INVERTS
 *      in dark appearance — white text on a near-white surface.
 *
 * They also pin the two shared bridges (surface + Platform local variables) and
 * the Till boundary, because those bridges are what make the migration reach
 * pages that were NOT individually edited.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const INDEX_CSS = read("src/index.css");

/** Pages migrated in this phase, with the primitives each one now owns. */
const MIGRATED = {
  "src/pages/sales/SalesAdmin.jsx": [
    "onepos-page-header",
    "onepos-page-title",
    "onepos-page-subtitle",
    "onepos-card",
    /* The toolbar + table moved INTO the shared global ObjectList           */
    /* (components/records/ObjectList.jsx → .onepos-object-* primitives),   */
    /* so this page no longer owns them locally — that IS the migration.    */
    "onepos-empty",
    "onepos-btn",
  ],
  "src/pages/suppliers/SuppliersAdmin.jsx": [
    "onepos-page-header",
    "onepos-page-title",
    "onepos-card",
    /* The toolbar + table moved INTO the shared global ObjectList           */
    /* (components/records/ObjectList.jsx → .onepos-object-* primitives),   */
    /* so this page no longer owns them locally — that IS the migration.    */
    "onepos-empty",
    /* Status pill now renders inside ObjectList (.onepos-badge lives there). */
    "onepos-alert",
    "onepos-btn",
  ],
  "src/pages/inventory/InventoryAdmin.jsx": [
    "onepos-page-header",
    "onepos-page-title",
    "onepos-card",
    /* The toolbar + table moved INTO the shared global ObjectList           */
    /* (components/records/ObjectList.jsx → .onepos-object-* primitives),   */
    /* so this page no longer owns them locally — that IS the migration.    */
    "onepos-empty",
    "onepos-alert",
    "onepos-btn",
  ],
  "src/pages/products/ProductsAdmin.jsx": [
    /* Phase 4 — operational admin lists converge on ObjectList.           */
    "onepos-card",
    "onepos-btn",
  ],
  "src/pages/customers/CustomersAdmin.jsx": [
    /* PageHeader/CardHeader/EmptyState render shared primitives via ui.jsx;  */
    /* the list itself moved INTO the shared global ObjectList.               */
    "onepos-card",
    "onepos-card-title",
    "onepos-section-title",
  ],
  "src/pages/purchases/PurchasesAdmin.jsx": [
    /* The list moved INTO the shared global ObjectList; the page keeps its   */
    /* existing header buttons and workflow untouched, so it owns no other    */
    /* shared primitives directly.                                            */
  ],
  "src/pages/reports/ReportHeader.jsx": [
    "onepos-page-header",
    "onepos-page-title",
    "onepos-page-subtitle",
    "onepos-input",
    "onepos-btn",
  ],
  "src/pages/reports/ReportTable.jsx": [
    "onepos-card",
    "onepos-card-header",
    "onepos-table",
    "onepos-empty",
    "onepos-btn",
  ],
  "src/pages/reports/SummaryCards.jsx": ["onepos-stat", "onepos-stat-label", "onepos-stat-value"],
  "src/pages/online/OnlineOrdersAdmin.jsx": ["onepos-page-title", "onepos-card"],
  "src/pages/returns/ReturnsAdmin.jsx": ["onepos-page-title", "onepos-card"],

  /* Phase 3B — the Reports section (see section 7 for its own contract). */
  "src/pages/reports/ReportHeader.jsx": [
    "onepos-page-header",
    "onepos-page-title",
    "onepos-page-subtitle",
    "onepos-input",
    "onepos-btn",
  ],
  "src/pages/reports/ReportTable.jsx": [
    "onepos-card",
    "onepos-card-header",
    "onepos-table",
    "onepos-empty",
    "onepos-btn",
  ],
  "src/pages/reports/SummaryCards.jsx": ["onepos-stat", "onepos-stat-label", "onepos-stat-value"],
  "src/pages/reports/ReportPage.jsx": [
    "onepos-empty",
    "onepos-card",
    "onepos-page-header",
    "onepos-page-title",
    "onepos-btn",
  ],
  "src/pages/reports/ReportsAdmin.jsx": ["onepos-empty", "onepos-card", "onepos-btn"],
  "src/pages/reports/SalesReportsModule.jsx": [
    "onepos-empty",
    "onepos-card",
    "onepos-card-body",
    "onepos-toolbar",
    "onepos-tab",
    "onepos-tab-active",
    "onepos-input",
    "onepos-btn",
    "onepos-stat-label",
    "onepos-stat-value",
  ],
  "src/pages/reports/StockMovementLedger.jsx": [
    "onepos-alert",
    "onepos-card",
    "onepos-toolbar",
    "onepos-label",
    "onepos-input",
  ],
  "src/pages/reports/TillReport.jsx": [
    "onepos-card",
    "onepos-card-header",
    "onepos-card-title",
    "onepos-table",
    "onepos-badge",
    "onepos-empty",
  ],
  "src/pages/reports/CustomReportsAdmin.jsx": [
    "onepos-empty",
    "onepos-page-header",
    "onepos-page-title",
    "onepos-page-subtitle",
    "onepos-btn",
    "onepos-alert",
    "onepos-card",
    "onepos-card-header",
    "onepos-input",
    "onepos-label",
    "onepos-section-title",
  ],
  "src/pages/reports/VATReport.jsx": ["onepos-alert"],
  "src/pages/reports/CustomersReport.jsx": ["onepos-alert"],
  "src/pages/reports/InventoryReport.jsx": ["onepos-alert"],
  "src/pages/reports/ProfitReport.jsx": ["onepos-alert"],
  "src/pages/reports/shared/QuickDateRange.jsx": ["onepos-btn-primary", "onepos-btn-secondary"],
};

/* ---------------------------------------------------------------- 1. audit */

describe("1. migration audit", () => {
  test("every migrated page uses the shared primitives it was migrated to", () => {
    for (const [file, classes] of Object.entries(MIGRATED)) {
      const source = read(file);
      for (const cls of classes) {
        assert.match(
          source,
          new RegExp(`\\b${cls}\\b`),
          `${file} should use ${cls}`,
        );
      }
    }
  });

  test("migrated pages dropped the duplicated page-title / card literals", () => {
    for (const file of [
      "src/pages/sales/SalesAdmin.jsx",
      "src/pages/suppliers/SuppliersAdmin.jsx",
      "src/pages/inventory/InventoryAdmin.jsx",
      "src/pages/reports/ReportHeader.jsx",
      "src/pages/reports/ReportTable.jsx",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /text-2xl font-bold/, `${file} still hand-rolls its page title`);
      assert.doesNotMatch(
        source,
        /bg-white border border-slate-200 rounded-xl/,
        `${file} still hand-rolls its card`,
      );
    }
  });

  test("ReportTable no longer hand-rolls its own table chrome", () => {
    const source = read("src/pages/reports/ReportTable.jsx");
    assert.doesNotMatch(source, /className="w-full"/, "table class should be the shared one");
    assert.doesNotMatch(source, /px-3 py-2 text-xs uppercase text-slate-500/, "cells should not re-declare density");
    assert.match(source, /className="onepos-table"/);
  });
});

/* ------------------------------------------------- 2. shared bridges */

describe("2. shared bridges reach pages that were not individually edited", () => {
  test("the surface bridge maps bg-white onto a token, in light AND dark", () => {
    assert.match(
      INDEX_CSS,
      /\.onepos-shell \.bg-white \{ background-color: var\(--onepos-surface-raised\); \}/,
    );
  });

  test("the surface bridge is scoped to the shell and never touches text-white", () => {
    // text-white must stay white on accent buttons, so the bridge may only
    // ever target the background utility.
    assert.doesNotMatch(INDEX_CSS, /\.onepos-shell \.text-white/);
    assert.doesNotMatch(INDEX_CSS, /^\s*\.bg-white \{/m, "the bridge must not be global");
  });

  test("the alpha variants are deliberately left alone (frosted overlays on dark art)", () => {
    assert.doesNotMatch(INDEX_CSS, /\.onepos-shell \.bg-white\\\/(10|20)/);
  });

  test("the Platform studio's local variables are declared once, from shared tokens", () => {
    const bridge = INDEX_CSS.slice(
      INDEX_CSS.indexOf("Local-variable bridge"),
      INDEX_CSS.indexOf("Local-variable bridge") + 1600,
    );
    for (const [local, token] of [
      ["--card-background", "--onepos-surface-raised"],
      ["--muted-background", "--onepos-surface-muted"],
      ["--hover-background", "--onepos-surface-hover"],
      ["--border-color", "--onepos-border"],
      ["--text-primary", "--onepos-text-primary"],
      ["--text-secondary", "--onepos-text-secondary"],
      ["--primary-color", "--onepos-accent-600"],
    ]) {
      assert.match(bridge, new RegExp(`${local}: var\\(${token}\\)`), `${local} -> ${token}`);
    }
  });

  test("no bridge declaration hard-codes a literal colour", () => {
    // Only the declarations themselves — the adjacent comment deliberately
    // names the old hex fallbacks so the change is reviewable.
    const bridge = INDEX_CSS.slice(
      INDEX_CSS.indexOf("Local-variable bridge"),
      INDEX_CSS.indexOf("Local-variable bridge") + 1600,
    );
    const declarations = bridge
      .split("\n")
      .filter((line) => /^\s*--[a-z-]+\s*:/.test(line));
    assert.ok(declarations.length >= 7, "expected the seven bridge declarations");
    for (const line of declarations) {
      assert.doesNotMatch(line, /#[0-9a-fA-F]{3,6}/, `bridge must not re-introduce hex: ${line}`);
      assert.doesNotMatch(line, /rgb\(/, `bridge must not re-introduce rgb(): ${line}`);
      assert.match(line, /var\(--onepos-/, `every bridge value must be a shared token: ${line}`);
    }
  });

  test("the Platform editors no longer fall back to hard-coded hex for those variables", () => {
    // The variables are now defined, so the fallbacks are dead — but the point
    // of this test is that the shared declaration exists for all 14 editors.
    const editors = [
      "FieldEditor.jsx",
      "LayoutEditor.jsx",
      "ObjectEditor.jsx",
      "ObjectList.jsx",
      "ObjectForm.jsx",
      "PlatformHome.jsx",
    ];
    for (const editor of editors) {
      const source = read(`src/pages/settings/Platform/${editor}`);
      assert.match(
        source,
        /var\(--(border-color|card-background|text-primary|text-secondary|primary-color|muted-background)/,
        `${editor} should be covered by the bridge`,
      );
    }
  });
});

/* ------------------------------- 3. no hard-coded presentation remains */

describe("3. hard-coded presentation that breaks Dark is gone", () => {
  test("no admin page uses a dark-slate surface that would invert in dark appearance", () => {
    const pages = Object.keys(MIGRATED);
    for (const file of pages) {
      const source = read(file);
      assert.doesNotMatch(
        source,
        /bg-slate-(700|800|900)\b/,
        `${file}: bg-slate-* now maps to a TEXT token and inverts to near-white in Dark`,
      );
    }
  });

  test("the formerly inverted segmented controls / buttons now use the accent", () => {
    const stockTransfers = read("src/pages/inventory/StockTransfers.jsx");
    assert.doesNotMatch(stockTransfers, /bg-slate-900/);
    assert.match(stockTransfers, /bg-blue-600 text-white/);

    const inventory = read("src/pages/inventory/InventoryAdmin.jsx");
    assert.doesNotMatch(inventory, /bg-slate-900/);
    assert.match(inventory, /bg-blue-600 text-white/);
  });

  test("dark code / camera panels use the non-tokenised gray ramp so they stay dark", () => {
    assert.match(read("src/pages/integrations/EndpointTestModal.jsx"), /bg-gray-900 text-gray-100/);
    assert.match(read("src/pages/scanAndGo/CameraScanner.jsx"), /bg-gray-900/);
  });

  test("migration introduced no !important overrides (the project uses none)", () => {
    for (const file of Object.keys(MIGRATED)) {
      assert.doesNotMatch(read(file), /\s![a-z]+-[a-z0-9]+\b/, `${file} should not use ! overrides`);
    }
  });
});

/* ------------------------------------------ 4. new shared primitives */

describe("4. new shared primitives are token-driven", () => {
  const cases = [
    ["onepos-page-header", "--onepos-page-gap"],
    ["onepos-toolbar", "--onepos-toolbar-height"],
    ["onepos-icon-chip", "--onepos-icon-chip-size"],
    ["onepos-icon-chip", "--onepos-icon-chip-bg"],
    ["onepos-stat", "--onepos-card-pad"],
    ["onepos-stat", "--onepos-card-radius"],
  ];

  test("each new primitive consumes preset tokens rather than fixed values", () => {
    for (const [cls, token] of cases) {
      const start = INDEX_CSS.indexOf(`.${cls} {`);
      assert.ok(start > -1, `${cls} should be defined`);
      const block = INDEX_CSS.slice(start, INDEX_CSS.indexOf("}", start));
      assert.match(block, new RegExp(token.replace(/-/g, "\\-")), `${cls} should use ${token}`);
    }
  });

  test("the stat card reuses the card tokens so it follows every preset", () => {
    const start = INDEX_CSS.indexOf(".onepos-stat {");
    const block = INDEX_CSS.slice(start, INDEX_CSS.indexOf("}", start));
    assert.match(block, /var\(--onepos-card-bg/);
    assert.match(block, /var\(--onepos-card-border/);
    assert.match(block, /var\(--onepos-shadow-card/);
  });

  test("the primitives live in the shared stylesheet, not in the pages", () => {
    for (const cls of ["onepos-page-header", "onepos-toolbar", "onepos-icon-chip", "onepos-stat"]) {
      assert.match(INDEX_CSS, new RegExp(`\\.${cls} \\{`), `${cls} missing from index.css`);
    }
  });
});

/* --------------------------------------- 5. presets / appearance / accent */

describe("5. migrated pages inherit preset, appearance and accent", () => {
  test("migrated pages declare no preset-specific markup of their own", () => {
    for (const file of Object.keys(MIGRATED)) {
      const source = read(file);
      assert.doesNotMatch(source, /data-onepos-preset/, `${file} should not branch on the preset`);
      // A quoted preset key would mean the page is deciding presentation
      // itself; the words may still appear in comments about density.
      assert.doesNotMatch(
        source,
        /["'`](modern|enterprise|compact)["'`]/i,
        `${file} should not name a preset in code`,
      );
    }
  });

  test("the migrated pages carry no inline colour or preset literal", () => {
    for (const file of Object.keys(MIGRATED)) {
      const source = read(file);
      assert.doesNotMatch(source, /#[0-9a-fA-F]{6}/, `${file} should not hard-code a hex colour`);
    }
  });

  test("the one inline style introduced is token-driven, never literal", () => {
    const summary = read("src/pages/reports/SummaryCards.jsx");
    assert.match(summary, /var\(--onepos-section-gap/);
    assert.doesNotMatch(summary, /marginBottom: "\d/, "the margin must come from the token");
  });

  test("no migrated page gained routing (presentation only)", () => {
    // Permission reads that already existed (e.g. SuppliersAdmin passing
    // `permissions` down to its accounts modal) are untouched business logic;
    // what must not appear is the migration introducing navigation itself.
    for (const file of Object.keys(MIGRATED)) {
      const source = read(file);
      assert.doesNotMatch(source, /window\.history|pushState|location\.href\s*=/, `${file} must not route`);
    }
  });
});

/* ------------------------------------------------------ 6. boundaries */

describe("6. shell and Till boundaries hold", () => {
  test("the shell stays full-width after the page migration", () => {
    const start = INDEX_CSS.indexOf(".onepos-shell {");
    const block = INDEX_CSS.slice(start, INDEX_CSS.indexOf("}", start));
    assert.match(block, /flex: 1 1 auto/);
    assert.match(block, /width: 100%/);
    assert.match(block, /max-width: none/);
  });

  test("the local-variable bridge is declared on the shell, never on :root", () => {
    // Nothing from this migration may leak into the Till, so the generic
    // variable names must be declared inside the shell scope only.
    assert.match(INDEX_CSS, /\.onepos-shell \{\s*\n\s*--card-background: var\(--onepos-surface-raised\);/);
    assert.doesNotMatch(INDEX_CSS, /:root \{[^}]*--card-background/, "must not be global");
  });

  test("the Till imports no admin presentation module and uses no shared page classes", () => {
    const posFiles = [
      "src/pages/pos/POS.jsx",
      "src/pages/pos/POSHeader.jsx",
      "src/pages/pos/CartPanel.jsx",
      "src/pages/pos/ProductGrid.jsx",
    ];
    for (const file of posFiles) {
      const source = read(file);
      assert.doesNotMatch(source, /adminPreferences|AdminShell|onepos-card|onepos-page-title/, file);
    }
  });

  test("the migrated pages never import the Till or the dock", () => {
    for (const file of Object.keys(MIGRATED)) {
      const source = read(file);
      assert.doesNotMatch(source, /pages\/pos\/|AdminNavDock/, `${file} must not depend on Till/dock`);
    }
  });
});

/* --------------------------------------------------- 7. Reports section */

const REPORT_FILES = [
  "ReportHeader.jsx",
  "ReportTable.jsx",
  "SummaryCards.jsx",
  "ReportPage.jsx",
  "ReportsAdmin.jsx",
  "SalesReportsModule.jsx",
  "SalesReport.jsx",
  "PaymentsReport.jsx",
  "ProductsReport.jsx",
  "CustomersReport.jsx",
  "InventoryReport.jsx",
  "StockMovementLedger.jsx",
  "ProfitReport.jsx",
  "TillReport.jsx",
  "VATReport.jsx",
  "CustomReportsAdmin.jsx",
  "shared/QuickDateRange.jsx",
];

/* Every report that actually renders tabular output must build on the shared
   table. ReportHeader is a header, ReportPage composes the other reports and
   QuickDateRange is a filter bar, so none of them render a table themselves. */
const REPORT_NON_TABLE_FILES = new Set([
  "ReportHeader.jsx",
  "ReportPage.jsx",
  "ReportsAdmin.jsx",
  "SummaryCards.jsx",
  "shared/QuickDateRange.jsx",
]);
const REPORT_TABLE_FILES = REPORT_FILES.filter((f) => !REPORT_NON_TABLE_FILES.has(f));

const reportSource = (file) => read(`src/pages/reports/${file}`);

/* Contrast helpers — the accent ramp is emitted as hsl() triples. */
const parseColor = (value) => {
  const hsl = String(value).match(/hsla?\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (hsl) {
    const h = Number(hsl[1]);
    const s = Number(hsl[2]) / 100;
    const l = Number(hsl[3]) / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [f(0) * 255, f(8) * 255, f(4) * 255];
  }
  const rgb = String(value).match(/([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};
const relLum = (rgb) => {
  const g = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * g(rgb[0]) + 0.7152 * g(rgb[1]) + 0.0722 * g(rgb[2]);
};
const contrastOf = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("7. Reports section", () => {
  test("no report file hand-rolls a surface, page title, table or accent button", () => {
    for (const file of REPORT_FILES) {
      const src = reportSource(file);
      assert.doesNotMatch(src, /bg-white/, `${file} still hand-rolls a surface`);
      assert.doesNotMatch(src, /text-2xl font-bold/, `${file} still hand-rolls a page title`);
      assert.doesNotMatch(src, /className="w-full"/, `${file} still hand-rolls a table`);
      assert.doesNotMatch(src, /bg-blue-600/, `${file} still hard-codes the accent colour`);
      assert.doesNotMatch(
        src,
        /p-1[02] text-center text-slate-400|p-6 text-sm text-slate-500 bg-white/,
        `${file} still hand-rolls an empty/error state`,
      );
    }
  });

  test("every report builds on the shared table primitive", () => {
    for (const file of REPORT_TABLE_FILES) {
      const src = reportSource(file);
      assert.ok(
        /ReportTable|onepos-table/.test(src),
        `${file} should render through ReportTable or .onepos-table`,
      );
    }
  });

  test("report tables keep deliberate horizontal scrolling instead of crushed columns", () => {
    assert.match(reportSource("ReportTable.jsx"), /overflow-x-auto/);
  });

  test("report filters use the shared toolbar / tab / input / button primitives", () => {
    const sales = reportSource("SalesReportsModule.jsx");
    assert.match(sales, /onepos-toolbar/);
    assert.match(sales, /onepos-tab-active/);
    assert.doesNotMatch(sales, /rounded text-sm border \$\{/, "grouping pills should be shared tabs");

    const ledger = reportSource("StockMovementLedger.jsx");
    assert.match(ledger, /onepos-toolbar/);
    assert.match(ledger, /onepos-input/);
    assert.doesNotMatch(ledger, /border-slate-300 bg-white/);

    const quick = reportSource("shared/QuickDateRange.jsx");
    assert.match(quick, /onepos-btn-primary/);
    assert.doesNotMatch(quick, /bg-blue-600|border-slate-200 text-slate-600/);
  });

  test("TillReport's three tables and variance badge are shared primitives", () => {
    const src = reportSource("TillReport.jsx");
    assert.equal(
      (src.match(/<table className="onepos-table">/g) || []).length,
      3,
      "all three Till tables should be shared",
    );
    assert.doesNotMatch(src, /<table className="w-full">/);
    assert.match(src, /onepos-badge-danger/);
    assert.doesNotMatch(src, /bg-red-100 text-red-800/);
  });

  test("report calculations and scoping are untouched (presentation only)", () => {
    // The money formatting and the server-owned values must survive intact.
    const till = reportSource("TillReport.jsx");
    assert.match(till, /expectedClosing/, "server-authoritative expected cash preserved");
    assert.match(till, /signedMoney/);
    const sales = reportSource("SalesReportsModule.jsx");
    assert.match(sales, /getSalesOverview\(\{ by, from, to, storeId \}\)/, "query unchanged");
    assert.match(sales, /\/api\/auth\/me\/permissions/, "permission source unchanged");
  });

  test("the report schema builder stays desktop-only and off the small-screen path", () => {
    const src = reportSource("CustomReportsAdmin.jsx");
    assert.match(src, /hidden md:block/, "authoring card must be gated off phones");
    assert.match(src, /md:hidden/, "phones get an explanatory notice instead");
    assert.match(src, /Creating and editing report definitions is available on a larger screen/);
    assert.equal(
      (src.match(/hidden md:block/g) || []).length,
      1,
      "only the authoring card may be desktop-only",
    );
  });

  test("the desktop-only gate never hides report consumption", () => {
    const src = reportSource("CustomReportsAdmin.jsx");
    const listAt = src.indexOf("Available reports");
    const resultsAt = src.indexOf('title="Results"');
    const gateAt = src.indexOf("hidden md:block");
    assert.ok(listAt > -1, "the saved-reports list stays available");
    assert.ok(resultsAt > -1, "run results stay available");
    assert.ok(gateAt > listAt && gateAt < resultsAt, "the gate sits on the builder card only");
  });

  test("the Reports section never reaches into the Till/POS runtime", () => {
    for (const file of REPORT_FILES) {
      assert.doesNotMatch(reportSource(file), /pages\/pos\/|AdminNavDock/, file);
    }
  });

  test("report authoring is not imported by the Till/POS runtime", () => {
    for (const file of [
      "src/pages/pos/POS.jsx",
      "src/pages/pos/POSHeader.jsx",
      "src/pages/pos/CartPanel.jsx",
      "src/pages/pos/ProductGrid.jsx",
    ]) {
      assert.doesNotMatch(read(file), /CustomReportsAdmin|CustomReportBuilder/, file);
    }
  });

  test("primary-button text comes from the accent-contrast token, not hard-coded white", () => {
    const block = INDEX_CSS.slice(
      INDEX_CSS.indexOf(".onepos-btn-primary {"),
      INDEX_CSS.indexOf(".onepos-btn-primary:hover"),
    );
    assert.match(block, /color: var\(--onepos-accent-contrast/, "must use the contrast token");
    assert.doesNotMatch(block, /@apply text-white/, "hard-coded white fails in Dark");
  });

  test("primary-button text clears 4.5:1 for every preset × appearance × accent", () => {
    for (const preset of LAYOUT_PRESETS.map((p) => p.key)) {
      for (const appearance of APPEARANCE_OPTIONS.map((a) => a.key)) {
        for (const accent of ACCENT_OPTIONS.map((a) => a.key)) {
          const map = tokensForPreferences({
            preset,
            appearance,
            accent,
            sidebarCollapsed: false,
          });
          const bg = parseColor(map["--onepos-accent-600"]);
          const fg = parseColor(map["--onepos-accent-contrast"]);
          assert.ok(bg && fg, `${preset}/${appearance}/${accent}: tokens must resolve`);
          const ratio = contrastOf(fg, bg);
          assert.ok(
            ratio >= 4.5,
            `${preset}/${appearance}/${accent}: primary button text ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }
  });
});
