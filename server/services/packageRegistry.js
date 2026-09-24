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
    batch_expiry: "OneBatchExpiry",
    hospitality: "OneHospitality",
    kds: "OneKDS",
    customer_credit: "OneCustomerCredit",
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
    batch_expiry: "Batch stock, expiry tracking and FEFO inventory controls.",
    hospitality: "Floor plans, tables and reservations.",
    kds: "Kitchen display tickets and preparation status.",
    customer_credit: "Customer credit accounts, payments and protected credit controls.",
    suppliers: "Suppliers and purchasing operations.",
    customers: "Customer records and customer activity.",
    staff: "Employees, users, roles and store access.",
    reports: "Operational and custom report administration.",
    platform: "Customer-configurable Platform metadata and builders.",
    online_orders: "Online order intake and preparation.",
    integrations: "External delivery, payment and communication integrations.",
  };
  const entitlementKeys = {
    retail_pos: "pos", products: "pos", inventory: "inventory", batch_expiry: "batch_expiry",
    hospitality: "hospitality", kds: "kds", customer_credit: "credit_control", suppliers: "purchasing", customers: "customers", staff: "staff",
    reports: "reports", online_orders: "online_orders", integrations: "integrations", platform: "platform",
  };
  const dependencies = {
    retail_pos: ["products"],
    inventory: ["products"],
    batch_expiry: ["inventory", "products"],
    hospitality: ["retail_pos", "customers"],
    kds: ["hospitality", "retail_pos"],
    customer_credit: ["customers", "retail_pos"],
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
      entitlementKey: entry.entitlementKey || entitlementKeys[entry.key] || entry.key,
      licenceRequired: true,
      permissions: entry.permissions,
      storeScoped: entry.storeScoped === true,
      category: entry.category,
      dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
      optionalFeatures: Array.isArray(entry.optionalFeatures) ? entry.optionalFeatures : [],
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [entry.key],
      ...(entry.key === "batch_expiry" ? {
        objects: [
          {
            objectKey: "inventory_batch", label: "Inventory Batch", pluralLabel: "Inventory Batches",
            description: "Store-level batch and expiry stock.", sourceTable: "inventory_batches",
            fields: [
              { apiName: "store_id", label: "Store", fieldType: "lookup", required: true, writable: false },
              { apiName: "product_id", label: "Product", fieldType: "lookup", required: true, writable: false },
              { apiName: "batch_number", label: "Batch Number", fieldType: "text", required: true, writable: false },
              { apiName: "expiry_date", label: "Expiry Date", fieldType: "date", writable: false },
              { apiName: "quantity", label: "Quantity", fieldType: "number", required: true, writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false }
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "product", childObjectKey: "inventory_batch", relationshipKey: "batches", relationshipType: "one_to_many", childFieldApiName: "product_id" },
          { parentObjectKey: "store", childObjectKey: "inventory_batch", relationshipKey: "inventory_batches", relationshipType: "one_to_many", childFieldApiName: "store_id" },
        ],
        listViews: [
          { objectKey: "inventory_batch", viewKey: "all", label: "All Batches", columns: ["product_id","batch_number","expiry_date","quantity"], isDefault: true },
          { objectKey: "inventory_batch", viewKey: "expiring", label: "Expiring Batches", columns: ["product_id","batch_number","expiry_date","quantity"] }
        ],
      } : {}),
      ...(entry.key === "hospitality" ? {
        objects: [
          { objectKey: "hospitality_floor", label: "Floor", pluralLabel: "Floors", sourceTable: "hospitality_floors", fields: [
            { apiName: "store_id", label: "Store", fieldType: "lookup", required: true, writable: true },
            { apiName: "name", label: "Name", fieldType: "text", required: true, writable: true },
            { apiName: "display_order", label: "Display Order", fieldType: "number", writable: true },
            { apiName: "active", label: "Active", fieldType: "boolean", writable: true }
          ]},
          { objectKey: "hospitality_table", label: "Table", pluralLabel: "Tables", sourceTable: "hospitality_tables", fields: [
            { apiName: "store_id", label: "Store", fieldType: "lookup", required: true, writable: true },
            { apiName: "floor_id", label: "Floor", fieldType: "lookup", required: true, writable: true },
            { apiName: "table_number", label: "Table Number", fieldType: "text", required: true, writable: true },
            { apiName: "capacity", label: "Capacity", fieldType: "number", required: true, writable: true },
            { apiName: "shape", label: "Shape", fieldType: "picklist", writable: true, options: ["square","round","rectangle"] },
            { apiName: "position_x", label: "X", fieldType: "number", writable: true },
            { apiName: "position_y", label: "Y", fieldType: "number", writable: true },
            { apiName: "active", label: "Active", fieldType: "boolean", writable: true }
          ]},
          { objectKey: "hospitality_reservation", label: "Reservation", pluralLabel: "Reservations", sourceTable: "hospitality_reservations", fields: [
            { apiName: "store_id", label: "Store", fieldType: "lookup", required: true, writable: true },
            { apiName: "table_id", label: "Table", fieldType: "lookup", writable: true },
            { apiName: "customer_id", label: "Customer", fieldType: "lookup", writable: true },
            { apiName: "customer_name", label: "Customer Name", fieldType: "text", required: true, writable: true },
            { apiName: "reservation_date", label: "Date", fieldType: "date", required: true, writable: true },
            { apiName: "reservation_time", label: "Time", fieldType: "text", required: true, writable: true },
            { apiName: "guests", label: "Guests", fieldType: "number", required: true, writable: true },
            { apiName: "status", label: "Status", fieldType: "picklist", writable: true, options: ["RESERVED","SEATED","CANCELLED","COMPLETED"] }
          ]}
        ],
        relationships: [
          { parentObjectKey: "hospitality_floor", childObjectKey: "hospitality_table", relationshipKey: "tables", relationshipType: "one_to_many", childFieldApiName: "floor_id" },
          { parentObjectKey: "hospitality_table", childObjectKey: "hospitality_reservation", relationshipKey: "reservations", relationshipType: "one_to_many", childFieldApiName: "table_id" },
          { parentObjectKey: "customer", childObjectKey: "hospitality_reservation", relationshipKey: "reservations", relationshipType: "one_to_many", childFieldApiName: "customer_id" }
        ],
        listViews: [
          { objectKey: "hospitality_table", viewKey: "all", label: "All Tables", columns: ["table_number","capacity","shape","active"], isDefault: true },
          { objectKey: "hospitality_reservation", viewKey: "upcoming", label: "Upcoming Reservations", columns: ["reservation_date","reservation_time","customer_name","guests","status"], isDefault: true }
        ],
        pages: [
          { pageKey: "hospitality", label: "Hospitality", routePath: "/app/custom/hospitality", runtimeComponent: "hospitality_operations" }
        ]
      } : {}),
      ...(entry.key === "kds" ? {
        objects: [
          { objectKey: "kds_ticket", label: "Kitchen Ticket", pluralLabel: "Kitchen Tickets", sourceTable: "hospitality_kds_tickets", fields: [
            { apiName: "store_id", label: "Store", fieldType: "lookup", required: true, writable: false },
            { apiName: "sale_id", label: "Sale", fieldType: "lookup", writable: false },
            { apiName: "table_id", label: "Table", fieldType: "lookup", writable: false },
            { apiName: "status", label: "Status", fieldType: "picklist", required: true, writable: true, options: ["NEW","IN_PREPARATION","READY","COMPLETED"] },
            { apiName: "items", label: "Items", fieldType: "text", writable: false },
            { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false }
          ]}
        ],
        relationships: [
          { parentObjectKey: "sale", childObjectKey: "kds_ticket", relationshipKey: "kitchen_tickets", relationshipType: "one_to_many", childFieldApiName: "sale_id" },
          { parentObjectKey: "hospitality_table", childObjectKey: "kds_ticket", relationshipKey: "kitchen_tickets", relationshipType: "one_to_many", childFieldApiName: "table_id" }
        ],
        listViews: [
          { objectKey: "kds_ticket", viewKey: "active", label: "Active Kitchen Tickets", columns: ["sale_id","table_id","status","created_at"], isDefault: true }
        ],
        pages: [
          { pageKey: "kds", label: "Kitchen Display", routePath: "/app/custom/kds", runtimeComponent: "kitchen_display" }
        ]
      } : {}),
      ...(entry.key === "customer_credit" ? {
        objects: [
          {
            objectKey: "customer_credit_account",
            label: "Customer Credit Account",
            pluralLabel: "Customer Credit Accounts",
            description: "Customer credit configuration and derived account exposure.",
            sourceTable: "customers",
            fields: [
              { apiName: "credit_enabled", label: "Credit Enabled", fieldType: "boolean", writable: false },
              { apiName: "credit_limit", label: "Credit Limit", fieldType: "currency", writable: false },
            ],
          },
          {
            objectKey: "customer_credit_ledger",
            label: "Customer Credit Ledger Entry",
            pluralLabel: "Customer Credit Ledger Entries",
            description: "Immutable customer credit transactions.",
            sourceTable: "customer_credit_ledger",
            fields: [
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", writable: false },
              { apiName: "store_id", label: "Store", fieldType: "lookup", writable: false },
              { apiName: "transaction_type", label: "Transaction Type", fieldType: "text", writable: false },
              { apiName: "amount", label: "Amount", fieldType: "currency", writable: false },
              { apiName: "balance_after", label: "Balance After", fieldType: "currency", writable: false },
              { apiName: "reference_type", label: "Reference Type", fieldType: "text", writable: false },
              { apiName: "reference_id", label: "Reference", fieldType: "lookup", writable: false },
              { apiName: "description", label: "Description", fieldType: "text", writable: false },
              { apiName: "payment_method", label: "Payment Method", fieldType: "text", writable: false },
              { apiName: "created_by", label: "Operator", fieldType: "lookup", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "customer", childObjectKey: "customer_credit_account", relationshipKey: "credit_account", relationshipType: "lookup" },
          { parentObjectKey: "customer_credit_account", childObjectKey: "customer_credit_ledger", relationshipKey: "ledger_entries", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
        ],
        listViews: [
          { objectKey: "customer_credit_account", viewKey: "all", label: "All Credit Accounts", columns: ["credit_enabled", "credit_limit"], isDefault: true },
          { objectKey: "customer_credit_account", viewKey: "active", label: "Active", filters: { credit_enabled: true } },
          { objectKey: "customer_credit_account", viewKey: "disabled", label: "Credit Disabled", filters: { credit_enabled: false } },
          { objectKey: "customer_credit_ledger", viewKey: "all", label: "Credit Ledger Activity", columns: ["customer_id", "transaction_type", "amount", "created_at"], isDefault: true },
        ],
        rules: [
          {
            objectKey: "customer_credit_account",
            name: "Credit limit cannot be negative",
            triggerKey: "before_save",
            conditions: [{ field: "credit_limit", operator: "less_than", value: 0 }],
            action: { type: "validation", message: "Credit limit cannot be negative" },
          },
          {
            objectKey: "customer_credit_account",
            name: "Credit enabled requires a limit",
            triggerKey: "before_save",
            conditions: [{ field: "credit_enabled", operator: "equals", value: true }, { field: "credit_limit", operator: "is_empty" }],
            action: { type: "validation", message: "A credit limit is required when credit is enabled" },
          },
          {
            objectKey: "customer_credit_ledger",
            name: "Credit payment received notification",
            triggerKey: "after_save",
            conditions: [{ field: "transaction_type", operator: "equals", value: "payment" }],
            action: { type: "send_in_app_notification", title: "Credit payment received" },
          },
        ],
      } : {}),
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
          [field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true }), existingField.rows[0].id]
        );
      } else {
        await db(
          `INSERT INTO platform_fields
           (object_id,api_name,label,field_type,required,readable,writable,options,config,company_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
          [object.id, apiName, field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true }), companyId || null]
        );
      }
    }
  }

  for (const relationship of Array.isArray(manifest.relationships) ? manifest.relationships : []) {
    const parentKey = relationship.parentObjectKey || relationship.parent_object_key;
    const childKey = relationship.childObjectKey || relationship.child_object_key;
    let parentObjectId = objectIds.get(parentKey);
    let childObjectId = objectIds.get(childKey);
    if (!parentObjectId || !childObjectId) {
      const external = await db(
        "SELECT id,object_key FROM platform_objects WHERE object_key=ANY($1::text[]) AND (company_id IS NULL OR company_id=$2)",
        [[parentKey, childKey], companyId]
      );
      const byKey = new Map(external.rows.map((row) => [row.object_key, row.id]));
      parentObjectId ||= byKey.get(parentKey);
      childObjectId ||= byKey.get(childKey);
    }
    if (!parentObjectId || !childObjectId || !safeMetadataKey(relationship.relationshipKey || relationship.relationship_key)) {
      throw new Error("Package relationships must reference declared objects with safe keys");
    }
    let childFieldId = null;
    const childFieldKey = relationship.childFieldApiName || relationship.child_field_api_name;
    if (childFieldKey) {
      const fieldResult = await db(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3) LIMIT 1",
        [childObjectId, childFieldKey, companyId]
      );
      childFieldId = fieldResult.rows[0]?.id || null;
      if (!childFieldId) throw new Error(`Package relationship field not found: ${childFieldKey}`);
    }
    await db(
      `INSERT INTO platform_relationships
       (parent_object_id,child_object_id,relationship_key,relationship_type,child_field_id,active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (parent_object_id,relationship_key)
       DO UPDATE SET child_object_id=EXCLUDED.child_object_id,relationship_type=EXCLUDED.relationship_type,child_field_id=EXCLUDED.child_field_id,active=true`,
      [parentObjectId, childObjectId, relationship.relationshipKey || relationship.relationship_key, relationship.relationshipType || relationship.relationship_type || "lookup", childFieldId]
    );
  }

  for (const view of Array.isArray(manifest.listViews) ? manifest.listViews : []) {
    const objectId = objectIds.get(view.objectKey || view.object_key);
    if (!objectId || !safeMetadataKey(view.viewKey || view.view_key)) {
      throw new Error("Package list views must reference declared objects with safe keys");
    }
    await db(
      `INSERT INTO platform_list_views
       (object_id,company_id,view_key,label,description,columns,filters,sort,page_size,is_default)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
       ON CONFLICT (object_id,company_id,view_key)
       DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,
         columns=EXCLUDED.columns,filters=EXCLUDED.filters,sort=EXCLUDED.sort,
         page_size=EXCLUDED.page_size,is_default=EXCLUDED.is_default,active=true,updated_at=NOW()`,
      [
        objectId,
        companyId || null,
        view.viewKey || view.view_key,
        view.label,
        view.description || null,
        JSON.stringify(view.columns || []),
        JSON.stringify(view.filters || {}),
        JSON.stringify(view.sort || { field: null, direction: "asc" }),
        Number.isFinite(Number(view.pageSize)) ? Number(view.pageSize) : 50,
        view.isDefault === true,
      ]
    );
  }

  for (const page of Array.isArray(manifest.pages) ? manifest.pages : []) {
    const pageKey = page.pageKey || page.page_key;
    if (!safeMetadataKey(pageKey) || typeof page.label !== "string" || !page.label.trim()) {
      throw new Error("Package pages require a safe page key and label");
    }
    const appKey = `package_${String(packageId).replace(/-/g, "_")}`.slice(0, 100);
    const appResult = await db(
      `INSERT INTO platform_apps (company_id,app_key,label,description,active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (company_id,app_key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description,active=true,updated_at=NOW()
       RETURNING id`,
      [companyId || null, appKey, page.appLabel || page.label, page.description || null]
    );
    await db(
      `INSERT INTO platform_pages (app_id,company_id,page_key,label,route_path,page_type,definition,active)
       VALUES ($1,$2,$3,$4,$5,'page',$6::jsonb,true)
       ON CONFLICT (app_id,company_id,page_key) DO UPDATE SET label=EXCLUDED.label,route_path=EXCLUDED.route_path,definition=EXCLUDED.definition,active=true,updated_at=NOW()`,
      [appResult.rows[0].id, companyId || null, pageKey, page.label.trim(), page.routePath || `/app/custom/${pageKey}`, JSON.stringify({ presentation_mode: "landing", runtime_component: page.runtimeComponent || page.runtime_component || null, components: [] })]
    );
  }

  for (const rule of Array.isArray(manifest.rules) ? manifest.rules : []) {
    const objectId = objectIds.get(rule.objectKey || rule.object_key);
    if (!objectId || typeof rule.name !== "string" || !safeMetadataKey(rule.triggerKey || rule.trigger_key)) {
      throw new Error("Package rules must reference declared objects with safe trigger keys");
    }
    const existingRule = await db(
      "SELECT id FROM platform_rules WHERE object_id=$1 AND company_id IS NOT DISTINCT FROM $2 AND name=$3 LIMIT 1",
      [objectId, companyId || null, rule.name.trim()]
    );
    if (existingRule.rows.length) continue;
    await db(
      `INSERT INTO platform_rules
       (object_id,name,trigger_key,conditions,action,active,company_id)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,false,$6)`,
      [
        objectId,
        rule.name.trim(),
        rule.triggerKey || rule.trigger_key,
        JSON.stringify(rule.conditions || []),
        JSON.stringify(rule.action || {}),
        companyId || null,
      ]
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
