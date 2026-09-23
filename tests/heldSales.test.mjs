/*
 * onePOS — Held sales (suspended transactions) hardening (focused suite)
 *
 *   node --test tests/heldSales.test.mjs
 *
 * Backend: the REAL routes/heldSales.js router over HTTP against a stateful
 * fake that models held_sales with genuine DELETE..RETURNING semantics
 * (a claimed row is gone — a second claim finds nothing).
 *
 * Proves: hold + list + resume + delete contracts, the atomic claim (second
 * resume → 404 alreadyResumed), legacy plain-array holds, notes/customer/
 * miscLines/discount restore payloads, company/store/user isolation,
 * store-wide scope (same store only, never cross-company), permission
 * enforcement and admin bypass, payload limits, and the POS offline
 * contract (static pins — the offline guard is client-side).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const USER_1 = "u0000000-0000-4000-8000-000000000009";
const USER_2 = "u0000000-0000-4000-8000-000000000010";

/* ------------------------------------------------------- stateful fake db */

function makeCtx() {
  const state = { holds: [] };
  let nextId = 1;

  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();

    if (/^SELECT hs\.id, hs\.user_id, hs\.customer_id, hs\.items/.test(s)) {
      const storeScope = !/AND hs\.user_id = \$3|AND hs\.user_id=\$3/.test(s);
      const rows = state.holds
        .filter((h) =>
          h.company_id === params[0] &&
          h.store_id === params[1] &&
          (storeScope || h.user_id === params[2]))
        .map((h) => ({
          ...h,
          user_name: h.user_id === USER_1 ? "alice" : "bob",
          customer_name: h.customer_name ?? null,
        }));
      return { rows };
    }

    if (/^INSERT INTO held_sales/.test(s)) {
      if (state.holds.length >= 500) throw new Error("too many");
      const hold = {
        id: `h-${nextId}`,
        company_id: params[0],
        store_id: params[1],
        user_id: params[2],
        customer_id: params[3],
        items: JSON.parse(params[4]),
        discount_type: params[5],
        discount_value: params[6],
        notes: params[7],
        created_at: new Date().toISOString(),
      };
      state.holds.push(hold);
      return { rows: [{ id: hold.id, created_at: hold.created_at }] };
    }

    /* The ATOMIC claim: DELETE..RETURNING — the row is removed and returned
       in one statement. Only the first caller can ever get the contents. */
    if (/^DELETE FROM held_sales WHERE id=\$1 AND company_id=\$2 AND store_id=\$3(?: AND user_id=\$4)? RETURNING/.test(s)) {
      const takeOthers = params.length === 3;
      const idx = state.holds.findIndex((h) =>
        h.id === params[0] &&
        h.company_id === params[1] &&
        h.store_id === params[2] &&
        (takeOthers || h.user_id === params[3]));
      if (idx === -1) return { rows: [] };
      const [claimed] = state.holds.splice(idx, 1);
      return {
        rows: [{
          id: claimed.id, user_id: claimed.user_id, customer_id: claimed.customer_id,
          items: claimed.items, discount_type: claimed.discount_type,
          discount_value: claimed.discount_value, notes: claimed.notes,
          created_at: claimed.created_at,
        }],
      };
    }

    if (/^DELETE FROM held_sales WHERE id=\$1 AND company_id=\$2 AND store_id=\$3 AND user_id=\$4 RETURNING id$/.test(s)) {
      const idx = state.holds.findIndex((h) =>
        h.id === params[0] && h.company_id === params[1] &&
        h.store_id === params[2] && h.user_id === params[3]);
      if (idx === -1) return { rows: [] };
      state.holds.splice(idx, 1);
      return { rows: [{ id: params[0] }] };
    }

    throw new Error("unexpected db use: " + s.slice(0, 80));
  };

  return { state, db };
}

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, userId = USER_1, permissions = "any", isAdmin = true } = {}) {
  const mod = await import("../routes/heldSales.js");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const authorize = (...needed) => (_req, res, next) => {
    if (isAdmin || permissions === "any" || needed.some((code) => permissions.includes(code))) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  };
  app.use("/api", (req, _res, next) => {
    req.user = { id: userId, companyId, storeId };
    next();
  });
  app.use("/api", mod.default({ authenticate: (_req, _res, next) => next(), authorize, db: ctx.db }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const post = async (port, path, body = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const get = async (port, path = "/api/held-sales") => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const del = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "DELETE" });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const holdBody = (overrides = {}) => ({
  items: [{ productId: "p-1", name: "Beans", quantity: 2, price: 1.5 }],
  miscLines: [],
  customerId: null,
  discountType: null,
  discountValue: 0,
  notes: null,
  ...overrides,
});

/* ------------------------------------------------------------------ tests */

test("create a held sale (POST) and list it (default user scope)", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  const created = await post(port, "/api/held-sales", holdBody());
  assert.equal(created.status, 201);
  assert.ok(created.body.data.id);
  const list = await get(port);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].id, created.body.data.id);
  server.close();
});

test("resume claims atomically and returns the full contents", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  const created = await post(port, "/api/held-sales", holdBody());
  const resumed = await post(port, `/api/held-sales/${created.body.data.id}/resume`);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.data.id, created.body.data.id);
  assert.equal(resumed.body.data.items.items.length, 1);
  // The claim removed it: the list is now empty.
  const list = await get(port);
  assert.equal(list.body.data.length, 0);
  server.close();
});

test("resume restores items, miscLines, discount, customer and notes", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  await post(port, "/api/held-sales", holdBody({
    items: [{ productId: "p-9", name: "Eggs", quantity: 3, price: 2 }],
    miscLines: [{ description: "Delivery", price: 5, quantity: 1, vatRate: 0.2 }],
    customerId: "cust-77",
    discountType: "percent",
    discountValue: 10,
    notes: "customer paying later",
  }));
  const list = await get(port);
  const id = list.body.data[0].id;
  const resumed = await post(port, `/api/held-sales/${id}/resume`);
  assert.equal(resumed.status, 200);
  const data = resumed.body.data;
  assert.equal(data.items.items.length, 1);
  assert.equal(data.items.items[0].productId, "p-9");
  assert.equal(data.items.miscLines.length, 1);
  assert.equal(data.items.miscLines[0].description, "Delivery");
  assert.equal(data.discount_type, "percent");
  assert.equal(Number(data.discount_value), 10);
  assert.equal(data.customer_id, "cust-77");
  assert.equal(data.notes, "customer paying later");
  server.close();
});

test("legacy plain-array hold still resumes", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  // Seed a legacy row directly through the same fake the INSERT uses.
  await post(port, "/api/held-sales", holdBody());
  // Overwrite its items with the legacy plain-array shape.
  ctx.state.holds[0].items = [{ productId: "p-old", name: "Old", quantity: 1, price: 3 }];
  const resumed = await post(port, `/api/held-sales/${ctx.state.holds[0].id}/resume`);
  assert.equal(resumed.status, 200);
  assert.ok(Array.isArray(resumed.body.data.items));
  assert.equal(resumed.body.data.items[0].productId, "p-old");
  server.close();
});

test("second resume attempt returns 404 alreadyResumed and cannot restore again", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  const created = await post(port, "/api/held-sales", holdBody());
  const first = await post(port, `/api/held-sales/${created.body.data.id}/resume`);
  assert.equal(first.status, 200);
  const second = await post(port, `/api/held-sales/${created.body.data.id}/resume`);
  assert.equal(second.status, 404);
  assert.equal(second.body.data.alreadyResumed, true);
  server.close();
});

test("cross-user access blocked: resume/delete/list are user-scoped by default", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { userId: USER_1 });
  const created = await post(port, "/api/held-sales", holdBody());
  const id = created.body.data.id;
  server.close();

  const other = makeCtx();
  other.state.holds.push(...ctx.state.holds); // same underlying rows
  const { server: s2, port: p2 } = await buildApp(other, { userId: USER_2, isAdmin: false, permissions: ["sale.hold"] });
  assert.equal((await get(p2)).body.data.length, 0, "other user cannot list the hold");
  const resume = await post(p2, `/api/held-sales/${id}/resume`);
  assert.equal(resume.status, 404, "other user cannot claim the hold");
  const remove = await del(p2, `/api/held-sales/${id}`);
  assert.equal(remove.status, 404, "other user cannot delete the hold");
  assert.equal(other.state.holds.length, 1, "hold still exists");
  s2.close();
});

test("cross-store access blocked", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { storeId: STORE_1 });
  const created = await post(port, "/api/held-sales", holdBody());
  server.close();

  const other = makeCtx();
  other.state.holds.push(...ctx.state.holds);
  const { server: s2, port: p2 } = await buildApp(other, { storeId: STORE_2, userId: USER_1, isAdmin: false, permissions: ["sale.hold"] });
  assert.equal((await get(p2)).body.data.length, 0);
  assert.equal((await post(p2, `/api/held-sales/${created.body.data.id}/resume`)).status, 404);
  s2.close();
});

test("cross-company access blocked (even for an admin of company B)", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { companyId: COMPANY_A });
  const created = await post(port, "/api/held-sales", holdBody());
  server.close();

  const other = makeCtx();
  other.state.holds.push(...ctx.state.holds);
  const { server: s2, port: p2 } = await buildApp(other, { companyId: COMPANY_B, userId: USER_1, isAdmin: true });
  assert.equal((await get(p2)).body.data.length, 0);
  assert.equal((await post(p2, `/api/held-sales/${created.body.data.id}/resume`)).status, 404);
  s2.close();
});

test("permission denied without sale.hold", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { isAdmin: false, permissions: [] });
  assert.equal((await get(port)).status, 403);
  assert.equal((await post(port, "/api/held-sales", holdBody())).status, 403);
  assert.equal((await post(port, "/api/held-sales/h-1/resume")).status, 403);
  assert.equal((await del(port, "/api/held-sales/h-1")).status, 403);
  server.close();
});

test("legacy sale.refund-less roles: sale.hold alone authorises (admin bypass intact)", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { isAdmin: false, permissions: ["sale.hold"] });
  const created = await post(port, "/api/held-sales", holdBody());
  assert.equal(created.status, 201);
  assert.equal((await post(port, `/api/held-sales/${created.body.data.id}/resume`)).status, 200);
  server.close();
});

test("admin bypass authorises all held-sale operations", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { isAdmin: true, permissions: [] });
  const created = await post(port, "/api/held-sales", holdBody());
  assert.equal(created.status, 201);
  assert.equal((await post(port, `/api/held-sales/${created.body.data.id}/resume`)).status, 200);
  server.close();
});

test("empty basket rejected; malformed lines rejected", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  assert.equal((await post(port, "/api/held-sales", holdBody({ items: [] }))).status, 400);
  assert.equal((await post(port, "/api/held-sales", holdBody({ items: "nope" }))).status, 400);
  assert.equal((await post(port, "/api/held-sales", holdBody({ items: [null] }))).status, 400);
  assert.equal(ctx.state.holds.length, 0);
  server.close();
});

test("oversized / too-many-line hold rejected", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx);
  const many = holdBody({ items: Array.from({ length: 201 }, (_, i) => ({ productId: `p-${i}`, quantity: 1, price: 1 })) });
  assert.equal((await post(port, "/api/held-sales", many)).status, 400);
  const huge = holdBody({ items: [{ productId: "p-1", blob: "x".repeat(600_000) }] });
  const tooBig = await post(port, "/api/held-sales", huge);
  assert.ok([413, 400].includes(tooBig.status), `oversized snapshot refused (${tooBig.status})`);
  // A normal basket still passes.
  assert.equal((await post(port, "/api/held-sales", holdBody())).status, 201);
  server.close();
});

test("store-scope listing returns holds from the caller's store only (any user)", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { userId: USER_1, storeId: STORE_1 });
  await post(port, "/api/held-sales", holdBody({ notes: "alice's hold" }));
  server.close();

  const ctx2 = makeCtx();
  const { server: s2, port: p2 } = await buildApp(ctx2, { userId: USER_2, storeId: STORE_1 });
  await post(p2, "/api/held-sales", holdBody({ notes: "bob's hold" }));
  s2.close();

  // Manager lists the whole store: sees both users' holds.
  const shared = makeCtx();
  shared.state.holds.push(...ctx.state.holds, ...ctx2.state.holds);
  const { server: s3, port: p3 } = await buildApp(shared, { userId: USER_1, storeId: STORE_1, isAdmin: false, permissions: ["sale.hold"] });
  const storeList = await get(p3, "/api/held-sales?scope=store");
  assert.equal(storeList.status, 200);
  assert.equal(storeList.body.scope, "store");
  assert.equal(storeList.body.data.length, 2);
  assert.deepEqual(
    storeList.body.data.map((h) => h.notes).sort(),
    ["alice's hold", "bob's hold"],
  );
  // Every row carries the owning user's identity for display.
  assert.ok(storeList.body.data.every((h) => h.user_name));
  // Default (no scope) stays user-only.
  const mine = await get(p3);
  assert.equal(mine.body.data.length, 1);
  assert.equal(mine.body.scope, undefined);
  s3.close();
});

test("store-scope listing never leaks another company or store", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { companyId: COMPANY_A, storeId: STORE_1, userId: USER_1 });
  await post(port, "/api/held-sales", holdBody());
  server.close();

  const other = makeCtx();
  other.state.holds.push(...ctx.state.holds);
  const { server: s2, port: p2 } = await buildApp(other, { companyId: COMPANY_B, storeId: STORE_2, userId: USER_1, isAdmin: true });
  const storeList = await get(p2, "/api/held-sales?scope=store");
  assert.equal(storeList.body.data.length, 0);
  s2.close();
});

test("delete remains correctly scoped and works for the owner", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { userId: USER_1 });
  const created = await post(port, "/api/held-sales", holdBody());
  assert.equal((await del(port, `/api/held-sales/${created.body.data.id}`)).status, 200);
  assert.equal((await del(port, `/api/held-sales/${created.body.data.id}`)).status, 404);
  assert.equal(ctx.state.holds.length, 0);
  server.close();
});

test("manager can claim another user's hold through takeOthers (store-scoped)", async () => {
  const ctx = makeCtx();
  const { server, port } = await buildApp(ctx, { userId: USER_1, isAdmin: false, permissions: ["sale.hold"] });
  const created = await post(port, "/api/held-sales", holdBody());
  server.close();

  const other = makeCtx();
  other.state.holds.push(...ctx.state.holds);
  const { server: s2, port: p2 } = await buildApp(other, { userId: USER_2, isAdmin: false, permissions: ["sale.hold"] });
  const claimed = await post(p2, `/api/held-sales/${created.body.data.id}/resume`, { takeOthers: true });
  assert.equal(claimed.status, 200, "store-wide takeover claims within the same store");
  assert.equal(claimed.body.data.user_id, USER_1);
  s2.close();
});

/* ------------------------------------------------ offline contract (POS) */

test("offline contract: Hold and Resume are explicitly refused offline (client-side)", () => {
  const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");

  // Hold refuses offline with a clear message and keeps the basket intact
  // (the guard runs BEFORE any clearing/network call).
  const holdFn = posSrc.slice(posSrc.indexOf("const holdSale"), posSrc.indexOf("const loadHeldSales"));
  assert.match(holdFn, /!isOnline\(\)/);
  assert.match(holdFn, /Hold Sale requires a connection to the onePOS server/);
  assert.ok(holdFn.indexOf("!isOnline()") < holdFn.indexOf("apiRequest"), "offline guard precedes the network call");

  // Resume refuses offline the same way.
  const loadFn = posSrc.slice(posSrc.indexOf("const loadHeldSales"), posSrc.indexOf("const resumeSale"));
  assert.match(loadFn, /!isOnline\(\)/);
  assert.match(loadFn, /Resume Held Sale requires a connection to the onePOS server/);

  // Resume is the ATOMIC claim, not GET-then-DELETE.
  const resumeFn = posSrc.slice(posSrc.indexOf("const resumeSale"), posSrc.indexOf("COMPLETE SALE"));
  assert.match(resumeFn, /\/resume`/);
  assert.ok(!/method: "DELETE"/.test(resumeFn), "resume must not delete via the old flow");
  // Basket is restored only after a successful claim.
  assert.ok(resumeFn.indexOf("/resume`") < resumeFn.indexOf("setBasket("), "claim precedes any basket restore");
});

test("held-sale data can never bypass the authoritative sale engine (static pin)", () => {
  const routerSrc = fs.readFileSync(new URL("../routes/heldSales.js", import.meta.url), "utf8");
  assert.ok(!/INSERT INTO sales/.test(routerSrc), "held-sales router never creates sales");
  assert.ok(!/inventory_movements/.test(routerSrc), "held-sales router never touches stock");
  assert.match(routerSrc, /DELETE FROM held_sales WHERE \$\{scopeSql\}\s*\n?\s*RETURNING/, "resume claims via DELETE..RETURNING");
});
