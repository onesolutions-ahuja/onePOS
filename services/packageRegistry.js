import { internalAppCatalog } from "./internalAppCatalog.js";

export const packageRegistrySchema = `
  CREATE TABLE IF NOT EXISTS package_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    description TEXT,
    module_id UUID UNIQUE REFERENCES platform_modules(id) ON DELETE SET NULL,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS package_dependencies (
    package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE CASCADE,
    dependency_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
    version_range VARCHAR(40),
    optional BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (package_id, dependency_id),
    CHECK (package_id <> dependency_id)
  );
  CREATE TABLE IF NOT EXISTS company_package_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
    version VARCHAR(40) NOT NULL,
    selected_features JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, package_id)
  );
  ALTER TABLE company_package_installations
    ADD COLUMN IF NOT EXISTS selected_features JSONB NOT NULL DEFAULT '[]'::jsonb;
  CREATE INDEX IF NOT EXISTS idx_company_package_installations_company
    ON company_package_installations(company_id, status);
  CREATE TABLE IF NOT EXISTS package_installation_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
    version VARCHAR(40) NOT NULL,
    migration_key VARCHAR(200) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (company_id, package_id, version, migration_key)
  );
  CREATE INDEX IF NOT EXISTS idx_package_installation_versions_company
    ON package_installation_versions(company_id, package_id, applied_at DESC);
  CREATE TABLE IF NOT EXISTS package_installation_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(200) NOT NULL,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('install','uninstall','deactivate')),
    package_key VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('completed','failed')),
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, idempotency_key, operation, package_key)
  );
  ALTER TABLE package_installation_operations
    DROP CONSTRAINT IF EXISTS package_installation_operations_company_id_idempotency_key_operation_key;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_package_installation_operations_key
    ON package_installation_operations(company_id, idempotency_key, operation, package_key);
`;

export function packageDefinition(entry) {
  const packageNames = {
    retail_pos: "OneSales",
    products: "OneProduct",
    inventory: "OneInventory",
    suppliers: "OnePurchase",
    customers: "OneCustomer",
    staff: "OneStaff",
    reports: "OneReport",
    platform: "OneBuilder",
    online_orders: "OneOnline",
    integrations: "OneIntegrations",
  };
  const packageDescriptions = {
    retail_pos: "Sales, payments, returns and order processing.",
    products: "The canonical product catalogue and product references.",
    inventory: "Stock, replenishment and inventory movements.",
    suppliers: "Suppliers and purchasing operations.",
    customers: "Customer records and customer activity.",
    staff: "Employees, users, roles and store access.",
    reports: "Operational and custom report administration.",
    platform: "Customer-configurable Platform metadata and builders.",
    online_orders: "Online order intake and preparation.",
    integrations: "External delivery, payment and communication integrations.",
  };
  const dependencies = {
    retail_pos: ["products"],
    inventory: ["products"],
    reports: [],
    platform: [],
  };
  return {
    packageKey: entry.packageKey || entry.key,
    name: packageNames[entry.key] || entry.name,
    version: entry.version || "1.0.0",
    description: packageDescriptions[entry.key] || entry.description,
    dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
    moduleKey: entry.key,
    manifest: {
      route: entry.route,
      permissions: entry.permissions,
      storeScoped: entry.storeScoped === true,
      category: entry.category,
      dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
      optionalFeatures: Array.isArray(entry.optionalFeatures) ? entry.optionalFeatures : [],
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [entry.key],
    },
  };
}

export function packageDefinitions(catalog = internalAppCatalog) {
  return catalog.map(packageDefinition);
}

export function resolvePackagePlan(packageKey, packages) {
  const byKey = new Map(packages.map((pkg) => [pkg.packageKey || pkg.package_key, pkg]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();

  function visit(key) {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Package dependency cycle detected at ${key}`);
    const pkg = byKey.get(key);
    if (!pkg) throw new Error(`Package dependency not found: ${key}`);
    visiting.add(key);
    for (const dependency of pkg.dependencies || []) {
      const dependencyKey = typeof dependency === "string" ? dependency : dependency.packageKey || dependency.package_key;
      if (!dependencyKey) throw new Error(`Invalid dependency declared by ${key}`);
      visit(dependencyKey);
    }

    visiting.delete(key);
    visited.add(key);
    ordered.push(pkg);
  }

  visit(packageKey);
  return ordered;
}

export function resolveFeaturePlan(packageDefinitionEntry, requestedFeatures = []) {
  const features = Array.isArray(packageDefinitionEntry?.manifest?.optionalFeatures)
    ? packageDefinitionEntry.manifest.optionalFeatures
    : [];
  const byKey = new Map(features.map((feature) => [feature.key, feature]));
  const selected = [];
  for (const key of requestedFeatures) {
    const feature = byKey.get(key);
    if (!feature) throw new Error(`Optional feature not found: ${key}`);
    selected.push(feature);
    for (const dependency of feature.dependencies || []) {
      if (!selected.some((item) => item.key === dependency)) {
        const dependencyFeature = byKey.get(dependency);
        if (!dependencyFeature) throw new Error(`Feature dependency not found: ${dependency}`);
        selected.push(dependencyFeature);
      }
    }
  }
  return selected;
}

const safeMetadataKey = (value) => typeof value === "string" && /^[a-z_][a-z0-9_]{0,99}$/.test(value);

export async function provisionPackageMetadata(db, { packageId, moduleId, companyId, manifest = {} }) {
  const objects = Array.isArray(manifest.objects) ? manifest.objects : [];
  const objectIds = new Map();

  for (const definition of objects) {
    const objectKey = definition?.objectKey || definition?.object_key || definition?.key;
    if (!safeMetadataKey(objectKey)) throw new Error(`Invalid package object key: ${objectKey || "(missing)"}`);
    if (typeof definition.label !== "string" || !definition.label.trim()) {
      throw new Error(`Package object label is required: ${objectKey}`);
    }
    const existing = await db(
      "SELECT id,package_id,module_id,company_id FROM platform_objects WHERE object_key=$1",
      [objectKey]
    );
    let object;
    if (existing.rows.length) {
      object = existing.rows[0];
      if (object.package_id && object.package_id !== packageId) {
        throw new Error(`Platform object is owned by another package: ${objectKey}`);
      }
      if (object.company_id && object.company_id !== companyId) {
        throw new Error(`Platform object belongs to another company: ${objectKey}`);
      }
      await db(
        "UPDATE platform_objects SET package_id=$1,module_id=COALESCE(module_id,$2),company_id=COALESCE(company_id,$3),label=$4,plural_label=$5,description=$6,active=true,updated_at=NOW() WHERE id=$7 RETURNING *",
        [packageId, moduleId, companyId || null, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, object.id]
      );
    } else {
      const result = await db(
        `INSERT INTO platform_objects
         (module_id,package_id,object_key,label,plural_label,description,company_id,source_table)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [moduleId, packageId, objectKey, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, companyId || null, definition.sourceTable || definition.source_table || null]
      );
      object = result.rows[0];
    }
    objectIds.set(objectKey, object.id);

    for (const field of Array.isArray(definition.fields) ? definition.fields : []) {
      const apiName = field?.apiName || field?.api_name;
      if (!safeMetadataKey(apiName) || typeof field.label !== "string" || !field.label.trim()) {
        throw new Error(`Invalid package field on ${objectKey}`);
      }
      const existingField = await db(
        "SELECT id,company_id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3)",
        [object.id, apiName, companyId]
      );
      if (existingField.rows.length) {
        if (existingField.rows[0].company_id && existingField.rows[0].company_id !== companyId) {
          throw new Error(`Platform field belongs to another company: ${objectKey}.${apiName}`);
        }
        await db(
          "UPDATE platform_fields SET label=$1,field_type=$2,required=$3,readable=$4,writable=$5,options=$6::jsonb,config=$7::jsonb,active=true WHERE id=$8",
          [field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify(field.config || {}), existingField.rows[0].id]
        );
      } else {
        await db(
          `INSERT INTO platform_fields
           (object_id,api_name,label,field_type,required,readable,writable,options,config,company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
          [object.id, apiName, field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify(field.config || {}), companyId || null]
        );
      }
    }
  }

  for (const relationship of Array.isArray(manifest.relationships) ? manifest.relationships : []) {
    const parentObjectId = objectIds.get(relationship.parentObjectKey || relationship.parent_object_key);
    const childObjectId = objectIds.get(relationship.childObjectKey || relationship.child_object_key);
    if (!parentObjectId || !childObjectId || !safeMetadataKey(relationship.relationshipKey || relationship.relationship_key)) {
      throw new Error("Package relationships must reference declared objects with safe keys");
    }
    await db(
      `INSERT INTO platform_relationships
       (parent_object_id,child_object_id,relationship_key,relationship_type,active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (parent_object_id,relationship_key)
       DO UPDATE SET child_object_id=EXCLUDED.child_object_id,relationship_type=EXCLUDED.relationship_type,active=true`,
      [parentObjectId, childObjectId, relationship.relationshipKey || relationship.relationship_key, relationship.relationshipType || relationship.relationship_type || "lookup"]
    );
  }

  return { objects: objectIds.size };
}

export async function provisionDefaultCompanyPackages(db, { companyId, installedBy = null, packageKeys = ["retail_pos", "products", "customers"] }) {
  for (const packageKey of packageKeys) {
    const packageResult = await db(
      `SELECT p.id, p.version, p.module_id
       FROM package_registry p
       WHERE p.package_key=$1 AND p.active=true`,
      [packageKey]
    );
    if (!packageResult.rows.length) continue;
    const pkg = packageResult.rows[0];
    await db(
      `INSERT INTO company_package_installations
       (company_id,package_id,version,status,installed_by)
       VALUES ($1,$2,$3,'active',$4)
       ON CONFLICT (company_id,package_id) DO NOTHING`,
      [companyId, pkg.id, pkg.version, installedBy]
    );
    if (pkg.module_id) {
      await db(
        `INSERT INTO platform_module_access (module_id,company_id,store_id,enabled)
         VALUES ($1,$2,NULL,true)
         ON CONFLICT (module_id,company_id,COALESCE(store_id,'00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET enabled=true,updated_at=NOW()`,
        [pkg.module_id, companyId]
      );
    }
  }
}

export function seedPackageRegistry(pool) {
  return (async () => {
    const definitions = packageDefinitions();
    try {
      for (const definition of definitions) {
      const moduleResult = await pool.query(
        "SELECT * FROM platform_modules WHERE module_key=$1",
        [definition.moduleKey]
      );
      if (!moduleResult.rows.length) continue;
      await pool.query(
        `INSERT INTO package_registry (package_key,name,version,description,module_id,manifest)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (package_key) DO UPDATE SET
           name=EXCLUDED.name, version=EXCLUDED.version, description=EXCLUDED.description,
           module_id=EXCLUDED.module_id, manifest=EXCLUDED.manifest, active=TRUE, updated_at=NOW()`,
        [definition.packageKey, definition.name, definition.version, definition.description, moduleResult.rows[0].id, JSON.stringify(definition.manifest)]
      );
      }
      for (const definition of definitions) {
      const packageResult = await pool.query("SELECT id FROM package_registry WHERE package_key=$1", [definition.packageKey]);
      if (!packageResult.rows.length) continue;
      await pool.query("DELETE FROM package_dependencies WHERE package_id=$1", [packageResult.rows[0].id]);
      for (const dependency of definition.dependencies) {
        const dependencyKey = typeof dependency === "string" ? dependency : dependency.packageKey || dependency.package_key;
        const dependencyResult = await pool.query("SELECT id FROM package_registry WHERE package_key=$1", [dependencyKey]);
        if (!dependencyResult.rows.length) throw new Error(`Package dependency not found: ${dependencyKey}`);
        await pool.query(
          `INSERT INTO package_dependencies (package_id,dependency_id,version_range,optional)
           VALUES ($1,$2,$3,$4)`,
          [packageResult.rows[0].id, dependencyResult.rows[0].id, typeof dependency === "string" ? null : dependency.versionRange || dependency.version_range || null, typeof dependency === "string" ? false : dependency.optional === true]
        );
      }
      }
    } catch (error) {
      if (error?.code) throw error;
      console.warn("Package registry is unavailable; continuing Platform metadata bootstrap.");
    }
    return definitions;
  })();
}
