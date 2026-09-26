import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";
import { getPlatformFunction } from "../services/platformFunctionRegistry.js";
import { systemObjectRbacPermission } from "../services/platformSystemObjects.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const RECORD_ID = "e0000000-0000-4000-8000-000000000001";
const ROLE_ID = "d0000000-0000-4000-8000-000000000001";
const OBJECTS = {
  employee: {
    id: "f0000000-0000-4000-8000-000000000001",
    object_key: "employee",
    source_table: "users",
    company_id: null,
    company_scoped: true,
    store_scoped: false,
    active: true,
  },
  attendance: {
    id: "f0000000-0000-4000-8000-000000000002",
    object_key: "attendance",
    source_table: "attendance_records",
    company_id: null,
    company_scoped: true,
    store_scoped: true,
    active: true,
  },
};

function createContext({
  companyId = COMPANY_A,
  permissions = [],
  roleCompanyId = COMPANY_A,
  superadmin = false,
  recordCompanyId = companyId,
} = {}) {
  const calls = [];
  const db = async (sql, params = []) => {
    const query = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ query, params });
    if (query.startsWith("SELECT * FROM platform_objects WHERE object_key=$1")) {
      const object = OBJECTS[params[0]];
      return { rows: object && (!object.company_id || object.company_id === companyId) ? [{ ...object }] : [] };
    }
    if (query.startsWith("SELECT can_view, can_create, can_edit, can_delete, can_import")) return { rows: [] };
    if (query.startsWith("SELECT object_key,source_table FROM platform_objects WHERE id=$1")) {
      const object = Object.values(OBJECTS).find((entry) => entry.id === params[0]);
      return { rows: object && (!object.company_id || object.company_id === params[1]) ? [{ ...object }] : [] };
    }
    if (query.startsWith("SELECT 1 FROM roles r")) {
      return { rows: roleCompanyId === null || roleCompanyId === companyId
        ? permissions.includes(params[2]) ? [{ "?column?": 1 }] : []
        : [] };
    }
    if (query.startsWith("SELECT * FROM platform_fields WHERE object_id=$1")) {
      const object = Object.values(OBJECTS).find((entry) => entry.id === params[0]);
      const columns = object?.object_key === "employee"
        ? [["full_name", "Full Name", "full_name"], ["active", "Status", "active"]]
        : [["clock_in", "Clock In", "clock_in"], ["clock_out", "Clock Out", "clock_out"]];
      return { rows: columns.map(([api_name, label, source_column], index) => ({
        id: `${object.object_key}-field-${index}`,
        object_id: object.id,
        api_name,
        label,
        source_column,
        field_type: api_name.includes("clock") ? "datetime" : "text",
        readable: true,
        writable: true,
        active: true,
        display_order: index,
      })) };
    }
    if (query.startsWith("SELECT field_id,readable,writable FROM platform_field_security")) return { rows: [] };
    if (query.startsWith('SELECT "full_name"') || query.startsWith('SELECT "clock_in"')) {
      const requestedCompany = params.find((value) => value === COMPANY_A || value === COMPANY_B);
      if (requestedCompany !== companyId) return { rows: [] };
      if (recordCompanyId !== companyId) return { rows: [] };
      return { rows: [params[0] === RECORD_ID
        ? { id: RECORD_ID, company_id: companyId, full_name: "Staff Member", active: true, clock_in: "2026-09-26T08:00:00.000Z", clock_out: null }
        : { id: RECORD_ID, company_id: companyId, full_name: "Staff Member", active: true, clock_in: "2026-09-26T08:00:00.000Z", clock_out: null }] };
    }
    if (query.startsWith("SELECT * FROM platform_objects WHERE id=$1")) {
      const object = Object.values(OBJECTS).find((entry) => entry.id === params[0]);
      return { rows: object && (!object.company_id || object.company_id === companyId) ? [{ ...object }] : [] };
    }
    if (query.startsWith("SELECT can_view,can_create,can_edit,can_delete FROM platform_object_permissions")) return { rows: [] };
    return { rows: [] };
  };
  return { db, calls, pool: { async connect() { return { query: db, release() {} }; } }, companyId, superadmin };
}

async function start(context) {
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = {
      id: ROLE_ID,
      roleId: ROLE_ID,
      companyId: context.companyId,
      storeId: "c0000000-0000-4000-8000-000000000001",
      isSuperadmin: context.superadmin,
    };
    next();
  });
  app.use("/api", createPlatformRouter({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: context.db,
    pool: context.pool,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

async function request(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.json() };
}

test("Staff and Attendance map existing RBAC permissions without granting generic User creation or attendance writes", () => {
  assert.equal(systemObjectRbacPermission({ object_key: "employee", source_table: "users" }, "view"), "user.view");
  assert.equal(systemObjectRbacPermission({ object_key: "employee", source_table: "users" }, "edit"), "user.edit");
  assert.equal(systemObjectRbacPermission({ object_key: "employee", source_table: "users" }, "create"), null);
  assert.equal(systemObjectRbacPermission({ object_key: "attendance", source_table: "attendance_records" }, "view"), "attendance.view");
  assert.equal(systemObjectRbacPermission({ object_key: "attendance", source_table: "attendance_records" }, "edit"), null);

  for (const key of ["attendance.clock_in", "attendance.clock_out"]) {
    assert.ok(getPlatformFunction(key).permissions.includes("attendance.use"));
  }
});

test("user.view opens the canonical Staff Object and no grant denies it", async (t) => {
  const permitted = await start(createContext({ permissions: ["user.view"] }));
  t.after(() => permitted.server.close());
  const result = await request(permitted.port, `/api/platform/runtime/record-page?objectKey=employee&recordId=${RECORD_ID}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.record.full_name, "Staff Member");

  const denied = await start(createContext());
  t.after(() => denied.server.close());
  const resultDenied = await request(denied.port, `/api/platform/runtime/record-page?objectKey=employee&recordId=${RECORD_ID}`);
  assert.equal(resultDenied.status, 403);
});

test("user.edit maps to Staff edit while user.create stays with authoritative User administration", async (t) => {
  const context = createContext({ permissions: ["user.edit", "user.create"] });
  const app = await start(context);
  t.after(() => app.server.close());
  const permissions = await request(app.port, `/api/platform/objects/${OBJECTS.employee.id}/effective-permissions`);
  assert.equal(permissions.status, 200);
  assert.equal(permissions.body.data.can_edit, true);
  assert.equal(permissions.body.data.can_create, false);
  assert.equal(permissions.body.data.source, "rbac_bridge");
});

test("attendance.view grants the canonical Attendance Object; attendance.use alone does not", async (t) => {
  const permitted = await start(createContext({ permissions: ["attendance.view"] }));
  t.after(() => permitted.server.close());
  const result = await request(permitted.port, `/api/platform/runtime/record-page?objectKey=attendance&recordId=${RECORD_ID}`);
  assert.equal(result.status, 200);

  const denied = await start(createContext({ permissions: ["attendance.use"] }));
  t.after(() => denied.server.close());
  const resultDenied = await request(denied.port, `/api/platform/runtime/record-page?objectKey=attendance&recordId=${RECORD_ID}`);
  assert.equal(resultDenied.status, 403);
});

test("RBAC bridge preserves Superadmin bypass and rejects cross-company role permission grants", async (t) => {
  const superadmin = await start(createContext({ superadmin: true }));
  t.after(() => superadmin.server.close());
  const allowed = await request(superadmin.port, `/api/platform/runtime/record-page?objectKey=employee&recordId=${RECORD_ID}`);
  assert.equal(allowed.status, 200);

  const foreignRole = await start(createContext({ permissions: ["user.view"], roleCompanyId: COMPANY_A, companyId: COMPANY_B }));
  t.after(() => foreignRole.server.close());
  const denied = await request(foreignRole.port, `/api/platform/runtime/record-page?objectKey=employee&recordId=${RECORD_ID}`);
  assert.equal(denied.status, 403);

  const tenantData = await start(createContext({
    companyId: COMPANY_B,
    recordCompanyId: COMPANY_A,
    roleCompanyId: COMPANY_B,
    permissions: ["user.view"],
  }));
  t.after(() => tenantData.server.close());
  const isolated = await request(tenantData.port, `/api/platform/runtime/record-page?objectKey=employee&recordId=${RECORD_ID}`);
  assert.equal(isolated.status, 404);
});
