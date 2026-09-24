import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync } from "node:fs";
import { resolvePageLayout } from "../services/platformLayoutResolver.js";

const layoutListSource = readFileSync(new URL("../src/pages/settings/Platform/LayoutList.jsx", import.meta.url), "utf8");
const layoutEditorSource = readFileSync(new URL("../src/pages/settings/Platform/LayoutEditor.jsx", import.meta.url), "utf8");
const routesSource = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

function layoutDatabase() {
  const objects = new Map();
  const layouts = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;
  const visible = (row, companyId) => [null, companyId].includes(row.company_id ?? null);
  const query = async (sql, params = []) => {
    if (sql.startsWith("SELECT api_name FROM platform_fields")) return { rows: [{ api_name: "name" }] };
    if (sql.startsWith("UPDATE platform_buttons SET active=false")) return { rows: [] };
    if (sql.startsWith("SELECT id FROM roles WHERE id=$1 AND company_id=$2")) return { rows: [{ id: params[0] }] };
    if (sql.startsWith("SELECT * FROM platform_objects WHERE id=$1")) {
      const object = objects.get(params[0]);
      if (!object || !object.active || !visible(object, params[1])) return { rows: [] };
      return { rows: [object] };
    }
    if (sql.startsWith("INSERT INTO platform_layouts")) {
      const hasRecordType = params.length === 9;
      const [object_id, page_type, role_id, company_id, fifth, sixth, seventh, eighth, ninth] = params;
      const record_type_id = hasRecordType ? fifth : null;
      const name = hasRecordType ? sixth : fifth;
      const layout_key = hasRecordType ? seventh : sixth;
      const definition = hasRecordType ? eighth : seventh;
      const is_default = hasRecordType ? ninth : eighth;
      const identity = layouts.find((row) =>
        row.object_id === object_id && row.page_type === page_type
        && (row.role_id ?? null) === (role_id ?? null) && visible(row, company_id) && (row.company_id ?? null) === (company_id ?? null)
      );
      if (identity) {
        // ON CONFLICT (object_id, page_type, role_id, company_id) DO UPDATE:
        // name/definition/active are refreshed, the stored layout_key survives.
        Object.assign(identity, { name, definition: JSON.parse(definition), active: true, updated_at: "now" });
        return { rows: [identity] };
      }
      const keyClash = layouts.find((row) =>
        row.object_id === object_id && row.page_type === page_type && row.layout_key === layout_key
      );
      if (keyClash) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint: "uq_platform_layouts_object_page_key" });
      const row = { id: nextId("layout"), object_id, page_type, role_id, company_id, record_type_id, name, layout_key, definition: JSON.parse(definition), active: true, is_default: is_default === true, updated_at: "now" };
      layouts.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT * FROM platform_layouts WHERE id=$1")) {
      const row = layouts.find((item) => item.id === params[0] && visible(item, params[1]));
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("SELECT * FROM platform_layouts WHERE id=$1 AND active=true")) {
      const row = layouts.find((item) => item.id === params[0] && item.active && visible(item, params[1]));
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("UPDATE platform_layouts SET page_type")) {
      const hasRecordType = params.length === 8;
      const id = hasRecordType ? params[7] : params[6];
      const row = layouts.find((item) => item.id === id);
      if (!row) return { rows: [] };
      const keyClash = layouts.find((item) =>
        item.id !== row.id && item.object_id === row.object_id
        && item.page_type === params[0] && item.layout_key === row.layout_key
      );
      if (keyClash) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint: "uq_platform_layouts_object_page_key" });
      Object.assign(row, {
        page_type: params[0],
        role_id: params[1] ?? null,
        name: hasRecordType ? params[3] : params[2],
        definition: hasRecordType ? params[4] : params[3],
        active: (hasRecordType ? params[5] : params[4]) === undefined || (hasRecordType ? params[5] : params[4]) === null ? row.active : (hasRecordType ? params[5] : params[4]),
        is_default: (hasRecordType ? params[6] : params[5]) === undefined || (hasRecordType ? params[6] : params[5]) === null ? row.is_default : (hasRecordType ? params[6] : params[5]),
        updated_at: "now",
      });
      return { rows: [row] };
    }
    if (sql.includes("FROM platform_layouts") && sql.includes("active=true") && sql.includes("ORDER BY name")) {
      return { rows: layouts.filter((row) => row.active && visible(row, params[0])) };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  return { query, objects, layouts };
}

async function layoutApi(t, db, { isSuperadmin = false } = {}) {
  const { default: createPlatformRouter } = await import("../routes/platform.js");
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db: db.query,
    authenticate: (req, res, next) => { req.user = { companyId: "company-a", isSuperadmin }; next(); },
    authorize: (code) => (req, res, next) => { assert.equal(code, "settings.manage"); next(); },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
}

function productObject(db, id) {
  const object = { id, object_key: id, label: id, company_id: null, active: true };
  db.objects.set(id, object);
  return object;
}

test("label-only layout creation fixes the live 400 and derives the API key from the name", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  const call = await layoutApi(t, db);

  // Payload shaped exactly like the live editor: snake_case page_type, no API key.
  const created = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout",
    page_type: "detail",
    objectId: "product",
    roleId: null,
    companyId: null,
    definition: { components: [] },
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.data.layout_key, "standard_product_layout");
  assert.equal(created.body.data.page_type, "detail");
  assert.equal(created.body.data.name, "Standard Product Layout");
});

test("generated layout API keys are deterministic and duplicates are rejected without suffixing", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  productObject(db, "customer");
  const call = await layoutApi(t, db);

  const first = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "product", definition: { components: [] },
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.data.layout_key, "standard_product_layout");

  // Same label on another object produces the same deterministic key (scoped per object).
  const otherObject = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "customer", definition: { components: [] },
  });
  assert.equal(otherObject.status, 201);
  assert.equal(otherObject.body.data.layout_key, "standard_product_layout");

  // Same generated key on the same object+page but a different role is a hard
  // conflict: rejected with a clear 409, never silently suffixed _2/_3.
  const keyClash = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "product", roleId: "role-manager", definition: { components: [] },
  });
  assert.equal(keyClash.status, 409);
  assert.match(keyClash.body.message, /API key already exists/);

  // Re-creating the exact same layout identity is the documented upsert path:
  // the existing row (and its API key) is kept instead of a second record.
  const repeat = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "product", definition: { components: [] },
  });
  assert.equal(repeat.status, 201);
  assert.equal(repeat.body.data.id, first.body.data.id);
  assert.equal(repeat.body.data.layout_key, "standard_product_layout");
  assert.equal(db.layouts.length, 2);
  assert.equal(db.layouts.filter((row) => row.object_id === "product").length, 1);
});

test("editing the layout label keeps the stored API key stable", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  const call = await layoutApi(t, db);

  const created = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "product", definition: { components: [] },
  });
  const layoutId = created.body.data.id;

  // The client no longer owns the key, but even a stale layoutKey in the
  // payload must never rename the stored key on update.
  const renamed = await call("PUT", `/platform/layouts/${layoutId}`, {
    name: "Renamed Product Layout",
    layoutKey: "something_else",
    pageType: "detail",
    definition: { components: [] },
  });

  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.name, "Renamed Product Layout");
  assert.equal(renamed.body.data.layout_key, "standard_product_layout");
  assert.equal(db.layouts[0].layout_key, "standard_product_layout");
});

test("update keeps accepting the snake_case page_type payload", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  const call = await layoutApi(t, db);

  const created = await call("POST", "/platform/layouts", {
    name: "Standard Product Layout", pageType: "detail", objectId: "product", definition: { components: [] },
  });

  const updated = await call("PUT", `/platform/layouts/${created.body.data.id}`, {
    name: "Standard Product Layout",
    page_type: "list",
    definition: { components: [] },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.page_type, "list");
});

test("layout listing is company scoped and the admin list filters by the selected object", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  const call = await layoutApi(t, db);

  await call("POST", "/platform/layouts", {
    name: "Company Layout", pageType: "detail", objectId: "product", definition: { components: [] },
  });
  db.layouts.push({
    id: "layout-other-company", object_id: "product", page_type: "detail", role_id: null,
    company_id: "company-b", name: "Other Company Layout", layout_key: "other_company_layout",
    definition: { components: [] }, active: true, updated_at: "now",
  });

  const list = await call("GET", "/platform/layouts");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.map((row) => row.name), ["Company Layout"]);

  // The configuration screen narrows the visible rows to the selected object.
  assert.match(layoutListSource, /objectId = null/);
  assert.match(layoutListSource, /layout\.object_id/);
});

test("layout retrieval returns the saved definition and remains company scoped", async (t) => {
  const db = layoutDatabase();
  productObject(db, "product");
  const call = await layoutApi(t, db);

  const created = await call("POST", "/platform/layouts", {
    name: "Record Detail", pageType: "detail", objectId: "product",
    definition: { components: [{ type: "field", field_key: "name" }] },
  });
  const retrieved = await call("GET", `/platform/layouts/${created.body.data.id}`);
  assert.equal(retrieved.status, 200);
  assert.deepEqual(retrieved.body, { success: true, data: created.body.data });
  assert.deepEqual(retrieved.body.data.definition.components, [{ type: "field", field_key: "name" }]);

  db.layouts[0].company_id = "company-b";
  const isolated = await call("GET", `/platform/layouts/${created.body.data.id}`);
  assert.equal(isolated.status, 404);
  assert.equal(isolated.body.message, "Layout not found");
});

test("layout editor generates the API key with the shared safeApiName convention", () => {
  assert.match(layoutEditorSource, /import \{ toSafeApiName, withGeneratedApiName \} from "\.\/safeApiName\.js"/);
  assert.match(layoutEditorSource, /toSafeApiName\(label, "layout"\)/);
  assert.match(layoutEditorSource, /apiNameField: "layout_key", isNew/);
  assert.match(layoutEditorSource, /readOnly/);
  assert.match(layoutEditorSource, /pageType: form\.page_type/);
  assert.match(layoutEditorSource, /layout\?\.definition\?\.components/);
  assert.doesNotMatch(layoutEditorSource, /Enter a layout API key/);
});

test("layout routes generate the key server-side from the shared toSafeApiName helper", () => {
  assert.match(routesSource, /toSafeApiName\(req\.body\.layoutKey \|\| req\.body\.name, "layout"\)/);
  assert.match(routesSource, /uq_platform_layouts_object_page_key/);
});

test("layout resolver prefers role assignment, then default, then company fallback", () => {
  const resolved = resolvePageLayout([
    { id: "fallback", active: true, company_id: "company-a", updated_at: "2026-01-03" },
    { id: "default", active: true, is_default: true, company_id: "company-a", updated_at: "2026-01-01" },
    { id: "role", active: true, role_id: "role-a", company_id: "company-a", updated_at: "2025-01-01" },
    { id: "inactive", active: false, role_id: "role-a", company_id: "company-a" },
  ]);
  assert.equal(resolved.id, "role");
  assert.equal(resolvePageLayout([{ id: "inactive", active: false }]), null);
});

test("layout editor exposes section authoring and restrictive field presentation controls", () => {
  assert.match(layoutEditorSource, /Add Section/);
  assert.match(layoutEditorSource, /Columns/);
  assert.match(layoutEditorSource, /Move Section|moveSection/);
  assert.match(layoutEditorSource, /Read-only/);
  assert.match(layoutEditorSource, /Required/);
  assert.match(layoutEditorSource, /sections:/);
});
