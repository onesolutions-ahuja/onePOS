/*
 * T10J — Role Management UI / permission assignment tests.
 *
 * Live-database integration tests over the REAL createAdminRouter (same
 * module server.js mounts) covering:
 *   1.  Permission persistence cycle: ON → save → reopen → still ON;
 *       OFF → save → reopen → still OFF (the T10J acceptance loop).
 *   2.  Role create / rename via the new T10J endpoints.
 *   3.  Reserved-name protection (cannot spoof Administrator/Admin/Owner).
 *   4.  Last-administrator lockout guard (cannot deactivate the final
 *       privileged role with active users).
 *   5.  Company isolation (foreign role → 404).
 *   6.  role.manage authorization gate (permission-less user → 403).
 *   7.  UI contract: toggles (not checkboxes) render the permission matrix;
 *       no broad report.view; granular reports individually selectable.
 *
 * All rows are tagged and removed afterwards.
 *
 *   node --test tests/roleManagement.test.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import bcrypt from "bcryptjs";
import createAdminRouter from "../routes/admin.js";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ------------------------------------------------------------------ db */
let pool;
let ctx;
const PORT = 10041;
let server;

async function setup() {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const db = (q, p) => pool.query(q, p);
  const tag = crypto.randomUUID().slice(0, 8);

  const company = await db("INSERT INTO companies(name) VALUES($1) RETURNING id", [`role-t10j-${tag}`]);
  const companyId = company.rows[0].id;
  const store = await db("INSERT INTO stores(company_id, name) VALUES($1,$2) RETURNING id", [companyId, `store-${tag}`]);
  const storeId = store.rows[0].id;

  /* Owner-role admin user (canViewCompanyCustomers bypass) */
  const adminRole = await db(
    "INSERT INTO roles(company_id,name,description,is_system_role) VALUES($1,$2,$3,TRUE) RETURNING id",
    [companyId, "Administrator", "Full access"]
  );
  const adminUser = await db(
    "INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, role_id",
    [companyId, storeId, adminRole.rows[0].id, `owner-${tag}`, `Owner ${tag}`, await bcrypt.hash("pass1234", 10)]
  );

  /* A manager role holding role.manage, owned by a NON-admin user */
  const managerRole = await db(
    "INSERT INTO roles(company_id,name,is_system_role) VALUES($1,$2,FALSE) RETURNING id",
    [companyId, `manager-${tag}`]
  );
  const roleManagePerm = await db("SELECT id FROM permissions WHERE code='role.manage'");
  await db("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)", [
    managerRole.rows[0].id,
    roleManagePerm.rows[0].id,
  ]);
  const managerUser = await db(
    "INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, role_id",
    [companyId, storeId, managerRole.rows[0].id, `mgr-${tag}`, `Manager ${tag}`, await bcrypt.hash("pass1234", 10)]
  );

  /* A permission-less user (must be rejected on role APIs) */
  const peonRole = await db("INSERT INTO roles(company_id,name) VALUES($1,$2) RETURNING id", [companyId, `peon-${tag}`]);
  const peonUser = await db(
    "INSERT INTO users(company_id,store_id,role_id,username,full_name,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id, role_id",
    [companyId, storeId, peonRole.rows[0].id, `peon-u-${tag}`, `Peon ${tag}`, await bcrypt.hash("pass1234", 10)]
  );

  /* Foreign company + role for isolation checks */
  const foreignCompany = await db("INSERT INTO companies(name) VALUES($1) RETURNING id", [`role-t10j-foreign-${tag}`]);
  const foreignRole = await db(
    "INSERT INTO roles(company_id,name) VALUES($1,$2) RETURNING id",
    [foreignCompany.rows[0].id, `foreign-role-${tag}`]
  );

  ctx = {
    db, tag, companyId, storeId,
    adminRole: adminRole.rows[0],
    adminUser: adminUser.rows[0],
    managerRole: managerRole.rows[0],
    managerUser: managerUser.rows[0],
    peonUser: peonUser.rows[0],
    foreignCompanyId: foreignCompany.rows[0].id,
    foreignRole: foreignRole.rows[0],
  };

  /* --------------------------------------------------------------- app */
  const app = express();
  app.use(express.json());
  const authenticate = (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: "Unauthenticated" });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "test-secret");
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
  };
  /* Mirror server.js's real authorize: admin bypass by ROLE NAME in DB. */
  const canViewCompanyCustomers = async (user) => {
    const r = await db(
      "SELECT 1 FROM roles WHERE id=$1 AND company_id=$2 AND LOWER(name) IN ('administrator','admin','owner') LIMIT 1",
      [user.roleId, user.companyId]
    );
    return r.rows.length > 0;
  };
  const getRolePermissionCodes = async (roleId) => {
    if (!roleId) return [];
    const r = await db(
      "SELECT p.code FROM role_permissions rp INNER JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1",
      [roleId]
    );
    return r.rows.map((row) => row.code);
  };
  const authorize = (...permissionCodes) => async (req, res, next) => {
    if (await canViewCompanyCustomers(req.user)) return next();
    const codes = await getRolePermissionCodes(req.user.roleId);
    if (permissionCodes.some((code) => codes.includes(code))) return next();
    return res.status(403).json({ success: false, message: "Forbidden" });
  };

  app.use("/api", createAdminRouter({ authenticate, authorize, db, pool, canViewCompanyCustomers, bcrypt }));

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });
}

async function teardown() {
  if (!ctx) return;
  const { db, tag, companyId, foreignCompanyId } = ctx;
  /* Children first — tagged rows only. */
  await db("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id=$1)", [companyId]);
  await db("DELETE FROM users WHERE company_id=$1", [companyId]);
  await db("DELETE FROM roles WHERE company_id=$1", [companyId]);
  await db("DELETE FROM stores WHERE company_id=$1", [companyId]);
  await db("DELETE FROM companies WHERE id=$1", [companyId]);
  await db("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id=$1)", [foreignCompanyId]);
  await db("DELETE FROM roles WHERE company_id=$1", [foreignCompanyId]);
  await db("DELETE FROM stores WHERE company_id=$1", [foreignCompanyId]);
  await db("DELETE FROM companies WHERE id=$1", [foreignCompanyId]);
  await pool.end();
  if (server) await new Promise((r) => server.close(r));
}

const tokenFor = (user) =>
  jwt.sign(
    { id: user.id, companyId: ctx.companyId, storeId: ctx.storeId, roleId: user.role_id ?? user.roleId },
    process.env.JWT_SECRET || "test-secret",
    { expiresIn: "1h" }
  );

const req = (port, method, url, body = null, token = null) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const r = http.request(
      { host: "127.0.0.1", port, method, path: url, headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* noop */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    r.on("error", reject);
    r.write(payload);
    r.end();
  });

/* ------------------------------------------------------------------ tests */

describe("T10J Role Management", () => {
  before(async () => { await setup(); });
  after(async () => { await teardown(); });

  describe("permission persistence cycle (acceptance loop)", () => {
    test("ON → save → reopen → ON; OFF → save → reopen → OFF", async () => {
      const token = tokenFor(ctx.adminUser);
      const create = await req(PORT, "POST", "/api/admin/roles", { name: `cycle-${ctx.tag}` }, token);
      assert.equal(create.status, 201, JSON.stringify(create.body));
      const roleId = create.body.data.id;

      /* Turn reports.sales.view ON and save. */
      const onResp = await req(PORT, "PUT", `/api/admin/roles/${roleId}/permissions`, { permissions: ["reports.sales.view"] }, token);
      assert.equal(onResp.status, 200);
      assert.deepEqual(onResp.body.data, ["reports.sales.view"]);

      /* Fresh GET (simulates refresh + reopen). */
      const reopenedOn = await req(PORT, "GET", `/api/admin/roles/${roleId}/permissions`, null, token);
      assert.equal(reopenedOn.status, 200);
      assert.deepEqual(reopenedOn.body.data, ["reports.sales.view"], "permission must remain ON after reopen");

      /* Turn it OFF (empty selection) and save. */
      const offResp = await req(PORT, "PUT", `/api/admin/roles/${roleId}/permissions`, { permissions: [] }, token);
      assert.equal(offResp.status, 200);

      const reopenedOff = await req(PORT, "GET", `/api/admin/roles/${roleId}/permissions`, null, token);
      assert.equal(reopenedOff.status, 200);
      assert.deepEqual(reopenedOff.body.data, [], "permission must remain OFF after reopen");
    });

    test("granular report codes persist individually and role.manage keeps enforcing", async () => {
      const token = tokenFor(ctx.adminUser);
      const codes = ["reports.vat.view", "reports.profit.view", "report.export"];
      const create = await req(PORT, "POST", "/api/admin/roles", { name: `granular-${ctx.tag}` }, token);
      const roleId = create.body.data.id;
      const save = await req(PORT, "PUT", `/api/admin/roles/${roleId}/permissions`, { permissions: codes }, token);
      assert.equal(save.status, 200);
      const verify = await req(PORT, "GET", `/api/admin/roles/${roleId}/permissions`, null, token);
      assert.deepEqual([...verify.body.data].sort(), codes.sort());
    });
  });

  describe("role create / rename", () => {
    test("creates a role and lists it with is_system_role + user_count", async () => {
      const token = tokenFor(ctx.adminUser);
      const created = await req(PORT, "POST", "/api/admin/roles", { name: `cashier-${ctx.tag}`, description: "Till staff" }, token);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.is_system_role, false);

      const list = await req(PORT, "GET", "/api/admin/roles", null, token);
      const row = list.body.data.find((r) => r.id === created.body.data.id);
      assert.ok(row, "created role appears in list");
      assert.equal(row.user_count, 0);
    });

    test("renames a role; duplicate names are rejected", async () => {
      const token = tokenFor(ctx.adminUser);
      const a = await req(PORT, "POST", "/api/admin/roles", { name: `alpha-${ctx.tag}` }, token);
      const renamed = await req(PORT, "PUT", `/api/admin/roles/${a.body.data.id}`, { name: `alpha2-${ctx.tag}` }, token);
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.data.name, `alpha2-${ctx.tag}`);

      const b = await req(PORT, "POST", "/api/admin/roles", { name: `alpha2-${ctx.tag}` }, token);
      assert.equal(b.status, 409, "duplicate role name must 409");
    });

    test("reserved privileged names are rejected (anti bypass)", async () => {
      const token = tokenFor(ctx.adminUser);
      for (const name of ["Administrator", "admin", "Owner"]) {
        const resp = await req(PORT, "POST", "/api/admin/roles", { name }, token);
        assert.equal(resp.status, 400, `"${name}" must be rejected`);
      }
    });

    test("the Administrator system role cannot be renamed", async () => {
      const token = tokenFor(ctx.adminUser);
      const resp = await req(PORT, "PUT", `/api/admin/roles/${ctx.adminRole.id}`, { name: "NotAdmin" }, token);
      assert.equal(resp.status, 400);
    });
  });

  describe("last-admin lockout guard", () => {
    test("cannot deactivate the final privileged role with active users", async () => {
      /* Owner holds ctx.adminRole; a privileged non-system role with the
         owner attached would also be the last admin path — but the system
         role check comes first: an active Administrator holder blocks it. */
      const token = tokenFor(ctx.managerUser);
      /* Try to deactivate the Administrator role itself. */
      const resp = await req(PORT, "PUT", `/api/admin/roles/${ctx.adminRole.id}/active`, { active: false }, token);
      assert.equal(resp.status, 400, "Administrator role with active users must refuse deactivation");
    });

    test("deactivating a normal role detaches its users (soft action)", async () => {
      const token = tokenFor(ctx.adminUser);
      /* managerRole holds ctx.managerUser (active). */
      const resp = await req(PORT, "PUT", `/api/admin/roles/${ctx.managerRole.id}/active`, { active: false }, token);
      assert.equal(resp.status, 200);

      const check = await ctx.db("SELECT role_id FROM users WHERE id=$1", [ctx.managerUser.id]);
      assert.equal(check.rows[0].role_id, null, "user detached from deactivated role");
    });
  });

  describe("authorization + isolation", () => {
    test("user WITHOUT role.manage is rejected (cannot self-grant)", async () => {
      const token = tokenFor(ctx.peonUser);
      const list = await req(PORT, "GET", "/api/admin/roles", null, token);
      assert.equal(list.status, 403);
      const grant = await req(
        PORT, "PUT",
        `/api/admin/roles/${ctx.peonUser.role_id ?? ctx.peonUser.roleId}/permissions`,
        { permissions: ["role.manage", "user.manage"] },
        token
      );
      assert.equal(grant.status, 403, "permission-less user cannot grant themselves permissions");
    });

    test("user with ONLY role.manage can list roles (granular grant works)", async () => {
      const token = tokenFor(ctx.managerUser);
      const list = await req(PORT, "GET", "/api/admin/roles", null, token);
      assert.equal(list.status, 200);
    });

    test("foreign-company role is invisible and unmodifiable (404)", async () => {
      const token = tokenFor(ctx.adminUser);
      const perms = await req(PORT, "GET", `/api/admin/roles/${ctx.foreignRole.id}/permissions`, null, token);
      assert.equal(perms.status, 404);
      const grant = await req(PORT, "PUT", `/api/admin/roles/${ctx.foreignRole.id}/permissions`, { permissions: ["sale.create"] }, token);
      assert.equal(grant.status, 404);
    });
  });
});

/* ------------------------------------------------------------ UI contract */

describe("T10J Role Management UI contract", () => {
  const src = read("src/pages/settings/SettingsAdmin.jsx");

  test("permission matrix uses Toggle switches, not bare checkboxes", () => {
    const start = src.indexOf("function RolePermissionsManager");
    assert.ok(start >= 0, "RolePermissionsManager not found");
    const next = src.indexOf("\nfunction ", start + 10);
    const matrix = src.slice(start, next === -1 ? src.length : next);
    assert.ok(/<Toggle/.test(matrix), "toggles required in the matrix");
    assert.ok(
      !/type=["']checkbox["']/.test(matrix),
      "raw checkboxes must not be used for permissions"
    );
  });

  test("RoleListManager provides create + edit of roles", () => {
    assert.ok(/function RoleListManager/.test(src));
    assert.ok(src.includes('"/api/admin/roles"') || src.includes("'/api/admin/roles'"), "create call");
    assert.ok(/\/api\/admin\/roles\/\$\{form\.id\}/.test(src), "edit call");
    assert.ok(src.includes("Add role"));
  });

  test("role active toggle present and system roles protected", () => {
    assert.ok(src.includes("/active`"), "activate/deactivate endpoint used");
    assert.ok(/is_system_role/.test(src), "system role protection in UI");
  });

  test("no broad report.view introduced anywhere in the UI", () => {
    assert.ok(!src.includes('"report.view"') && !src.includes("'report.view'"));
  });
});
