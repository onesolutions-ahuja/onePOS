/*
 * JARVES phase-2 tests: read-only Sales tool + licence control + UI identity.
 *
 * All tests run without a real database or the real Gemini API - the existing
 * `db` helper and the AI provider are injected as mocks so the tests pin the
 * CONTRACT: identity comes from the verified session context only, permissions
 * are the existing report codes, "today" uses the company timezone, tools are
 * SELECT-only, and no credential ever reaches a prompt or response.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SALES_TODAY_TOOL_NAME,
  createJarvisTools,
  formatToolResultBlock,
} from "../services/jarvis/tools/index.js";
import {
  normalizeJarvesAllowance,
  JARVES_ALLOWANCE_RESULTS,
  getJarvesLicenceState,
  isJarvesEnabledForUser,
  setJarvesAllowance,
  setJarvesUserEnabled,
  createJarvesAccessChecker,
} from "../services/jarvis/licensing.js";
import { createJarvisService } from "../services/jarvis/service.js";
import { JarvisError, JARVIS_ERROR_CODES, jarvisPublicMessage } from "../services/jarvis/errors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Configurable mock of the existing server.js `db(query, params)` helper. */
function mockDb(handlers) {
  const queries = [];
  const db = async (query, params = []) => {
    queries.push({ query: query.replace(/\s+/g, " ").trim(), params });
    for (const handler of handlers) {
      const result = handler(query, params, queries);
      if (result !== undefined) return result;
    }
    return { rows: [] };
  };
  db.queries = queries;
  return db;
}

const TIMEZONE_HANDLER = (query, params) => {
  if (/FROM companies WHERE id/i.test(query)) return { rows: [{ timezone: "Europe/London" }] };
  if (/NOW\(\) AT TIME ZONE/i.test(query)) return { rows: [{ today: "2026-09-21" }] };
  return undefined;
};

const SALES_HANDLER = (query) => {
  if (/sales_total AS/i.test(query)) {
    return { rows: [{ gross_sales: "150.50", transactions: 3, vat: "25.08", discounts: "5.00", returned_value: "10.00" }] };
  }
  return undefined;
};

describe("JARVES read-only Sales tool", () => {
  test("an authorised user receives REAL today's sales computed from the existing report definitions", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const result = await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"],
    });

    assert.equal(result.tool, SALES_TODAY_TOOL_NAME);
    assert.equal(result.summary.grossSales, 150.5);
    assert.equal(result.summary.transactions, 3);
    assert.equal(result.summary.returns, 10);
    assert.equal(result.summary.netSales, 140.5);
    /* Same definitions as routes/reports.js: completed sales, customer returns. */
    const salesQuery = db.queries.find((q) => /sales_total AS/i.test(q.query));
    assert.match(salesQuery.query, /s\.status='completed'/);
    assert.match(salesQuery.query, /return_type='CUSTOMER'/);
  });

  test("the query is scoped by the VERIFIED session company and store, never by client input", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db });
    await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "company-A", storeId: "store-A", permissions: ["reports.sales.view"],
    });
    const salesQuery = db.queries.find((q) => /sales_total AS/i.test(q.query));
    assert.deepEqual(salesQuery.params, ["company-A", "store-A", "2026-09-21"]);
    const returnsQuery = db.queries.find((q) => /stock_returns/i.test(q.query));
    assert.deepEqual(returnsQuery.params, ["company-A", "store-A", "2026-09-21"]);
  });

  test("a user WITHOUT Sales permissions is refused and no data is queried or leaked", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    await assert.rejects(
      () => tools.executeTool(SALES_TODAY_TOOL_NAME, { companyId: "c-1", storeId: "s-1", permissions: ["product.view"] }),
      (error) => {
        assert.ok(error instanceof JarvisError);
        assert.equal(error.code, JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED);
        assert.equal(error.httpStatus, 403);
        return true;
      }
    );
    assert.equal(db.queries.some((q) => /sales_total AS/i.test(q.query)), false);
  });

  test("the EXISTING Administrator/Owner bypass grants access without a report permission", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: async () => true });
    const result = await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "c-1", storeId: "s-1", permissions: [],
    });
    assert.equal(result.summary.transactions, 3);
  });

  test("a bypass helper failure can never accidentally grant access", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: async () => { throw new Error("db down"); } });
    await assert.rejects(
      () => tools.executeTool(SALES_TODAY_TOOL_NAME, { companyId: "c-1", storeId: "s-1", permissions: [] }),
      (error) => error.code === JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED
    );
  });

  test("\"today\" uses the COMPANY timezone convention, never the server clock", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"],
    });
    const tzQuery = db.queries.find((q) => /FROM companies WHERE id/i.test(q.query));
    assert.ok(tzQuery, "reads companies.timezone");
    const todayQuery = db.queries.find((q) => /NOW\(\) AT TIME ZONE/i.test(q.query));
    assert.deepEqual(todayQuery.params, ["Europe/London"]);
  });

  test("tools are strictly READ-ONLY (SELECT only)", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"],
    });
    for (const q of db.queries) {
      assert.doesNotMatch(q.query, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT)\b/i);
      assert.match(q.query, /^\s*(WITH|SELECT)/i);
    }
  });

  test("an unknown tool is refused", async () => {
    const tools = createJarvisTools({ db: mockDb([]) });
    await assert.rejects(
      () => tools.executeTool("stock_levels", { permissions: ["reports.summary.view"] }),
      (error) => error.code === JARVIS_ERROR_CODES.TOOL_UNAVAILABLE
    );
  });
});

describe("JARVES licence control", () => {
  const LICENCE_STATE_HANDLER = (query, params) => {
    if (/jarves_licence_users FROM company_settings/i.test(query)) {
      return { rows: [{ jarves_licence_users: params[0] === "c-full" ? 1 : 5 }] };
    }
    if (/COUNT\(\*\)::int AS enabled/i.test(query)) {
      return { rows: [{ enabled: params[0] === "c-full" ? 1 : 2 }] };
    }
    return undefined;
  };

  test("allowance normalisation rejects junk, negatives and absurd values", () => {
    assert.equal(normalizeJarvesAllowance("5"), 5);
    assert.equal(normalizeJarvesAllowance(0), 0);
    assert.equal(normalizeJarvesAllowance(12.5), null);
    assert.equal(normalizeJarvesAllowance(-1), null);
    assert.equal(normalizeJarvesAllowance("abc"), null);
    assert.equal(normalizeJarvesAllowance(999999), null);
  });

  test("an unset/zero allowance means no user can be JARVES-enabled", async () => {
    const db = mockDb([
      (q) => (/jarves_licence_users FROM company_settings/i.test(q) ? { rows: [] } : undefined),
      (q) => (/COUNT\(\*\)::int AS enabled/i.test(q) ? { rows: [{ enabled: 0 }] } : undefined),
    ]);
    const state = await getJarvesLicenceState(db, "c-1");
    assert.deepEqual(state, { allowance: 0, enabledUsers: 0, seatsRemaining: 0 });
  });

  test("enabling a user beyond the allowance is refused (ALLOWANCE_REACHED)", async () => {
    const db = mockDb([
      LICENCE_STATE_HANDLER,
      (q, p) => (/FROM users WHERE id = \$1 AND company_id/i.test(q) ? { rows: [] } : undefined),
    ]);
    const code = await setJarvesUserEnabled(db, { companyId: "c-full", userId: "u-2", enabled: true });
    assert.equal(code, JARVES_ALLOWANCE_RESULTS.ALLOWANCE_REACHED);
  });

  test("an already-enabled user can be re-set (does not consume an extra seat)", async () => {
    const db = mockDb([
      LICENCE_STATE_HANDLER,
      (q, p) => (/FROM users WHERE id = \$1 AND company_id/i.test(q) ? { rows: [{ id: "u-1" }] } : undefined),
      (q, p) => (/UPDATE users SET jarves_enabled/i.test(q) ? { rows: [{ id: "u-1", jarves_enabled: true }] } : undefined),
    ]);
    const code = await setJarvesUserEnabled(db, { companyId: "c-1", userId: "u-1", enabled: true });
    assert.equal(code, JARVES_ALLOWANCE_RESULTS.OK);
  });

  test("disabling a user is never blocked by the allowance", async () => {
    const db = mockDb([
      LICENCE_STATE_HANDLER,
      (q, p) => (/UPDATE users SET jarves_enabled/i.test(q) ? { rows: [{ id: "u-1", jarves_enabled: false }] } : undefined),
    ]);
    const code = await setJarvesUserEnabled(db, { companyId: "c-full", userId: "u-1", enabled: false });
    assert.equal(code, JARVES_ALLOWANCE_RESULTS.OK);
  });

  test("lowering the allowance below the enabled count is refused - users are never silently stripped", async () => {
    const db = mockDb([
      (q) => (/jarves_licence_users FROM company_settings/i.test(q) ? { rows: [{ jarves_licence_users: 5 }] } : undefined),
      (q) => (/COUNT\(\*\)::int AS enabled/i.test(q) ? { rows: [{ enabled: 3 }] } : undefined),
    ]);
    const code = await setJarvesAllowance(db, "c-1", 2, "admin-1");
    assert.equal(code, JARVES_ALLOWANCE_RESULTS.ALLOWANCE_BELOW_ENABLED);
    assert.equal(db.queries.some((q) => /INSERT INTO company_settings/i.test(q.query)), false);
  });

  test("a valid allowance persists through the existing company_settings upsert", async () => {
    const db = mockDb([
      (q) => (/COUNT\(\*\)::int AS enabled/i.test(q) ? { rows: [{ enabled: 2 }] } : undefined),
    ]);
    const code = await setJarvesAllowance(db, "c-1", 5, "admin-1");
    assert.equal(code, JARVES_ALLOWANCE_RESULTS.OK);
    const insert = db.queries.find((q) => /INSERT INTO company_settings/i.test(q.query));
    assert.match(insert.query, /ON CONFLICT \(company_id\) DO UPDATE/);
    assert.deepEqual(insert.params.slice(0, 2), ["c-1", 5]);
  });

  test("every licence query is company-scoped (no cross-company access)", async () => {
    const db = mockDb([LICENCE_STATE_HANDLER]);
    await getJarvesLicenceState(db, "c-A");
    for (const q of db.queries) {
      if (/users|company_settings/i.test(q.query)) {
        assert.match(q.query, /company_id = \$1|company_id/i);
      }
    }
    const enabled = db.queries.find((q) => /COUNT\(\*\)::int AS enabled/i.test(q.query));
    assert.deepEqual(enabled.params, ["c-A"]);
  });
});

describe("JARVES sales-today intent (natural language -> todays_sales)", () => {
  const SALES_QUESTIONS = [
    "How much have I sold today?",
    "How much sales today?",
    "What are today's sales?",
    "How much have we sold today?",
    "Today's sales",
    "What did we sell today?",
    "How much did we make today?",
    "How much did we sell today?",
  ];

  test("every natural-language sales wording resolves to the same todays_sales tool", () => {
    const tools = createJarvisTools({ db: mockDb([]) });
    for (const question of SALES_QUESTIONS) {
      const match = tools.matchTool(question);
      assert.deepEqual(match, { name: SALES_TODAY_TOOL_NAME }, `expected todays_sales for: ${question}`);
    }
  });

  test("every sales wording end-to-end grounds the provider with REAL tool figures", async () => {
    for (const question of SALES_QUESTIONS) {
      const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
      const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
      const seen = {};
      const provider = {
        name: "gemini",
        model: "test",
        isConfigured: () => true,
        async generateAnswer({ systemInstruction }) {
          seen.instruction = systemInstruction;
          return { text: "Today's sales are 150.50 across 3 transactions.", provider: "gemini", model: "test" };
        },
      };
      const service = createJarvisService({ provider, tools });
      const result = await service.ask({
        message: question,
        context: { companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"] },
      });
      assert.ok(result.answer.length > 0, `expected an answer for: ${question}`);
      assert.match(seen.instruction, /TOOL RESULT/, `expected grounding for: ${question}`);
      assert.match(seen.instruction, /150\.50/, `expected figures for: ${question}`);
    }
  });

  test("non-sales questions never trigger the sales tool", () => {
    const tools = createJarvisTools({ db: mockDb([]) });
    for (const question of [
      "How do I add a product?",
      "What time do we close today?",
      "How do I process a refund?",
      "Show me my settings",
    ]) {
      assert.equal(tools.matchTool(question), null, `must not match: ${question}`);
    }
  });

  test("zero sales return a clear zero grounding (never 'cannot access')", async () => {
    const zeroSales = (query) => (/sales_total AS/i.test(query)
      ? { rows: [{ gross_sales: "0", transactions: 0, vat: "0", discounts: "0", returned_value: "0" }] }
      : undefined);
    const db = mockDb([TIMEZONE_HANDLER, zeroSales]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const result = await tools.executeTool(SALES_TODAY_TOOL_NAME, {
      companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"],
    });
    assert.equal(result.summary.grossSales, 0);
    assert.equal(result.summary.transactions, 0);
    const block = formatToolResultBlock(result);
    assert.match(block, /Gross sales: 0\.00/);
    assert.match(block, /transactions: 0/);
  });

  test("REGRESSION: an unauthorised user cannot retrieve sales through JARVIS (403, no data read)", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const seen = {};
    const provider = {
      name: "gemini",
      model: "test",
      isConfigured: () => true,
      async generateAnswer({ systemInstruction }) {
        seen.instruction = systemInstruction;
        return { text: "general help", provider: "gemini", model: "test" };
      },
    };
    const service = createJarvisService({ provider, tools });
    await assert.rejects(
      () => service.ask({
        message: "How much have I sold today?",
        context: { companyId: "c-1", storeId: "s-1", permissions: ["product.view"] },
      }),
      (error) => {
        assert.ok(error instanceof JarvisError);
        assert.equal(error.code, JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED);
        assert.equal(error.httpStatus, 403);
        return true;
      }
    );
    assert.equal(db.queries.some((q) => /sales_total AS/i.test(q.query)), false, "no sales data may be read");
    assert.equal(seen.instruction, undefined, "the provider must never be called on denial");
    assert.equal(
      jarvisPublicMessage(JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED).includes("Sales"),
      true
    );
  });
});

describe("JARVES service integration (tool grounding)", () => {
  const PROVIDER = {
    name: "gemini",
    model: "gemini-3.5-flash-lite",
    isConfigured: () => true,
    async generateAnswer({ systemInstruction, message }) {
      PROVIDER.last = { systemInstruction, message };
      return { text: "Here are today's sales.", provider: "gemini", model: "gemini-3.5-flash-lite" };
    },
  };

  test("a sales question is grounded with REAL tool data before the provider is called", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const service = createJarvisService({ provider: PROVIDER, tools });
    const result = await service.ask({
      message: "What are today's sales?",
      context: { companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"] },
    });
    assert.equal(result.answer, "Here are today's sales.");
    assert.match(PROVIDER.last.systemInstruction, /Gross sales/);
    assert.match(PROVIDER.last.systemInstruction, /150\.50/);
    /* Tool result block explicitly forbids the model claiming live data access it does not have. */
    assert.match(PROVIDER.last.systemInstruction, /only these figures/);
  });

  test("a non-sales question never runs a tool and never injects data", async () => {
    const db = mockDb([]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const service = createJarvisService({ provider: PROVIDER, tools });
    await service.ask({ message: "How do I add a product?", context: { companyId: "c-1" } });
    assert.equal(db.queries.length, 0);
    assert.doesNotMatch(PROVIDER.last.systemInstruction, /Gross sales/);
  });

  test("a tool failure degrades safely to the general assistant (no fabricated figures)", async () => {
    const brokenTools = {
      matchTool: () => ({ name: SALES_TODAY_TOOL_NAME }),
      executeTool: async () => { throw new Error("db offline"); },
    };
    const service = createJarvisService({ provider: PROVIDER, tools: brokenTools });
    const result = await service.ask({
      message: "Today's sales?",
      context: { companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"] },
    });
    assert.equal(result.answer, "Here are today's sales.");
    assert.doesNotMatch(PROVIDER.last.systemInstruction, /Gross sales/);
    assert.match(PROVIDER.last.systemInstruction, /no tool data could be loaded/);
  });

  test("no API key or provider configuration ever reaches the prompt", async () => {
    const db = mockDb([TIMEZONE_HANDLER, SALES_HANDLER]);
    const tools = createJarvisTools({ db, canViewCompanyCustomers: null });
    const service = createJarvisService({ provider: PROVIDER, tools });
    await service.ask({
      message: "today's sales summary",
      context: { companyId: "c-1", storeId: "s-1", permissions: ["reports.summary.view"], apiKey: "sk-secret" },
    });
    assert.doesNotMatch(PROVIDER.last.systemInstruction, /sk-secret/);
    assert.doesNotMatch(JSON.stringify(PROVIDER.last), /sk-secret/);
  });
});

describe("JARVES UI identity (static contract)", () => {
  const orb = readFileSync(join(ROOT, "src/components/jarvis/JarvisOrb.jsx"), "utf8");
  const styles = readFileSync(join(ROOT, "src/components/jarvis/JarvisStyles.jsx"), "utf8");
  const panel = readFileSync(join(ROOT, "src/components/jarvis/JarvisPanel.jsx"), "utf8");

  test("the Orb is a MULTI-COLOUR living energy core, not a plain teal ball", () => {
    for (const colour of ["#22d3ee", "#a855f7", "#ec4899", "#34d399"]) {
      assert.ok(styles.includes(colour), `expected multi-colour layer ${colour}`);
    }
    assert.match(styles, /@keyframes jarvis-orb-hue/);
    assert.match(styles, /jarvis-orb-flow3/);
    assert.match(styles, /jarvis-orb-glint-alt/);
  });

  test("the Orb animates continuously, including idle", () => {
    assert.match(styles, /\.jarvis-orb-flow \{[^}]*animation:[^;]*infinite/s);
    assert.match(styles, /@keyframes jarvis-orb-orbit/);
    assert.match(styles, /@keyframes jarvis-orb-drift/);
    /* not a simple scale pulse as the main animation */
    assert.match(styles, /@keyframes jarvis-orb-sheen/);
  });

  test("idle/listening/thinking states remain wired", () => {
    assert.match(orb, /ORB_STATES/);
    assert.match(orb, /LISTENING/);
    assert.match(orb, /THINKING/);
    assert.match(styles, /jarvis-orb--listening/);
    assert.match(styles, /jarvis-orb--thinking/);
    assert.match(styles, /jarvis-message-settle/);
  });

  test("the Orb is not a microphone icon and keeps accessibility + click behaviour", () => {
    /* Icon-component identifiers/imports only - prose mentioning
       "microphone" in comments is fine and must not trip this. */
    assert.doesNotMatch(orb, /\bMic\b|MicOff|Volume2|lucide-react/);
    assert.match(orb, /aria-label=/);
    assert.match(orb, /aria-haspopup/);
    assert.match(orb, /aria-expanded/);
    assert.match(orb, /onClick/);
    assert.match(orb, /JARVES/);
  });

  test("prefers-reduced-motion remains supported", () => {
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(styles, /animation: none !important/);
  });

  test("user-facing branding is JARVES", () => {
    assert.match(panel, /JARVES/);
    assert.match(orb, /JARVES/);
    /* user-facing JARVIS strings would be a branding regression - code
       comments are checked too, via the visible >JARVES< heading. */
    assert.match(panel, />JARVES</);
    assert.doesNotMatch(orb, />JARVIS</);
  });
});



