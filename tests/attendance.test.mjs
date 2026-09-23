/*
 * onePOS — Staff attendance (clock in/out) focused suite
 *
 *   node --test tests/attendance.test.mjs
 *
 * Backend under test: the REAL routes/attendance.js over HTTP against a
 * stateful SQL fake that models attendance_records (incl. the partial
 * unique open-per-user index uq_attendance_open_per_user), users and
 * stores. Isolation tests prove company/store/user boundaries; duration is
 * validated against timestamps the fake controls.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "a0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000101";
const STORE_2 = "c0000000-0000-4000-8000-000000000102"; // same company A, different store
const STORE_B1 = "c0000000-0000-4000-8000-000000000201"; // company B store
const USER = "e0000000-0000-4000-8000-000000000901";
const USER_2 = "e0000000-0000-4000-8000-000000000902"; // company A, store 1
const USER_3 = "e0000000-0000-4000-8000-000000000903"; // company A, store 2
const USER_B = "e0000000-0000-4000-8000-000000000801"; // company B

process.env.NODE_ENV = "test";

function makeCtx() {
  const state = {
    users: [
      { id: USER, company_id: COMPANY_A, store_id: STORE_1, username: "alice", full_name: "Alice Smith", active: true, role_id: "role-admin" },
      { id: USER_2, company_id: COMPANY_A, store_id: STORE_1, username: "bob", full_name: "Bob Jones", active: true, role_id: "role-staff" },
      { id: USER_3, company_id: COMPANY_A, store_id: STORE_2, username: "carol", full_name: "Carol White", active: true, role_id: "role-staff" },
      { id: USER_B, company_id: COMPANY_B, store_id: STORE_B1, username: "dave", full_name: "Dave Brown", active: true, role_id: "role-b-admin" },
    ],
    stores: [
      { id: STORE_1, company_id: COMPANY_A, name: "A Store 1" },
      { id: STORE_2, company_id: COMPANY_A, name: "A Store 2" },
      { id: STORE_B1, company_id: COMPANY_B, name: "B Store 1" },
    ],
    attendance: [], // { id, company_id, store_id, user_id, status, clock_in, clock_out, worked_minutes, note }
    roleCodes: {
      "role-admin": ["attendance.view", "user.view", "user.manage"],
      "role-staff": ["sale.view", "sale.create"],
      "role-manager": ["attendance.view", "sale.view"],
      "role-viewer": ["sale.view"],
      "role-b-admin": ["attendance.view"],
    },
    nowMs: Date.now(), // fake clock — advanced manually by tests
  };

  const nextId = (() => {
    let n = 0;
    return () => `att-${(n += 1)}`;
  })();

  function tick(ms) {
    state.nowMs += ms;
    return new Date(state.nowMs).toISOString();
  }
  const now = () => new Date(state.nowMs).toISOString();

  const matchSql = async (s0, params) => {
    const s = String(s0).replace(/\s+/g, " ").trim();

    /* users lookups */
    if (/SELECT id, company_id, store_id, active FROM users WHERE id = \$1 LIMIT 1$/.test(s)) {
      const u = state.users.find((x) => x.id === params[0]);
      return { rows: u ? [{ id: u.id, company_id: u.company_id, store_id: u.store_id, active: u.active }] : [] };
    }
    if (/SELECT id, company_id, store_id, username, full_name FROM users WHERE id = \$1 LIMIT 1$/.test(s)) {
      const u = state.users.find((x) => x.id === params[0]);
      return {
        rows: u
          ? [{ id: u.id, company_id: u.company_id, store_id: u.store_id, username: u.username, full_name: u.full_name }]
          : [],
      };
    }
    if (/SELECT id FROM users WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(s)) {
      const u = state.users.find((x) => x.id === params[0] && x.company_id === params[1]);
      return { rows: u ? [{ id: u.id }] : [] };
    }
    if (/SELECT store_id FROM users WHERE id = \$1 LIMIT 1$/.test(s)) {
      const u = state.users.find((x) => x.id === params[0]);
      return { rows: u ? [{ store_id: u.store_id }] : [] };
    }

    /* stores lookup (management list store filter) */
    if (/SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 LIMIT 1$/.test(s)) {
      const st = state.stores.find((x) => x.id === params[0] && x.company_id === params[1]);
      return { rows: st ? [{ id: st.id }] : [] };
    }

    /* role permission codes */
    if (/SELECT p\.code\s*FROM role_permissions rp\s*INNER JOIN permissions p ON p\.id = rp\.permission_id\s*WHERE rp\.role_id = \$1$/.test(s)) {
      const codes = state.roleCodes[params[0]] || [];
      return { rows: codes.map((code) => ({ code })) };
    }

    /* open session lookups (clock-in guard + clock-out lookup) */
    if (/SELECT id, clock_in FROM attendance_records\s*WHERE user_id = \$1 AND status = 'open'\s*LIMIT 1$/.test(s)) {
      const row = state.attendance.find((x) => x.user_id === params[0] && x.status === "open");
      return { rows: row ? [{ id: row.id, clock_in: row.clock_in }] : [] };
    }

    /* clock-in insert — models the partial unique open-per-user index */
    if (/INSERT INTO attendance_records \(company_id, store_id, user_id, status, clock_in\)/.test(s)) {
      if (state.attendance.some((x) => x.user_id === params[2] && x.status === "open")) {
        const err = new Error("duplicate key value violates unique constraint uq_attendance_open_per_user");
        err.code = "23505";
        throw err;
      }
      const row = {
        id: nextId(),
        company_id: params[0],
        store_id: params[1],
        user_id: params[2],
        status: "open",
        clock_in: now(),
        clock_out: null,
        worked_minutes: null,
        note: null,
      };
      state.attendance.push(row);
      return { rows: [row] };
    }

    /* clock-out update — computes worked_minutes from the recorded timestamps */
    if (/UPDATE attendance_records\s*SET status = 'closed',\s*clock_out = NOW\(\),\s*worked_minutes = GREATEST\(0, FLOOR\(EXTRACT\(EPOCH FROM \(NOW\(\) - clock_in\)\) \/ 60\)\)::int,\s*updated_at = NOW\(\)\s*WHERE id = \$1 AND status = 'open'/.test(s)) {
      const row = state.attendance.find((x) => x.id === params[0] && x.status === "open");
      if (!row) return { rows: [] };
      row.status = "closed";
      row.clock_out = now(); // the fake's clock IS the DB clock
      row.worked_minutes = Math.max(0, Math.floor((new Date(row.clock_out) - new Date(row.clock_in)) / 60000));
      row.updated_at = row.clock_out;
      return { rows: [row] };
    }

    /* GET /attendance/me — latest row for the user with elapsed minutes */
    if (/CASE WHEN ar\.status = 'open'/.test(s) && /FROM attendance_records ar\s*WHERE ar\.user_id = \$1\s*ORDER BY ar\.clock_in DESC\s*LIMIT 1$/.test(s)) {
      const row = [...state.attendance]
        .filter((x) => x.user_id === params[0])
        .sort((a, b) => new Date(b.clock_in) - new Date(a.clock_in))[0];
      if (!row) return { rows: [] };
      const elapsed = row.status === "open"
        ? Math.max(0, Math.floor((state.nowMs - new Date(row.clock_in).getTime()) / 60000))
        : null;
      return { rows: [{ ...row, elapsed_minutes: elapsed }] };
    }

    /* per-user management records (also matches /attendance/me/records shape) */
    if (/SELECT ar\.id, ar\.company_id, ar\.store_id, ar\.user_id, ar\.status,\s*ar\.clock_in, ar\.clock_out, ar\.worked_minutes, ar\.note,\s*s\.name AS store_name\s*FROM attendance_records ar\s*LEFT JOIN stores s ON s\.id = ar\.store_id\s*WHERE ar\.user_id = \$1\s*ORDER BY ar\.clock_in DESC\s*LIMIT \$2$/.test(s)) {
      const rows = state.attendance
        .filter((x) => x.user_id === params[0])
        .sort((a, b) => new Date(b.clock_in) - new Date(a.clock_in))
        .slice(0, params[1])
        .map((x) => ({ ...x, store_name: state.stores.find((st) => st.id === x.store_id)?.name ?? null }));
      return { rows };
    }

    /* management list (company-scoped, optional store/user filters) */
    if (/SELECT ar\.id, ar\.company_id, ar\.store_id, ar\.user_id, ar\.status,\s*ar\.clock_in, ar\.clock_out, ar\.worked_minutes, ar\.note,\s*u\.username, u\.full_name, s\.name AS store_name\s*FROM attendance_records ar/.test(s)) {
      let rows = state.attendance.filter((x) => x.company_id === params[0]);
      // conditions arrive in the route's fixed order: store filter, then user filter
      const hasStoreFilter = /ar\.store_id = \$2/.test(s);
      const hasUserFilter = /ar\.user_id = \$\d+/.test(s);
      if (hasStoreFilter) rows = rows.filter((x) => x.store_id === params[1]);
      if (hasUserFilter) {
        const userIdx = hasStoreFilter ? 2 : 1;
        rows = rows.filter((x) => x.user_id === params[userIdx]);
      }
      rows = rows
        .sort((a, b) => new Date(b.clock_in) - new Date(a.clock_in))
        .slice(0, params[params.length - 1])
        .map((x) => ({
          ...x,
          username: state.users.find((u) => u.id === x.user_id)?.username ?? null,
          full_name: state.users.find((u) => u.id === x.user_id)?.full_name ?? null,
          store_name: state.stores.find((st) => st.id === x.store_id)?.name ?? null,
        }));
      return { rows };
    }

    /* audit sink */
    if (/INSERT INTO audit_logs/.test(s)) return { rows: [] };

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    const r = await matchSql(sql, params);
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
  };

  return { state, db, tick, now };
}

/* ---------------------------------------------------------------- harness */

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, userId = USER, roleId = "role-admin" } = {}) {
  const mod = await import("../routes/attendance.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: userId, companyId, storeId, roleId, role: roleId.replace("role-", "") };
    next();
  });
  app.use(
    "/api",
    mod.default({
      authenticate: (_q, _s, n) => n(),
      db: ctx.db,
      canViewCompanyCustomers: async (user) => user.roleId === "role-admin" || user.roleId === "role-b-admin",
      canAccessStore: async (user, targetStoreId) => {
        // mirrors server.js: admins bypass; others need the store among their assignments
        if (user.roleId === "role-admin" || user.roleId === "role-b-admin") return true;
        const u = ctx.state.users.find((x) => x.id === user.id);
        const assigned = u && u.store_id === targetStoreId ? [targetStoreId] : [];
        return assigned.includes(targetStoreId);
      },
      writeAudit: async () => {},
    })
  );
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, port: server.address().port };
}

const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ---------------------------------------------------------------- tests */

describe("clock in", () => {
  test("staff can clock in (1) — session persisted with user/company/store/server timestamps", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/attendance/clock-in");
      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      const row = ctx.state.attendance[0];
      assert.equal(row.user_id, USER_2);
      assert.equal(row.company_id, COMPANY_A);
      assert.equal(row.store_id, STORE_1);
      assert.equal(row.status, "open");
      assert.ok(row.clock_in, "clock_in recorded server-side");
      assert.equal(row.clock_out, null);
      assert.equal(row.worked_minutes, null);
    } finally {
      server.close();
    }
  });

  test("duplicate clock-in is rejected (6) — 409, no second open session", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const first = await post(port, "/api/attendance/clock-in");
      assert.equal(first.status, 201);
      const again = await post(port, "/api/attendance/clock-in");
      assert.equal(again.status, 409);
      assert.equal(ctx.state.attendance.filter((r) => r.status === "open").length, 1);
    } finally {
      server.close();
    }
  });

  test("clock-in ignores any client-supplied timestamps/duration", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/attendance/clock-in", { clockIn: "2000-01-01T00:00:00Z", workedMinutes: 999 });
      assert.equal(res.status, 201);
      const row = ctx.state.attendance[0];
      assert.notEqual(row.clock_in, "2000-01-01T00:00:00Z");
    } finally {
      server.close();
    }
  });
});

describe("status", () => {
  test("staff can see they are currently clocked in (2) — with server-computed elapsed minutes", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      let status = await get(port, "/api/attendance/me");
      assert.equal(status.status, 200);
      assert.equal(status.body.data, null, "not clocked in before any session");

      await post(port, "/api/attendance/clock-in");
      ctx.tick(45 * 60 * 1000); // 45 minutes pass
      status = await get(port, "/api/attendance/me");
      assert.equal(status.body.data.status, "open");
      assert.equal(status.body.data.clockOut, null);
      assert.equal(status.body.data.elapsedMinutes, 45, "elapsed time computed server-side");
    } finally {
      server.close();
    }
  });
});

describe("clock out", () => {
  test("staff can clock out (3) — the correct open session is closed (4)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const inRes = await post(port, "/api/attendance/clock-in");
      const openedId = ctx.state.attendance[0].id;
      ctx.tick(90 * 60 * 1000); // 1h30m passes
      const outRes = await post(port, "/api/attendance/clock-out");
      assert.equal(outRes.status, 200);
      assert.equal(outRes.body.data.id, openedId, "the open session is the one closed");
      assert.equal(outRes.body.data.status, "closed");
      assert.ok(outRes.body.data.clockOut);
      assert.equal(outRes.body.data.clockIn, inRes.body.data.clockIn);
      const row = ctx.state.attendance[0];
      assert.equal(row.status, "closed");
      assert.ok(row.clock_out);
    } finally {
      server.close();
    }
  });

  test("worked duration is calculated correctly (5)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/attendance/clock-in");
      ctx.tick(8 * 60 * 60 * 1000 + 30 * 1000); // 8h00m30s
      const outRes = await post(port, "/api/attendance/clock-out");
      assert.equal(outRes.status, 200);
      // floor(8h00m30s) = 480 minutes, computed from the recorded timestamps
      assert.equal(outRes.body.data.workedMinutes, 480);
      const row = ctx.state.attendance[0];
      const ms = new Date(row.clock_out) - new Date(row.clock_in);
      assert.equal(Math.floor(ms / 60000), 480, "duration matches the persisted timestamps");
    } finally {
      server.close();
    }
  });

  test("clock-out without an active session is rejected (7) — 409", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/attendance/clock-out");
      assert.equal(res.status, 409);
      assert.equal(ctx.state.attendance.length, 0);
    } finally {
      server.close();
    }
  });

  test("second clock-out after a completed session is rejected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/attendance/clock-in");
      ctx.tick(60 * 60 * 1000);
      const first = await post(port, "/api/attendance/clock-out");
      assert.equal(first.status, 200);
      const second = await post(port, "/api/attendance/clock-out");
      assert.equal(second.status, 409);
      const row = ctx.state.attendance[0];
      assert.equal(row.status, "closed");
      assert.equal(ctx.state.attendance.filter((r) => r.status === "closed").length, 1);
    } finally {
      server.close();
    }
  });
});

describe("tenant / store / user isolation", () => {
  test("attendance records are isolated by company (8) — Company B cannot see Company A staff", async () => {
    const ctx = makeCtx();
    // Alice (Company A) clocks in.
    const appA = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const a = await listen(appA);
    await post(a.port, "/api/attendance/clock-in");
    a.server.close();

    // Dave (Company B admin) asks for Alice's records: the user is not addressable.
    const appB = await buildApp(ctx, { companyId: COMPANY_B, storeId: STORE_B1, userId: USER_B, roleId: "role-b-admin" });
    const b = await listen(appB);
    try {
      const perUser = await get(b.port, `/api/attendance/users/${USER_2}/records`);
      assert.equal(perUser.status, 404, "another company's staff member does not exist");
      const list = await get(b.port, `/api/attendance?userId=${USER_2}`);
      assert.equal(list.status, 404);
      const all = await get(b.port, "/api/attendance");
      assert.equal(all.status, 200);
      assert.equal(all.body.data.length, 0, "no Company A rows leak into Company B");
      // Company B store filter cannot address Company A's stores either.
      const storeList = await get(b.port, `/api/attendance?storeId=${STORE_1}`);
      assert.equal(storeList.status, 404);
    } finally {
      b.server.close();
    }
  });

  test("store-level access follows existing Freebuff rules (9) — assigned-store enforcement", async () => {
    const ctx = makeCtx();
    // Carol (store 2, no attendance.view) clocks in — her records exist.
    const appCarol = await buildApp(ctx, { userId: USER_3, roleId: "role-staff" });
    const c = await listen(appCarol);
    await post(c.port, "/api/attendance/clock-in");
    c.server.close();

    // Bob (store 1, manager WITH attendance.view) lists company records:
    // store 2 rows are outside his assigned store, so the store-filtered
    // query is refused under the same rule inventory/transfers use.
    const appBob = await buildApp(ctx, { userId: USER_2, roleId: "role-manager" });
    const b = await listen(appBob);
    try {
      const filtered = await get(b.port, `/api/attendance?storeId=${STORE_2}`);
      assert.equal(filtered.status, 403);
      // A different company's store is simply not found.
      const foreign = await get(b.port, `/api/attendance?storeId=${STORE_B1}`);
      assert.equal(foreign.status, 404);
    } finally {
      b.server.close();
    }
  });

  test("unauthorised users cannot view/modify another staff member's attendance (10)", async () => {
    const ctx = makeCtx();
    // Alice (staff, store 1) has an attendance session.
    const appA = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const a = await listen(appA);
    await post(a.port, "/api/attendance/clock-in");
    a.server.close();

    // Bob (store 1 manager WITH attendance.view) may view Alice's records...
    const appMgr = await buildApp(ctx, { userId: USER, roleId: "role-manager" });
    const m = await listen(appMgr);
    const ok = await get(m.port, `/api/attendance/users/${USER_2}/records`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.length, 1);
    m.server.close();

    // ...but Carol (store 2, NO attendance.view) may not — 403.
    const appNoPerm = await buildApp(ctx, { userId: USER_3, roleId: "role-staff" });
    const np = await listen(appNoPerm);
    try {
      const denied = await get(np.port, `/api/attendance/users/${USER_2}/records`);
      assert.equal(denied.status, 403);
      const deniedList = await get(np.port, "/api/attendance");
      assert.equal(deniedList.status, 403);
    } finally {
      np.server.close();
    }
  });

  test("clock in/out operate only on the caller's own session (self-service endpoints)", async () => {
    const ctx = makeCtx();
    // Alice (staff) is clocked in.
    const appA = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const a = await listen(appA);
    await post(a.port, "/api/attendance/clock-in");
    a.server.close();

    // Bob (admin of the same company) cannot clock Alice out: there is no
    // endpoint that takes a user id, and his own clock-out finds no open
    // session of his own.
    const appB = await buildApp(ctx, { userId: USER, roleId: "role-admin" });
    const b = await listen(appB);
    try {
      const res = await post(b.port, "/api/attendance/clock-out");
      assert.equal(res.status, 409);
      const row = ctx.state.attendance.find((r) => r.user_id === USER_2);
      assert.equal(row.status, "open", "Alice's session untouched");
    } finally {
      b.server.close();
    }
  });
});

describe("own history & management list", () => {
  test("staff can list their own records without attendance.view", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/attendance/clock-in");
      ctx.tick(30 * 60 * 1000);
      await post(port, "/api/attendance/clock-out");
      const res = await get(port, "/api/attendance/me/records");
      assert.equal(res.status, 200);
      assert.equal(res.body.data.length, 1);
      assert.equal(res.body.data[0].status, "closed");
      assert.equal(res.body.data[0].workedMinutes, 30);
    } finally {
      server.close();
    }
  });

  test("management list shows staff, store, clock-in, clock-out, duration (admin)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/attendance/clock-in");
      ctx.tick(25 * 60 * 1000);
      await post(port, "/api/attendance/clock-out");
      const admin = await buildApp(ctx, { userId: USER, roleId: "role-admin" });
      const ad = await listen(admin);
      try {
        const res = await get(ad.port, "/api/attendance");
        assert.equal(res.status, 200);
        assert.equal(res.body.data.length, 1);
        const rec = res.body.data[0];
        assert.equal(rec.username, "bob");
        assert.equal(rec.storeName, "A Store 1");
        assert.equal(rec.status, "closed");
        assert.ok(rec.clockIn);
        assert.ok(rec.clockOut);
        assert.equal(rec.workedMinutes, 25);
      } finally {
        ad.server.close();
      }
    } finally {
      server.close();
    }
  });

  test("management list supports ?userId and ?storeId filters", async () => {
    const ctx = makeCtx();
    const s1 = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const s1srv = await listen(s1);
    await post(s1srv.port, "/api/attendance/clock-in");
    ctx.tick(10 * 60 * 1000);
    await post(s1srv.port, "/api/attendance/clock-out");
    s1srv.server.close();

    ctx.tick(60 * 1000);
    const s2 = await buildApp(ctx, { userId: USER_3, roleId: "role-staff" });
    const s2srv = await listen(s2);
    await post(s2srv.port, "/api/attendance/clock-in");
    s2srv.server.close();

    const admin = await buildApp(ctx, { userId: USER, roleId: "role-admin" });
    const ad = await listen(admin);
    try {
      const byUser = await get(ad.port, `/api/attendance?userId=${USER_2}`);
      assert.equal(byUser.status, 200);
      assert.equal(byUser.body.data.length, 1);
      assert.equal(byUser.body.data[0].userId, USER_2);

      const byStore = await get(ad.port, `/api/attendance?storeId=${STORE_2}`);
      assert.equal(byStore.status, 200);
      assert.equal(byStore.body.data.length, 1);
      assert.equal(byStore.body.data[0].storeId, STORE_2);

      const all = await get(ad.port, "/api/attendance");
      assert.equal(all.body.data.length, 2);
    } finally {
      ad.server.close();
    }
  });

  test("inactive user cannot clock in", async () => {
    const ctx = makeCtx();
    ctx.state.users.find((u) => u.id === USER_2).active = false;
    const app = await buildApp(ctx, { userId: USER_2, roleId: "role-staff" });
    const { server, port } = await listen(app);
    try {
      const res = await post(port, "/api/attendance/clock-in");
      assert.equal(res.status, 403);
      assert.equal(ctx.state.attendance.length, 0);
    } finally {
      server.close();
    }
  });
});
