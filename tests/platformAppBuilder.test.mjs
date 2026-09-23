import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";

const state = { apps: [], pages: [] };

function db(sql, params = []) {
  if (sql.startsWith("SELECT * FROM platform_apps")) {
    if (params.length === 1 && typeof params[0] === "string") {
      return { rows: state.apps.filter((app) => app.company_id === params[0] && app.active !== false) };
    }
    if (params.length === 2 && typeof params[1] === "string") {
      return { rows: state.apps.filter((app) => app.id === params[0] && app.company_id === params[1] && app.active !== false) };
    }
    if (params.length === 2 && typeof params[0] === "string") {
      return { rows: state.apps.filter((app) => app.company_id === params[1] && app.active !== false) };
    }
    return { rows: state.apps.filter((app) => app.company_id === params[0] && app.active !== false) };
  }
  if (sql.startsWith("INSERT INTO platform_apps")) {
    const app = {
      id: `app-${state.apps.length + 1}`,
      company_id: params[0],
      app_key: params[1],
      label: params[2],
      description: params[3],
      active: true,
      config: JSON.parse(params[4]),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.apps.push(app);
    return { rows: [app] };
  }
  if (sql.startsWith("UPDATE platform_apps")) {
    const app = state.apps.find((entry) => entry.id === params[params.length - 1]);
    if (!app) return { rows: [] };
    if (params[0] !== undefined) app.app_key = params[0];
    if (params[1] !== undefined) app.label = params[1];
    if (params[2] !== undefined) app.description = params[2];
    if (params[3] !== undefined) app.active = params[3];
    if (params[4] !== undefined) app.config = JSON.parse(params[4]);
    app.updated_at = new Date().toISOString();
    return { rows: [app] };
  }
  if (sql.startsWith("SELECT * FROM platform_pages")) {
    if (params.length === 2 && typeof params[0] === "string") {
      return { rows: state.pages.filter((page) => page.app_id === params[0] && page.company_id === params[1] && page.active !== false) };
    }
    if (params.length === 1 && typeof params[0] === "string") {
      return { rows: state.pages.filter((page) => page.id === params[0] && page.active !== false) };
    }
    return { rows: [] };
  }
  if (sql.startsWith("INSERT INTO platform_pages")) {
    const page = {
      id: `page-${state.pages.length + 1}`,
      app_id: params[0],
      company_id: params[1],
      page_key: params[2],
      label: params[3],
      route_path: params[4],
      page_type: params[5],
      definition: JSON.parse(params[6]),
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.pages.push(page);
    return { rows: [page] };
  }
  if (sql.startsWith("UPDATE platform_pages")) {
    const page = state.pages.find((entry) => entry.id === params[params.length - 1]);
    if (!page) return { rows: [] };
    if (params[0] !== undefined) page.page_key = params[0];
    if (params[1] !== undefined) page.label = params[1];
    if (params[2] !== undefined) page.route_path = params[2];
    if (params[3] !== undefined) page.page_type = params[3];
    if (params[4] !== undefined) page.definition = JSON.parse(params[4]);
    if (params[5] !== undefined) page.active = params[5];
    page.updated_at = new Date().toISOString();
    return { rows: [page] };
  }
  if (sql.startsWith("UPDATE platform_apps SET active=false")) {
    const app = state.apps.find((entry) => entry.id === params[0] && entry.company_id === params[1]);
    if (app) app.active = false;
    return { rows: app ? [app] : [] };
  }
  if (sql.startsWith("UPDATE platform_pages SET active=false")) {
    const page = state.pages.find((entry) => entry.id === params[0] && entry.company_id === params[1]);
    if (page) page.active = false;
    return { rows: page ? [page] : [] };
  }
  return { rows: [] };
}

test("platform app builder creates apps and pages with metadata scoping", async () => {
  const app = express();
  app.use(express.json());
  app.use(createPlatformRouter({
    db,
    authenticate: (req, res, next) => { req.user = { companyId: "company-a", storeId: null, isSuperadmin: false }; next(); },
    authorize: () => (req, res, next) => next(),
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const createAppResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/apps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "allowed" },
      body: JSON.stringify({ label: "Operations Center", config: { defaultPage: "dashboard" } }),
    });
    assert.equal(createAppResp.status, 201);
    const createdApp = await createAppResp.json();
    assert.equal(createdApp.data.app_key, "operations_center");

    const createPageResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/apps/${createdApp.data.id}/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "allowed" },
      body: JSON.stringify({ label: "Vehicles", pageType: "object", routePath: "/vehicles", definition: { objectKey: "vehicle" } }),
    });
    assert.equal(createPageResp.status, 201);
    const createdPage = await createPageResp.json();
    assert.equal(createdPage.data.page_key, "vehicles");

    const runtimeResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/runtime/apps/${createdApp.data.id}`, {
      headers: { Authorization: "allowed" },
    });
    assert.equal(runtimeResp.status, 200);
    const runtimeBody = await runtimeResp.json();
    assert.equal(runtimeBody.data.pages[0].page_type, "object");

    const appResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/apps/${createdApp.data.id}`, {
      headers: { Authorization: "allowed" },
    });
    assert.equal(appResp.status, 200);
    const appBody = await appResp.json();
    assert.equal(appBody.data.pages.length, 1);
    assert.equal(appBody.data.pages[0].label, "Vehicles");

    const listResp = await fetch(`http://127.0.0.1:${server.address().port}/platform/apps`, {
      headers: { Authorization: "allowed" },
    });
    assert.equal(listResp.status, 200);
    const listed = await listResp.json();
    assert.equal(listed.data[0].label, "Operations Center");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
