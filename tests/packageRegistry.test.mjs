import test from "node:test";
import assert from "node:assert/strict";
import { packageDefinition, packageDefinitions, packageRegistrySchema, provisionDefaultCompanyPackages, provisionPackageMetadata, resolveFeaturePlan, resolvePackagePlan, satisfiesPackageVersion } from "../services/packageRegistry.js";
import createPackagesRouter from "../routes/packages.js";
import express from "express";
import { getWorkflowActionDefinition } from "../services/platformWorkflow.js";

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

test("manifest captures install, licensing, visibility, dependency, and ownership policy", async () => {
  const definition = packageDefinition({
    key: "sample_app",
    name: "Sample App",
    dependencies: [{ packageKey: "customer_core", minVersion: "2.0.0", maxVersion: "3.0.0" }],
    optionalDependencies: [{ packageKey: "analytics", versionRange: "^1.2.0" }],
  });
  assert.equal(definition.manifest.packageKey, "sample_app");
  assert.equal(definition.manifest.version, "1.0.0");
  assert.equal(definition.manifest.packageType, "APPLICATION");
  assert.equal(definition.manifest.category, "Business");
  assert.deepEqual(definition.manifest.optionalDependencies, [{ packageKey: "analytics", versionRange: "^1.2.0" }]);
  assert.equal(definition.manifest.versionConstraints.customer_core.minVersion, "2.0.0");
  assert.equal(definition.manifest.licenceMode, "COMMERCIAL");
  assert.equal(definition.manifest.licenceRequired, true);
  assert.equal(definition.manifest.billable, true);
  assert.equal(definition.manifest.visibility, "PUBLIC");
  assert.equal(definition.manifest.installable, true);
  assert.equal(definition.manifest.lifecycleState, "PUBLISHED");
  assert.equal(definition.manifest.metadataOwnership.preserveUserModified, true);
  assert.equal(satisfiesPackageVersion("2.4.0", ">=2.0.0 <3.0.0"), true);
  assert.equal(satisfiesPackageVersion("3.0.0", ">=2.0.0 <3.0.0"), false);
  const fs = await import("node:fs");
  const canonical = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../database/baseFoundation.sql", import.meta.url), "utf8");
  for (const fragment of [
    "package_type", "publisher", "category", "required_platform_version", "publication_state",
    "visible", "installable", "billable", "system_only", "display_order", "available_tiers",
    "licence_mode", "allowed_bundles", "allowed_companies", "min_version", "max_version",
    "suspended_by_entitlement", "deactivated_by_user", "package_metadata_ownership",
    "licence_packages", "licence_bundle_packages", "licence_tier_packages",
    "company_package_entitlement_sources", "DIRECT_INSTALL",
  ]) {
    assert.ok(canonical.includes(fragment), `canonical schema contains ${fragment}`);
    assert.ok(migration.includes(fragment), `runtime migration contains ${fragment}`);
  }
});

test("initial One-* definitions reuse canonical catalog module keys", () => {
  const sales = packageDefinition({ key: "retail_pos", name: "POS & Sales" });
  const inventory = packageDefinition({ key: "inventory", name: "Inventory" });
  assert.equal(sales.name, "OneSales");
  assert.equal(inventory.name, "OneInventory");
  assert.deepEqual(sales.dependencies, ["products"]);
  assert.equal(sales.moduleKey, "retail_pos");
});

test("Product Core is a non-billable foundation declaring canonical Product metadata", () => {
  const definition = packageDefinitions().find((pkg) => pkg.packageKey === "products");
  assert.ok(definition);
  assert.equal(definition.name, "Product Core");
  assert.equal(definition.version, "1.1.0");
  assert.deepEqual(definition.dependencies, []);
  assert.equal(definition.manifest.packageType, "FOUNDATION");
  assert.equal(definition.manifest.billable, false);
  assert.equal(definition.manifest.licenceRequired, false);
  assert.equal(definition.manifest.upgrade.adoptsExistingData, true);
  assert.ok(definition.manifest.migrations.includes("product_core.adopt_canonical_metadata.v1"));
  const product = definition.manifest.objects.find(({ objectKey }) => objectKey === "product");
  const category = definition.manifest.objects.find(({ objectKey }) => objectKey === "category");
  assert.equal(product.sourceTable, "products");
  assert.deepEqual(product.adoptFromPackageKeys, ["retail_pos"]);
  for (const apiName of ["name", "sku", "barcode", "category_id", "active", "product_kind", "parent_product_id", "variant_attributes"]) {
    assert.ok(product.fields.some((field) => field.apiName === apiName), apiName);
  }
  assert.equal(category.sourceTable, "categories");
  assert.ok(definition.manifest.relationships.some((relationship) =>
    relationship.parentObjectKey === "category" && relationship.childObjectKey === "product" &&
    relationship.childFieldApiName === "category_id"
  ));
  assert.ok(definition.manifest.relationships.some((relationship) =>
    relationship.parentObjectKey === "product" && relationship.childObjectKey === "product" &&
    relationship.relationshipKey === "variants" && relationship.childFieldApiName === "parent_product_id"
  ));
  assert.ok(definition.manifest.listViews.some((view) => view.objectKey === "product" && view.isDefault));
  assert.ok(definition.manifest.layouts.some((layout) => layout.pageType === "detail" && layout.objectKey === "product"));
  assert.ok(definition.manifest.recordForms.some((form) =>
    form.pageType === "create" && form.objectKey === "product" && form.definition.components.length === 0
  ));
  assert.ok(definition.manifest.rules.some((rule) => rule.objectKey === "product"));
  assert.deepEqual(definition.manifest.actions.map(({ handlerKey }) => handlerKey), Array(5).fill("RECORD_SAVE"));
});

test("Product Core idempotently adopts the existing Product Object and owns its declared metadata", async () => {
  const definition = packageDefinitions().find((pkg) => pkg.packageKey === "products");
  const objects = new Map([
    ["product", { id: "existing-product-object", package_id: "retail-pos-package", module_id: "retail-pos-module", company_id: null }],
    ["category", { id: "existing-category-object", package_id: null, module_id: "retail-pos-module", company_id: null }],
  ]);
  const fields = new Map();
  const rules = new Map();
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
      return { rows: [objects.get(params[0])] };
    }
    if (sql.startsWith("SELECT package_key FROM package_registry")) return { rows: [{ package_key: "retail_pos" }] };
    if (sql.startsWith("SELECT 1 FROM package_metadata_ownership")) return { rows: [{ "?column?": 1 }] };
    if (sql.startsWith("UPDATE platform_objects SET package_id=")) {
      const object = [...objects.values()].find((candidate) => candidate.id === params[8]);
      Object.assign(object, { package_id: params[0], module_id: params[1], company_id: params[2] });
      return { rows: [object] };
    }
    if (sql.startsWith("SELECT id,company_id FROM platform_fields")) {
      const field = fields.get(`${params[0]}:${params[1]}:${params[2] || "global"}`);
      return { rows: field ? [field] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_fields")) {
      const key = `${params[0]}:${params[1]}:${params[11] || "global"}`;
      fields.set(key, { id: `field-${fields.size + 1}`, company_id: params[11] || null });
      return { rows: [] };
    }
    if (sql.startsWith("SELECT id FROM platform_fields WHERE object_id=$1")) return { rows: [{ id: `field-${params[1]}` }] };
    if (sql.startsWith("SELECT id,object_key FROM platform_objects WHERE object_key=ANY")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_list_views")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_layouts")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_registered_actions")) return { rows: [{ id: `action-${params[2]}` }] };
    if (sql.startsWith("SELECT id,action,source_package_id,user_modified FROM platform_rules")) {
      const rule = rules.get(params[2]);
      return { rows: rule ? [rule] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_rules")) {
      rules.set(params[1], {
        id: `rule-${params[1]}`,
        action: JSON.parse(params[4]),
        source_package_id: params[8],
        user_modified: false,
      });
      return { rows: [] };
    }
    if (sql.startsWith("WITH owned AS")) return { rowCount: 1, rows: [] };
    return { rows: [] };
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await provisionPackageMetadata(db, {
      packageId: "product-core-package",
      moduleId: "products-module",
      companyId: "company-a",
      manifest: definition.manifest,
      packageVersion: definition.version,
    });
    assert.equal(result.objects, 2);
  }

  assert.equal(objects.get("product").id, "existing-product-object");
  assert.equal(objects.get("product").package_id, "product-core-package");
  assert.equal(objects.get("category").id, "existing-category-object");
  assert.equal(objects.get("category").package_id, "product-core-package");
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_objects")).length, 0);
  assert.ok(calls.some(({ sql }) => sql.startsWith("INSERT INTO platform_fields") && /source_column/.test(sql)));
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_layouts")).length, 6);
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_rules")).length, 3);
  assert.ok(calls.some(({ sql }) => sql.startsWith("WITH owned AS") && /source_package_id/.test(sql)));
});

test("Staff Core is a non-billable foundation over existing users and attendance", () => {
  const staff = packageDefinitions().find((definition) => definition.packageKey === "staff");
  assert.ok(staff);
  assert.equal(staff.version, "1.1.0");
  assert.equal(staff.manifest.packageType, "FOUNDATION");
  assert.equal(staff.manifest.billable, false);
  assert.deepEqual(staff.dependencies, []);
  assert.deepEqual(staff.manifest.dependencies, []);

  const employee = staff.manifest.objects.find((object) => object.objectKey === "employee");
  const attendance = staff.manifest.objects.find((object) => object.objectKey === "attendance");
  assert.equal(employee.sourceTable, "users");
  assert.equal(employee.metadataScope, "global");
  assert.ok(employee.fields.some((field) => field.apiName === "full_name" && field.sourceColumn === "full_name" && field.required));
  assert.ok(employee.fields.some((field) => field.apiName === "store_id"));
  assert.equal(employee.fields.some((field) => /password|pin_hash/i.test(field.apiName)), false);
  assert.equal(attendance.sourceTable, "attendance_records");
  assert.equal(attendance.storeScoped, true);
  assert.ok(staff.manifest.relationships.some((relationship) =>
    relationship.parentObjectKey === "employee" && relationship.childObjectKey === "attendance"
      && relationship.childFieldApiName === "user_id"));

  const detail = staff.manifest.layouts.find((layout) => layout.pageType === "detail");
  assert.ok(detail.definition.components.some((component) => component.type === "header"));
  assert.ok(detail.definition.components.some((component) =>
    component.type === "related_list" && component.relationship_key === "attendance_records"));
  assert.ok(staff.manifest.listViews.some((view) => view.objectKey === "employee"
    && view.columns.includes("full_name") && view.columns.includes("active")));
  assert.ok(staff.manifest.rules.some((rule) =>
    rule.action.type === "validation" && rule.conditions[0].field === "full_name"));
  assert.ok(staff.manifest.permissionDeclarations.some((declaration) => declaration.permission === "user.view"));
  assert.ok(staff.manifest.permissionDeclarations.some((declaration) => declaration.permission === "attendance.view"));
  assert.ok(staff.manifest.metadataOwnership.requiredTypes.includes("field"));
  assert.ok(staff.manifest.ownership.metadataTypes.includes("validation"));
  assert.ok(staff.manifest.ownership.excludes.includes("user_records"));
  assert.equal(staff.manifest.upgradeMetadata.preserveExistingUserIds, true);
});

test("Uber Eats is declared as a licensed package with dependencies and safe metadata", () => {
  const definition = packageDefinitions().find((pkg) => pkg.packageKey === "uber_eats");
  assert.ok(definition);
  assert.equal(definition.name, "Uber Eats");
  assert.equal(definition.moduleKey, "uber_eats");
  assert.equal(definition.manifest.entitlementKey, "integrations");
  assert.deepEqual(definition.manifest.dependencies, ["integrations", "online_orders"]);
  assert.equal(definition.manifest.objects[0].metadataScope, "global");
  assert.equal(definition.manifest.objects[0].sourceTable, "integrations");
  assert.deepEqual(definition.manifest.listViews[0].columns, ["name", "provider", "active", "updated_at"]);
  assert.equal(definition.manifest.objects[0].fields.some((field) => field.apiName === "configuration"), false);
  assert.deepEqual(definition.manifest.actions.map((action) => action.handlerKey), [
    "UBER_GET_STORES",
    "UBER_TEST_CONNECTION",
    "UBER_UPLOAD_MENU",
    "UBER_ACCEPT_ORDER",
    "UBER_DENY_ORDER",
    "UBER_UPDATE_ITEM_PRICE",
    "UBER_SET_ITEM_UNAVAILABLE",
    "UBER_SET_ITEM_AVAILABLE",
  ]);
  assert.ok(definition.manifest.actions.slice(0, 3).every((action) => action.requiredPermission === "online_orders.configure"));
  assert.ok(definition.manifest.actions.slice(3, 5).every((action) => action.requiredPermission === "online_orders.manage"));
  assert.ok(definition.manifest.actions.slice(5).every((action) => action.requiredPermission === "online_orders.configure"));
  assert.equal(definition.manifest.buttons.length, 3);
  assert.equal(definition.manifest.workflows[0].triggerKey, "after_save");
  assert.equal(definition.manifest.workflows[0].activeByDefault, false);
  assert.equal(definition.manifest.workflows[0].actions[0].type, "UBER_UPLOAD_MENU");
  assert.deepEqual(definition.manifest.permissionDeclarations.map(({ permission }) => permission), [
    "online_orders.view",
    "online_orders.configure",
    "online_orders.manage",
  ]);
  assert.equal(definition.manifest.mappingSchema.find(({ key }) => key === "product").override, "preserve-explicit-product-item-id");
  assert.ok(definition.manifest.forms[0].fields.find(({ key }) => key === "client_secret").sensitive);
  assert.ok(definition.manifest.pages[0].definition.forms.length);
});

test("Online Orders Core declares provider-neutral, package-owned canonical metadata", () => {
  const definition = packageDefinitions().find((pkg) => pkg.packageKey === "online_orders");
  assert.ok(definition);
  assert.equal(definition.version, "1.0.0");
  assert.equal(definition.manifest.packageType, "FOUNDATION");
  assert.equal(definition.manifest.billable, false);
  assert.equal(definition.manifest.systemOnly, true);
  assert.equal(definition.manifest.visibility, "HIDDEN");
  assert.deepEqual(definition.dependencies, [
    "products",
    "inventory",
    { packageKey: "customers", optional: true },
  ]);
  assert.equal(definition.dependencies.some((dependency) => ["uber_eats", "deliveroo", "just_eat"].includes(dependency)), false);
  assert.deepEqual(
    definition.manifest.objects.map(({ objectKey, sourceTable }) => [objectKey, sourceTable]),
    [["online_order", "online_orders"], ["online_order_line", "online_order_items"]]
  );
  const order = definition.manifest.objects.find(({ objectKey }) => objectKey === "online_order");
  assert.deepEqual(
    order.fields.filter(({ apiName }) => ["platform", "external_order_id", "company_id", "store_id", "customer_id", "fulfilment_type", "status", "subtotal", "tax", "total"].includes(apiName))
      .map(({ apiName }) => apiName)
      .sort(),
    ["company_id", "customer_id", "external_order_id", "fulfilment_type", "platform", "status", "store_id", "subtotal", "tax", "total"].sort()
  );
  assert.deepEqual(
    definition.manifest.relationships.map(({ parentObjectKey, childObjectKey, relationshipKey }) => [parentObjectKey, childObjectKey, relationshipKey]),
    [
      ["online_order", "online_order_line", "order_lines"],
      ["online_order_line", "product", "product"],
      ["customer", "online_order", "online_orders"],
      ["store", "online_order", "online_orders"],
    ]
  );
  assert.equal(definition.manifest.listViews[0].objectKey, "online_order");
  assert.equal(definition.manifest.layouts[0].pageType, "detail");
  assert.deepEqual(definition.manifest.forms.map(({ pageType }) => pageType), ["create", "edit"]);
  assert.equal(definition.manifest.validationRules[0].action.message, "Order line quantity must be greater than zero.");
  assert.equal(definition.manifest.actions.length, 9);
  assert.ok(definition.manifest.actions.every(({ handlerKey }) => handlerKey === "ONLINE_ORDER_TRANSITION"));
  assert.ok(getWorkflowActionDefinition("ONLINE_ORDER_TRANSITION"));
  assert.deepEqual(definition.manifest.metadataOwnership.objects, ["online_order", "online_order_line"]);
  assert.deepEqual(definition.manifest.metadataOwnership.permissions, [
    "online_orders.view", "online_orders.manage", "online_orders.status_update", "online_orders.cancel",
  ]);
  assert.equal(definition.manifest.upgrade.preservesRecordIds, true);
  assert.equal(definition.manifest.events[0].eventType, "online_order.created");
});

test("Online Orders Core schema accepts future normalized channels and upgrades customer links additively", async () => {
  const { readFile } = await import("node:fs/promises");
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /platform ~ '\^\[a-z\]\[a-z0-9_\]\{0,19\}\$'/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers\(id\) ON DELETE SET NULL/);
  assert.match(schema, /UPDATE online_orders AS o[\s\S]*c\.company_id = o\.company_id/);
  assert.doesNotMatch(schema, /DROP TABLE\s+online_orders/i);
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
  assert.equal(result.objects, 1);
  assert.ok(calls.some((sql) => sql.includes("platform_fields")));
});

test("Staff Core provisioning maps existing users and owns its attendance layout and validation metadata", async () => {
  const staff = packageDefinitions().find((definition) => definition.packageKey === "staff");
  const objects = new Map([["employee", {
    id: "employee-object",
    package_id: "staff-package",
    module_id: "staff-module",
    company_id: null,
  }]]);
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
      const object = objects.get(params[0]);
      return { rows: object ? [object] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_objects")) {
      const object = {
        id: `${params[2]}-object`,
        package_id: params[1],
        module_id: params[0],
        company_id: params[6],
      };
      objects.set(params[2], object);
      return { rows: [object] };
    }
    if (sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")) {
      return { rows: [{ id: `field-${params[0]}-${params[1]}`, company_id: null, source_package_id: "staff-package" }] };
    }
    if (sql.startsWith("SELECT id,object_key FROM platform_objects")) {
      return { rows: [{ id: "store-object", object_key: "store" }] };
    }
    if (sql.startsWith("SELECT id FROM platform_fields")) return { rows: [{ id: "staff-link-field" }] };
    if (sql.startsWith("SELECT id,action,source_package_id,user_modified FROM platform_rules")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_layouts")) return { rows: [{ id: "staff-layout" }] };
    if (sql.startsWith("WITH owned AS")) return { rowCount: 12 };
    return { rows: [] };
  };

  const result = await provisionPackageMetadata(db, {
    packageId: "staff-package",
    moduleId: "staff-module",
    companyId: "company-a",
    manifest: staff.manifest,
    packageVersion: staff.version,
  });

  assert.equal(result.objects, 2);
  assert.equal(result.ownedMetadata, 12);
  assert.equal(objects.get("attendance").company_id, null);
  const attendanceObject = calls.find(({ sql, params }) => sql.startsWith("INSERT INTO platform_objects") && params[2] === "attendance");
  assert.equal(attendanceObject.params[8], true);
  const fullName = calls.find(({ sql, params }) => sql.startsWith("UPDATE platform_fields") && params[0] === "Name");
  assert.equal(fullName.params[2], "full_name");
  assert.ok(calls.some(({ sql, params }) => sql.startsWith("INSERT INTO platform_relationships") && params[2] === "attendance_records"));
  assert.ok(calls.some(({ sql, params }) => sql.startsWith("INSERT INTO platform_list_views") && params[2] === "all_staff"));
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_layouts")).length, 2);
  const validation = calls.find(({ sql }) => sql.startsWith("INSERT INTO platform_rules"));
  assert.equal(validation.params[5], true);
  assert.equal(validation.params[6], "company-a");
  assert.equal(validation.params[8], "staff-package");
  const ownership = calls.find(({ sql }) => sql.startsWith("WITH owned AS"));
  assert.match(ownership.sql, /SELECT 'list_view'/);
  assert.match(ownership.sql, /THEN 'validation' ELSE 'workflow'/);
  assert.match(ownership.sql, /o\.package_id=\$1 OR f\.source_package_id=\$1/);
});

test("Uber Eats metadata is idempotent, globally defined, and tenant-scoped", async () => {
    const definition = packageDefinitions().find((pkg) => pkg.packageKey === "uber_eats");
    const objects = new Map();
    const fields = new Map();
    const views = new Set();
    const packageRules = new Map();
    const calls = [];
    const db = async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
        const object = objects.get(params[0]);
        return { rows: object ? [object] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_objects")) {
        const object = { id: `object-${params[2]}`, package_id: params[1], module_id: params[0], company_id: params[6] };
        objects.set(params[2], object);
        return { rows: [object] };
      }
      if (sql.startsWith("SELECT id,object_key FROM platform_objects WHERE object_key=ANY")) {
        const existing = new Map([
          ...objects,
          ["customer", { id: "customer-object" }],
          ["store", { id: "store-object" }],
        ]);
        return { rows: params[0].flatMap((key) => existing.has(key) ? [{ id: existing.get(key).id, object_key: key }] : []) };
      }
      if (sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")) {
        const field = fields.get(`${params[0]}:${params[1]}:${params[2] || "global"}`)
          || fields.get(`${params[0]}:${params[1]}:global`);
        return { rows: field ? [field] : [] };
      }
      if (sql.startsWith("SELECT id FROM platform_fields")) {
        const field = fields.get(`${params[0]}:${params[1]}:${params[2] || "global"}`)
          || fields.get(`${params[0]}:${params[1]}:global`);
        return { rows: field ? [{ id: field.id }] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_fields")) {
        fields.set(`${params[0]}:${params[1]}:${params[11] || "global"}`, {
          id: `${params[1]}-${params[11]}`,
          source_package_id: params[12],
        });
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO platform_apps")) return { rows: [{ id: "uber-app" }] };
      if (sql.startsWith("INSERT INTO platform_list_views")) {
        views.add(`${params[0]}:${params[1]}:${params[2]}`);
        return { rows: [] };
      }
      if (sql.startsWith("SELECT id FROM platform_objects WHERE object_key=$1")) {
        const object = objects.get(params[0]) || (["product", "customer"].includes(params[0]) ? { id: `${params[0]}-object` } : null);
        return { rows: object ? [{ id: object.id }] : [] };
      }
      if (sql.startsWith("SELECT id,code FROM permissions")) {
        return { rows: params[0].map((code) => ({ id: `permission-${code}`, code })) };
      }
      if (sql.startsWith("SELECT id,action,source_package_id,user_modified FROM platform_rules")) {
        const rule = packageRules.get(`${params[1]}:${params[2]}`);
        return { rows: rule ? [rule] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_rules")) {
        packageRules.set(`${params[6]}:${params[1]}`, {
          id: `rule-${params[1]}`,
          source_package_id: params[8],
          user_modified: false,
          action: JSON.parse(params[4]),
        });
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO platform_event_types")) return { rows: [{ event_type: params[0] }] };
      if (sql.startsWith("INSERT INTO platform_registered_actions")) return { rows: [{ id: `action-${params[2]}` }] };
      if (sql.startsWith("INSERT INTO platform_buttons")) return { rows: [{ id: `button-${params[2]}` }] };
      return { rows: [] };
    };

    for (const companyId of ["company-a", "company-b", "company-a"]) {
      await provisionPackageMetadata(db, {
        packageId: "package-uber",
        moduleId: "module-uber",
        companyId,
        manifest: definition.manifest,
      });
    }

    assert.equal(objects.size, 1);
    assert.equal(objects.get("uber_eats_connection").company_id, null);
    assert.equal(fields.size, definition.manifest.objects[0].fields.length * 2);
    assert.equal(views.size, 2);
    assert.equal(packageRules.size, 2);
    assert.deepEqual([...views].map((key) => key.split(":")[1]).sort(), ["company-a", "company-b"]);
    assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_objects")).length, 1,
      JSON.stringify(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_objects")).map(({ params }) => params)));
    assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_fields")).length, definition.manifest.objects[0].fields.length * 2);
    assert.ok(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_fields")).every(({ params }) => ["company-a", "company-b"].includes(params[11])));
  });

test("package catalog and Uber Eats installation preserve existing client configuration", async (t) => {
    const definitions = packageDefinitions();
    const packages = definitions.map((definition) => ({
      id: `package-${definition.packageKey}`,
      package_key: definition.packageKey,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      module_key: definition.moduleKey,
      manifest: definition.manifest,
    }));
    const clientConfiguration = {
      environment: "production",
      client_id: "configured-client",
      client_secret: "encrypted-secret",
      store_location_id: "uber-store",
    };
    const objects = new Map();
    const fields = new Map();
    const packageRules = new Map();
    const registeredActions = new Map();
    const buttons = new Map();
    const pages = new Map();
    const calls = [];
    const db = async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM package_registry p LEFT JOIN")) return { rows: packages };
      if (sql.includes("FROM company_package_installations i")) return { rows: [] };
      if (sql.includes("FROM companies c")) {
        return { rows: [{ active: true, starts_at: null, expires_at: null, entitlements: { integrations: true, online_orders: true } }] };
      }
      if (sql.startsWith("SELECT id FROM platform_modules WHERE module_key=$1")) return { rows: [{ id: `module-${params[0]}` }] };
      if (sql.startsWith("SELECT id,version FROM package_registry WHERE package_key=$1 AND active=true")) {
        const pkg = packages.find((item) => item.package_key === params[0]);
        return { rows: pkg ? [{ id: pkg.id, version: pkg.version }] : [] };
      }
      if (sql.startsWith("SELECT id,version,installable FROM package_registry WHERE package_key=$1 AND active=true")) {
        const pkg = packages.find((item) => item.package_key === params[0]);
        return { rows: pkg ? [{ id: pkg.id, version: pkg.version, installable: pkg.manifest.installable }] : [] };
      }
      if (sql.startsWith("SELECT id FROM package_registry WHERE package_key=$1")) {
        const pkg = packages.find((item) => item.package_key === params[0]);
        return { rows: pkg ? [{ id: pkg.id }] : [] };
      }
      if (sql.startsWith("SELECT id,version,package_type,installable FROM package_registry WHERE package_key=$1")) {
        const pkg = packages.find((item) => item.package_key === params[0]);
        return { rows: pkg ? [{ id: pkg.id, version: pkg.version, package_type: pkg.manifest.packageType, installable: true }] : [] };
      }
      if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
        const object = objects.get(params[0]);
        return { rows: object ? [object] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_objects")) {
        const object = { id: `object-${params[2]}`, package_id: params[1], module_id: params[0], company_id: params[6] };
        objects.set(params[2], object);
        return { rows: [object] };
      }
      if (sql.startsWith("SELECT id,object_key FROM platform_objects WHERE object_key=ANY")) {
        const existing = new Map([
          ...objects,
          ["customer", { id: "customer-object" }],
          ["store", { id: "store-object" }],
        ]);
        return { rows: params[0].flatMap((key) => existing.has(key) ? [{ id: existing.get(key).id, object_key: key }] : []) };
      }
      if (sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")) {
        const field = fields.get(`${params[0]}:${params[1]}:${params[2] || "global"}`)
          || fields.get(`${params[0]}:${params[1]}:global`);
        return { rows: field ? [field] : [] };
      }
      if (sql.startsWith("SELECT id FROM platform_fields")) {
        const field = fields.get(`${params[0]}:${params[1]}:${params[2] || "global"}`)
          || fields.get(`${params[0]}:${params[1]}:global`);
        return { rows: field ? [{ id: field.id }] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_fields")) {
        fields.set(`${params[0]}:${params[1]}:${params[11] || "global"}`, {
          id: `${params[1]}-${params[11]}`,
          source_package_id: params[12],
        });
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO platform_apps")) return { rows: [{ id: "uber-app" }] };
      if (sql.startsWith("INSERT INTO platform_pages")) {
        pages.set(`${params[1]}:${params[2]}`, JSON.parse(params[5]));
        return { rows: [] };
      }
      if (sql.startsWith("SELECT id FROM platform_objects WHERE object_key=$1")) {
        const object = objects.get(params[0]) || (["product", "customer"].includes(params[0]) ? { id: `${params[0]}-object` } : null);
        return { rows: object ? [{ id: object.id }] : [] };
      }
      if (sql.startsWith("SELECT id,code FROM permissions")) {
        return { rows: params[0].map((code) => ({ id: `permission-${code}`, code })) };
      }
      if (sql.startsWith("SELECT id,action,source_package_id,user_modified FROM platform_rules")) {
        const rule = packageRules.get(`${params[1]}:${params[2]}`);
        return { rows: rule ? [rule] : [] };
      }
      if (sql.startsWith("INSERT INTO platform_rules")) {
        packageRules.set(`${params[6]}:${params[1]}`, {
          id: `rule-${params[1]}`,
          source_package_id: params[8],
          user_modified: false,
          action: JSON.parse(params[4]),
        });
        return { rows: [] };
      }
      if (sql.startsWith("INSERT INTO platform_event_types")) return { rows: [{ event_type: params[0] }] };
      if (sql.startsWith("INSERT INTO platform_registered_actions")) {
        registeredActions.set(`${params[0]}:${params[2]}`, {
          companyId: params[0],
          actionKey: params[2],
          handlerKey: params[5],
          requiredPermission: params[6],
          config: JSON.parse(params[7]),
        });
        return { rows: [{ id: `action-${params[2]}` }] };
      }
      if (sql.startsWith("INSERT INTO platform_buttons")) {
        buttons.set(`${params[0]}:${params[2]}`, {
          companyId: params[0],
          buttonKey: params[2],
          actionKey: params[4],
          requiredPermission: params[9],
        });
        return { rows: [{ id: `button-${params[2]}` }] };
      }
      if (sql.startsWith("UPDATE platform_module_access")) return { rows: [] };
      if (sql.startsWith("SELECT id FROM platform_module_access")) return { rows: [] };
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

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const catalogResponse = await fetch(`${baseUrl}/packages`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.ok(catalog.data.some((pkg) => pkg.package_key === "uber_eats"));

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const installResponse = await fetch(`${baseUrl}/packages/uber_eats/install`, { method: "POST" });
      const installed = await installResponse.json();
      assert.equal(installResponse.status, 200, JSON.stringify(installed));
      assert.deepEqual(installed.data.installed, ["integrations", "products", "inventory", "online_orders", "uber_eats"]);
    }

    assert.deepEqual(clientConfiguration, {
      environment: "production",
      client_id: "configured-client",
      client_secret: "encrypted-secret",
      store_location_id: "uber-store",
    });
    const expectedObjects = definitions
      .filter((definition) => ["integrations", "products", "inventory", "online_orders", "uber_eats"].includes(definition.packageKey))
      .reduce((count, definition) => count + (definition.manifest.objects?.length || 0), 0);
    assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_objects")).length, expectedObjects);
    assert.equal(calls.filter(({ sql }) => /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+integrations\b/i.test(sql)).length, 0);
    const installedDefinitions = definitions.filter((definition) =>
      ["integrations", "products", "inventory", "online_orders", "uber_eats"].includes(definition.packageKey)
    );
    const expectedActions = new Map(installedDefinitions.flatMap(({ manifest }) =>
      (manifest.actions || []).map((action) => [
        action.actionKey || action.action_key,
        action.requiredPermission || action.required_permission || null,
      ])
    ));
    const expectedButtons = new Map(installedDefinitions.flatMap(({ manifest }) =>
      (manifest.buttons || []).map((button) => [
        button.buttonKey || button.button_key,
        button.requiredPermission || button.required_permission || null,
      ])
    ));
    const expectedPackageRules = installedDefinitions.flatMap(({ manifest }) => [
      ...(manifest.rules || []),
      ...(manifest.workflows || []),
    ]);
    const expectedPackageRuleNames = new Set(expectedPackageRules.map((rule) => rule.name || rule.label));
    assert.equal(
      calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_registered_actions")).length,
      expectedActions.size * 2
    );
    assert.equal(
      calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_buttons")).length,
      expectedButtons.size * 2
    );
    assert.equal(
      calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_rules")).length,
      expectedPackageRules.length
    );
    assert.equal(calls.filter(({ sql }) => sql.startsWith("UPDATE platform_rules SET")).length, 0);
    const registeredActionCalls = calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_registered_actions"));
    assert.ok(registeredActionCalls.every(({ params }) =>
      params[0] === "company-a"
        && params[6] === expectedActions.get(params[2])
        && JSON.parse(params[7]).packageOwned
    ));
    const registeredButtonCalls = calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_buttons"));
    assert.ok(registeredButtonCalls.every(({ params }) =>
      params[0] === "company-a" && params[9] === expectedButtons.get(params[2])
    ));
    assert.equal(
      registeredActions.size,
      expectedActions.size
    );
    assert.equal(buttons.size, expectedButtons.size);
    assert.equal(packageRules.size, expectedPackageRuleNames.size);
    assert.ok([...packageRules.values()].some(({ action }) => action.packageKey === "uber_eats"));
    assert.equal(pages.get("company-a:uber_eats").form_key, "uber_eats_connection");
    assert.equal(pages.get("company-a:uber_eats").forms.some(({ key }) => key === "client_secret"), true);
});

  test("package registry uninstall preserves required and user-modified metadata", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
      assert.match(source, /removePackageMetadata/);
    assert.match(source, /PACKAGE_ACCESS_REMAINS/);
    assert.match(source, /platform_objects/);
    assert.match(source, /platform_module_access/);
      const registry = await import("node:fs").then((fs) => fs.readFileSync(new URL("../services/packageRegistry.js", import.meta.url), "utf8"));
      assert.match(registry, /package_required=false AND user_modified=false/);
  });

test("fresh company provisioning installs only the declared default packages", async () => {
    const queries = [];
    const db = async (sql, params = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM package_registry")) {
        const key = params[0];
        return { rows: [{ id: `pkg-${key}`, version: "1.0.0", module_id: `module-${key}`, manifest: {} }] };
      }
      return { rows: [] };
    };
    await provisionDefaultCompanyPackages(db, { companyId: "company", installedBy: "user" });
    assert.deepEqual(
      queries.filter(({ sql }) => sql.includes("FROM package_registry")).map(({ params }) => params[0]),
      ["staff", "retail_pos", "products", "customers"]
    );
    assert.equal(queries.filter(({ sql }) => sql.includes("company_package_installations")).length, 4);
    assert.equal(queries.filter(({ sql }) => sql.includes("platform_module_access")).length, 4);
});

test("package installation supports company-validated store scope", async () => {
    const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../routes/packages.js", import.meta.url), "utf8"));
    assert.match(source, /Store is not available to this company/);
    assert.match(source, /store_id IS NOT DISTINCT FROM/);
    assert.match(source, /selected_features=CASE WHEN EXCLUDED\.version = company_package_installations\.version/);
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
