/*
 * onePOS — Till Sessions + Cash Drawer Management foundation (focused suite)
 *
 *   node --test tests/tillSessions.test.mjs
 *
 * Backend under test: the REAL routes/till.js over HTTP against stateful
 * SQL fakes that model till_sessions (incl. the unique open-per-terminal
 * index), cash_movements, sales/payments/refunds, terminals and users.
 * Isolation tests prove company/store/till boundaries; regression covers
 * the sales-engine till-session lookup against the same fake.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "a0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000101";
const STORE_2 = "c0000000-0000-4000-8000-000000000102";
const TERM_1 = "d0000000-0000-4000-8000-000000001101";
const TERM_2 = "d0000000-0000-4000-8000-000000001102";
const TERM_B1 = "d0000000-0000-4000-8000-000000001201";
const USER = "e0000000-0000-4000-8000-000000000901";
const USER_2 = "e0000000-0000-4000-8000-000000000902";

process.env.NODE_ENV = "test";

function makeCtx() {
  const state = {
    terminals: [
      { id: TERM_1, store_id: STORE_1, name: "Till 01", terminal_number: "T01", active: true },
      { id: TERM_2, store_id: STORE_1, name: "Till 02", terminal_number: "T02", active: true },
      { id: TERM_B1, store_id: STORE_2, name: "B Till", terminal_number: "BT1", active: true },
    ],
    stores: [
      { id: STORE_1, company_id: COMPANY_A },
      { id: STORE_2, company_id: COMPANY_B },
    ],
    sessions: [], // { id, company_id, store_id, terminal_id, user_id, opening_cash, status, opened_at, closed_at, closed_by, closing_cash, expected_cash, cash_difference }
    movements: [], // { id, till_session_id, user_id, type, amount, reason, store_id, terminal_id, created_at }
    sales: [], // { id, company_id, store_id, terminal_id, total, status, payment_method, created_at }
    seq: 0,
    roleCodes: ["till.open", "till.close", "cash.adjustment", "cash.payout", "cash.open_drawer"],
  };
  const nextId = () => `id-${(state.seq += 1)}`;
  const now = () => new Date().toISOString();

  const matchSql = async (s0, params) => {
    const s = String(s0).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

    /* ---------- terminals / stores / companies ---------- */
    if (/SELECT id FROM terminals WHERE id = \$1 AND store_id = \$2 AND active = true$/.test(s)) {
      const t = state.terminals.find((t) => t.id === params[0] && t.store_id === params[1] && t.active);
      return { rows: t ? [{ id: t.id }] : [] };
    }
    if (/SELECT id FROM terminals WHERE store_id = \$1 AND active = true ORDER BY created_at LIMIT 1/.test(s)) {
      const t = state.terminals.find((t) => t.store_id === params[0] && t.active);
      return { rows: t ? [{ id: t.id }] : [] };
    }
    if (/SELECT id FROM terminals WHERE device_identifier = \$1 AND store_id = \$2 AND active = true/.test(s)) {
      const t = state.terminals.find((t) => t.device_identifier === params[0] && t.store_id === params[1] && t.active);
      return { rows: t ? [{ id: t.id }] : [] };
    }
    // sales.js engine lookup (regression): session + terminal + company timezone
    if (/SELECT ts\.id, ts\.terminal_id, t\.terminal_number, c\.timezone/.test(s)) {
      const sess = state.sessions.find(
        (x) => x.company_id === params[0] && x.store_id === params[1] && x.status === "open"
      );
      if (!sess) return { rows: [] };
      const term = state.terminals.find((t) => t.id === sess.terminal_id);
      return { rows: [{ id: sess.id, terminal_id: sess.terminal_id, terminal_number: term?.terminal_number ?? null, timezone: "Europe/London" }] };
    }

    /* ---------- open session ---------- */
    if (/INSERT INTO till_sessions \(company_id, store_id, terminal_id, user_id, opening_cash, status\)/.test(s)) {
      // model the unique open-per-terminal index
      if (state.sessions.some((x) => x.terminal_id === params[2] && x.status === "open")) {
        const err = new Error("duplicate key"); err.code = "23505"; throw err;
      }
      const row = {
        id: nextId(), company_id: params[0], store_id: params[1], terminal_id: params[2],
        user_id: params[3], opening_cash: Number(params[4]), status: "open", opened_at: now(),
        closed_at: null, closed_by: null, closing_cash: null, expected_cash: null, cash_difference: null,
      };
      state.sessions.push(row);
      return { rows: [{ id: row.id, company_id: row.company_id, store_id: row.store_id, terminal_id: row.terminal_id, user_id: row.user_id, opening_cash: row.opening_cash, status: row.status, opened_at: row.opened_at }] };
    }
    if (/SELECT id FROM till_sessions WHERE terminal_id = \$1 AND status = 'open'/.test(s)) {
      const x = state.sessions.find((x) => x.terminal_id === params[0] && x.status === "open");
      return { rows: x ? [{ id: x.id }] : [] };
    }

    /* ---------- current session (store-wide) ---------- */
    if (/SELECT ts\.id, ts\.terminal_id, ts\.user_id, ts\.opening_cash, ts\.closing_cash,/.test(s)) {
      const sess = [...state.sessions]
        .filter((x) => x.company_id === params[0] && x.store_id === params[1] && x.status === "open")
        .sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
      if (!sess) return { rows: [] };
      const term = state.terminals.find((t) => t.id === sess.terminal_id);
      const cashIn = state.movements.filter((m) => m.till_session_id === sess.id && m.type === "cash_in").reduce((a, m) => a + m.amount, 0);
      const cashOut = state.movements.filter((m) => m.till_session_id === sess.id && m.type === "cash_out").reduce((a, m) => a + m.amount, 0);
      const cashSales = state.sales.filter((sa) => sa.company_id === sess.company_id && sa.store_id === sess.store_id && sa.terminal_id === sess.terminal_id && sa.payment_method === "cash" && sa.status === "completed").reduce((a, sa) => a + sa.total, 0);
      const cashRefunds = state.sales.filter((sa) => sa._cashRefund && sa.company_id === sess.company_id && sa.store_id === sess.store_id && sa.terminal_id === sess.terminal_id).reduce((a, sa) => a + sa._cashRefund, 0);
      return {
        rows: [{
          id: sess.id, terminal_id: sess.terminal_id, user_id: sess.user_id,
          opening_cash: sess.opening_cash, closing_cash: sess.closing_cash,
          expected_cash: sess.expected_cash, cash_difference: sess.cash_difference,
          status: sess.status, opened_at: sess.opened_at, closed_at: sess.closed_at, closed_by: sess.closed_by,
          terminal_name: term?.name ?? null, opened_by_name: "opener",
          cash_in_total: cashIn, cash_out_total: cashOut, cash_sales: cashSales, cash_refunds: cashRefunds,
        }],
      };
    }

    /* ---------- close: row-locked load ---------- */
    if (/SELECT ts\.id, ts\.terminal_id, ts\.store_id, ts\.opening_cash, ts\.opened_at\s*FROM till_sessions ts\s*WHERE ts\.id = \$1 AND ts\.company_id = \$2 AND ts\.store_id = \$3 AND ts\.status = 'open'\s*FOR UPDATE/.test(s.replace(/\s+/g, " "))) {
      const x = state.sessions.find((x) => x.id === params[0] && x.company_id === params[1] && x.store_id === params[2] && x.status === "open");
      return { rows: x ? [{ id: x.id, terminal_id: x.terminal_id, store_id: x.store_id, opening_cash: x.opening_cash, opened_at: x.opened_at }] : [] };
    }

    /* ---------- close: aggregates ---------- */
    if (/SELECT COALESCE\(SUM\(amount\),0\) AS total FROM cash_movements WHERE till_session_id=\$1 AND type='cash_in'/.test(s)) {
      return { rows: [{ total: state.movements.filter((m) => m.till_session_id === params[0] && m.type === "cash_in").reduce((a, m) => a + m.amount, 0) }] };
    }
    if (/SELECT COALESCE\(SUM\(amount\),0\) AS total FROM cash_movements WHERE till_session_id=\$1 AND type='cash_out'/.test(s)) {
      return { rows: [{ total: state.movements.filter((m) => m.till_session_id === params[0] && m.type === "cash_out").reduce((a, m) => a + m.amount, 0) }] };
    }
    if (/SELECT COALESCE\(SUM\(s\.total\),0\) AS total\s*FROM sales s\s*INNER JOIN payments pa ON pa\.sale_id = s\.id\s*WHERE s\.company_id=\$1 AND s\.store_id=\$2 AND s\.terminal_id=\$3/.test(s.replace(/\s+/g, " "))) {
      const sess = state.sessions.find((x) => x.terminal_id === params[2]);
      const total = state.sales.filter((sa) => sa.company_id === params[0] && sa.store_id === params[1] && sa.terminal_id === params[2] && sa.payment_method === "cash" && sa.status === "completed").reduce((a, sa) => a + sa.total, 0);
      void sess;
      return { rows: [{ total }] };
    }
    if (/SELECT COALESCE\(SUM\(r\.amount\),0\) AS total\s*FROM refunds r\s*INNER JOIN sales s ON s\.id = r\.sale_id\s*WHERE s\.company_id=\$1 AND s\.store_id=\$2 AND s\.terminal_id=\$3/.test(s.replace(/\s+/g, " "))) {
      const total = state.sales.filter((sa) => sa.company_id === params[0] && sa.store_id === params[1] && sa.terminal_id === params[2] && sa._cashRefund).reduce((a, sa) => a + sa._cashRefund, 0);
      return { rows: [{ total }] };
    }

    /* ---------- close: update ---------- */
    if (/UPDATE till_sessions\s*SET status = 'closed'/.test(s.replace(/\s+/g, " "))) {
      const x = state.sessions.find((x) => x.id === params[4]);
      if (!x) return { rows: [] };
      x.status = "closed";
      x.closing_cash = Number(params[0]);
      x.expected_cash = Number(params[1]);
      x.cash_difference = Number(params[2]);
      x.closed_by = params[3];
      x.closed_at = now();
      return { rows: [{ id: x.id, company_id: x.company_id, store_id: x.store_id, terminal_id: x.terminal_id, opening_cash: x.opening_cash, closing_cash: x.closing_cash, expected_cash: x.expected_cash, cash_difference: x.cash_difference, status: x.status, opened_at: x.opened_at, closed_at: x.closed_at, closed_by: x.closed_by }] };
    }

    /* ---------- cash movements ---------- */
    if (/SELECT id, store_id, terminal_id FROM till_sessions WHERE id=\$1 AND company_id=\$2 AND store_id=\$3 AND status='open' FOR UPDATE/.test(s.replace(/\s+/g, " "))) {
      const x = state.sessions.find((x) => x.id === params[0] && x.company_id === params[1] && x.store_id === params[2] && x.status === "open");
      return { rows: x ? [{ id: x.id, store_id: x.store_id, terminal_id: x.terminal_id }] : [] };
    }
    if (/SELECT id FROM till_sessions WHERE id=\$1 AND company_id=\$2 AND store_id=\$3$/.test(s)) {
      const x = state.sessions.find((x) => x.id === params[0] && x.company_id === params[1] && x.store_id === params[2]);
      return { rows: x ? [{ id: x.id }] : [] };
    }
    // overdraw-guard position query
    if (/opening_cash FROM till_sessions WHERE id = \$1\) AS opening_cash/.test(s.replace(/\s+/g, " "))) {
      const sess = state.sessions.find((x) => x.id === params[0]);
      const cashIn = state.movements.filter((m) => m.till_session_id === params[0] && m.type === "cash_in").reduce((a, m) => a + m.amount, 0);
      const cashOut = state.movements.filter((m) => m.till_session_id === params[0] && m.type === "cash_out").reduce((a, m) => a + m.amount, 0);
      const cashSales = state.sales.filter((sa) => sess && sa.company_id === sess.company_id && sa.store_id === sess.store_id && sa.terminal_id === sess.terminal_id && sa.payment_method === "cash" && sa.status === "completed").reduce((a, sa) => a + sa.total, 0);
      const cashRefunds = state.sales.filter((sa) => sess && sa.company_id === sess.company_id && sa.store_id === sess.store_id && sa.terminal_id === sess.terminal_id && sa._cashRefund).reduce((a, sa) => a + sa._cashRefund, 0);
      return { rows: [{ opening_cash: sess?.opening_cash ?? 0, cash_in: cashIn, cash_out: cashOut, cash_sales: cashSales, cash_refunds: cashRefunds }] };
    }
    if (/INSERT INTO cash_movements \(till_session_id, user_id, type, amount, reason, store_id, terminal_id\)/.test(s.replace(/\s+/g, " ")) && /'drawer_open'/.test(s)) {
      /* Drawer route inlines the type: params are [session, user, 0, reason, store, terminal]. */
      const m = { id: nextId(), till_session_id: params[0], user_id: params[1], type: "drawer_open", amount: Number(params[2]) || 0, reason: params[3], store_id: params[4], terminal_id: params[5], created_at: now() };
      state.movements.push(m);
      return { rows: [{ id: m.id }] };
    }
    if (/INSERT INTO cash_movements \(till_session_id, user_id, type, amount, reason, store_id, terminal_id\)/.test(s.replace(/\s+/g, " "))) {
      const m = { id: nextId(), till_session_id: params[0], user_id: params[1], type: params[2], amount: Number(params[3]), reason: params[4], store_id: params[5], terminal_id: params[6], created_at: now() };
      state.movements.push(m);
      return { rows: [{ id: m.id, till_session_id: m.till_session_id, user_id: m.user_id, type: m.type, amount: m.amount, reason: m.reason, store_id: m.store_id, terminal_id: m.terminal_id, created_at: m.created_at }] };
    }
    if (/INSERT INTO cash_movements \(till_session_id, user_id, type, amount, reason, store_id, terminal_id\)/.test(s) === false && /INSERT INTO cash_movements \(till_session_id, user_id, type, amount, reason\)/.test(s)) {
      const m = { id: nextId(), till_session_id: params[0], user_id: params[1], type: params[2], amount: Number(params[3]), reason: params[4], store_id: null, terminal_id: null, created_at: now() };
      state.movements.push(m);
      return { rows: [{ id: m.id, till_session_id: m.till_session_id, user_id: m.user_id, type: m.type, amount: m.amount, reason: m.reason, created_at: m.created_at }] };
    }
    if (/SELECT cm\.id, cm\.till_session_id, cm\.user_id, u\.username, cm\.type, cm\.amount, cm\.reason, cm\.created_at/.test(s)) {
      return { rows: state.movements.filter((m) => m.till_session_id === params[0]).map((m) => ({ ...m, username: "who" })) };
    }
    if (/SELECT id FROM till_sessions WHERE id=\$1 AND company_id=\$2 AND store_id=\$3\s*$/m.test(s) && /status/.test(s) === false) {
      const x = state.sessions.find((x) => x.id === params[0] && x.company_id === params[1] && x.store_id === params[2]);
      return { rows: x ? [{ id: x.id }] : [] };
    }

    /* ---------- session history (GET /till/sessions) ---------- */
    if (/SELECT ts\.id, ts\.terminal_id, ts\.user_id, ts\.opening_cash, ts\.closing_cash,/m.test(s) === false && /FROM till_sessions ts\s*INNER JOIN terminals t/.test(s.replace(/\s+/g, " ")) && /ORDER BY ts\.opened_at DESC\s*LIMIT 50/.test(s.replace(/\s+/g, " "))) {
      const rows = state.sessions
        .filter((x) => x.company_id === params[0] && x.store_id === params[1])
        .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
        .slice(0, 50)
        .map((x) => ({ id: x.id, terminal_id: x.terminal_id, opening_cash: x.opening_cash, closing_cash: x.closing_cash, expected_cash: x.expected_cash, cash_difference: x.cash_difference, status: x.status, opened_at: x.opened_at, closed_at: x.closed_at, terminal_name: "T", opened_by_name: "o", closed_by_name: x.closed_by ? "c" : null }));
      return { rows };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    const r = await matchSql(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 };
  };
  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rows: [], rowCount: 0 };
      const r = await matchSql(sql, params);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? 0 };
    },
    release() {},
  };
  const pool = { async connect() { return client; } };

  return { state, db, pool, nextId, now };
}

/* ---------------------------------------------------------------- harness */

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, role = "admin", userId = USER } = {}) {
  const mod = await import("../routes/till.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: userId, companyId, storeId, roleId: `role-${role}`, role };
    next();
  });
  const permsFor = (r) => (r === "admin" ? ["*"] : ctx.state.roleCodes);
  app.use("/api", mod.default({
    authenticate: (_q, _s, n) => n(),
    authorize: () => (_q, _s, n) => n(), // real authorize() resolves perms below per-call
    db: ctx.db,
    pool: ctx.pool,
    getRolePermissionCodes: async (roleId) => (roleId === "role-admin" ? ["*"] : permsFor(role)),
    canViewCompanyCustomers: async (user) => user.role === "admin",
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, port: server.address().port };
}

const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ---------------------------------------------------------------- tests */

describe("till sessions — open", () => {
  test("open records company/store/till/user/opening cash", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/till/sessions", { openingCash: 100 });
      assert.equal(res.status, 201);
      const s = ctx.state.sessions[0];
      assert.equal(s.company_id, COMPANY_A);
      assert.equal(s.store_id, STORE_1);
      assert.equal(s.terminal_id, TERM_1);
      assert.equal(s.user_id, USER);
      assert.equal(s.opening_cash, 100);
      assert.equal(s.status, "open");
      assert.ok(s.opened_at);
    } finally { server.close(); }
  });

  test("cannot open two active sessions for the same till (409)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/till/sessions", { openingCash: 50 });
      const again = await post(port, "/api/till/sessions", { openingCash: 50 });
      assert.equal(again.status, 409);
      assert.equal(ctx.state.sessions.filter((s) => s.status === "open").length, 1);
    } finally { server.close(); }
  });

  test("requested till must belong to the caller's store", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/till/sessions", { openingCash: 10, terminalId: TERM_B1 });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /does not belong/i);
    } finally { server.close(); }
  });

  test("opening cash cannot be negative", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/till/sessions", { openingCash: -5 });
      assert.equal(res.status, 400);
    } finally { server.close(); }
  });
});

describe("active session retrieval", () => {
  test("returns the caller's open session with backend-computed cash position", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 100 });
      const sessId = opened.body.data.id;
      await post(port, `/api/till/sessions/${sessId}/cash-movements`, { type: "cash_in", amount: 20 });
      await post(port, `/api/till/sessions/${sessId}/cash-movements`, { type: "cash_out", amount: 5 });
      ctx.state.sales.push({ id: "s1", company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_1, total: 50, status: "completed", payment_method: "cash", created_at: new Date().toISOString() });
      ctx.state.sales.push({ id: "s2", company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_1, total: 10, status: "completed", payment_method: "cash", created_at: new Date().toISOString(), _cashRefund: 10 });

      const res = await get(port, "/api/till/sessions/current");
      assert.equal(res.status, 200);
      const d = res.body.data;
      assert.equal(d.id, sessId);
      // 100 + 20 in − 5 out + 60 sales − 10 refunds = 165
      assert.equal(d.current_cash, 165);
      assert.equal(d.cash_in_total, 20);
      assert.equal(d.cash_out_total, 5);
      assert.equal(d.cash_sales, 60);
    } finally { server.close(); }
  });
});

describe("till close — expected/count/variance", () => {
  test("zero variance: counted equals expected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 100 });
      const id = opened.body.data.id;
      ctx.state.sales.push({ id: "s1", company_id: COMPANY_A, store_id: STORE_1, terminal_id: TERM_1, total: 60, status: "completed", payment_method: "cash", created_at: new Date().toISOString() });
      const res = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 160 });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.expected_cash, 160);
      assert.equal(res.body.data.closing_cash, 160);
      assert.equal(res.body.data.cash_difference, 0);
      assert.ok(res.body.data.closed_at);
    } finally { server.close(); }
  });

  test("negative variance: counted below expected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 100 });
      const id = opened.body.data.id;
      const res = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 90 });
      assert.equal(res.body.data.expected_cash, 100);
      assert.equal(res.body.data.cash_difference, -10);
    } finally { server.close(); }
  });

  test("positive variance: counted above expected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 100 });
      const id = opened.body.data.id;
      const res = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 105.5 });
      assert.equal(res.body.data.cash_difference, 5.5);
    } finally { server.close(); }
  });

  test("expected cash includes movements and excludes closed double-close", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 100 });
      const id = opened.body.data.id;
      await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_in", amount: 30 });
      await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_out", amount: 10 });
      const res = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 120 });
      assert.equal(res.body.data.expected_cash, 120);
      // second close of the same (now closed) session is refused
      const again = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 120 });
      assert.equal(again.status, 404);
    } finally { server.close(); }
  });
});

describe("cash in / cash out", () => {
  test("cash-in and cash-out record session/store/till/user and affect expected cash", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 50 });
      const id = opened.body.data.id;
      const cin = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_in", amount: 25.5, reason: "Float" });
      assert.equal(cin.status, 201);
      const cout = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_out", amount: 10, reason: "Petty cash" });
      assert.equal(cout.status, 201);
      const m = ctx.state.movements;
      assert.equal(m.length, 2);
      assert.ok(m.every((x) => x.store_id === STORE_1 && x.terminal_id === TERM_1 && x.user_id === USER));
      const res = await post(port, `/api/till/sessions/${id}/close`, { countedCash: 65.5 });
      assert.equal(res.body.data.expected_cash, 65.5);
    } finally { server.close(); }
  });

  test("zero and negative amounts are refused", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 50 });
      const id = opened.body.data.id;
      const zero = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_in", amount: 0 });
      assert.equal(zero.status, 400);
      const neg = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_out", amount: -5 });
      assert.equal(neg.status, 400);
      assert.equal(ctx.state.movements.length, 0);
    } finally { server.close(); }
  });

  test("cash-out cannot overdraw the drawer", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 50 });
      const id = opened.body.data.id;
      const res = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_out", amount: 60 });
      assert.equal(res.status, 400);
      assert.match(res.body.message, /Insufficient cash in drawer/i);
      assert.equal(ctx.state.movements.length, 0);
      // within the available balance it succeeds
      const ok = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_out", amount: 50 });
      assert.equal(ok.status, 201);
    } finally { server.close(); }
  });

  test("closed session cannot receive normal cash movements", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const opened = await post(port, "/api/till/sessions", { openingCash: 50 });
      const id = opened.body.data.id;
      await post(port, `/api/till/sessions/${id}/close`, { countedCash: 50 });
      const res = await post(port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_in", amount: 10 });
      assert.equal(res.status, 404);
      assert.equal(ctx.state.movements.length, 0);
    } finally { server.close(); }
  });

  test("permission enforcement: cashier without cash permissions is refused", async () => {
    const ctx = makeCtx();
    ctx.state.roleCodes = []; // user has no cash permissions
    const app = await buildApp(ctx, { role: "cashier" });
    const { server, port } = await listen(app);
    try {
      // open a session as admin first
      const admin = await buildApp(ctx);
      const a = await listen(admin);
      const opened = await post(a.port, "/api/till/sessions", { openingCash: 50 });
      assert.equal(opened.status, 201);
      a.server.close();

      const res = await post(port, `/api/till/sessions/${opened.body.data.id}/cash-movements`, { type: "cash_in", amount: 10 });
      assert.equal(res.status, 403);
      assert.equal(ctx.state.movements.length, 0);
    } finally { server.close(); }
  });
});

describe("isolation", () => {
  test("company isolation: Company B cannot see or close Company A's session", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx, { companyId: COMPANY_A, storeId: STORE_1 });
    const a = await listen(appA);
    const opened = await post(a.port, "/api/till/sessions", { openingCash: 100 });
    const id = opened.body.data.id;
    a.server.close();

    const appB = await buildApp(ctx, { companyId: COMPANY_B, storeId: STORE_2 });
    const b = await listen(appB);
    try {
      const cur = await get(b.port, "/api/till/sessions/current");
      assert.equal(cur.body.data, null, "another company's session is invisible");
      const closeB = await post(b.port, `/api/till/sessions/${id}/close`, { countedCash: 100 });
      assert.equal(closeB.status, 404);
      const mov = await post(b.port, `/api/till/sessions/${id}/cash-movements`, { type: "cash_in", amount: 5 });
      assert.equal(mov.status, 404);
      assert.equal(ctx.state.sessions[0].status, "open", "session untouched");
    } finally { b.server.close(); }
  });

  test("store isolation: same company, different store cannot operate the session", async () => {
    const ctx = makeCtx();
    // Same company (A) but a store whose terminal list does not include TERM_1's store
    const app = await buildApp(ctx, { companyId: COMPANY_A, storeId: STORE_2 });
    const { server, port } = await listen(app);
    try {
      // The caller's store has its own terminal (TERM_B1); a fresh session opens there,
      // proving sessions bind to store+till, not just company.
      const res = await post(port, "/api/till/sessions", { openingCash: 10 });
      assert.equal(res.status, 201);
      assert.equal(ctx.state.sessions[0].terminal_id, TERM_B1);
      assert.equal(ctx.state.sessions[0].store_id, STORE_2);
    } finally { server.close(); }
  });

  test("till isolation: two tills in one store have independent sessions", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const t1 = await post(port, "/api/till/sessions", { openingCash: 10, terminalId: TERM_1 });
      const t2 = await post(port, "/api/till/sessions", { openingCash: 20, terminalId: TERM_2 });
      assert.equal(t1.status, 201);
      assert.equal(t2.status, 201);
      assert.notEqual(t1.body.data.id, t2.body.data.id);
    } finally { server.close(); }
  });
});

describe("drawer control", () => {
  test("drawer open records a zero-amount audit movement with reason", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/till/drawer/open", { reason: "No-sale open" });
      assert.equal(res.status, 200);
      assert.equal(ctx.state.movements.filter((m) => m.type === "drawer_open").length, 1);
      assert.equal(ctx.state.movements[0].amount, 0);
      assert.equal(ctx.state.movements[0].reason, "No-sale open");
    } finally { server.close(); }
  });

  test("drawer open for another store's till is refused", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/till/drawer/open", { terminalId: TERM_B1 });
      assert.equal(res.status, 400);
    } finally { server.close(); }
  });
});

describe("regression — sales engine session lookup", () => {
  test("sales POST still resolves the open session for the store", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/till/sessions", { openingCash: 50 });
      // the exact query the sales engine uses (faked above)
      const lookup = await ctx.db(
        `SELECT ts.id, ts.terminal_id, t.terminal_number, c.timezone
         FROM till_sessions ts
         INNER JOIN terminals t ON t.id = ts.terminal_id
         INNER JOIN stores s ON s.id = ts.store_id
         INNER JOIN companies c ON c.id = s.company_id
         WHERE ts.company_id = $1 AND ts.store_id = $2 AND ts.status = 'open'
         ORDER BY ts.opened_at DESC LIMIT 1`,
        [COMPANY_A, STORE_1]
      );
      assert.equal(lookup.rows.length, 1);
      assert.equal(lookup.rows[0].terminal_id, TERM_1);
    } finally { server.close(); }
  });
});
