/*
 * onePOS — Daily Till Close report: Expected vs Actual cash (focused suite)
 *
 *   node --test tests/tillDailyClose.test.mjs
 *
 * Backend under test: the REAL routes/reports.js over HTTP against stateful
 * SQL fakes that model till_sessions, cash_movements, sales/payments,
 * refunds, terminals, stores and companies (with timezones). The report must
 * echo the authoritative persisted values (expected_cash / closing_cash /
 * cash_difference) — never recompute a disagreeing number.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "a0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000101";
const STORE_2 = "c0000000-0000-4000-8000-000000000102";
const STORE_B = "c0000000-0000-4000-8000-000000000103";
const TERM_1 = "d0000000-0000-4000-8000-000000001101";
const TERM_2 = "d0000000-0000-4000-8000-000000001102";
const TERM_S2 = "d0000000-0000-4000-8000-000000001301";
const TERM_B1 = "d0000000-0000-4000-8000-000000001201";
const USER = "e0000000-0000-4000-8000-000000000901";

process.env.NODE_ENV = "test";

const TZ = "Europe/London";
const dayStr = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
};
const TODAY = dayStr(0);
const YESTERDAY = dayStr(-1);
const iso = (day, hour = 9) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();

function makeCtx() {
  const state = {
    companies: [
      { id: COMPANY_A, timezone: TZ },
      { id: COMPANY_B, timezone: TZ },
    ],
    stores: [
      { id: STORE_1, company_id: COMPANY_A },
      { id: STORE_2, company_id: COMPANY_A },
      { id: STORE_B, company_id: COMPANY_B },
    ],
    terminals: [
      { id: TERM_1, store_id: STORE_1, name: "Till 01", terminal_number: "T01", active: true },
      { id: TERM_2, store_id: STORE_1, name: "Till 02", terminal_number: "T02", active: true },
      { id: TERM_S2, store_id: STORE_2, name: "Till S2", terminal_number: "TS2", active: true },
      { id: TERM_B1, store_id: STORE_B, name: "B Till", terminal_number: "BT1", active: true },
    ],
    sessions: [],
    movements: [],
    sales: [],
    refunds: [],
    payments: [],
    roleCodes: ["reports.till.view"],
    seq: 0,
  };
  const nextId = () => `id-${(state.seq += 1)}`;

  const businessDate = (openedAt) =>
    new Date(openedAt).toLocaleDateString("en-CA", { timeZone: TZ });

  const cashSalesFor = (sess, until) =>
    state.sales
      .filter(
        (s) =>
          s.company_id === sess.company_id &&
          s.store_id === sess.store_id &&
          s.terminal_id === sess.terminal_id &&
          s.status === "completed" &&
          s.payment_method === "cash" &&
          new Date(s.created_at) >= new Date(sess.opened_at) &&
          new Date(s.created_at) <= new Date(until)
      )
      .reduce((a, s) => a + s.total, 0);

  const cashRefundsFor = (sess, until) =>
    state.refunds
      .filter((r) => {
        const sale = state.sales.find((s) => s.id === r.sale_id);
        return (
          sale &&
          sale.company_id === sess.company_id &&
          sale.store_id === sess.store_id &&
          sale.terminal_id === sess.terminal_id &&
          r.payment_method === "cash" &&
          new Date(r.created_at) >= new Date(sess.opened_at) &&
          new Date(r.created_at) <= new Date(until)
        );
      })
      .reduce((a, r) => a + r.amount, 0);

  const movementsTotal = (sessionId, type) =>
    state.movements.filter((m) => m.till_session_id === sessionId && m.type === type).reduce((a, m) => a + m.amount, 0);

  const sessionRow = (sess, withPosition) => {
    const term = state.terminals.find((t) => t.id === sess.terminal_id);
    const company = state.companies.find((c) => c.id === sess.company_id);
    const closed = sess.status === "closed";
    const until = closed ? sess.closed_at : new Date().toISOString();
    const cashIn = withPosition ? movementsTotal(sess.id, "cash_in") : 0;
    const cashOut = withPosition ? movementsTotal(sess.id, "cash_out") : 0;
    const cashSales = withPosition ? cashSalesFor(sess, until) : 0;
    const cashRefunds = withPosition ? cashRefundsFor(sess, until) : 0;
    return {
      id: sess.id,
      status: sess.status,
      opened_at: sess.opened_at,
      closed_at: sess.closed_at,
      opening_cash: sess.opening_cash,
      closing_cash: sess.closing_cash,
      expected_cash: sess.expected_cash,
      cash_difference: sess.cash_difference,
      business_date: businessDate(sess.opened_at),
      terminal_name: term?.name ?? null,
      timezone: company?.timezone ?? TZ,
      cash_in_total: cashIn,
      cash_out_total: cashOut,
      cash_sales: cashSales,
      cash_refunds: cashRefunds,
      opened_by_name: " opener",
      closed_by_name: sess.closed_by ? " closer" : null,
    };
  };

  const matchSql = async (s0, params) => {
    const s = String(s0).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

    /* ---------- daily till close LIST ---------- */
    if (/business_date/.test(s) && /FROM till_sessions ts/.test(s) && /GROUP BY ts\.id/.test(s)) {
      const from = params[2] || null;
      const to = params[3] || null;
      const rows = state.sessions
        .filter((x) => x.company_id === params[0] && x.store_id === params[1])
        .filter((x) => {
          const bd = businessDate(x.opened_at);
          return (!from || bd >= from) && (!to || bd <= to);
        })
        .sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at))
        .map((x) => sessionRow(x, true));
      return { rows };
    }

    /* ---------- daily till close DETAIL (session) ---------- */
    if (/WHERE ts\.id = \$3 AND ts\.company_id = \$1 AND ts\.store_id = \$2/.test(s)) {
      const sess = state.sessions.find(
        (x) => x.id === params[2] && x.company_id === params[0] && x.store_id === params[1]
      );
      if (!sess) return { rows: [] };
      return { rows: [sessionRow(sess, true)] };
    }

    /* ---------- daily till close DETAIL (movements) ---------- */
    if (/SELECT cm\.id, cm\.type, cm\.amount, cm\.reason, cm\.created_at, u\.username/.test(s)) {
      const rows = state.movements
        .filter((m) => m.till_session_id === params[2])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 200)
        .map((m) => ({ id: m.id, type: m.type, amount: m.amount, reason: m.reason, created_at: m.created_at, username: "who" }));
      return { rows };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    const r = await matchSql(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 };
  };

  return { state, db, nextId };
}

/* ---------------------------------------------------------------- harness */

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, role = "manager", userId = USER } = {}) {
  const mod = await import("../routes/reports.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: userId, companyId, storeId, roleId: `role-${role}`, role };
    next();
  });
  const permsFor = async (roleId) => (roleId === "role-admin" ? ["*"] : ctx.state.roleCodes);
  const canView = async (user) => user.role === "admin";
  const authorize = (...permissionCodes) => async (req, res, next) => {
    if (await canView(req.user)) return next();
    const codes = await permsFor(req.user.roleId);
    if (permissionCodes.some((code) => codes.includes(code))) return next();
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  };
  app.use("/api", mod.default({ authenticate: (_q, _s, n) => n(), authorize, db: ctx.db }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, port: server.address().port };
}

const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* Seed helpers */
function seedClosed(ctx, { terminalId, storeId = STORE_1, companyId = COMPANY_A, opening, expected, closing, diff, day = TODAY, openHour = 9, closeHour = 18 }) {
  const sess = {
    id: ctx.nextId(),
    company_id: companyId,
    store_id: storeId,
    terminal_id: terminalId,
    user_id: USER,
    opening_cash: opening,
    status: "closed",
    opened_at: iso(day, openHour),
    closed_at: iso(day, closeHour),
    closed_by: USER,
    closing_cash: closing,
    expected_cash: expected,
    cash_difference: diff,
  };
  ctx.state.sessions.push(sess);
  return sess;
}

/* ------------------------------------------------------------- fixtures */
function seedStandardDay(ctx) {
  /* S1: Till 01 today — short by £10. 100 + 100 in + 1200 sales − 50 out − 100 refunds = 1250 expected. */
  const s1 = seedClosed(ctx, { terminalId: TERM_1, opening: 100, expected: 1250, closing: 1240, diff: -10 });
  ctx.state.movements.push(
    { id: ctx.nextId(), till_session_id: s1.id, user_id: USER, type: "cash_in", amount: 100, reason: "Float top-up", store_id: STORE_1, terminal_id: TERM_1, created_at: iso(TODAY, 10) },
    { id: ctx.nextId(), till_session_id: s1.id, user_id: USER, type: "cash_out", amount: 50, reason: "Safe drop", store_id: STORE_1, terminal_id: TERM_1, created_at: iso(TODAY, 12) }
  );
  const cashSale = { id: ctx.nextId(), company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_1, status: "completed", payment_method: "cash", total: 1200, created_at: iso(TODAY, 11) };
  const cardSale = { id: ctx.nextId(), company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_1, status: "completed", payment_method: "card", total: 500, created_at: iso(TODAY, 11) };
  ctx.state.sales.push(cashSale, cardSale);
  ctx.state.payments.push(
    { sale_id: cashSale.id, payment_method: "cash" },
    { sale_id: cardSale.id, payment_method: "card" }
  );
  ctx.state.refunds.push({ id: ctx.nextId(), sale_id: cashSale.id, payment_method: "cash", amount: 100, created_at: iso(TODAY, 13) });

  /* S2: Till 02, same store today — exact. */
  seedClosed(ctx, { terminalId: TERM_2, opening: 200, expected: 200, closing: 200, diff: 0 });

  /* S3: Till 01 yesterday — over by £15. */
  seedClosed(ctx, { terminalId: TERM_1, opening: 300, expected: 300, closing: 315, diff: 15, day: YESTERDAY });

  /* S4: Till 02 still open today — live position only, nothing counted. */
  const s4 = {
    id: ctx.nextId(),
    company_id: COMPANY_A,
    store_id: STORE_1,
    terminal_id: TERM_2,
    user_id: USER,
    opening_cash: 80,
    status: "open",
    opened_at: iso(TODAY, 8),
    closed_at: null,
    closed_by: null,
    closing_cash: null,
    expected_cash: null,
    cash_difference: null,
  };
  ctx.state.sessions.push(s4);
  ctx.state.movements.push({ id: ctx.nextId(), till_session_id: s4.id, user_id: USER, type: "cash_in", amount: 20, reason: "Change supply", store_id: STORE_1, terminal_id: TERM_2, created_at: iso(TODAY, 9) });
  ctx.state.sales.push({ id: ctx.nextId(), company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_2, status: "completed", payment_method: "cash", total: 30, created_at: iso(TODAY, 10) });
  return { s1, s4 };
}

/* ---------------------------------------------------------------- tests */

describe("daily till close report", () => {
  test("closed sessions appear with authoritative expected/actual/variance (short, exact, over)", async () => {
    const ctx = makeCtx();
    const { s1 } = seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${YESTERDAY}&dateTo=${TODAY}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      const sessions = res.body.data.sessions;
      assert.equal(sessions.length, 4);

      const short = sessions.find((x) => x.id === s1.id);
      assert.equal(short.expectedClosing, 1250);
      assert.equal(short.actualClosing, 1240);
      assert.equal(short.difference, -10);
      assert.equal(short.varianceStatus, "short");

      const exact = sessions.find((x) => x.expectedClosing === 200 && x.status === "closed");
      assert.equal(exact.difference, 0);
      assert.equal(exact.varianceStatus, "exact");

      const over = sessions.find((x) => x.difference === 15);
      assert.equal(over.varianceStatus, "over");
    } finally { server.close(); }
  });

  test("reconciliation components: cash-in, cash-out, cash sales, cash refunds all included", async () => {
    const ctx = makeCtx();
    const { s1 } = seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      const short = res.body.data.sessions.find((x) => x.id === s1.id);
      assert.equal(short.openingCash, 100);
      assert.equal(short.cashIn, 100);
      assert.equal(short.cashOut, 50);
      assert.equal(short.cashSales, 1200); // card sale (500) excluded
      assert.equal(short.cashRefunds, 100);
      /* Expected follows the established close-session formula. */
      assert.equal(short.expectedClosing, 100 + 100 + 1200 - 50 - 100);
    } finally { server.close(); }
  });

  test("multiple tills/sessions remain separately identifiable (no unexplained merge)", async () => {
    const ctx = makeCtx();
    seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      const sessions = res.body.data.sessions;
      const till1 = sessions.filter((x) => x.terminal === "Till 01");
      const till2 = sessions.filter((x) => x.terminal === "Till 02");
      assert.equal(till1.length, 1);
      assert.equal(till2.length, 2);
      assert.equal(new Set(sessions.map((x) => x.id)).size, sessions.length);
      const summary = res.body.data.summary;
      assert.equal(summary.sessions, 3);
      assert.equal(summary.difference, -10); // −10 + 0 + (open not counted)
    } finally { server.close(); }
  });

  test("date filtering: today excludes yesterday's session; yesterday selection returns it", async () => {
    const ctx = makeCtx();
    seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const today = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.ok(today.body.data.sessions.every((x) => x.businessDate === TODAY));
      assert.ok(!today.body.data.sessions.some((x) => x.difference === 15));

      const yest = await get(port, `/api/reports/till?dateFrom=${YESTERDAY}&dateTo=${YESTERDAY}`);
      assert.equal(yest.body.data.sessions.length, 1);
      assert.equal(yest.body.data.sessions[0].varianceStatus, "over");
    } finally { server.close(); }
  });

  test("open/unclosed session: live expected cash, no actual/variance, marked not counted", async () => {
    const ctx = makeCtx();
    const { s4 } = seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      const open = res.body.data.sessions.find((x) => x.id === s4.id);
      assert.equal(open.status, "open");
      assert.equal(open.expectedClosing, 80 + 20 + 30); // opening + cash-in + cash sales (live)
      assert.equal(open.actualClosing, null);
      assert.equal(open.difference, null);
      assert.equal(open.varianceStatus, null);
    } finally { server.close(); }
  });

  test("session detail returns stored reconciliation plus cash movements", async () => {
    const ctx = makeCtx();
    const { s1 } = seedStandardDay(ctx);
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till/${s1.id}`);
      assert.equal(res.status, 200);
      const { session, movements } = res.body.data;
      assert.equal(session.expectedClosing, 1250);
      assert.equal(session.actualClosing, 1240);
      assert.equal(session.varianceStatus, "short");
      assert.equal(session.businessDate, TODAY);
      const ins = movements.filter((m) => m.type === "cash_in");
      const outs = movements.filter((m) => m.type === "cash_out");
      assert.equal(ins.length, 1);
      assert.equal(ins[0].reason, "Float top-up");
      assert.equal(outs.length, 1);
      assert.equal(outs[0].reason, "Safe drop");
    } finally { server.close(); }
  });

  test("detail of a session from another company or store is 404", async () => {
    const ctx = makeCtx();
    const { s1 } = seedStandardDay(ctx);
    const appB = await buildApp(ctx, { companyId: COMPANY_B, storeId: STORE_B });
    const b = await listen(appB);
    try {
      const res = await get(b.port, `/api/reports/till/${s1.id}`);
      assert.equal(res.status, 404);
    } finally { b.server.close(); }

    const appStore2 = await buildApp(ctx, { companyId: COMPANY_A, storeId: STORE_2 });
    const s2app = await listen(appStore2);
    try {
      const res = await get(s2app.port, `/api/reports/till/${s1.id}`);
      assert.equal(res.status, 404);
    } finally { s2app.server.close(); }
  });

  test("list is company+store scoped: other companies/stores never appear", async () => {
    const ctx = makeCtx();
    seedStandardDay(ctx);
    seedClosed(ctx, { terminalId: TERM_S2, storeId: STORE_2, opening: 10, expected: 10, closing: 10, diff: 0 });
    seedClosed(ctx, { terminalId: TERM_B1, storeId: STORE_B, companyId: COMPANY_B, opening: 10, expected: 10, closing: 10, diff: 0 });
    const appStore2 = await buildApp(ctx, { companyId: COMPANY_A, storeId: STORE_2 });
    const s2app = await listen(appStore2);
    try {
      const res = await get(s2app.port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.equal(res.body.data.sessions.length, 1);
      assert.equal(res.body.data.sessions[0].terminal, "Till S2");
    } finally { s2app.server.close(); }

    const appB = await buildApp(ctx, { companyId: COMPANY_B, storeId: STORE_B });
    const b = await listen(appB);
    try {
      const res = await get(b.port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.equal(res.body.data.sessions.length, 1);
      assert.equal(res.body.data.sessions[0].terminal, "B Till");
    } finally { b.server.close(); }
  });

  test("unauthorized role without reports.till.view is rejected on list and detail", async () => {
    const ctx = makeCtx();
    const { s1 } = seedStandardDay(ctx);
    ctx.state.roleCodes = [];
    const app = await buildApp(ctx, { role: "cashier" });
    const { server, port } = await listen(app);
    try {
      const list = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.equal(list.status, 403);
      const detail = await get(port, `/api/reports/till/${s1.id}`);
      assert.equal(detail.status, 403);
    } finally { server.close(); }
  });

  test("admin bypass keeps working for the report", async () => {
    const ctx = makeCtx();
    ctx.state.roleCodes = [];
    seedStandardDay(ctx);
    const app = await buildApp(ctx, { role: "admin" });
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.sessions.length >= 3);
    } finally { server.close(); }
  });

  test("no closed sessions: empty list, not an error", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await get(port, `/api/reports/till?dateFrom=${TODAY}&dateTo=${TODAY}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.sessions.length, 0);
      assert.equal(res.body.data.summary.sessions, 0);
    } finally { server.close(); }
  });
});

describe("daily till close static contracts", () => {
  test("closed sessions use the persisted expected/difference values (no recompute path)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("routes/reports.js", "utf8");
    assert.ok(/expected = closed\s*\?\s*Number\(row\.expected_cash\)/.test(src), "closed sessions must report stored expected_cash");
    assert.ok(/const difference = closed \? Number\(row\.cash_difference\) \|\| 0 : null;/.test(src), "variance must be the persisted cash_difference");
    /* frontend never recomputes: TillReport has no expected-cash arithmetic */
    const ui = fs.readFileSync("src/pages/reports/TillReport.jsx", "utf8");
    assert.ok(!/\bopeningCash\s*\+/.test(ui), "UI must not recompute expected cash from components");
    assert.ok(/expectedClosing/.test(ui), "UI displays the server value");
  });
});
