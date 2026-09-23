/*
 * T10B - Granular Permissions Regression Tests
 *
 * Tests the granular permission implementation:
 *  - Permission catalogue completeness (init.js / schema.sql / server.js)
 *  - Authorize middleware behaviour (admin bypass, OR logic, 403 on miss)
 *  - Reports route enforcement (each endpoint has its own authorize code)
 *  - PERMISSION_GROUPS UI structure (Sales/Customers/Products/Purchases/
 *    Inventory/Returns/Reports with individual report checkboxes, NO single
 *    report.view switch)
 *  - Cross-report isolation (reports.sales.view ≠ reports.inventory.view)
 *
 * Run:  node --test tests/granularPermissions.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------- file I/O */

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/* --------------------------------------------------- catalogue builders */

const EXPECTED_GRANULAR_CODES = [
  "sale.view", "sale.create", "sale.edit", "sale.delete",
  "sale.invoice.view", "sale.invoice.reprint",
  "customer.delete",
  "purchase.view", "purchase.create", "purchase.edit", "purchase.delete",
  "inventory.movements.view",
  "returns.approve",
  "reports.summary.view", "reports.sales.view", "reports.products.view",
  "reports.customers.view", "reports.inventory.view",
  "reports.inventory_movements.view", "reports.low_stock.view",
  "reports.payments.view", "reports.purchases.view", "reports.returns.view",
  "reports.profit.view", "reports.till.view", "reports.vat.view",
];

const OLD_PERMISSIONS_KEPT = [
  "sale.create", "sale.discount", "sale.void_item",
  "sale.refund", "sale.refund_without_receipt", "sale.price_change", "sale.hold",
  "product.view", "product.create", "product.edit", "product.delete",
  "inventory.view", "inventory.adjust",
  "customer.view", "customer.create", "customer.edit",
  "report.export",
  "cash.open_drawer", "cash.payout", "cash.adjustment",
  "till.open", "till.close",
  "returns.view", "returns.create",
  "user.manage", "role.manage", "payment.manage", "integration.manage", "settings.manage",
];

/* --------------------------------------------------------- static scans */

describe("T10B Permission Catalogue (all 3 insert paths)", () => {
  const sources = [
    ["database/schema.sql", read("database/schema.sql")],
    ["database/init.js", read("database/init.js")],
    ["server.js (setup endpoint)", read("server.js")],
  ];

  for (const [name, content] of sources) {
    test(`${name}: every NEW granular code is inserted`, () => {
      for (const code of EXPECTED_GRANULAR_CODES) {
        assert.ok(
          content.includes(`'${code}'`) || content.includes(`"${code}"`),
          `missing permission code in ${name}: ${code}`
        );
      }
    });

    test(`${name}: every OLD compatible code is still present`, () => {
      for (const code of OLD_PERMISSIONS_KEPT) {
        assert.ok(
          content.includes(`'${code}'`) || content.includes(`"${code}"`),
          `regression: removed backward-compatible code in ${name}: ${code}`
        );
      }
    });
  }

  test("broad report.view is NOT in the new catalogue (reports are split)", () => {
    // The old "report.view" (singular, no prefix) must be gone so admins
    // cannot accidentally grant access to ALL reports via one checkbox.
    // "reports.X.view" (plural, with prefix) and "report.export" remain OK.
    const schema = read("database/schema.sql");
    const broadMatches = schema.match(/'report\.view'/g) || [];
    const individualMatches = schema.match(/'reports\.[a-z_]+\.view'/g) || [];
    assert.equal(
      broadMatches.length,
      0,
      `found broad 'report.view' permission still inserted — it must be split.`
    );
    assert.ok(
      individualMatches.length >= 13,
      `expected ≥13 individual reports.*.view codes, got ${individualMatches.length}`
    );
  });
});

/* ------------------------------------------------ authorize middleware */

function buildAuthorize({
  adminRoleIds = new Set(),
  roleCodes = new Map(),
}) {
  // Mirrors server.js authorization behaviour: OR over required codes,
  // 401 when unauthenticated, 403 when no match.
  return (...required) => async (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Authentication required" });
    try {
      const codes = roleCodes.get(req.user.roleId) || [];
      if (required.some((c) => codes.includes(c))) return next();
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action" });
    } catch {
      return res.status(500).json({ success: false, message: "Authorization check failed" });
    }
  };
}

const USER = (roleId) => ({ id: "u-1", companyId: "c-1", storeId: "s-1", roleId });

function mockRes() {
  const state = { status: 200, body: null };
  const res = {
    status: (s) => {
      state.status = s;
      return {
        json: (b) => { state.body = b; },
      };
    },
    json: (b) => { state.body = b; },
  };
  Object.defineProperty(res, "statusCode", { get: () => state.status });
  Object.defineProperty(res, "body", { get: () => state.body });
  return res;
}

describe("T10B authorize middleware behaviour", () => {
  test("administrator roles still require their assigned permission (#10)", async () => {
    const ADMIN_ROLE = "r-admin";
    const authorize = buildAuthorize({
      adminRoleIds: new Set([ADMIN_ROLE]),
      roleCodes: new Map([[ADMIN_ROLE, ["product.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("product.view", "product.create")(
      { user: USER(ADMIN_ROLE) },
      res,
      () => { calledNext = true; }
    );
    assert.equal(calledNext, true, "administrator may proceed with the assigned permission");
  });

  test("user WITH product.view can view products (#1)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["product.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("product.view")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, true);
  });

  test("user WITHOUT product.view receives 403 (#2)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["customer.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("product.view")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /permission/i);
  });

  test("user WITH product.create can create products (#3)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["product.create"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("product.create")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, true);
  });

  test("user WITHOUT product.create receives 403 (#4)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["product.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("product.create")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 403);
  });

  test("OR logic: purchase.view works even when old inventory.view is absent", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["purchase.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("purchase.view", "inventory.view")(
      { user: USER(ROLE) }, res, () => { calledNext = true; }
    );
    assert.equal(calledNext, true, "new purchase.view must be accepted on its own");
  });

  test("backward compat: old inventory.view still lets user in via OR", async () => {
    const ROLE = "r-legacy";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["inventory.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("purchase.view", "inventory.view")(
      { user: USER(ROLE) }, res, () => { calledNext = true; }
    );
    assert.equal(calledNext, true, "existing roles with inventory.view must not break");
  });
});

describe("T10B Individual Report Permission Isolation (#6–#9)", () => {
  test("user with only reports.sales.view can access Sales Report (#6)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["reports.sales.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("reports.sales.view")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, true);
  });

  test("user without reports.sales.view CANNOT access Sales Report (#7)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["reports.inventory.view"]]]),
    });
    const res = mockRes();
    let calledNext = false;
    await authorize("reports.sales.view")({ user: USER(ROLE) }, res, () => { calledNext = true; });
    assert.equal(calledNext, false);
    assert.equal(res.statusCode, 403);
  });

  test("reports.sales.view does NOT grant reports.inventory.view (#8)", async () => {
    const ROLE = "r-staff";
    const authorize = buildAuthorize({
      roleCodes: new Map([[ROLE, ["reports.sales.view"]]]),
    });
    const resOk = mockRes();
    const resDenied = mockRes();
    let ok = false, denied = false;
    await authorize("reports.sales.view")({ user: USER(ROLE) }, resOk, () => { ok = true; });
    await authorize("reports.inventory.view")({ user: USER(ROLE) }, resDenied, () => { denied = true; });
    assert.equal(ok, true);
    assert.equal(denied, false);
    assert.equal(resDenied.statusCode, 403, "Sales Report permission must not leak to Inventory Report");
  });

  test("nine distinct report codes are fully isolated pairwise (spot check)", async () => {
    const codes = [
      "reports.sales.view", "reports.products.view", "reports.customers.view",
      "reports.inventory.view", "reports.inventory_movements.view",
      "reports.low_stock.view", "reports.profit.view", "reports.till.view",
      "reports.vat.view",
    ];
    for (const granted of codes) {
      const ROLE = "r-" + granted.replace(/\./g, "_");
      const authorize = buildAuthorize({
        roleCodes: new Map([[ROLE, [granted]]]),
      });
      for (const required of codes) {
        const res = mockRes();
        let next = false;
        await authorize(required)({ user: USER(ROLE) }, res, () => { next = true; });
        if (required === granted) {
          assert.equal(next, true, `${granted} should allow access to its own endpoint`);
        } else {
          assert.equal(next, false, `${granted} must NOT allow access to ${required} (#9)`);
          assert.equal(res.statusCode, 403);
        }
      }
    }
  });
});

/* --------------------------------------------- route enforcement scan */

describe("T10B Reports route enforcements (server-side security check)", () => {
  const reportsSrc = read("routes/reports.js");

  // Factory receives authorize parameter — critical, otherwise the middleware
  // is undefined and calls to it would throw (or silently pass).
  test("createReportsRouter factory accepts `authorize` parameter", () => {
    assert.match(
      reportsSrc,
      /createReportsRouter\(\s*\{\s*authenticate\s*,\s*authorize\s*,\s*db\s*\}/,
      "createReportsRouter must have authorize injected — security requires it"
    );
  });

  const ENDPOINTS = [
    ["/reports/summary", "reports.summary.view"],
    ["/reports/sales", "reports.sales.view"],
    ["/reports/products", "reports.products.view"],
    ["/reports/payments", "reports.payments.view"],
    ["/reports/customers", "reports.customers.view"],
    ["/reports/inventory-movements", "reports.inventory_movements.view"],
    ["/reports/profit", "reports.profit.view"],
    ["/reports/till", "reports.till.view"],
    ["/reports/vat", "reports.vat.view"],
  ];

  for (const [route, code] of ENDPOINTS) {
    test(`${route} enforces authorize("${code}")`, () => {
      // The route registration must have authorize(<code>) between the path
      // and the handler. Scan for the exact pattern in routes/reports.js.
      const routeBlock = reportsSrc.match(
        new RegExp(`router\\.get\\(\\s*["']${route.replace('/', '\\/')}["'][\\s\\S]*?authorize\\([^)]*["']${code}["'][^)]*\\)`, 'm')
      );
      assert.ok(
        routeBlock,
        `missing authorize('${code}') on GET ${route} — endpoint would be open!`
      );
    });
  }

  test("server.js passes authorize to createReportsRouter (wiring check)", () => {
    const serverSrc = read("server.js");
    assert.match(
      serverSrc,
      /createReportsRouter\(\s*\{\s*authenticate\s*,\s*authorize\s*,\s*db\b[\s\S]*?\}\s*\)/,
      "server.js must inject authorize into createReportsRouter"
    );
  });
});

/* -------------------------------------------------------- sales routes */

describe("T10B sales route permission fixes", () => {
  const salesSrc = read("routes/sales.js");

  test("GET /sales uses sale.view (backward compat with sale.create/refund)", () => {
    assert.match(
      salesSrc,
      /router\.get\(\s*["']\/sales["'][^)]*authorize\([^)]*"sale\.view"[^)]*"sale\.create"[^)]*"sale\.refund"[^)]*\)/s,
      "GET /sales must check sale.view first, with OR fallbacks for old role configs"
    );
  });

  test("GET /sales/:id includes sale.invoice.view (T10B invoice permission)", () => {
    assert.match(
      salesSrc,
      /router\.get\(\s*["']\/sales\/:id["'][^)]*authorize\([^)]*"sale\.invoice\.view"[^)]*\)/s,
      "GET /sales/:id must check sale.invoice.view per T10B spec"
    );
  });
});

/* ------------------------------------------------------ UI groups test */

describe("T10B RolePermissionsManager UI structure", () => {
  const src = read("src/pages/settings/SettingsAdmin.jsx");

  const GROUPS_REQUIRED = [
    "Sales", "Customers", "Products", "Purchases", "Inventory",
    "Sales Returns", "Reports", "Administration",
    /* T10J merged the former "Cash Management" + "Till" groups into one
       "Cash/Till" group (codes unchanged — same cash.* and till.* codes). */
    "Cash/Till",
  ];

  test(`all ${GROUPS_REQUIRED.length} groups are present (Sales/.../Reports etc.)`, () => {
    for (const label of GROUPS_REQUIRED) {
      assert.match(
        src,
        new RegExp(`label:\\s*["']${label}["']`),
        `missing PERMISSION_GROUP with label "${label}"`
      );
    }
  });

  test("Reports group lists individual 13 reports.X.view + report.export (no broad report.view)", () => {
    // Extract the Reports codes block from PERMISSION_GROUPS.
    const reportsBlock = src.match(/label:\s*"Reports"[\s\S]*?codes:\s*\[(?<codes>[\s\S]*?)\],/);
    assert.ok(reportsBlock, "could not find Reports group codes array");
    const codesText = reportsBlock.groups.codes;

    const individualReportCodes = [
      "reports.summary.view", "reports.sales.view", "reports.products.view",
      "reports.customers.view", "reports.inventory.view",
      "reports.inventory_movements.view", "reports.low_stock.view",
      "reports.payments.view", "reports.purchases.view", "reports.returns.view",
      "reports.profit.view", "reports.till.view", "reports.vat.view",
    ];
    for (const c of individualReportCodes) {
      assert.ok(
        codesText.includes(`"${c}"`) || codesText.includes(`'${c}'`),
        `Reports group missing individual checkbox code: ${c}`
      );
    }
    assert.ok(
      codesText.includes("report.export"),
      "report.export must still be present for cross-report CSV/PDF export"
    );
    assert.ok(
      !(codesText.includes(`"report.view"`) || codesText.includes(`'report.view'`)),
      "broad 'report.view' single checkbox MUST be removed from UI — use individual codes"
    );
  });

  test("No single 'Disable Reports' toggle or override in SettingsAdmin", () => {
    // T10B explicitly forbids a master switch that overrides individual
    // per-report permissions. Scan for common names.
    const forbidden = [
      "disableReports", "disable_reports", "reportsEnabled", "reports.enabled",
      "Reports Disabled", "Disable all reports", "reportsAll",
    ];
    for (const pattern of forbidden) {
      assert.ok(
        !src.includes(pattern),
        `found potential master reports override pattern "${pattern}" — T10B forbids this.`
      );
    }
  });

  test("Sales Returns group includes returns.approve", () => {
    const block = src.match(/label:\s*"Sales Returns"[\s\S]*?codes:\s*\[(?<codes>[\s\S]*?)\],/);
    assert.ok(block, "Sales Returns group missing");
    assert.ok(
      block.groups.codes.includes("returns.approve"),
      "Sales Returns group missing 'returns.approve' permission"
    );
  });
});

/* ---------------------------------------- company/store isolation check */

describe("T10B tenant isolation is untouched (preserve req.user scoping)", () => {
  test("routes/reports.js still scopes every query to req.user.companyId + storeId", () => {
    const reportsSrc = read("routes/reports.js");
    // scopedReportParams helper must exist and return [companyId, storeId, ...]
    assert.match(
      reportsSrc,
      /function scopedReportParams\(req\)\s*\{\s*return \[req\.user\.companyId,\s*req\.user\.storeId,/,
      "reports must continue to be companyId/storeId scoped — never tenant-leak"
    );
  });

  test("reports summary query still uses the scoped params (no global SQL)", () => {
    const reportsSrc = read("routes/reports.js");
    const summaryQuery = reportsSrc.match(
      /router\.get\(\s*["']\/reports\/summary["'][\s\S]*?WHERE s\.company_id=\$1[\s\S]*?AND s\.store_id=\$2/
    );
    assert.ok(summaryQuery, "reports/summary lost its companyId/storeId WHERE clauses — isolation regression");
  });
});
