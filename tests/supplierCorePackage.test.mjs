import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import { packageDefinitions, provisionPackageMetadata, resolvePackagePlan } from "../services/packageRegistry.js";
import createPackagesRouter from "../routes/packages.js";
import createSuppliersRouter from "../routes/suppliers.js";

const definitions = packageDefinitions();
const supplierCore = definitions.find(({ packageKey }) => packageKey === "supplier_core");
const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Supplier Core is hidden, non-billable foundation metadata dependent on Product Core", () => {
  assert.ok(supplierCore);
  assert.equal(supplierCore.version, "1.0.0");
  assert.equal(supplierCore.manifest.packageType, "FOUNDATION");
  assert.equal(supplierCore.manifest.visibility, "HIDDEN");
  assert.equal(supplierCore.manifest.systemOnly, true);
  assert.equal(supplierCore.manifest.billable, false);
  assert.equal(supplierCore.manifest.installable, true);
  assert.deepEqual(supplierCore.dependencies, ["products"]);
  assert.deepEqual(definitions.find(({ packageKey }) => packageKey === "suppliers").dependencies, ["supplier_core"]);
  assert.deepEqual(resolvePackagePlan("suppliers", definitions).map(({ packageKey }) => packageKey), ["products", "supplier_core", "suppliers"]);
  assert.equal(supplierCore.manifest.permissions.includes("inventory.view"), true);
  assert.equal(supplierCore.manifest.permissions.includes("inventory.adjust"), true);
  assert.equal(supplierCore.manifest.permissions.includes("purchase.view"), true);
});

test("Supplier and Supplier Product metadata map only existing canonical fields and relationships", () => {
  const objects = new Map(supplierCore.manifest.objects.map((object) => [object.objectKey, object]));
  assert.deepEqual([...objects.keys()], ["supplier", "supplier_product"]);
  assert.equal(objects.get("supplier").sourceTable, "suppliers");
  assert.equal(objects.get("supplier_product").sourceTable, "supplier_products");
  assert.equal(objects.has("product"), false);
  assert.deepEqual(
    objects.get("supplier").fields.map(({ apiName }) => apiName),
    ["company_id", "name", "contact_name", "phone", "email", "address", "notes", "active", "created_at", "updated_at"]
  );
  assert.deepEqual(
    objects.get("supplier_product").fields.map(({ apiName }) => apiName),
    ["company_id", "supplier_id", "product_id", "supplier_sku", "supplier_description", "cost_price", "effective_from", "effective_to", "preferred", "active", "created_at", "updated_at"]
  );
  assert.deepEqual(
    supplierCore.manifest.relationships.map(({ parentObjectKey, childObjectKey, relationshipKey }) =>
      [parentObjectKey, childObjectKey, relationshipKey]),
    [
      ["supplier", "supplier_product", "products"],
      ["product", "supplier_product", "supplier_products"],
      ["supplier_product", "supplier", "supplier"],
      ["supplier_product", "product", "product"],
    ]
  );
  assert.equal(supplierCore.manifest.listViews.length, 2);
  assert.equal(supplierCore.manifest.lifecycle.preservesExistingRecords, true);
  assert.equal(supplierCore.manifest.lifecycle.preservesCustomFields, true);

  const schema = source("../database/schema.sql");
  const supplierModel = schema.match(/CREATE TABLE IF NOT EXISTS suppliers \([\s\S]*?\n\);/)[0];
  const supplierProducts = schema.match(/CREATE TABLE IF NOT EXISTS supplier_products \([\s\S]*?\n\);/)[0];
  for (const field of objects.get("supplier").fields) assert.match(schema, new RegExp(`\\b${field.apiName}\\b`));
  assert.match(supplierModel, /company_id/);
  for (const field of objects.get("supplier_product").fields) assert.match(supplierProducts, new RegExp(`\\b${field.apiName}\\b`));
  assert.match(supplierProducts, /UNIQUE \(company_id, supplier_id, product_id, effective_from\)/);
  assert.doesNotMatch(supplierProducts, /UNIQUE\s*\(company_id,\s*product_id\)/);
  assert.match(schema, /ON supplier_products\(company_id, product_id\)\s+WHERE preferred = TRUE AND active = TRUE/);
});

test("install and reinstall reuse the Supplier object and preserve tenant custom metadata and sourcing links", async () => {
  const objects = new Map([
    ["supplier", { id: "supplier-object", package_id: "supplier-core-package", module_id: "supplier-core-module", company_id: null }],
    ["product", { id: "product-object", package_id: "product-package", module_id: "product-module", company_id: null }],
  ]);
  const fields = new Map();
  const relationships = new Map();
  const views = new Map();
  const calls = [];
  const businessData = {
    suppliers: [{ id: "existing-supplier" }],
    supplierProducts: [{ id: "existing-supplier-product", supplier_id: "existing-supplier", product_id: "existing-product" }],
  };
  for (const field of supplierCore.manifest.objects[0].fields) {
    fields.set(`supplier-object:${field.apiName}:global`, {
      id: `supplier-${field.apiName}`,
      company_id: null,
      source_package_id: "supplier-core-package",
      custom: field.apiName === "name" ? "preserve" : undefined,
    });
  }
  fields.set("supplier-object:custom_notes:global", { id: "custom-field", company_id: null, custom: true });

  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
      const object = objects.get(params[0]);
      return { rows: object ? [object] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_objects")) {
      const [moduleId, packageId, key, , , , companyId, sourceTable] = params;
      const object = { id: `${key}-object`, package_id: packageId, module_id: moduleId, company_id: companyId, source_table: sourceTable };
      objects.set(key, object);
      return { rows: [object] };
    }
    if (sql.startsWith("UPDATE platform_objects")) return { rows: [] };
    if (sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")) {
      const globalField = fields.get(`${params[0]}:${params[1]}:global`);
      const tenantField = fields.get(`${params[0]}:${params[1]}:${params[2]}`);
      const field = tenantField || globalField;
      return { rows: field ? [{ id: field.id, company_id: field.company_id, source_package_id: field.source_package_id }] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_fields")) {
      const apiName = params[1];
      const companyId = params[11];
      const id = `field-${params[0]}-${apiName}-${companyId || "global"}`;
      fields.set(`${params[0]}:${apiName}:${companyId || "global"}`, {
        id,
        company_id: companyId || null,
        source_package_id: params[12],
        source_column: params[4],
      });
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE platform_fields")) return { rows: [] };
    if (sql.startsWith("UPDATE package_metadata_ownership")) return { rows: [] };
    if (sql.startsWith("UPDATE platform_relationships metadata")) return { rows: [] };
    if (sql.startsWith("UPDATE platform_")) return { rows: [] };
    if (sql.startsWith("SELECT id,object_key FROM platform_objects WHERE object_key=ANY")) {
      return { rows: params[0].flatMap((key) => {
        const object = objects.get(key);
        return object ? [{ id: object.id, object_key: key }] : [];
      }) };
    }
    if (sql.startsWith("SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2")) {
      const field = fields.get(`${params[0]}:${params[1]}:global`)
        || fields.get(`${params[0]}:${params[1]}:${params[2]}`);
      return { rows: field ? [{ id: field.id }] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_relationships")) {
      relationships.set(`${params[0]}:${params[2]}`, { parent: params[0], child: params[1], key: params[2] });
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO platform_registered_actions")) return { rows: [{ id: `action-${params[2]}` }] };
    if (sql.startsWith("INSERT INTO platform_buttons")) return { rows: [{ id: `button-${params[2]}` }] };
    if (sql.startsWith("INSERT INTO platform_list_views")) {
      views.set(`${params[0]}:${params[1]}:${params[2]}`, params[2]);
      return { rows: [] };
    }
    if (sql.startsWith("WITH owned AS")) return { rows: [], rowCount: objects.size + fields.size + relationships.size };
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  for (const companyId of ["company-a", "company-a", "company-b"]) {
    await provisionPackageMetadata(db, {
      packageId: "supplier-core-package",
      moduleId: "supplier-core-module",
      companyId,
      manifest: supplierCore.manifest,
    });
  }

  assert.equal(objects.get("supplier").id, "supplier-object");
  assert.equal(objects.get("supplier_product").source_table, "supplier_products");
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_objects")).length, 1);
  assert.equal(relationships.size, 4);
  assert.equal(views.size, 4);
  assert.equal(fields.get("supplier-object:custom_notes:global").custom, true);
  assert.deepEqual(businessData.suppliers, [{ id: "existing-supplier" }]);
  assert.deepEqual(businessData.supplierProducts, [{ id: "existing-supplier-product", supplier_id: "existing-supplier", product_id: "existing-product" }]);
  const requiredSupplierField = calls.find(({ sql, params }) =>
    sql.startsWith("UPDATE platform_fields") && params[0] === "Name"
  );
  assert.equal(requiredSupplierField.params[13], true);
  assert.match(requiredSupplierField.sql, /package_required=\$14/);
  assert.ok(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_fields")).every(({ params, sql }) =>
    sql.includes("source_column") && params[4] === params[1]
  ));
  assert.ok(calls.filter(({ sql }) => sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")).some(({ params }) => params[2] === "company-b"));
  assert.equal(calls.some(({ sql }) => /\bDELETE\s+FROM\s+(suppliers|supplier_products)\b/i.test(sql)), false);
});

test("installing Purchasing succeeds through the Supplier Core and Product Core dependency plan", async (t) => {
  const packages = definitions.map((definition) => ({
    id: `package-${definition.packageKey}`,
    package_key: definition.packageKey,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    module_key: definition.moduleKey,
    manifest: definition.manifest,
    package_type: definition.manifest.packageType,
    installable: definition.manifest.installable,
  }));
  const objects = new Map([
    ["supplier", { id: "supplier-object", package_id: "package-supplier_core", module_id: "module-supplier_core", company_id: null }],
    ["supplier_product", { id: "supplier-product-object", package_id: "package-supplier_core", module_id: "module-supplier_core", company_id: null }],
    ["product", { id: "product-object", package_id: "package-products", module_id: "module-products", company_id: null }],
  ]);
  const fieldKeys = new Map();
  for (const object of supplierCore.manifest.objects) {
    const objectId = objects.get(object.objectKey).id;
    for (const field of object.fields) {
      const key = `${objectId}:${field.apiName}:global`;
      fieldKeys.set(key, {
        id: key,
        company_id: null,
        source_package_id: "package-supplier_core",
      });
    }
  }
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM package_registry p LEFT JOIN")) return { rows: packages };
    if (sql.startsWith("SELECT l.active")) return { rows: [{ active: true, starts_at: null, expires_at: null, entitlements: { pos: true, purchasing: true } }] };
    if (sql.includes("FROM company_bundle_assignments") || sql.startsWith("SELECT p.manifest->>")) return { rows: [] };
    if (sql.startsWith("SELECT id FROM package_registry WHERE package_key=$1 AND active=true")) {
      const item = packages.find((entry) => entry.package_key === params[0]);
      return { rows: item ? [{ id: item.id }] : [] };
    }
    if (sql.startsWith("SELECT id,version FROM package_registry WHERE package_key=$1 AND active=true")) {
      const item = packages.find((entry) => entry.package_key === params[0]);
      return { rows: item ? [{ id: item.id, version: item.version }] : [] };
    }
    if (sql.startsWith("SELECT id FROM platform_modules WHERE module_key=$1")) return { rows: [{ id: `module-${params[0]}` }] };
    if (sql.startsWith("SELECT id,version,installable FROM package_registry")) {
      const item = packages.find((entry) => entry.package_key === params[0]);
      return { rows: item ? [{ id: item.id, version: item.version, installable: item.installable }] : [] };
    }
    if (sql.startsWith("SELECT id,package_id,module_id,company_id FROM platform_objects")) {
      const object = objects.get(params[0]);
      return { rows: object ? [object] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_objects")) {
      const object = {
        id: `object-${params[2]}`,
        package_id: params[1],
        module_id: params[0],
        company_id: params[6],
      };
      objects.set(params[2], object);
      return { rows: [object] };
    }
    if (sql.startsWith("SELECT id,company_id,source_package_id FROM platform_fields")) {
      const key = `${params[0]}:${params[1]}:global`;
      const field = fieldKeys.get(key);
      return { rows: field ? [field] : [] };
    }
    if (sql.startsWith("UPDATE platform_objects") || sql.startsWith("UPDATE platform_fields")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_fields")) {
      const id = `field-${params[0]}-${params[1]}`;
      fieldKeys.set(`${params[0]}:${params[1]}:global`, {
        id,
        company_id: params[11] || null,
        source_package_id: params[12],
      });
      return { rows: [] };
    }
    if (sql.startsWith("SELECT 1 FROM package_metadata_ownership")) return { rows: [{ "?column?": 1 }] };
    if (sql.startsWith("SELECT id,object_key FROM platform_objects WHERE object_key=ANY")) {
      return { rows: params[0].flatMap((key) => {
        const object = objects.get(key);
        return object ? [{ id: object.id, object_key: key }] : [];
      }) };
    }
    if (sql.startsWith("SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2")) {
      const field = fieldKeys.get(`${params[0]}:${params[1]}:global`);
      return { rows: field ? [{ id: field.id }] : [] };
    }
    if (sql.startsWith("INSERT INTO platform_relationships")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_registered_actions")) return { rows: [{ id: `action-${params[2]}` }] };
    if (sql.startsWith("INSERT INTO platform_buttons")) return { rows: [{ id: `button-${params[2]}` }] };
    if (sql.startsWith("INSERT INTO platform_list_views")) return { rows: [] };
    if (sql.startsWith("WITH owned AS")) return { rows: [], rowCount: 2 };
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

  const response = await fetch(`http://127.0.0.1:${server.address().port}/packages/suppliers/install`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.installed, ["products", "supplier_core", "suppliers"]);
  assert.equal(objects.get("supplier").id, "supplier-object");
  assert.equal(objects.get("supplier_product").id, "supplier-product-object");
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO company_package_installations")).length, 3);
  assert.equal(calls.filter(({ sql }) => sql.startsWith("INSERT INTO platform_relationships")).length, 6);
});

test("Supplier workflows retain tenant guards, preferred selection, effective dates, and Purchasing/Returns references", () => {
  const supplierRoutes = source("../routes/suppliers.js");
  const replenishment = source("../routes/replenishment.js");
  const purchases = source("../routes/purchases.js");
  const receiving = source("../services/purchaseReceiving.js");
  const returns = source("../routes/returns.js");
  const packageRoutes = source("../routes/packages.js");
  assert.match(supplierRoutes, /router\.get\([\s\S]*?"\/suppliers"/);
  assert.match(supplierRoutes, /router\.post\([\s\S]*?"\/suppliers"/);
  assert.match(supplierRoutes, /router\.put\([\s\S]*?"\/suppliers\/:id"/);
  assert.match(supplierRoutes, /WHERE s\.company_id = \$1/);
  assert.match(supplierRoutes, /demoted_preferred/);
  assert.match(supplierRoutes, /sp\.effective_from IS DISTINCT FROM COALESCE/);
  assert.match(replenishment, /sp\.effective_from <= CURRENT_DATE/);
  assert.match(replenishment, /sp\.effective_to IS NULL OR sp\.effective_to >= CURRENT_DATE/);
  assert.match(replenishment, /ORDER BY sp\.preferred DESC, sp\.effective_from DESC, sp\.cost_price ASC/);
  assert.match(purchases, /supplier_id/);
  assert.match(purchases, /\/purchases\/:id\/receive/);
  assert.match(receiving, /purchase_receipt_items/);
  assert.match(returns, /supplier_id/);
  assert.match(returns, /SUPPLIER_RETURN/);
  assert.doesNotMatch(packageRoutes, /DELETE\s+FROM\s+(suppliers|supplier_products)/i);
});

test("existing Supplier CRUD and supplier-product routes retain their RBAC and company-scoped API contracts", async (t) => {
  const calls = [];
  const permissions = [];
  const supplier = {
    id: "supplier-a",
    name: "North Foods",
    contact_name: "Sam",
    active: true,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
  const supplierProduct = { id: "supplier-product-a", supplier_id: "supplier-a", product_id: "product-a", cost_price: "2.50", preferred: true };
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM suppliers s")) return { rows: [{ ...supplier, purchase_count: 0, total_purchase_value: 0 }] };
    if (sql.includes("FROM purchases p")) return { rows: [] };
    if (sql.includes("FROM supplier_products sp INNER JOIN products p")) return { rows: [] };
    if (sql.startsWith("SELECT sp.id, sp.supplier_id")) return { rows: [supplierProduct] };
    if (sql.includes("INSERT INTO suppliers")) return { rows: [supplier] };
    if (sql.includes("UPDATE suppliers")) return { rows: [supplier] };
    if (sql.startsWith("WITH target_product AS")) return { rows: [supplierProduct] };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const app = express();
  app.use(express.json());
  app.use(createSuppliersRouter({
    db,
    authenticate: (req, res, next) => {
      req.user = { id: "user-a", companyId: "company-a" };
      next();
    },
    authorize: (...required) => {
      permissions.push(required);
      return (req, res, next) => next();
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${baseUrl}/suppliers`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/suppliers/supplier-a`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/suppliers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "North Foods", contactName: "Sam" }),
  })).status, 201);
  assert.equal((await fetch(`${baseUrl}/suppliers/supplier-a`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "North Foods Updated" }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/suppliers/supplier-a/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ active: false }),
  })).status, 200);
  assert.equal((await fetch(`${baseUrl}/suppliers/supplier-a/products`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ productId: "product-a", costPrice: 2.5, preferred: true }),
  })).status, 201);
  assert.equal((await fetch(`${baseUrl}/products/product-a/suppliers`)).status, 200);

  assert.deepEqual(permissions, [
    ["inventory.view"],
    ["inventory.view"],
    ["inventory.adjust"],
    ["inventory.view"],
    ["inventory.adjust"],
    ["inventory.adjust"],
    ["inventory.adjust"],
  ]);
  assert.ok(calls.every(({ params }) => params.includes("company-a")));
  assert.ok(calls.some(({ sql, params }) => sql.startsWith("WITH target_product AS") && params[0] === "company-a"));
});
