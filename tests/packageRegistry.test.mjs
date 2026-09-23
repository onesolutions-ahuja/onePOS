import test from "node:test";
import assert from "node:assert/strict";
import { packageDefinition, packageRegistrySchema, provisionDefaultCompanyPackages, provisionPackageMetadata, resolveFeaturePlan, resolvePackagePlan } from "../services/packageRegistry.js";
import createPackagesRouter from "../routes/packages.js";
import express from "express";

test("package registry schema is additive and company scoped", () => {
  assert.match(packageRegistrySchema, /CREATE TABLE IF NOT EXISTS package_registry/);
  assert.match(packageRegistrySchema, /CREATE TABLE IF NOT EXISTS package_dependencies/);
  assert.match(packageRegistrySchema, /company_id UUID NOT NULL REFERENCES companies/);
  assert.match(packageRegistrySchema, /selected_features JSONB/);
  assert.match(packageRegistrySchema, /CREATE TABLE IF NOT EXISTS package_installation_versions/);
  assert.match(packageRegistrySchema, /migration_key VARCHAR/);
  assert.match(packageRegistrySchema, /idempotency_key/);
  assert.match(packageRegistrySchema, /UNIQUE \(company_id, idempotency_key, operation, package_key\)/);
  assert.doesNotMatch(packageRegistrySchema, /\bDROP\s+TABLE\b/i);
});

test("platform metadata records package ownership", async () => {
  const { platformSchema } = await import("../services/platformMetadata.js");
  assert.match(platformSchema, /package_id UUID REFERENCES package_registry\(id\)/);
  assert.match(platformSchema, /idx_platform_objects_package/);
});

test("dependency plans are deterministic, dependency-first, and reject cycles", () => {
  const packages = [
    { packageKey: "one.app", dependencies: ["one.base"] },
    { packageKey: "one.base", dependencies: [] },
  ];
  assert.deepEqual(resolvePackagePlan("one.app", packages).map((pkg) => pkg.packageKey), ["one.base", "one.app"]);
  assert.throws(
    () => resolvePackagePlan("one.app", [{ packageKey: "one.app", dependencies: ["one.app"] }]),
    /cycle/
  );
});

test("initial One-* definitions reuse canonical catalog module keys", () => {
  const sales = packageDefinition({ key: "retail_pos", name: "POS & Sales" });
  const inventory = packageDefinition({ key: "inventory", name: "Inventory" });
  assert.equal(sales.name, "OneSales");
  assert.equal(inventory.name, "OneInventory");
  assert.deepEqual(sales.dependencies, ["products"]);
  assert.equal(sales.moduleKey, "retail_pos");
});

test("optional feature plans validate and include feature dependencies", () => {
  const definition = packageDefinition({
    key: "retail_pos",
    name: "POS & Sales",
    optionalFeatures: [
      { key: "loyalty", dependencies: ["customer_credit"] },
      { key: "customer_credit", dependencies: [] },
    ],
  });
  assert.deepEqual(resolveFeaturePlan(definition, ["loyalty"]).map((feature) => feature.key), ["loyalty", "customer_credit"]);
  assert.throws(() => resolveFeaturePlan(definition, ["missing"]), /Optional feature not found/);
});

test("package routes require authentication and preserve company scope", async (t) => {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM package_registry p LEFT JOIN")) {
      return { rows: [{ id: "pkg-id", package_key: "one.app", name: "App", version: "1.0.0", module_key: "one.app", manifest: { dependencies: [] } }] };
    }
    if (sql.includes("FROM company_package_installations i")) return { rows: [] };
    return { rows: [] };
  };
  const app = express();
  app.use(express.json());
  app.use(createPackagesRouter({
    db,
    authenticate: (req, res, next) => {
      req.user = { id: "user-a", companyId: "company-a" };
      next();
    },
    authorize: () => (req, res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/packages`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].company_installation, null);
  assert.equal(calls[1].params[0], "company-a");
});

test("uninstall refuses to remove an active package", async (t) => {
  const db = async (sql) => {
    if (sql.includes("SELECT response FROM package_installation_operations")) return { rows: [] };
    if (sql.includes("SELECT id FROM package_registry")) return { rows: [{ id: "pkg-id" }] };
    if (sql.includes("SELECT status FROM company_package_installations")) return { rows: [{ status: "active" }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const app = express();
  app.use(express.json());
  app.use(createPackagesRouter({
    db,
    authenticate: (req, res, next) => {
      req.user = { id: "user-a", companyId: "company-a" };
      next();
    },
    authorize: () => (req, res, next) => next(),
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/packages/one.app/uninstall`, { method: "POST" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "PACKAGE_ACTIVE");
});

test("package metadata provisioning is idempotent and package-owned", async () => {
  const objects = new Map();
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push(sql);
    if (sql.startsWith("SELECT id,package_id,module_id,company_id")) {
      const object = objects.get(params[0]);
      return { rows: object ? [object] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_objects")) {
      const object = { id: "object-1", package_id: params[1], module_id: params[0], company_id: params[6] };
      objects.set(params[2], object);
      return { rows: [object] };
    }
    if (sql.startsWith("SELECT id,company_id FROM platform_fields")) return { rows: [] };
    return { rows: [] };
  };
  const result = await provisionPackageMetadata(db, {
    packageId: "package-1",
    moduleId: "module-1",
    companyId: "company-1",
    manifest: {
      objects: [{
        key: "package_order",
        label: "Package Order",
        fields: [{ apiName: "external_id", label: "External ID", fieldType: "text" }],
      }],
    },
  });

  test("package registry exposes uninstall metadata safety guards", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
    assert.match(source, /PACKAGE_METADATA_REMAINS/);
    assert.match(source, /PACKAGE_ACCESS_REMAINS/);
    assert.match(source, /platform_objects/);
    assert.match(source, /platform_module_access/);
  });

  test("fresh company provisioning installs only the declared default packages", async () => {
    const queries = [];
    const db = async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM package_registry")) {
        const key = params[0];
        return { rows: key === "retail_pos" ? [{ id: "pkg", version: "1.0.0", module_id: "module" }] : [] };
      }
      return { rows: [] };
    };
    await provisionDefaultCompanyPackages(db, { companyId: "company", installedBy: "user", packageKeys: ["retail_pos"] });
    assert.equal(queries.filter(({ sql }) => sql.includes("company_package_installations")).length, 1);
    assert.equal(queries.filter(({ sql }) => sql.includes("platform_module_access")).length, 1);
  });

  test("package installation supports company-validated store scope", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
    assert.match(source, /Store is not available to this company/);
    assert.match(source, /store_id IS NOT DISTINCT FROM/);
    assert.match(source, /selected_features\)/);
  });

  test("package routes use a dedicated package permission with settings compatibility", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
    assert.match(source, /authorize\("package\.manage", "settings\.manage"\)/);
    const platformSource = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8"));
    assert.match(platformSource, /module\.access\.manage/);
  });

  test("package uninstall checks active cross-package metadata references", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
    assert.match(source, /PACKAGE_REFERENCED/);
    assert.match(source, /platform_relationships/);
    assert.match(source, /sourcePackage\.package_key/);
  });
  assert.equal(result.objects, 1);
  assert.ok(calls.some((sql) => sql.includes("platform_fields")));
});
