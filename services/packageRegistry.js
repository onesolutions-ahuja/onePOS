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
    package_type VARCHAR(30) NOT NULL DEFAULT 'APPLICATION',
    publisher VARCHAR(200) NOT NULL DEFAULT 'OneSolutions',
    category VARCHAR(100),
    required_platform_version VARCHAR(40),
    publication_state VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
    visible BOOLEAN NOT NULL DEFAULT TRUE,
    installable BOOLEAN NOT NULL DEFAULT TRUE,
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    system_only BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    available_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    licence_mode VARCHAR(30) NOT NULL DEFAULT 'COMMERCIAL',
    allowed_bundles TEXT[] NOT NULL DEFAULT '{}',
    allowed_companies UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS package_dependencies (
    package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE CASCADE,
    dependency_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
    version_range VARCHAR(40),
    min_version VARCHAR(40),
    max_version VARCHAR(40),
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
    installation_type VARCHAR(30) NOT NULL DEFAULT 'DIRECT',
    available_version VARCHAR(40),
    last_upgrade_at TIMESTAMPTZ,
    last_upgrade_state VARCHAR(20) NOT NULL DEFAULT 'READY',
    suspended_by_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
    deactivated_by_user BOOLEAN NOT NULL DEFAULT FALSE,
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
    products: "Product Core",
    inventory: "OneInventory",
    batch_expiry: "OneBatchExpiry",
    hospitality: "OneHospitality",
    kds: "OneKDS",
    customer_credit: "OneCustomerCredit",
    suppliers: "OnePurchase",
    customers: "OneCustomer",
    staff: "Staff Core",
    reports: "OneReport",
    platform: "OneBuilder",
    online_orders: "OneOnline",
    integrations: "OneIntegrations",
    uber_eats: "Uber Eats",
    supplier_core: "Supplier Core",
    loyalty: "Loyalty Core",
    finance_core: "Finance Core",
  };
  const packageDescriptions = {
    retail_pos: "Sales, payments, returns and order processing.",
    products: "Technical foundation for the canonical Product and Category objects.",
    inventory: "Stock, replenishment and inventory movements.",
    batch_expiry: "Batch stock, expiry tracking and FEFO inventory controls.",
    hospitality: "Floor plans, tables and reservations.",
    kds: "Kitchen display tickets and preparation status.",
    customer_credit: "Customer credit accounts, payments and protected credit controls.",
    suppliers: "Suppliers and purchasing operations.",
    customers: "Customer records and customer activity.",
    staff: "Reusable employee and attendance foundations over existing user identities.",
    reports: "Operational and custom report administration.",
    platform: "Customer-configurable Platform metadata and builders.",
    online_orders: "Online order intake and preparation.",
    integrations: "External delivery, payment and communication integrations.",
    uber_eats: "Uber Eats connection and online order integration.",
    supplier_core: "Canonical supplier identity and supplier-product sourcing metadata.",
    loyalty: "Canonical loyalty configuration, balances, activity and rules.",
    finance_core: "Reusable financial ledger and supplier-accounting foundation.",
  };
  const entitlementKeys = {
    retail_pos: "pos", products: "pos", inventory: "inventory", batch_expiry: "batch_expiry",
    hospitality: "hospitality", kds: "kds", customer_credit: "credit_control", suppliers: "purchasing", customers: "customers", staff: "staff",
    reports: "reports", online_orders: "online_orders", integrations: "integrations",
    uber_eats: "integrations", platform: "platform", loyalty: "loyalty",
  };
  const dependencies = {
    retail_pos: ["products"],
    inventory: ["products"],
    batch_expiry: ["inventory", "products"],
    hospitality: ["retail_pos", "customers"],
    kds: ["hospitality", "retail_pos"],
    customer_credit: ["customers", "retail_pos"],
    suppliers: ["supplier_core"],
    supplier_core: ["products"],
    reports: [],
    platform: [],
    uber_eats: ["integrations", "online_orders"],
    finance_core: ["suppliers"],
    loyalty: ["customers", "retail_pos"],
  };
  const packageType = entry.packageType === "FOUNDATION" || entry.technical === true
    ? "FOUNDATION"
    : "APPLICATION";
  const billable = packageType === "APPLICATION" && entry.billable !== false;
  const licenceMode = entry.licenceMode || (packageType === "FOUNDATION" ? "TECHNICAL" : "COMMERCIAL");
  return {
    packageKey: entry.packageKey || entry.key,
    name: packageNames[entry.key] || entry.name,
    version: entry.version || "1.0.0",
    description: packageDescriptions[entry.key] || entry.description,
    dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
    moduleKey: entry.key,
    manifest: {
      packageKey: entry.packageKey || entry.key,
      name: packageNames[entry.key] || entry.name,
      version: entry.version || "1.0.0",
      packageType,
      publisher: entry.publisher || "OneSolutions",
      category: entry.category || "Business",
      description: packageDescriptions[entry.key] || entry.description,
      route: entry.route,
      entitlementKey: entry.entitlementKey || entitlementKeys[entry.key] || entry.key,
      licenceMode,
      licenceRequired: entry.licenceRequired !== false && licenceMode === "COMMERCIAL",
      billable,
      visibility: entry.visibility || (packageType === "FOUNDATION" ? "HIDDEN" : "PUBLIC"),
      installable: entry.installable !== false,
      systemOnly: entry.systemOnly === true || packageType === "FOUNDATION",
      displayOrder: Number.isInteger(entry.displayOrder) ? entry.displayOrder : 0,
      lifecycleState: entry.lifecycleState || "PUBLISHED",
      permissions: entry.permissions,
      storeScoped: entry.storeScoped === true,
      dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
      optionalDependencies: Array.isArray(entry.optionalDependencies) ? entry.optionalDependencies : [],
      versionConstraints: Object.fromEntries(
        (Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []))
          .filter((dependency) => dependency && typeof dependency === "object")
          .map((dependency) => [
            dependency.packageKey || dependency.package_key,
            {
              minVersion: dependency.minVersion || dependency.min_version || null,
              maxVersion: dependency.maxVersion || dependency.max_version || null,
              versionRange: dependency.versionRange || dependency.version_range || null,
              optional: dependency.optional === true,
            },
          ])
      ),
      metadataOwnership: {
        policy: "PACKAGE_MANAGED",
        preserveUserModified: true,
        requiredTypes: ["object", "field", "relationship", "form", "layout", "workflow", "action", "report", "permission", "connector", "template"],
      },
      optionalFeatures: Array.isArray(entry.optionalFeatures) ? entry.optionalFeatures : [],
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [entry.key],
      ...(entry.key === "products" ? {
        packageKey: "products",
        packageType: "FOUNDATION",
        name: "Product Core",
        version: entry.version || "1.0.0",
        description: "Technical foundation for the canonical Product and Category objects.",
        dependencies: [],
        billable: false,
        licenceRequired: false,
        visibility: "HIDDEN",
        installable: true,
        systemOnly: true,
        technical: true,
        upgrade: {
          strategy: "idempotent_metadata_upsert",
          adoptsExistingData: true,
          preservesRecordIds: true,
          migrations: ["product_core.adopt_canonical_metadata.v1"],
        },
        ownedObjects: ["product", "category"],
        ownedFields: {
          product: [
            "name", "sku", "barcode", "description", "category_id", "active",
            "product_kind", "parent_product_id", "variant_attributes", "image_url",
          ],
          category: ["name", "display_order", "active"],
        },
        objects: [
          {
            objectKey: "product",
            adoptFromPackageKeys: ["retail_pos"],
            metadataScope: "global",
            label: "Product",
            pluralLabel: "Products",
            description: "Canonical tenant-scoped product records.",
            sourceTable: "products",
            fields: [
              { apiName: "name", label: "Name", fieldType: "text", sourceColumn: "name", required: true, writable: true, displayOrder: 1 },
              { apiName: "sku", label: "SKU", fieldType: "text", sourceColumn: "sku", writable: true, displayOrder: 2 },
              { apiName: "barcode", label: "Barcode / EAN", fieldType: "text", sourceColumn: "barcode", writable: true, displayOrder: 3 },
              { apiName: "description", label: "Description", fieldType: "text", sourceColumn: "description", writable: true, displayOrder: 4 },
              { apiName: "category_id", label: "Category", fieldType: "lookup", sourceColumn: "category_id", writable: true, config: { relatedObjectKey: "category" }, displayOrder: 5 },
              { apiName: "active", label: "Active", fieldType: "boolean", sourceColumn: "active", writable: true, displayOrder: 6 },
              { apiName: "product_kind", label: "Product Kind", fieldType: "picklist", sourceColumn: "product_kind", writable: true, options: ["standard", "variant", "bundle"], displayOrder: 7 },
              { apiName: "parent_product_id", label: "Parent Product", fieldType: "lookup", sourceColumn: "parent_product_id", writable: true, config: { relatedObjectKey: "product", relationshipKey: "variants", preventSelfReference: true }, displayOrder: 8 },
              { apiName: "variant_attributes", label: "Variant Attributes", fieldType: "json", sourceColumn: "variant_attributes", writable: true, displayOrder: 9 },
              { apiName: "image_url", label: "Image", fieldType: "text", sourceColumn: "image_url", writable: true, displayOrder: 10 },
              { apiName: "created_at", label: "Created", fieldType: "datetime", sourceColumn: "created_at", writable: false, displayOrder: 11 },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", sourceColumn: "updated_at", writable: false, displayOrder: 12 },
            ],
          },
          {
            objectKey: "category",
            metadataScope: "global",
            label: "Category",
            pluralLabel: "Categories",
            description: "Canonical product categories.",
            sourceTable: "categories",
            fields: [
              { apiName: "name", label: "Name", fieldType: "text", sourceColumn: "name", required: true, writable: true, displayOrder: 1 },
              { apiName: "display_order", label: "Display Order", fieldType: "number", sourceColumn: "display_order", writable: true, displayOrder: 2 },
              { apiName: "active", label: "Active", fieldType: "boolean", sourceColumn: "active", writable: true, displayOrder: 3 },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "category", childObjectKey: "product", relationshipKey: "products", relationshipType: "one_to_many", childFieldApiName: "category_id", required: true },
          { parentObjectKey: "product", childObjectKey: "product", relationshipKey: "variants", relationshipType: "one_to_many", childFieldApiName: "parent_product_id", required: true },
        ],
        listViews: [
          { objectKey: "product", viewKey: "all_products", label: "All Products", columns: ["name", "sku", "barcode", "category_id", "active"], sort: { field: "name", direction: "asc" }, pageSize: 50, isDefault: true },
          { objectKey: "category", viewKey: "all_categories", label: "All Categories", columns: ["name", "display_order", "active"], sort: { field: "display_order", direction: "asc" }, pageSize: 50, isDefault: true },
        ],
        layouts: [
          {
            objectKey: "product",
            layoutKey: "standard_detail",
            pageType: "detail",
            metadataScope: "global",
            name: "Product Record Page",
            isDefault: true,
            definition: {
              presentation_mode: "inline",
              sections: [
                { id: "product_identity", label: "Product Identity", columns: 2, order: 1 },
                { id: "product_category", label: "Category", columns: 1, order: 2 },
                { id: "product_variants", label: "Variants", columns: 1, order: 3 },
              ],
              components: [
                { id: "product_name", type: "field", field_key: "name", section_id: "product_identity", width: "full", order: 1 },
                { id: "product_sku", type: "field", field_key: "sku", section_id: "product_identity", order: 2 },
                { id: "product_barcode", type: "field", field_key: "barcode", section_id: "product_identity", order: 3 },
                { id: "product_kind", type: "field", field_key: "product_kind", section_id: "product_identity", order: 4 },
                { id: "product_status", type: "field", field_key: "active", section_id: "product_identity", order: 5 },
                { id: "product_category_id", type: "field", field_key: "category_id", section_id: "product_category", order: 1 },
                { id: "product_parent_id", type: "field", field_key: "parent_product_id", section_id: "product_variants", order: 1 },
                { id: "product_variant_attributes", type: "field", field_key: "variant_attributes", section_id: "product_variants", order: 2 },
                { id: "product_image", type: "field", field_key: "image_url", section_id: "product_identity", order: 6 },
                { id: "product_variants", type: "related_list", relationship_key: "variants", label: "Variants", columns: ["name", "sku", "barcode", "product_kind", "active"], section_id: "product_variants", order: 3 },
              ],
            },
          },
        ],
        recordForms: [
          {
            objectKey: "product",
            formKey: "product_create",
            layoutKey: "standard_create",
            pageType: "create",
            metadataScope: "global",
            name: "Create Product",
            definition: { presentation_mode: "inline", sections: [{ id: "product_form", label: "Product Details", columns: 2, order: 1 }], components: [] },
          },
          {
            objectKey: "product",
            formKey: "product_edit",
            layoutKey: "standard_edit",
            pageType: "edit",
            metadataScope: "global",
            name: "Edit Product",
            definition: { presentation_mode: "inline", sections: [{ id: "product_form", label: "Product Details", columns: 2, order: 1 }], components: [] },
          },
        ],
        permissionDeclarations: [
          { key: "product_read", permission: "product.view", access: "read" },
          { key: "product_create", permission: "product.create", access: "create" },
          { key: "product_manage", permission: "product.edit", access: "update" },
          { key: "category_read", permission: "category.view", access: "read" },
          { key: "category_create", permission: "category.create", access: "create" },
          { key: "category_manage", permission: "category.edit", access: "update" },
          { key: "category_deactivate", permission: "category.delete", access: "delete" },
          { key: "product_deactivate", permission: "product.delete", access: "delete" },
        ],
        actions: [
          { actionKey: "product.create", objectKey: "product", label: "Create Product", handlerKey: "RECORD_SAVE", requiredPermission: "product.create" },
          { actionKey: "product.update", objectKey: "product", label: "Update Product", handlerKey: "RECORD_SAVE", requiredPermission: "product.edit" },
          { actionKey: "product.activate", objectKey: "product", label: "Activate Product", handlerKey: "RECORD_SAVE", requiredPermission: "product.edit" },
          { actionKey: "product.deactivate", objectKey: "product", label: "Deactivate Product", handlerKey: "RECORD_SAVE", requiredPermission: "product.edit" },
          { actionKey: "product.add_variant", objectKey: "product", label: "Add Variant", handlerKey: "RECORD_SAVE", requiredPermission: "product.create" },
        ],
        rules: [
          {
            objectKey: "product",
            name: "Product name is required",
            triggerKey: "before_save",
            conditions: [{ field: "name", operator: "is_empty" }],
            action: { type: "validation", message: "Product name is required" },
          },
          {
            objectKey: "product",
            name: "Variant requires a parent product",
            triggerKey: "before_save",
            conditions: [
              { field: "product_kind", operator: "equals", value: "variant" },
              { field: "parent_product_id", operator: "is_empty" },
            ],
            action: { type: "validation", message: "A variant must have a parent product" },
          },
          {
            objectKey: "product",
            name: "Only variants can have a parent product",
            triggerKey: "before_save",
            conditions: [
              { field: "product_kind", operator: "not_equals", value: "variant" },
              { field: "parent_product_id", operator: "is_not_empty" },
            ],
            action: { type: "validation", message: "Only a variant can have a parent product" },
          },
        ],
        validationRules: [
          { key: "product_name_required", rule: "Product name is required" },
          { key: "variant_parent_required", rule: "Variant requires a parent product" },
          { key: "parent_only_for_variant", rule: "Only variants can have a parent product" },
          { duplicateIdentity: "Enforced by the existing Product API and active-company unique indexes for SKU and barcode." },
        ],
        migrations: ["product_core.adopt_canonical_metadata.v1"],
      } : {}),
      ...(entry.key === "online_orders" ? {
        metadataOwnership: {
          policy: "PACKAGE_MANAGED",
          preserveUserModified: true,
          requiredTypes: ["object", "field", "relationship", "form", "layout", "workflow", "action", "report", "permission", "connector", "template"],
          objects: ["online_order", "online_order_line"],
          relationships: ["order_lines", "product", "customer", "store"],
          layouts: ["online_order_detail"],
          forms: ["online_order_create", "online_order_edit"],
          listViews: ["all"],
          validations: ["online_order_line_quantity_positive"],
          permissions: ["online_orders.view", "online_orders.manage", "online_orders.status_update", "online_orders.cancel"],
          actions: [
            "online_order.accept",
            "online_order.reject",
            "online_order.prepare",
            "online_order.mark_ready",
            "online_order.mark_ready_for_pickup",
            "online_order.mark_ready_for_delivery",
            "online_order.collect",
            "online_order.complete",
            "online_order.cancel",
          ],
          events: [
            "online_order.created",
            "online_order.accepted",
            "online_order.status_changed",
            "online_order.cancelled",
            "online_order.completed",
          ],
        },
        upgrade: {
          migrationKey: "online_orders_core_1_0_0",
          strategy: "additive",
          preservesRecordIds: true,
          idempotentMetadataProvisioning: true,
        },
        objects: [
          {
            objectKey: "online_order",
            metadataScope: "global",
            label: "Online Order",
            pluralLabel: "Online Orders",
            description: "Canonical provider-neutral online order record.",
            sourceTable: "online_orders",
            required: true,
            fields: [
              { apiName: "external_reference", sourceColumn: "external_reference", label: "Order Reference", fieldType: "text", writable: false },
              { apiName: "external_order_id", sourceColumn: "external_order_id", label: "External Provider Order ID", fieldType: "text", required: true, writable: false },
              { apiName: "platform", sourceColumn: "platform", label: "Provider / Channel", fieldType: "text", required: true, writable: false, config: { normalizedProviderKey: true, allowFutureProviders: true } },
              { apiName: "company_id", sourceColumn: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "store_id", sourceColumn: "store_id", label: "Store", fieldType: "lookup", writable: false },
              { apiName: "customer_id", sourceColumn: "customer_id", label: "Customer", fieldType: "lookup", writable: false },
              { apiName: "customer_name", sourceColumn: "customer_name", label: "Customer Name", fieldType: "text", writable: false },
              { apiName: "customer_phone", sourceColumn: "customer_phone", label: "Customer Phone", fieldType: "phone", writable: false },
              { apiName: "customer_email", sourceColumn: "customer_email", label: "Customer Email", fieldType: "email", writable: false },
              { apiName: "fulfilment_type", sourceColumn: "fulfilment_type", label: "Fulfilment", fieldType: "picklist", required: true, writable: false, options: ["SELF_PICKUP", "DELIVERY"] },
              { apiName: "status", sourceColumn: "status", label: "Status", fieldType: "picklist", required: true, writable: false, options: ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "READY_FOR_PICKUP", "READY_FOR_DELIVERY", "COLLECTED", "COMPLETED", "REJECTED", "CANCELLED"] },
              { apiName: "subtotal", sourceColumn: "subtotal", label: "Subtotal", fieldType: "currency", writable: false },
              { apiName: "tax", sourceColumn: "tax", label: "Tax", fieldType: "currency", writable: false },
              { apiName: "total", sourceColumn: "total", label: "Total", fieldType: "currency", writable: false },
              { apiName: "notes", sourceColumn: "notes", label: "Notes", fieldType: "text", writable: false },
              { apiName: "delivery_address", sourceColumn: "delivery_address", label: "Delivery Address", fieldType: "text", writable: false },
              { apiName: "created_at", sourceColumn: "created_at", label: "Created", fieldType: "datetime", writable: false },
              { apiName: "updated_at", sourceColumn: "updated_at", label: "Updated", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "online_order_line",
            metadataScope: "global",
            label: "Online Order Line",
            pluralLabel: "Online Order Lines",
            description: "Existing online order item rows and Product Core references.",
            sourceTable: "online_order_items",
            required: true,
            fields: [
              { apiName: "order_id", sourceColumn: "order_id", label: "Online Order", fieldType: "lookup", required: true, writable: false },
              { apiName: "product_id", sourceColumn: "product_id", label: "Product", fieldType: "lookup", writable: false },
              { apiName: "product_name", sourceColumn: "product_name", label: "Product Name", fieldType: "text", required: true, writable: false },
              { apiName: "external_item_id", sourceColumn: "external_item_id", label: "External Item ID", fieldType: "text", writable: false },
              { apiName: "quantity", sourceColumn: "quantity", label: "Quantity", fieldType: "decimal", required: true, writable: false, config: { minimum: 0.001 } },
              { apiName: "unit_price", sourceColumn: "unit_price", label: "Unit Price", fieldType: "currency", required: true, writable: false },
              { apiName: "tax", sourceColumn: "tax", label: "Tax", fieldType: "currency", writable: false },
              { apiName: "total", sourceColumn: "total", label: "Line Total", fieldType: "currency", required: true, writable: false },
              { apiName: "mapping_status", sourceColumn: "mapping_status", label: "Product Mapping", fieldType: "picklist", required: true, writable: false, options: ["MAPPED", "UNMAPPED"] },
              { apiName: "platform_data", sourceColumn: "platform_data", label: "Provider Item Data", fieldType: "json", writable: false },
              { apiName: "created_at", sourceColumn: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "online_order", childObjectKey: "online_order_line", relationshipKey: "order_lines", relationshipType: "one_to_many", childFieldApiName: "order_id", required: true },
          { parentObjectKey: "online_order_line", childObjectKey: "product", relationshipKey: "product", relationshipType: "lookup", childFieldApiName: "product_id" },
          { parentObjectKey: "customer", childObjectKey: "online_order", relationshipKey: "online_orders", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
          { parentObjectKey: "store", childObjectKey: "online_order", relationshipKey: "online_orders", relationshipType: "one_to_many", childFieldApiName: "store_id" },
        ],
        listViews: [
          {
            objectKey: "online_order",
            viewKey: "all",
            label: "All Online Orders",
            columns: ["external_reference", "external_order_id", "platform", "store_id", "fulfilment_type", "status", "total", "created_at"],
            sort: { field: "created_at", direction: "desc" },
            pageSize: 50,
            isDefault: true,
          },
        ],
        layouts: [
          {
            objectKey: "online_order",
            layoutKey: "online_order_detail",
            pageType: "detail",
            name: "Online Order Details",
            isDefault: true,
            required: true,
            definition: {
              sections: [{ id: "order-details", label: "Order Details", order: 0, columns: 2, visible: true }],
              components: [
                ...["external_reference", "external_order_id", "platform", "store_id", "customer_id", "customer_name", "fulfilment_type", "status", "subtotal", "tax", "total", "created_at"].map((fieldKey, order) => ({
                  id: `field-${fieldKey}`,
                  type: "field",
                  field_key: fieldKey,
                  section_id: "order-details",
                  order,
                  width: "1/2",
                  visible: true,
                  readOnly: true,
                })),
                { id: "related-order-lines", type: "related_list", relationship_key: "order_lines", label: "Order Lines", visible: true },
              ],
            },
          },
        ],
        forms: [
          {
            objectKey: "online_order",
            formKey: "online_order_create",
            pageType: "create",
            name: "Online Order Create",
            fields: ["external_order_id", "platform", "store_id", "customer_id", "fulfilment_type", "status"],
          },
          {
            objectKey: "online_order",
            formKey: "online_order_edit",
            pageType: "edit",
            name: "Online Order Edit",
            fields: ["external_reference", "external_order_id", "platform", "store_id", "customer_id", "fulfilment_type", "status", "notes"],
          },
        ],
        validationRules: [
          {
            objectKey: "online_order_line",
            name: "online_order_line_quantity_positive",
            triggerKey: "before_create",
            conditions: [{ field: "quantity", operator: "less_than", value: 0.001 }],
            action: { message: "Order line quantity must be greater than zero." },
            required: true,
          },
        ],
        permissionDeclarations: [
          { key: "online_order_read", permission: "online_orders.view", access: "read" },
          { key: "online_order_lifecycle", permission: "online_orders.manage", access: "execute" },
        ],
        actions: [
          { actionKey: "online_order.accept", objectKey: "online_order", label: "Accept Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "PREPARING" } },
          { actionKey: "online_order.reject", objectKey: "online_order", label: "Reject Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "REJECTED" } },
          { actionKey: "online_order.prepare", objectKey: "online_order", label: "Prepare Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "PREPARING" } },
          { actionKey: "online_order.mark_ready", objectKey: "online_order", label: "Mark Ready", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "AUTO_READY" } },
          { actionKey: "online_order.mark_ready_for_pickup", objectKey: "online_order", label: "Mark Ready for Pickup", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "READY_FOR_PICKUP" } },
          { actionKey: "online_order.mark_ready_for_delivery", objectKey: "online_order", label: "Mark Ready for Delivery", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "READY_FOR_DELIVERY" } },
          { actionKey: "online_order.collect", objectKey: "online_order", label: "Collect Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "COLLECTED" } },
          { actionKey: "online_order.complete", objectKey: "online_order", label: "Complete Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "COMPLETED" } },
          { actionKey: "online_order.cancel", objectKey: "online_order", label: "Cancel Order", handlerKey: "ONLINE_ORDER_TRANSITION", requiredPermission: "online_orders.manage", config: { toStatus: "CANCELLED" } },
        ],
        buttons: [
          { buttonKey: "online_order_accept", objectKey: "online_order", label: "Accept", actionKey: "online_order.accept", requiredPermission: "online_orders.manage", variant: "primary" },
          { buttonKey: "online_order_reject", objectKey: "online_order", label: "Reject", actionKey: "online_order.reject", requiredPermission: "online_orders.manage", variant: "danger" },
          { buttonKey: "online_order_prepare", objectKey: "online_order", label: "Prepare", actionKey: "online_order.prepare", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_ready", objectKey: "online_order", label: "Mark Ready", actionKey: "online_order.mark_ready", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_ready_pickup", objectKey: "online_order", label: "Ready for Pickup", actionKey: "online_order.mark_ready_for_pickup", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_ready_delivery", objectKey: "online_order", label: "Ready for Delivery", actionKey: "online_order.mark_ready_for_delivery", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_collect", objectKey: "online_order", label: "Collect", actionKey: "online_order.collect", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_complete", objectKey: "online_order", label: "Complete", actionKey: "online_order.complete", requiredPermission: "online_orders.manage", variant: "secondary" },
          { buttonKey: "online_order_cancel", objectKey: "online_order", label: "Cancel", actionKey: "online_order.cancel", requiredPermission: "online_orders.manage", variant: "danger" },
        ],
        events: [
          { eventType: "online_order.created", description: "A canonical online order was created." },
          { eventType: "online_order.accepted", description: "A canonical online order was accepted." },
          { eventType: "online_order.status_changed", description: "A canonical online order status changed." },
          { eventType: "online_order.cancelled", description: "A canonical online order was cancelled." },
          { eventType: "online_order.completed", description: "A canonical online order was completed." },
        ],
      } : {}),
      ...(entry.key === "staff" ? {
        packageKey: "staff",
        packageType: "FOUNDATION",
        name: "Staff Core",
        version: entry.version || "1.1.0",
        description: "Technical foundation for Staff and Attendance metadata on existing tenant-scoped records.",
        dependencies: [],
        billable: false,
        licenceRequired: false,
        visibility: "HIDDEN",
        installable: true,
        systemOnly: true,
        technical: true,
        upgrade: {
          strategy: "idempotent_metadata_upsert",
          adoptsExistingData: true,
          preservesRecordIds: true,
          migrations: ["staff_core_object_metadata_v1"],
        },
        objects: [
          {
            objectKey: "employee",
            label: "Staff Member",
            pluralLabel: "Staff",
            description: "Business-facing staff metadata on the existing authentication user record.",
            sourceTable: "users",
            metadataScope: "global",
            fieldsMetadataScope: "global",
            fields: [
              { apiName: "full_name", label: "Name", fieldType: "text", sourceColumn: "full_name", required: true, writable: true },
              { apiName: "username", label: "User", fieldType: "text", sourceColumn: "username", required: true, writable: false },
              { apiName: "email", label: "Email", fieldType: "email", sourceColumn: "email", writable: true },
              { apiName: "active", label: "Status", fieldType: "boolean", sourceColumn: "active", required: true, writable: true },
              { apiName: "store_id", label: "Store", fieldType: "lookup", sourceColumn: "store_id", writable: true },
              { apiName: "created_at", label: "Created", fieldType: "datetime", sourceColumn: "created_at", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", sourceColumn: "updated_at", writable: false },
            ],
          },
          {
            objectKey: "attendance",
            label: "Attendance",
            pluralLabel: "Attendance Records",
            description: "Existing server-timestamped staff attendance sessions.",
            sourceTable: "attendance_records",
            metadataScope: "global",
            fieldsMetadataScope: "global",
            storeScoped: true,
            fields: [
              { apiName: "user_id", label: "Staff User", fieldType: "lookup", sourceColumn: "user_id", required: true, writable: false },
              { apiName: "store_id", label: "Store", fieldType: "lookup", sourceColumn: "store_id", required: true, writable: false },
              { apiName: "status", label: "Status", fieldType: "picklist", sourceColumn: "status", required: true, writable: false, options: ["open", "closed"] },
              { apiName: "clock_in", label: "Clock In", fieldType: "datetime", sourceColumn: "clock_in", required: true, writable: false },
              { apiName: "clock_out", label: "Clock Out", fieldType: "datetime", sourceColumn: "clock_out", writable: false },
              { apiName: "worked_minutes", label: "Worked Minutes", fieldType: "number", sourceColumn: "worked_minutes", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", sourceColumn: "created_at", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "employee", childObjectKey: "attendance", relationshipKey: "attendance_records", relationshipType: "one_to_many", childFieldApiName: "user_id", required: true },
          { parentObjectKey: "store", childObjectKey: "employee", relationshipKey: "staff", relationshipType: "one_to_many", childFieldApiName: "store_id" },
        ],
        listViews: [
          {
            objectKey: "employee",
            viewKey: "all_staff",
            label: "All Staff",
            description: "Existing business-facing user and employee records.",
            columns: ["full_name", "active", "username", "email", "store_id"],
            sort: { field: "full_name", direction: "asc" },
            isDefault: true,
          },
        ],
        layouts: [
          {
            objectKey: "employee",
            pageType: "detail",
            layoutKey: "staff_record_detail",
            name: "Staff Record",
            metadataScope: "global",
            definition: {
              sections: [{ id: "staff-details", label: "Staff Details", order: 0, columns: 2, visible: true }],
              components: [
                { id: "staff-header", type: "header", label: "Staff Record", section_id: "staff-details", order: 0, width: "full", visible: true },
                { id: "staff-full-name", type: "field", field_key: "full_name", section_id: "staff-details", order: 1, width: "1/2", visible: true, readOnly: true },
                { id: "staff-active", type: "field", field_key: "active", section_id: "staff-details", order: 2, width: "1/2", visible: true, readOnly: true },
                { id: "staff-username", type: "field", field_key: "username", section_id: "staff-details", order: 3, width: "1/2", visible: true, readOnly: true },
                { id: "staff-email", type: "field", field_key: "email", section_id: "staff-details", order: 4, width: "1/2", visible: true, readOnly: true },
                { id: "staff-store", type: "field", field_key: "store_id", section_id: "staff-details", order: 5, width: "1/2", visible: true, readOnly: true },
                { id: "staff-created", type: "field", field_key: "created_at", section_id: "staff-details", order: 6, width: "1/2", visible: true, readOnly: true },
                { id: "staff-attendance", type: "related_list", relationship_key: "attendance_records", label: "Attendance", section_id: "staff-details", order: 7, width: "full", visible: true },
              ],
            },
          },
          {
            objectKey: "employee",
            pageType: "view",
            layoutKey: "staff_record_view",
            name: "Staff Record View",
            metadataScope: "global",
            definition: {
              sections: [{ id: "staff-view", label: "Staff Details", order: 0, columns: 2, visible: true }],
              components: [
                { id: "staff-view-header", type: "header", label: "Staff Record", section_id: "staff-view", order: 0, width: "full", visible: true },
                { id: "staff-view-name", type: "field", field_key: "full_name", section_id: "staff-view", order: 1, width: "1/2", visible: true, readOnly: true },
                { id: "staff-view-status", type: "field", field_key: "active", section_id: "staff-view", order: 2, width: "1/2", visible: true, readOnly: true },
                { id: "staff-view-user", type: "field", field_key: "username", section_id: "staff-view", order: 3, width: "1/2", visible: true, readOnly: true },
                { id: "staff-view-email", type: "field", field_key: "email", section_id: "staff-view", order: 4, width: "1/2", visible: true, readOnly: true },
                { id: "staff-view-store", type: "field", field_key: "store_id", section_id: "staff-view", order: 5, width: "1/2", visible: true, readOnly: true },
                { id: "staff-view-attendance", type: "related_list", relationship_key: "attendance_records", label: "Attendance", section_id: "staff-view", order: 6, width: "full", visible: true },
              ],
            },
          },
        ],
        rules: [
          {
            name: "Staff name is required",
            objectKey: "employee",
            triggerKey: "before_save",
            active: true,
            required: true,
            conditions: [{ field: "full_name", operator: "is_empty" }],
            action: { type: "validation", match: "all", message: "Enter a staff name." },
          },
        ],
        permissionDeclarations: [
          { key: "staff_records", objectKey: "employee", permission: "user.view", access: "read" },
          { key: "staff_manage", objectKey: "employee", permission: "user.edit", access: "manage" },
          { key: "attendance_records", objectKey: "attendance", permission: "attendance.view", access: "read" },
          { key: "attendance_actions", objectKey: "attendance", permission: "attendance.use", access: "execute" },
        ],
        permissions: ["user.view", "user.edit", "attendance.view", "attendance.use"],
        capabilities: ["staff_core", "employee_metadata", "attendance_metadata"],
        ownership: {
          metadataTypes: ["object", "field", "relationship", "layout", "list_view", "validation", "workflow", "action"],
          excludes: ["authentication_user_metadata", "roles", "permissions", "user_records", "attendance_record_data"],
        },
        upgradeMetadata: { strategy: "additive", preserveExistingUserIds: true, preserveAttendanceRecords: true },
        migrations: ["staff_core_object_metadata_v1"],
      } : {}),
      ...(entry.key === "supplier_core" ? {
        objects: [
          {
            objectKey: "supplier",
            label: "Supplier",
            pluralLabel: "Suppliers",
            description: "Canonical supplier identity and contact details.",
            sourceTable: "suppliers",
            metadataScope: "global",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", sourceColumn: "company_id", required: true, writable: false },
              { apiName: "name", label: "Name", fieldType: "text", sourceColumn: "name", required: true, writable: true },
              { apiName: "contact_name", label: "Contact Name", fieldType: "text", sourceColumn: "contact_name", writable: true },
              { apiName: "phone", label: "Phone", fieldType: "phone", sourceColumn: "phone", writable: true },
              { apiName: "email", label: "Email", fieldType: "email", sourceColumn: "email", writable: true },
              { apiName: "address", label: "Address", fieldType: "text", sourceColumn: "address", writable: true },
              { apiName: "notes", label: "Notes", fieldType: "text", sourceColumn: "notes", writable: true },
              { apiName: "active", label: "Active", fieldType: "boolean", sourceColumn: "active", writable: true },
              { apiName: "created_at", label: "Created", fieldType: "datetime", sourceColumn: "created_at", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", sourceColumn: "updated_at", writable: false },
            ],
          },
          {
            objectKey: "supplier_product",
            label: "Supplier Product",
            pluralLabel: "Supplier Products",
            description: "Supplier-specific product references, costs and effective dates.",
            sourceTable: "supplier_products",
            metadataScope: "global",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", sourceColumn: "company_id", required: true, writable: false },
              { apiName: "supplier_id", label: "Supplier", fieldType: "lookup", sourceColumn: "supplier_id", required: true, writable: true, config: { relationshipKey: "supplier", relatedObjectKey: "supplier" } },
              { apiName: "product_id", label: "Product", fieldType: "lookup", sourceColumn: "product_id", required: true, writable: true, config: { relationshipKey: "product", relatedObjectKey: "product" } },
              { apiName: "supplier_sku", label: "Supplier SKU", fieldType: "text", sourceColumn: "supplier_sku", writable: true },
              { apiName: "supplier_description", label: "Supplier Description", fieldType: "text", sourceColumn: "supplier_description", writable: true },
              { apiName: "cost_price", label: "Supplier Cost", fieldType: "currency", sourceColumn: "cost_price", required: true, writable: true },
              { apiName: "effective_from", label: "Effective From", fieldType: "date", sourceColumn: "effective_from", required: true, writable: true },
              { apiName: "effective_to", label: "Effective To", fieldType: "date", sourceColumn: "effective_to", writable: true },
              { apiName: "preferred", label: "Preferred Supplier", fieldType: "boolean", sourceColumn: "preferred", writable: true },
              { apiName: "active", label: "Active", fieldType: "boolean", sourceColumn: "active", writable: true },
              { apiName: "created_at", label: "Created", fieldType: "datetime", sourceColumn: "created_at", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", sourceColumn: "updated_at", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "supplier", childObjectKey: "supplier_product", relationshipKey: "products", relationshipType: "one_to_many", childFieldApiName: "supplier_id" },
          { parentObjectKey: "product", childObjectKey: "supplier_product", relationshipKey: "supplier_products", relationshipType: "one_to_many", childFieldApiName: "product_id" },
          { parentObjectKey: "supplier_product", childObjectKey: "supplier", relationshipKey: "supplier", relationshipType: "lookup", parentFieldApiName: "supplier_id" },
          { parentObjectKey: "supplier_product", childObjectKey: "product", relationshipKey: "product", relationshipType: "lookup", parentFieldApiName: "product_id" },
        ],
        listViews: [
          { objectKey: "supplier", viewKey: "all", label: "All Suppliers", columns: ["name", "contact_name", "phone", "email", "active", "updated_at"], isDefault: true },
          { objectKey: "supplier_product", viewKey: "sourcing", label: "Supplier Product Sourcing", columns: ["supplier_id", "product_id", "supplier_sku", "cost_price", "effective_from", "effective_to", "preferred", "active"], isDefault: true },
        ],
        permissionDeclarations: [
          { permission: "inventory.view", label: "View supplier master data" },
          { permission: "inventory.adjust", label: "Manage supplier master data" },
          { permission: "purchase.view", label: "View supplier references used in purchasing" },
        ],
        lifecycle: {
          preservesExistingRecords: true,
          preservesCustomFields: true,
          disableBehavior: "deactivate-package-access-only",
        },
      } : {}),
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
      ...(entry.key === "finance_core" ? {
        objects: [
          {
            objectKey: "supplier_invoice",
            metadataScope: "global",
            label: "Supplier Invoice",
            pluralLabel: "Supplier Invoices",
            description: "Authoritative supplier invoice records.",
            sourceTable: "supplier_invoices",
            required: true,
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "supplier_id", label: "Supplier", fieldType: "lookup", required: true, writable: false },
              { apiName: "store_id", label: "Store", fieldType: "lookup", writable: false },
              { apiName: "purchase_id", label: "Purchase Order", fieldType: "lookup", writable: false },
              { apiName: "invoice_number", label: "Invoice Number", fieldType: "text", required: true, writable: false },
              { apiName: "invoice_date", label: "Invoice Date", fieldType: "date", required: true, writable: false },
              { apiName: "due_date", label: "Due Date", fieldType: "date", writable: false },
              { apiName: "subtotal", label: "Subtotal", fieldType: "currency", required: true, writable: false },
              { apiName: "tax", label: "VAT / Tax", fieldType: "currency", required: true, writable: false },
              { apiName: "total", label: "Total", fieldType: "currency", required: true, writable: false },
              { apiName: "status", label: "Status", fieldType: "picklist", required: true, writable: false, options: ["OPEN", "PARTIALLY_PAID", "PAID", "VOID"] },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "supplier_payment",
            metadataScope: "global",
            label: "Supplier Payment",
            pluralLabel: "Supplier Payments",
            description: "Authoritative supplier-account payment records.",
            sourceTable: "supplier_payments",
            required: true,
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "supplier_id", label: "Supplier", fieldType: "lookup", required: true, writable: false },
              { apiName: "store_id", label: "Store", fieldType: "lookup", writable: false },
              { apiName: "amount", label: "Amount", fieldType: "currency", required: true, writable: false },
              { apiName: "payment_date", label: "Payment Date", fieldType: "date", required: true, writable: false },
              { apiName: "payment_method", label: "Payment Method", fieldType: "text", writable: false },
              { apiName: "reference", label: "Reference", fieldType: "text", writable: false },
              { apiName: "status", label: "Status", fieldType: "picklist", required: true, writable: false, options: ["PENDING", "COMPLETED", "CANCELLED"] },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "supplier_payment_allocation",
            metadataScope: "global",
            label: "Payment Allocation",
            pluralLabel: "Payment Allocations",
            description: "Authoritative junction between supplier payments and invoices.",
            sourceTable: "supplier_payment_allocations",
            required: true,
            fields: [
              { apiName: "payment_id", label: "Supplier Payment", fieldType: "lookup", required: true, writable: false },
              { apiName: "invoice_id", label: "Supplier Invoice", fieldType: "lookup", required: true, writable: false },
              { apiName: "amount", label: "Allocated Amount", fieldType: "currency", required: true, writable: false },
            ],
          },
          {
            objectKey: "supplier_ledger",
            metadataScope: "global",
            label: "Supplier Ledger Entry",
            pluralLabel: "Supplier Ledger Entries",
            description: "Authoritative supplier-account ledger entries.",
            sourceTable: "supplier_ledger_entries",
            required: true,
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "supplier_id", label: "Supplier", fieldType: "lookup", required: true, writable: false },
              { apiName: "store_id", label: "Store", fieldType: "lookup", writable: false },
              { apiName: "entry_type", label: "Entry Type", fieldType: "picklist", required: true, writable: false, options: ["INVOICE", "PAYMENT", "RETURN_CREDIT", "OPENING"] },
              { apiName: "reference_type", label: "Reference Type", fieldType: "text", writable: false },
              { apiName: "reference_id", label: "Source Reference", fieldType: "lookup", writable: false },
              { apiName: "reference", label: "Reference", fieldType: "text", writable: false },
              { apiName: "amount", label: "Amount", fieldType: "currency", required: true, writable: false },
              { apiName: "debit", label: "Debit", fieldType: "boolean", required: true, writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "financial_ledger",
            metadataScope: "global",
            label: "Financial Ledger Entry",
            pluralLabel: "Financial Ledger Entries",
            description: "Shared financial ledger contract backed by existing entries.",
            sourceTable: "financial_ledger_entries",
            required: true,
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "transaction_id", label: "Transaction", fieldType: "lookup", writable: false },
              { apiName: "payment_id", label: "Payment", fieldType: "lookup", writable: false },
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", writable: false },
              { apiName: "supplier_id", label: "Supplier", fieldType: "lookup", writable: false },
              { apiName: "supplier_invoice_id", label: "Supplier Invoice", fieldType: "lookup", writable: false },
              { apiName: "transaction_type", label: "Transaction Type", fieldType: "text", required: true, writable: false },
              { apiName: "debit", label: "Debit", fieldType: "currency", writable: false },
              { apiName: "credit", label: "Credit", fieldType: "currency", writable: false },
              { apiName: "amount", label: "Amount", fieldType: "currency", required: true, writable: false },
              { apiName: "net_amount", label: "Net Amount", fieldType: "currency", writable: false },
              { apiName: "vat_amount", label: "VAT / Tax", fieldType: "currency", writable: false },
              { apiName: "reference", label: "Reference", fieldType: "text", writable: false },
              { apiName: "status", label: "Status", fieldType: "text", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "supplier", childObjectKey: "supplier_invoice", relationshipKey: "invoices", relationshipType: "one_to_many", childFieldApiName: "supplier_id", required: true },
          { parentObjectKey: "supplier_invoice", childObjectKey: "supplier", relationshipKey: "supplier", relationshipType: "lookup", parentFieldApiName: "supplier_id", required: true },
          { parentObjectKey: "supplier", childObjectKey: "supplier_payment", relationshipKey: "payments", relationshipType: "one_to_many", childFieldApiName: "supplier_id", required: true },
          { parentObjectKey: "supplier_payment", childObjectKey: "supplier", relationshipKey: "supplier", relationshipType: "lookup", parentFieldApiName: "supplier_id", required: true },
          { parentObjectKey: "supplier_payment", childObjectKey: "supplier_payment_allocation", relationshipKey: "allocations", relationshipType: "one_to_many", childFieldApiName: "payment_id", required: true },
          { parentObjectKey: "supplier_payment_allocation", childObjectKey: "supplier_payment", relationshipKey: "payment", relationshipType: "lookup", parentFieldApiName: "payment_id", required: true },
          { parentObjectKey: "supplier_payment_allocation", childObjectKey: "supplier_invoice", relationshipKey: "invoice", relationshipType: "lookup", parentFieldApiName: "invoice_id", required: true },
          { parentObjectKey: "supplier_invoice", childObjectKey: "purchase", relationshipKey: "purchase_order", relationshipType: "lookup", parentFieldApiName: "purchase_id" },
          { parentObjectKey: "supplier_ledger", childObjectKey: "supplier", relationshipKey: "supplier", relationshipType: "lookup", parentFieldApiName: "supplier_id", required: true },
          { parentObjectKey: "financial_ledger", childObjectKey: "supplier", relationshipKey: "supplier", relationshipType: "lookup", parentFieldApiName: "supplier_id" },
        ],
        listViews: [
          { objectKey: "supplier_invoice", viewKey: "supplier_invoices", label: "Supplier Invoices", columns: ["invoice_number", "supplier_id", "invoice_date", "due_date", "total", "status"] },
          { objectKey: "supplier_payment", viewKey: "supplier_payments", label: "Supplier Payments", columns: ["supplier_id", "payment_date", "amount", "payment_method", "reference", "status"] },
          { objectKey: "supplier_ledger", viewKey: "supplier_ledger", label: "Supplier Ledger", columns: ["supplier_id", "entry_type", "amount", "debit", "reference", "created_at"] },
          { objectKey: "financial_ledger", viewKey: "financial_ledger", label: "Financial Ledger", columns: ["transaction_type", "supplier_id", "amount", "debit", "credit", "reference", "created_at"] },
        ],
        actions: [
          { actionKey: "supplier_invoice.manage", label: "Manage Supplier Invoices", handlerKey: "SUPPLIER_INVOICE_MANAGE", requiredPermission: "purchase.edit" },
          { actionKey: "supplier_payment.manage", label: "Manage Supplier Payments", handlerKey: "SUPPLIER_PAYMENT_MANAGE", requiredPermission: "purchase.edit" },
          { actionKey: "supplier_ledger.view", label: "View Supplier Ledger", handlerKey: "SUPPLIER_LEDGER_VIEW", requiredPermission: "purchase.view" },
        ],
        permissionDeclarations: [
          { permission: "purchase.view", label: "View supplier accounting" },
          { permission: "purchase.edit", label: "Manage supplier invoices and payments" },
          { permission: "inventory.adjust", label: "Post supplier account adjustments" },
          { permission: "reports.payments.view", label: "View financial ledger" },
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
      ...(entry.key === "customers" ? {
        objects: [
          {
            objectKey: "customer",
            label: "Customer",
            pluralLabel: "Customers",
            description: "Canonical customer record for person and business relationships.",
            sourceTable: "customers",
            fields: [
              { apiName: "customer_number", label: "Customer Number", fieldType: "text", writable: false },
              { apiName: "display_name", label: "Display Name", fieldType: "text", required: true, writable: true },
              { apiName: "default_contact_id", label: "Default Contact", fieldType: "lookup", writable: true },
              { apiName: "default_address_id", label: "Default Address", fieldType: "lookup", writable: true },
              { apiName: "status", label: "Status", fieldType: "picklist", options: ["ACTIVE", "INACTIVE", "BLOCKED"], writable: true },
            ],
          },
          {
            objectKey: "contact",
            label: "Contact",
            pluralLabel: "Contacts",
            description: "Reusable contact details that can be shared across customer, sales, and CRM workflows.",
            sourceTable: "contacts",
            fields: [
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", required: true, writable: true },
              { apiName: "first_name", label: "First Name", fieldType: "text", writable: true },
              { apiName: "last_name", label: "Last Name", fieldType: "text", writable: true },
              { apiName: "name", label: "Contact Name", fieldType: "text", required: true, writable: true },
              { apiName: "email", label: "Email", fieldType: "email", writable: true },
              { apiName: "phone", label: "Phone", fieldType: "phone", writable: true },
              { apiName: "job_title", label: "Job Title", fieldType: "text", writable: true },
              { apiName: "is_primary", label: "Primary Contact", fieldType: "boolean", writable: true },
              { apiName: "active", label: "Active", fieldType: "boolean", writable: true },
            ],
          },
          {
            objectKey: "address",
            label: "Address",
            pluralLabel: "Addresses",
            description: "Reusable address records for billing, shipping, and customer communication.",
            sourceTable: "addresses",
            fields: [
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", required: true, writable: true },
              { apiName: "address_type", label: "Address Type", fieldType: "picklist", options: ["HOME", "WORK", "BILLING", "SHIPPING"], writable: true },
              { apiName: "line_1", label: "Address Line 1", fieldType: "text", required: true, writable: true },
              { apiName: "line_2", label: "Address Line 2", fieldType: "text", writable: true },
              { apiName: "city", label: "City", fieldType: "text", writable: true },
              { apiName: "region", label: "Region / State", fieldType: "text", writable: true },
              { apiName: "postcode", label: "Postcode", fieldType: "text", writable: true },
              { apiName: "country", label: "Country", fieldType: "text", writable: true },
              { apiName: "is_default", label: "Default Address", fieldType: "boolean", writable: true },
              { apiName: "is_billing", label: "Billing Address", fieldType: "boolean", writable: true },
              { apiName: "is_shipping", label: "Shipping Address", fieldType: "boolean", writable: true },
              { apiName: "active", label: "Active", fieldType: "boolean", writable: true },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "customer", childObjectKey: "contact", relationshipKey: "contacts", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
          { parentObjectKey: "customer", childObjectKey: "address", relationshipKey: "addresses", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
        ],
        listViews: [
          { objectKey: "customer", viewKey: "all", label: "All Customers", columns: ["customer_number", "display_name", "email", "phone", "status"], isDefault: true },
          { objectKey: "contact", viewKey: "all", label: "All Contacts", columns: ["name", "email", "phone", "job_title"], isDefault: true },
          { objectKey: "address", viewKey: "all", label: "All Addresses", columns: ["line_1", "city", "postcode", "address_type"], isDefault: true },
        ],
        actions: [
          { actionKey: "customer.add_contact", objectKey: "customer", label: "Add Contact", description: "Create a related contact for this customer.", handlerKey: "ADD_CONTACT", requiredPermission: "customer.edit" },
          { actionKey: "customer.add_address", objectKey: "customer", label: "Add Address", description: "Create a related address for this customer.", handlerKey: "ADD_ADDRESS", requiredPermission: "customer.edit" },
        ],
        rules: [
          {
            objectKey: "contact",
            name: "Contact has a name",
            triggerKey: "before_save",
            conditions: [{ field: "name", operator: "is_empty" }],
            action: { type: "validation", message: "Contact name is required" },
          },
          {
            objectKey: "address",
            name: "Address line 1 is required",
            triggerKey: "before_save",
            conditions: [{ field: "line_1", operator: "is_empty" }],
            action: { type: "validation", message: "Address line 1 is required" },
          },
          {
            objectKey: "customer",
            name: "Customer name is required",
            triggerKey: "before_save",
            conditions: [{ field: "display_name", operator: "is_empty" }],
            action: { type: "validation", message: "Customer display name is required" },
          },
        ],
      } : {}),
      ...(entry.key === "loyalty" ? {
        objects: [
          {
            objectKey: "loyalty_configuration",
            metadataScope: "global",
            label: "Loyalty Configuration",
            pluralLabel: "Loyalty Configurations",
            description: "Company-level loyalty programme settings. Values remain authoritative in company_settings.",
            sourceTable: "company_settings",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "loyalty_enabled", label: "Enabled", fieldType: "boolean", writable: false },
              { apiName: "loyalty_earning_rate", label: "Earn Rate", fieldType: "decimal", writable: false },
              { apiName: "loyalty_min_sale_total", label: "Minimum Qualifying Sale", fieldType: "currency", writable: false },
              { apiName: "loyalty_redeem_value_per_point", label: "Redemption Value per Point", fieldType: "decimal", writable: false },
              { apiName: "loyalty_min_points_redeem", label: "Minimum Redemption Points", fieldType: "number", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "loyalty_account",
            metadataScope: "global",
            label: "Loyalty Account",
            pluralLabel: "Loyalty Accounts",
            description: "Customer loyalty balance. The balance remains authoritative in customer_loyalty_balances.",
            sourceTable: "customer_loyalty_balances",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", required: true, writable: false },
              { apiName: "balance", label: "Balance", fieldType: "decimal", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "loyalty_activity",
            metadataScope: "global",
            label: "Loyalty Activity",
            pluralLabel: "Loyalty Activity",
            description: "Canonical loyalty earn, redemption, reversal and adjustment ledger.",
            sourceTable: "customer_loyalty_transactions",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", required: true, writable: false },
              { apiName: "transaction_type", label: "Entry Type", fieldType: "picklist", required: true, writable: false },
              { apiName: "amount", label: "Points", fieldType: "decimal", required: true, writable: false },
              { apiName: "balance_after", label: "Balance After", fieldType: "decimal", writable: false },
              { apiName: "reference_type", label: "Reference Type", fieldType: "text", writable: false },
              { apiName: "reference_id", label: "Reference", fieldType: "lookup", writable: false },
              { apiName: "description", label: "Reason", fieldType: "text", writable: false },
              { apiName: "created_by", label: "Operator", fieldType: "lookup", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
          {
            objectKey: "loyalty_adjustment",
            metadataScope: "global",
            label: "Loyalty Adjustment",
            pluralLabel: "Loyalty Adjustments",
            description: "Auditable manual loyalty adjustments.",
            sourceTable: "customer_loyalty_adjustments",
            fields: [
              { apiName: "company_id", label: "Company", fieldType: "lookup", required: true, writable: false },
              { apiName: "customer_id", label: "Customer", fieldType: "lookup", required: true, writable: false },
              { apiName: "points", label: "Points", fieldType: "decimal", required: true, writable: false },
              { apiName: "reason", label: "Reason", fieldType: "text", writable: false },
              { apiName: "reference_id", label: "Reference", fieldType: "lookup", writable: false },
              { apiName: "created_by", label: "Operator", fieldType: "lookup", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
            ],
          },
        ],
        relationships: [
          { parentObjectKey: "customer", childObjectKey: "loyalty_account", relationshipKey: "loyalty_account", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
          { parentObjectKey: "customer", childObjectKey: "loyalty_activity", relationshipKey: "loyalty_activity", relationshipType: "one_to_many", childFieldApiName: "customer_id" },
          { parentObjectKey: "loyalty_activity", childObjectKey: "customer", relationshipKey: "customer", relationshipType: "lookup", childFieldApiName: "customer_id" },
          { parentObjectKey: "loyalty_activity", childObjectKey: "sale", relationshipKey: "sale", relationshipType: "lookup", childFieldApiName: "reference_id", referenceType: "sale" },
          { parentObjectKey: "sale", childObjectKey: "loyalty_activity", relationshipKey: "loyalty_activity", relationshipType: "one_to_many", childFieldApiName: "reference_id", referenceType: "sale" },
        ],
        permissionDeclarations: [
          { key: "view", permission: "customer.view", access: "read" },
          { key: "adjust", permission: "loyalty.adjust", access: "execute" },
          { key: "configure", permission: "settings.manage", access: "write" },
        ],
        actions: [
          {
            actionKey: "loyalty.adjust",
            objectKey: "loyalty_account",
            label: "Adjust Loyalty",
            description: "Use the existing customer loyalty adjustment route and ledger.",
            handlerKey: "CUSTOMER_LOYALTY_ADJUST",
            requiredPermission: "loyalty.adjust",
          },
        ],
        listViews: [
          { objectKey: "loyalty_account", viewKey: "all", label: "Customer Loyalty", columns: ["customer_id", "balance", "updated_at"], isDefault: true },
          { objectKey: "loyalty_activity", viewKey: "all", label: "Loyalty Activity", columns: ["customer_id", "transaction_type", "amount", "reference_type", "created_at"], isDefault: true },
        ],
        references: [
          { packageKey: "retail_pos", objectKey: "sale", purpose: "Sale reference for earning, redemption and reversal activity" },
          { packageKey: "retail_pos", objectKey: "payment", purpose: "Loyalty redemption remains a Payment Core tender" },
        ],
      } : {}),
      ...(entry.key === "uber_eats" ? {
        objects: [
          {
            objectKey: "uber_eats_connection",
            metadataScope: "global",
            label: "Uber Eats Connection",
            pluralLabel: "Uber Eats Connections",
            description: "Tenant-scoped connection status for Uber Eats. Client credentials remain in the existing integration configuration and are not exposed as Platform fields.",
            sourceTable: "integrations",
            fields: [
              { apiName: "name", label: "Connection Name", fieldType: "text", writable: false },
              { apiName: "provider", label: "Provider", fieldType: "text", required: true, writable: false },
              { apiName: "active", label: "Active", fieldType: "boolean", writable: false },
              { apiName: "created_at", label: "Created", fieldType: "datetime", writable: false },
              { apiName: "updated_at", label: "Updated", fieldType: "datetime", writable: false },
            ],
          },
        ],
        permissionDeclarations: [
          { key: "connection_status", permission: "online_orders.view", access: "read" },
          { key: "connector_actions", permission: "online_orders.configure", access: "execute" },
          { key: "order_lifecycle", permission: "online_orders.manage", access: "execute" },
        ],
        actions: [
          {
            actionKey: "uber_eats.get_stores",
            objectKey: "uber_eats_connection",
            label: "Get Uber Eats Stores",
            description: "List stores available to the configured company connector.",
            handlerKey: "UBER_GET_STORES",
            requiredPermission: "online_orders.configure",
          },
          {
            actionKey: "uber_eats.test_connection",
            objectKey: "uber_eats_connection",
            label: "Test Uber Eats Connection",
            description: "Test connector credentials and discover accessible stores.",
            handlerKey: "UBER_TEST_CONNECTION",
            requiredPermission: "online_orders.configure",
          },
          {
            actionKey: "uber_eats.upload_menu",
            objectKey: "uber_eats_connection",
            label: "Upload Uber Eats Menu",
            description: "Publish explicitly Uber-enabled Product Master items.",
            handlerKey: "UBER_UPLOAD_MENU",
            requiredPermission: "online_orders.configure",
          },
          {
            actionKey: "uber_eats.accept_order",
            objectKey: "uber_eats_connection",
            label: "Accept Uber Eats Order",
            description: "Accept a company-scoped Uber Eats order through the online-order lifecycle.",
            handlerKey: "UBER_ACCEPT_ORDER",
            requiredPermission: "online_orders.manage",
          },
          {
            actionKey: "uber_eats.deny_order",
            objectKey: "uber_eats_connection",
            label: "Deny Uber Eats Order",
            description: "Deny a company-scoped Uber Eats order through the online-order lifecycle.",
            handlerKey: "UBER_DENY_ORDER",
            requiredPermission: "online_orders.manage",
          },
          {
            actionKey: "uber_eats.update_item_price",
            objectKey: "uber_eats_connection",
            label: "Update Uber Eats Item Price",
            description: "Push a mapped onePOS product price to its Uber Eats menu item.",
            handlerKey: "UBER_UPDATE_ITEM_PRICE",
            requiredPermission: "online_orders.configure",
          },
          {
            actionKey: "uber_eats.set_item_unavailable",
            objectKey: "uber_eats_connection",
            label: "Set Uber Eats Item Unavailable",
            description: "Temporarily suspend a mapped Uber Eats menu item.",
            handlerKey: "UBER_SET_ITEM_UNAVAILABLE",
            requiredPermission: "online_orders.configure",
          },
          {
            actionKey: "uber_eats.set_item_available",
            objectKey: "uber_eats_connection",
            label: "Set Uber Eats Item Available",
            description: "Remove the suspension from a mapped Uber Eats menu item.",
            handlerKey: "UBER_SET_ITEM_AVAILABLE",
            requiredPermission: "online_orders.configure",
          },
        ],
        buttons: [
          { buttonKey: "uber_eats_get_stores", objectKey: "uber_eats_connection", label: "Get Stores", actionKey: "uber_eats.get_stores", requiredPermission: "online_orders.configure", variant: "secondary" },
          { buttonKey: "uber_eats_test_connection", objectKey: "uber_eats_connection", label: "Test Connection", actionKey: "uber_eats.test_connection", requiredPermission: "online_orders.configure", variant: "secondary" },
          { buttonKey: "uber_eats_upload_menu", objectKey: "uber_eats_connection", label: "Upload Menu", actionKey: "uber_eats.upload_menu", requiredPermission: "online_orders.configure", variant: "primary" },
        ],
        mappingSchema: [
          {
            key: "store",
            scope: "company",
            source: "integrations.configuration.store_id",
            externalKey: "integrations.configuration.store_location_id",
            target: "stores.id",
            override: "company-selected-store",
          },
          {
            key: "product",
            scope: "company",
            source: "products.uber_item_id",
            externalKey: "Uber Eats item id",
            eligibility: "products.available_on_uber",
            override: "preserve-explicit-product-item-id",
          },
        ],
        workflows: [
          {
            key: "uber_eats_menu_sync_after_product_save",
            label: "Uber Eats menu sync after product save",
            objectKey: "product",
            triggerKey: "after_save",
            activeByDefault: false,
            conditions: [{ field: "available_on_uber", operator: "equals", value: true }],
            actions: [{ type: "UBER_UPLOAD_MENU" }],
          },
        ],
        forms: [
          {
            formKey: "uber_eats_connection",
            label: "Uber Eats Connection",
            permission: "online_orders.configure",
            fields: [
              { key: "environment", label: "Environment", source: "integrations.configuration.environment", editableBy: "existing-online-platform-settings" },
              { key: "client_id", label: "Client ID", source: "integrations.configuration.client_id", sensitive: true, editableBy: "existing-online-platform-settings" },
              { key: "client_secret", label: "Client Secret", source: "integrations.configuration.client_secret", sensitive: true, editableBy: "existing-online-platform-settings" },
              { key: "store_id", label: "onePOS Store", source: "integrations.configuration.store_id", editableBy: "existing-online-platform-settings" },
            ],
          },
        ],
        pages: [
          {
            pageKey: "uber_eats",
            label: "Uber Eats",
            routePath: "/app/custom/uber_eats",
            runtimeComponent: "uber_eats_settings",
            permissions: ["online_orders.view", "online_orders.configure"],
            definition: {
              presentation_mode: "landing",
              runtime_component: "uber_eats_settings",
              required_permissions: ["online_orders.view"],
              form_key: "uber_eats_connection",
              mapping_schema: [
                { key: "store", path: "integrations.configuration.store_id", external_key: "integrations.configuration.store_location_id" },
                { key: "product", path: "products.uber_item_id", eligibility: "products.available_on_uber" },
              ],
              forms: [
                { key: "environment", component_key: "picklist", source: "integrations.configuration.environment", permission: "online_orders.configure" },
                { key: "client_id", component_key: "text_input", source: "integrations.configuration.client_id", sensitive: true, permission: "online_orders.configure" },
                { key: "client_secret", component_key: "text_input", source: "integrations.configuration.client_secret", sensitive: true, permission: "online_orders.configure" },
                { key: "store_id", component_key: "lookup", source: "integrations.configuration.store_id", permission: "online_orders.configure" },
              ],
              sections: [
                { id: "uber-eats-connection", label: "Uber Eats Connection", columns: 1 },
                { id: "uber-eats-mapping", label: "Product Mapping", columns: 1 },
              ],
              components: [
                { id: "uber-eats-heading", section_id: "uber-eats-connection", component_key: "header", label: "Uber Eats" },
                { id: "uber-eats-settings", section_id: "uber-eats-connection", component_key: "text", label: "Manage credentials and store selection in the existing Online Platforms settings. Secrets are never displayed in this package page." },
                { id: "uber-eats-mapping-info", section_id: "uber-eats-mapping", component_key: "text", label: "Product availability and item IDs use the existing Product Master fields available_on_uber and uber_item_id." },
              ],
            },
          },
        ],
        listViews: [
          {
            objectKey: "uber_eats_connection",
            viewKey: "connection_status",
            label: "Connection Status",
            description: "Uber Eats connection status without exposing client credentials.",
            columns: ["name", "provider", "active", "updated_at"],
            filters: { provider: "uber" },
            isDefault: true,
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
      if (!(typeof dependency === "object" && dependency.optional === true)) {
        const required = byKey.get(dependencyKey);
        if (required && typeof dependency === "object") {
          const minVersion = dependency.minVersion || dependency.min_version;
          const maxVersion = dependency.maxVersion || dependency.max_version;
          if (minVersion && comparePackageVersions(required.version, minVersion) < 0) {
            throw new Error(`Package ${key} requires ${dependencyKey} version ${minVersion} or later`);
          }
          if (maxVersion && comparePackageVersions(required.version, maxVersion) > 0) {
            throw new Error(`Package ${key} requires ${dependencyKey} version ${maxVersion} or earlier`);
          }
          const versionRange = dependency.versionRange || dependency.version_range;
          if (versionRange && !satisfiesPackageVersion(required.version, versionRange)) {
            throw new Error(`Package ${key} requires ${dependencyKey} version range ${versionRange}`);
          }
        }
        visit(dependencyKey);
      }
    }

    visiting.delete(key);
    visited.add(key);
    ordered.push(pkg);
  }

  visit(packageKey);
  return ordered;
}

export function satisfiesPackageVersion(version, range) {
  const value = String(range || "").trim();
  if (!value) return true;
  const comparators = value.split(/\s*,\s*|\s+/).filter(Boolean);
  return comparators.every((comparator) => {
    const match = comparator.match(/^(>=|<=|>|<|=|\^|~)?(\d+\.\d+\.\d+(?:[-+].*)?)$/);
    if (!match) throw new Error(`Invalid package version range: ${range}`);
    const [, operator = "=", target] = match;
    const compared = comparePackageVersions(version, target);
    if (operator === ">=") return compared >= 0;
    if (operator === "<=") return compared <= 0;
    if (operator === ">") return compared > 0;
    if (operator === "<") return compared < 0;
    if (operator === "^") {
      const base = target.split(".").map(Number);
      const upper = base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
      return compared >= 0 && comparePackageVersions(version, upper.join(".")) < 0;
    }
    if (operator === "~") {
      const base = target.split(".").map(Number);
      const upper = [base[0], base[1] + 1, 0];
      return compared >= 0 && comparePackageVersions(version, upper.join(".")) < 0;
    }
    return compared === 0;
  });
}

export function comparePackageVersions(left, right) {
  const parse = (version) => {
    const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) throw new Error(`Invalid semantic package version: ${version}`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
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

export async function provisionPackageMetadata(db, { packageId, moduleId, companyId, manifest = {}, packageVersion = manifest.version || "1.0.0" }) {
  const objects = Array.isArray(manifest.objects) ? manifest.objects : [];
  const objectIds = new Map();

  for (const definition of objects) {
    const objectKey = definition?.objectKey || definition?.object_key || definition?.key;
    const objectCompanyId = definition.metadataScope === "global" ? null : companyId || null;
    if (!safeMetadataKey(objectKey)) throw new Error(`Invalid package object key: ${objectKey || "(missing)"}`);
    if (typeof definition.label !== "string" || !definition.label.trim()) {
      throw new Error(`Package object label is required: ${objectKey}`);
    }
    const sourceTable = definition.sourceTable || definition.source_table || null;
    const storeScoped = typeof definition.storeScoped === "boolean" ? definition.storeScoped : null;
    if (sourceTable && !safeMetadataKey(sourceTable)) throw new Error(`Invalid package source table: ${sourceTable}`);
    const existing = await db(
      "SELECT id,package_id,module_id,company_id FROM platform_objects WHERE object_key=$1",
      [objectKey]
    );
    let object;
    if (existing.rows.length) {
      object = existing.rows[0];
      if (object.package_id && object.package_id !== packageId) {
        const adoptable = Array.isArray(definition.adoptFromPackageKeys) ? definition.adoptFromPackageKeys : [];
        const owner = adoptable.length
          ? await db("SELECT package_key FROM package_registry WHERE id=$1", [object.package_id])
          : { rows: [] };
        if (!adoptable.includes(owner.rows[0]?.package_key)) {
          throw new Error(`Platform object is owned by another package: ${objectKey}`);
        }
      }
      if (!object.package_id) {
        const priorOwner = await db(
          "SELECT 1 FROM package_metadata_ownership WHERE metadata_type='object' AND metadata_id=$1 AND package_id=$2 AND managed=true",
          [object.id, packageId]
        );
        if (!priorOwner.rows.length) {
          throw new Error(`Package cannot take ownership of existing custom Platform object: ${objectKey}`);
        }
      }
      if (object.company_id && object.company_id !== objectCompanyId) {
        throw new Error(`Platform object belongs to another company: ${objectKey}`);
      }
      await db(
          "UPDATE platform_objects SET package_id=$1,module_id=COALESCE(module_id,$2),company_id=COALESCE(company_id,$3),label=CASE WHEN user_modified THEN label ELSE $4 END,plural_label=CASE WHEN user_modified THEN plural_label ELSE $5 END,description=CASE WHEN user_modified THEN description ELSE $6 END,source_table=CASE WHEN user_modified THEN source_table ELSE COALESCE($7,source_table) END,store_scoped=CASE WHEN user_modified OR $8::boolean IS NULL THEN store_scoped ELSE $8 END,source_package_version=$10,managed=true,package_required=$11,active=true,updated_at=NOW() WHERE id=$9 RETURNING *",
          [packageId, moduleId, objectCompanyId, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, sourceTable, storeScoped, object.id, packageVersion, definition.required === true]
      );
    } else {
      const result = await db(
        `INSERT INTO platform_objects
         (module_id,package_id,object_key,label,plural_label,description,company_id,source_table,store_scoped,source_package_version,managed,package_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11) RETURNING *`,
        [moduleId, packageId, objectKey, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, objectCompanyId, sourceTable, definition.storeScoped === true, packageVersion, definition.required === true]
      );
      object = result.rows[0];
    }
    objectIds.set(objectKey, object.id);

    for (const field of Array.isArray(definition.fields) ? definition.fields : []) {
      const fieldCompanyId = definition.fieldsMetadataScope === "global" || field.metadataScope === "global"
        ? null
        : companyId || null;
      const apiName = field?.apiName || field?.api_name;
      const sourceColumn = field?.sourceColumn || field?.source_column || null;
      if (!safeMetadataKey(apiName) || typeof field.label !== "string" || !field.label.trim()) {
        throw new Error(`Invalid package field on ${objectKey}`);
      }
      if (sourceColumn && !safeMetadataKey(sourceColumn)) {
        throw new Error(`Invalid package field source column on ${objectKey}.${apiName}`);
      }
      const existingField = await db(
        "SELECT id,company_id,source_package_id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3) ORDER BY company_id NULLS FIRST LIMIT 1",
        [object.id, apiName, fieldCompanyId]
      );
      if (existingField.rows.length) {
        if (existingField.rows[0].company_id && existingField.rows[0].company_id !== fieldCompanyId) {
          throw new Error(`Platform field belongs to another company: ${objectKey}.${apiName}`);
        }
        if (existingField.rows[0].source_package_id && existingField.rows[0].source_package_id !== packageId) {
          throw new Error(`Platform field is owned by another package: ${objectKey}.${apiName}`);
        }
        if (!existingField.rows[0].source_package_id) {
          const priorOwner = await db(
            "SELECT 1 FROM package_metadata_ownership WHERE metadata_type='field' AND metadata_id=$1 AND package_id=$2 AND managed=true",
            [existingField.rows[0].id, packageId]
          );
          if (!priorOwner.rows.length) {
            throw new Error(`Package cannot take ownership of existing custom Platform field: ${objectKey}.${apiName}`);
          }
        }
        await db(
          "UPDATE platform_fields SET label=CASE WHEN user_modified THEN label ELSE $1 END,field_type=CASE WHEN user_modified THEN field_type ELSE $2 END,source_column=CASE WHEN user_modified THEN source_column ELSE $3 END,required=$4,readable=CASE WHEN user_modified THEN readable ELSE $5 END,writable=CASE WHEN user_modified THEN writable ELSE $6 END,options=CASE WHEN user_modified THEN options ELSE $7::jsonb END,config=CASE WHEN user_modified THEN config ELSE $8::jsonb END,display_order=$9,company_id=COALESCE(company_id,$10),source_package_id=$12,source_package_version=$13,managed=true,package_required=$14,active=true WHERE id=$11",
          [field.label.trim(), field.fieldType || field.field_type || "text", sourceColumn, field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), Number(field.displayOrder ?? field.display_order ?? 0), fieldCompanyId, existingField.rows[0].id, packageId, packageVersion, field.required === true]
        );
      } else {
        await db(
          `INSERT INTO platform_fields
           (object_id,api_name,label,field_type,source_column,required,readable,writable,options,config,display_order,company_id,source_package_id,source_package_version,managed,package_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,true,$15)`,
          [object.id, apiName, field.label.trim(), field.fieldType || field.field_type || "text", field.sourceColumn || field.source_column || null, field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), Number(field.displayOrder ?? field.display_order ?? 0), fieldCompanyId, packageId, packageVersion, field.required === true]
        );
      }
    }
  }

  const layouts = [
    ...(Array.isArray(manifest.layouts) ? manifest.layouts : []),
    ...(Array.isArray(manifest.recordForms) ? manifest.recordForms.map((form) => ({
      ...form,
      layoutKey: form.layoutKey || form.layout_key || form.formKey || form.form_key,
    })) : []),
  ];
  for (const layout of layouts) {
    const objectId = objectIds.get(layout.objectKey || layout.object_key);
    const layoutKey = layout.layoutKey || layout.layout_key;
    const pageType = layout.pageType || layout.page_type;
    if (!objectId || !safeMetadataKey(layoutKey) || !["list", "detail", "view", "create", "edit", "quick_create"].includes(pageType) ||
        typeof layout.name !== "string" || !layout.name.trim() || !layout.definition || !Array.isArray(layout.definition.components)) {
      throw new Error("Package layouts and forms require an object, safe key, supported page type, name and component definition");
    }
    await db(
      `INSERT INTO platform_layouts
       (object_id,page_type,company_id,name,layout_key,definition,active,is_default,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,$7,$8,$9,true,$10)
       ON CONFLICT (object_id,page_type,layout_key) WHERE layout_key <> ''
       DO UPDATE SET company_id=EXCLUDED.company_id,name=EXCLUDED.name,definition=EXCLUDED.definition,
         active=true,is_default=EXCLUDED.is_default,source_package_id=EXCLUDED.source_package_id,
         source_package_version=EXCLUDED.source_package_version,managed=true,package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_layouts.user_modified=false
          OR platform_layouts.source_package_id=EXCLUDED.source_package_id`,
      [objectId, pageType, layout.metadataScope === "global" ? null : companyId || null, layout.name.trim(), layoutKey,
        JSON.stringify(layout.definition), layout.isDefault === true, packageId, packageVersion, layout.required === true]
    );
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
      const relationshipType = relationship.relationshipType || relationship.relationship_type || "lookup";
      const fieldObjectId = relationshipType === "lookup" ? parentObjectId : childObjectId;
      const fieldResult = await db(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3) LIMIT 1",
        [fieldObjectId, childFieldKey, companyId]
      );
      if (!fieldResult.rows[0]?.id) throw new Error(`Package relationship field not found: ${childFieldKey}`);
      if (relationshipType !== "lookup") childFieldId = fieldResult.rows[0].id;
    }
    const parentFieldKey = relationship.parentFieldApiName || relationship.parent_field_api_name;
    const relationshipType = relationship.relationshipType || relationship.relationship_type || "lookup";
    if (relationshipType === "lookup" && parentFieldKey) {
      const parentFieldResult = await db(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3) LIMIT 1",
        [parentObjectId, parentFieldKey, companyId]
      );
      if (!parentFieldResult.rows.length) throw new Error(`Package relationship field not found: ${parentFieldKey}`);
    }
    const registeredRelationship = await db(      `INSERT INTO platform_relationships
       (parent_object_id,child_object_id,relationship_key,relationship_type,child_field_id,active,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,true,$8)
       ON CONFLICT (parent_object_id,relationship_key)
       DO UPDATE SET child_object_id=EXCLUDED.child_object_id,relationship_type=EXCLUDED.relationship_type,child_field_id=EXCLUDED.child_field_id,source_package_version=EXCLUDED.source_package_version,managed=true,package_required=EXCLUDED.package_required,active=true
       WHERE platform_relationships.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [parentObjectId, childObjectId, relationship.relationshipKey || relationship.relationship_key, relationship.relationshipType || relationship.relationship_type || "lookup", childFieldId, packageId, packageVersion, relationship.required === true]
    );
    if (!registeredRelationship.rows?.length && registeredRelationship.rowCount === 0) {
      throw new Error(`Package relationship key is owned by another declaration: ${relationship.relationshipKey || relationship.relationship_key}`);
    }
  }

  for (const view of Array.isArray(manifest.listViews) ? manifest.listViews : []) {
    const objectId = objectIds.get(view.objectKey || view.object_key);
    if (!objectId || !safeMetadataKey(view.viewKey || view.view_key)) {
      throw new Error("Package list views must reference declared objects with safe keys");
    }
    const registeredView = await db(
      `INSERT INTO platform_list_views
       (object_id,company_id,view_key,label,description,columns,filters,sort,page_size,is_default,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,true,$13)
       ON CONFLICT (object_id,company_id,view_key)
       DO UPDATE SET label=CASE WHEN platform_list_views.user_modified THEN platform_list_views.label ELSE EXCLUDED.label END,
         description=CASE WHEN platform_list_views.user_modified THEN platform_list_views.description ELSE EXCLUDED.description END,
         columns=CASE WHEN platform_list_views.user_modified THEN platform_list_views.columns ELSE EXCLUDED.columns END,
         filters=CASE WHEN platform_list_views.user_modified THEN platform_list_views.filters ELSE EXCLUDED.filters END,
         sort=CASE WHEN platform_list_views.user_modified THEN platform_list_views.sort ELSE EXCLUDED.sort END,
         page_size=CASE WHEN platform_list_views.user_modified THEN platform_list_views.page_size ELSE EXCLUDED.page_size END,
         is_default=CASE WHEN platform_list_views.user_modified THEN platform_list_views.is_default ELSE EXCLUDED.is_default END,
         source_package_version=EXCLUDED.source_package_version,managed=true,package_required=EXCLUDED.package_required,
         active=CASE WHEN platform_list_views.user_modified THEN platform_list_views.active ELSE true END,
         updated_at=NOW()
       WHERE platform_list_views.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
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
        packageId,
        packageVersion,
        view.required === true,
      ]
    );
    if (!registeredView.rows?.length && registeredView.rowCount === 0) {
      throw new Error(`Package list view is owned by another declaration: ${view.viewKey || view.view_key}`);
    }
  }

  for (const page of Array.isArray(manifest.pages) ? manifest.pages : []) {
    const pageKey = page.pageKey || page.page_key;
    if (!safeMetadataKey(pageKey) || typeof page.label !== "string" || !page.label.trim()) {
      throw new Error("Package pages require a safe page key and label");
    }
    const appKey = `package_${String(packageId).replace(/-/g, "_")}`.slice(0, 100);
    const appResult = await db(
      `INSERT INTO platform_apps
       (company_id,app_key,label,description,active,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,true,$5,$6,true,$7)
       ON CONFLICT (company_id,app_key) DO UPDATE SET
         label=CASE WHEN platform_apps.user_modified THEN platform_apps.label ELSE EXCLUDED.label END,
         description=CASE WHEN platform_apps.user_modified THEN platform_apps.description ELSE EXCLUDED.description END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,
         active=CASE WHEN platform_apps.user_modified THEN platform_apps.active ELSE true END,
         updated_at=NOW()
       WHERE platform_apps.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [companyId || null, appKey, page.appLabel || page.label, page.description || null,
        packageId, packageVersion, page.required === true]
    );
    if (!appResult.rows.length) throw new Error(`Package page app key is owned by another declaration: ${appKey}`);
    await db(
      `INSERT INTO platform_pages
       (app_id,company_id,page_key,label,route_path,page_type,definition,active,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,'page',$6::jsonb,true,$7,$8,true,$9)
       ON CONFLICT (app_id,company_id,page_key) DO UPDATE SET
         label=CASE WHEN platform_pages.user_modified THEN platform_pages.label ELSE EXCLUDED.label END,
         route_path=CASE WHEN platform_pages.user_modified THEN platform_pages.route_path ELSE EXCLUDED.route_path END,
         definition=CASE WHEN platform_pages.user_modified THEN platform_pages.definition ELSE EXCLUDED.definition END,
         active=CASE WHEN platform_pages.user_modified THEN platform_pages.active ELSE true END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_pages.source_package_id=EXCLUDED.source_package_id`,
      [appResult.rows[0].id, companyId || null, pageKey, page.label.trim(),
        page.routePath || `/app/custom/${pageKey}`,
        JSON.stringify({ ...(page.definition || { presentation_mode: "landing", runtime_component: page.runtimeComponent || page.runtime_component || null, components: [] }), packageId }),
        packageId, packageVersion, page.required === true]
    );
  }

  for (const action of Array.isArray(manifest.actions) ? manifest.actions : []) {
    const objectId = objectIds.get(action.objectKey || action.object_key) || objectIds.values().next().value || null;
    const actionKey = action.actionKey || action.action_key;
    const handlerKey = action.handlerKey || action.handler_key;
    if (!objectId || !safeMetadataKey(String(actionKey || "").replace(/\./g, "_")) || !/^[A-Z][A-Z0-9_]{0,139}$/.test(handlerKey || "") || typeof action.label !== "string" || !action.label.trim()) {
      throw new Error("Package actions require a declared object, safe action key, registered handler key and label");
    }
    const registered = await db(
      `INSERT INTO platform_registered_actions
       (company_id,object_id,action_key,label,description,handler_key,required_permission,config,active,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,true,$9,$10,true,$11)
       ON CONFLICT (company_id,action_key) WHERE company_id IS NOT NULL
       DO UPDATE SET
         object_id=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.object_id ELSE EXCLUDED.object_id END,
         label=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.label ELSE EXCLUDED.label END,
         description=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.description ELSE EXCLUDED.description END,
         handler_key=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.handler_key ELSE EXCLUDED.handler_key END,
         required_permission=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.required_permission ELSE EXCLUDED.required_permission END,
         config=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.config ELSE COALESCE(platform_registered_actions.config,'{}'::jsonb) || EXCLUDED.config END,
         active=CASE WHEN platform_registered_actions.user_modified THEN platform_registered_actions.active ELSE true END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_registered_actions.config->>'packageOwned'='true'
         AND platform_registered_actions.config->>'packageId'=EXCLUDED.config->>'packageId'
       RETURNING id`,
      [companyId || null, objectId, actionKey, action.label.trim(), action.description || null,
        handlerKey, action.requiredPermission || action.required_permission || null,
        JSON.stringify({ ...(action.config || {}), packageOwned: true, packageId }), packageId, packageVersion,
        action.required === true]
    );
    if (!registered.rows.length) throw new Error(`Package action key is owned by another declaration: ${actionKey}`);
  }

  for (const button of Array.isArray(manifest.buttons) ? manifest.buttons : []) {
    const objectId = objectIds.get(button.objectKey || button.object_key) || objectIds.values().next().value || null;
    const actionKey = button.actionKey || button.action_key;
    if (!objectId || !safeMetadataKey(button.buttonKey || button.button_key) || typeof button.label !== "string" || !button.label.trim() || !actionKey) {
      throw new Error("Package buttons require a declared object, safe key, label and action target");
    }
    const registered = await db(
      `INSERT INTO platform_buttons
       (company_id,object_id,button_key,label,action_key,placement,visibility_rule,config,active,target_type,target_key,variant,required_permission,input_mappings,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,true,'action',$5,$9,$10,'{}'::jsonb,$11,$12,true,$13)
       ON CONFLICT (company_id,button_key) WHERE company_id IS NOT NULL
       DO UPDATE SET
         object_id=CASE WHEN platform_buttons.user_modified THEN platform_buttons.object_id ELSE EXCLUDED.object_id END,
         label=CASE WHEN platform_buttons.user_modified THEN platform_buttons.label ELSE EXCLUDED.label END,
         action_key=CASE WHEN platform_buttons.user_modified THEN platform_buttons.action_key ELSE EXCLUDED.action_key END,
         placement=CASE WHEN platform_buttons.user_modified THEN platform_buttons.placement ELSE EXCLUDED.placement END,
         visibility_rule=CASE WHEN platform_buttons.user_modified THEN platform_buttons.visibility_rule ELSE EXCLUDED.visibility_rule END,
         config=CASE WHEN platform_buttons.user_modified THEN platform_buttons.config ELSE COALESCE(platform_buttons.config,'{}'::jsonb) || EXCLUDED.config END,
         active=CASE WHEN platform_buttons.user_modified THEN platform_buttons.active ELSE true END,
         target_type=CASE WHEN platform_buttons.user_modified THEN platform_buttons.target_type ELSE 'action' END,
         target_key=CASE WHEN platform_buttons.user_modified THEN platform_buttons.target_key ELSE EXCLUDED.target_key END,
         variant=CASE WHEN platform_buttons.user_modified THEN platform_buttons.variant ELSE EXCLUDED.variant END,
         required_permission=CASE WHEN platform_buttons.user_modified THEN platform_buttons.required_permission ELSE EXCLUDED.required_permission END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_buttons.config->>'packageOwned'='true'
         AND platform_buttons.config->>'packageId'=EXCLUDED.config->>'packageId'
       RETURNING id`,
      [companyId || null, objectId, button.buttonKey || button.button_key,
        button.label.trim(), actionKey, button.placement || "record",
        JSON.stringify(button.visibilityRule || button.visibility_rule || {}),
        JSON.stringify({ packageOwned: true, packageId, ...(button.config || {}) }),
        button.variant || "primary", button.requiredPermission || button.required_permission || null,
        packageId, packageVersion, button.required === true]
    );
    if (!registered.rows.length) throw new Error(`Package button key is owned by another declaration: ${button.buttonKey || button.button_key}`);
  }

  const packageRules = [
    ...(Array.isArray(manifest.rules) ? manifest.rules : []),
    ...(Array.isArray(manifest.workflows) ? manifest.workflows.map((workflow) => ({
      ...workflow,
      name: workflow.name || workflow.label,
      action: {
        type: "workflow",
        match: workflow.match || "all",
        actions: workflow.actions || [],
      },
    })) : []),
  ];
  for (const rule of packageRules) {
    const objectKey = rule.objectKey || rule.object_key;
    let objectId = objectIds.get(objectKey);
    if (!objectId) {
      const external = await db(
        "SELECT id FROM platform_objects WHERE object_key=$1 AND (company_id IS NULL OR company_id=$2) LIMIT 1",
        [objectKey, companyId]
      );
      objectId = external.rows[0]?.id;
    }
    if (!objectId || typeof rule.name !== "string" || !safeMetadataKey(rule.triggerKey || rule.trigger_key)) {
      throw new Error("Package rules must reference declared objects with safe trigger keys");
    }
    const existingRule = await db(
      "SELECT id,action,source_package_id,user_modified FROM platform_rules WHERE object_id=$1 AND company_id IS NOT DISTINCT FROM $2 AND name=$3 LIMIT 1",
      [objectId, companyId || null, rule.name.trim()]
    );
    const ruleAction = { ...(rule.action || {}), packageKey: manifest.packageKey || rule.packageKey };
    if (existingRule.rows.length) {
      if (existingRule.rows[0].source_package_id !== packageId) {
        throw new Error(`Package workflow name is owned by another declaration: ${rule.name}`);
      }
      if (existingRule.rows[0].user_modified) continue;
      await db(
        `UPDATE platform_rules
            SET trigger_key=CASE WHEN user_modified THEN trigger_key ELSE $1 END,
                conditions=CASE WHEN user_modified THEN conditions ELSE $2::jsonb END,
                action=CASE WHEN user_modified THEN action ELSE $3::jsonb END,
                active=CASE WHEN user_modified THEN active ELSE $4 END,
                lifecycle_status=CASE WHEN user_modified THEN lifecycle_status ELSE $5 END,
                source_package_version=$6,managed=true,package_required=$7,
                updated_at=NOW()
          WHERE id=$8 AND source_package_id=$9`,
        [rule.triggerKey || rule.trigger_key, JSON.stringify(rule.conditions || []), JSON.stringify(ruleAction),
          rule.action?.type === "validation" && rule.active === true,
          rule.action?.type === "validation" && rule.active === true ? "ACTIVE" : "INACTIVE",
          packageVersion, rule.required === true, existingRule.rows[0].id, packageId]
      );
      continue;
    }
    await db(
      `INSERT INTO platform_rules
       (object_id,name,trigger_key,conditions,action,active,company_id,lifecycle_status,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,true,$11)`,
      [
        objectId,
        rule.name.trim(),
        rule.triggerKey || rule.trigger_key,
        JSON.stringify(rule.conditions || []),
        JSON.stringify(ruleAction),
        rule.action?.type === "validation" && rule.active === true,
        companyId || null,
        rule.action?.type === "validation" && rule.active === true ? "ACTIVE" : "INACTIVE",
        packageId,
        packageVersion,
        rule.required === true,
      ]
    );
  }

  const forms = [
    ...(Array.isArray(manifest.forms) ? manifest.forms.filter((form) =>
      (form.objectKey || form.object_key) && form.definition && typeof form.definition === "object"
    ).map((form) => ({
      ...form,
      pageType: form.pageType || form.page_type || "edit",
    })) : []),
  ];
  for (const layout of forms) {
    const objectId = objectIds.get(layout.objectKey || layout.object_key);
    const pageType = layout.pageType || layout.page_type;
    const layoutKey = layout.layoutKey || layout.layout_key || layout.name;
    if (!objectId || !["list", "detail", "view", "create", "edit", "quick_create"].includes(pageType) ||
        !safeMetadataKey(String(layoutKey || "").replace(/-/g, "_")) ||
        typeof layout.name !== "string" || !layout.name.trim() ||
        !layout.definition || typeof layout.definition !== "object") {
      throw new Error("Package forms and layouts require a declared object, safe key, name, page type, and definition");
    }
    const registered = await db(
      `INSERT INTO platform_layouts
       (object_id,page_type,company_id,name,layout_key,definition,active,is_default,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,$7,$8,$9,true,$10)
       ON CONFLICT (object_id,page_type,role_id,company_id)
       DO UPDATE SET name=CASE WHEN platform_layouts.user_modified THEN platform_layouts.name ELSE EXCLUDED.name END,
         layout_key=EXCLUDED.layout_key,
         definition=CASE WHEN platform_layouts.user_modified THEN platform_layouts.definition ELSE EXCLUDED.definition END,
         active=CASE WHEN platform_layouts.user_modified THEN platform_layouts.active ELSE true END,
         is_default=CASE WHEN platform_layouts.user_modified THEN platform_layouts.is_default ELSE EXCLUDED.is_default END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required
       WHERE platform_layouts.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [objectId, pageType, companyId || null, layout.name.trim(), layoutKey,
        JSON.stringify(layout.definition), layout.isDefault === true, packageId,
        packageVersion, layout.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package layout is owned by another declaration: ${layoutKey}`);
    }
  }

  for (const report of Array.isArray(manifest.reports) ? manifest.reports : []) {
    const objectId = objectIds.get(report.objectKey || report.object_key);
    const reportKey = report.reportKey || report.report_key;
    if (!objectId || !safeMetadataKey(reportKey) || typeof report.label !== "string" || !report.label.trim()) {
      throw new Error("Package reports require a declared object, safe report key, and label");
    }
    const registered = await db(
      `INSERT INTO platform_reports
       (object_id,company_id,report_key,label,description,config,active,source_package_id,
        source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,true,$7,$8,true,$9)
       ON CONFLICT (object_id,company_id,report_key)
       DO UPDATE SET label=CASE WHEN platform_reports.user_modified THEN platform_reports.label ELSE EXCLUDED.label END,
         description=CASE WHEN platform_reports.user_modified THEN platform_reports.description ELSE EXCLUDED.description END,
         config=CASE WHEN platform_reports.user_modified THEN platform_reports.config ELSE EXCLUDED.config END,
         active=CASE WHEN platform_reports.user_modified THEN platform_reports.active ELSE true END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required
       WHERE platform_reports.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [objectId, companyId || null, reportKey, report.label.trim(), report.description || null,
        JSON.stringify(report.config || {}), packageId, packageVersion, report.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package report is owned by another declaration: ${reportKey}`);
    }
  }

  for (const connector of Array.isArray(manifest.connectors) ? manifest.connectors : []) {
    const connectorKey = connector.connectorKey || connector.connector_key;
    const baseUrl = connector.baseUrl || connector.base_url;
    let parsedUrl;
    try { parsedUrl = new URL(baseUrl); } catch { parsedUrl = null; }
    if (!safeMetadataKey(String(connectorKey || "").replace(/[.-]/g, "_")) ||
        typeof connector.name !== "string" || !connector.name.trim() ||
        !parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Package connectors require a safe key, name, and HTTP(S) base URL");
    }
    const registered = await db(
      `INSERT INTO platform_connector_definitions
       (connector_key,name,description,publisher,auth_type,base_url,credentials_schema,operations,
        timeout_ms,retry_policy,status,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,'ACTIVE',$11,$12,true,$13)
       ON CONFLICT(connector_key)
       DO UPDATE SET name=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.name ELSE EXCLUDED.name END,
         description=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.description ELSE EXCLUDED.description END,
         auth_type=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.auth_type ELSE EXCLUDED.auth_type END,
         base_url=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.base_url ELSE EXCLUDED.base_url END,
         credentials_schema=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.credentials_schema ELSE EXCLUDED.credentials_schema END,
         operations=CASE WHEN platform_connector_definitions.user_modified THEN platform_connector_definitions.operations ELSE EXCLUDED.operations END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_connector_definitions.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [connectorKey, connector.name.trim(), connector.description || null, connector.publisher || null,
        connector.authType || connector.auth_type || "none", parsedUrl.toString(),
        JSON.stringify(connector.credentialsSchema || connector.credentials_schema || []),
        JSON.stringify(connector.operations || []),
        Number.isInteger(connector.timeoutMs || connector.timeout_ms) ? (connector.timeoutMs || connector.timeout_ms) : 15000,
        JSON.stringify(connector.retryPolicy || connector.retry_policy || { maxAttempts: 3, backoffMs: 1000 }),
        packageId, packageVersion, connector.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package connector is owned by another declaration: ${connectorKey}`);
    }
  }

  if (Array.isArray(manifest.templates) && manifest.templates.length && !companyId) {
    throw new Error("Package message templates require a company installation scope");
  }
  for (const template of Array.isArray(manifest.templates) ? manifest.templates : []) {
    const apiKey = template.apiKey || template.api_key || template.templateKey || template.template_key;
    const channel = String(template.channel || "").toUpperCase();
    if (!safeMetadataKey(apiKey) || typeof template.name !== "string" || !template.name.trim() ||
        !["EMAIL", "SMS", "WHATSAPP"].includes(channel) || typeof template.body !== "string" || !template.body.trim()) {
      throw new Error("Package templates require a safe key, name, supported channel, and body");
    }
    const registered = await db(
      `INSERT INTO platform_message_templates
       (company_id,name,api_key,description,channel,subject,body,active,created_by,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,NULL,$8,$9,true,$10)
       ON CONFLICT(company_id,api_key)
       DO UPDATE SET name=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.name ELSE EXCLUDED.name END,
         description=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.description ELSE EXCLUDED.description END,
         channel=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.channel ELSE EXCLUDED.channel END,
         subject=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.subject ELSE EXCLUDED.subject END,
         body=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.body ELSE EXCLUDED.body END,
         active=CASE WHEN platform_message_templates.user_modified THEN platform_message_templates.active ELSE true END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required,updated_at=NOW()
       WHERE platform_message_templates.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [companyId, template.name.trim(), apiKey, template.description || null, channel,
        template.subject || null, template.body, packageId, packageVersion,
        template.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package template key is owned by another declaration: ${apiKey}`);
    }
  }

  for (const permission of Array.isArray(manifest.objectPermissions) ? manifest.objectPermissions : []) {
    const objectId = objectIds.get(permission.objectKey || permission.object_key);
    const roleId = permission.roleId || permission.role_id;
    if (!objectId || !roleId || !companyId) {
      throw new Error("Package object permissions require a declared object, role, and company scope");
    }
    const role = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [roleId, companyId]);
    if (!role.rows.length) throw new Error(`Package permission role is not available: ${roleId}`);
    const registered = await db(
      `INSERT INTO platform_object_permissions
       (object_id,role_id,company_id,can_view,can_create,can_edit,can_delete,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)
       ON CONFLICT(object_id,role_id,company_id)
       DO UPDATE SET can_view=CASE WHEN platform_object_permissions.user_modified THEN platform_object_permissions.can_view ELSE EXCLUDED.can_view END,
         can_create=CASE WHEN platform_object_permissions.user_modified THEN platform_object_permissions.can_create ELSE EXCLUDED.can_create END,
         can_edit=CASE WHEN platform_object_permissions.user_modified THEN platform_object_permissions.can_edit ELSE EXCLUDED.can_edit END,
         can_delete=CASE WHEN platform_object_permissions.user_modified THEN platform_object_permissions.can_delete ELSE EXCLUDED.can_delete END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required
       WHERE platform_object_permissions.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [objectId, roleId, companyId, permission.canView !== false, permission.canCreate === true,
        permission.canEdit === true, permission.canDelete === true, packageId,
        packageVersion, permission.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package permission is owned by another declaration for role: ${roleId}`);
    }
  }

  for (const permission of Array.isArray(manifest.fieldPermissions) ? manifest.fieldPermissions : []) {
    const objectId = objectIds.get(permission.objectKey || permission.object_key);
    const fieldApiName = permission.fieldApiName || permission.field_api_name;
    const roleId = permission.roleId || permission.role_id;
    if (!objectId || !safeMetadataKey(fieldApiName) || !roleId || !companyId) {
      throw new Error("Package field permissions require a declared field, role, and company scope");
    }
    const field = await db(
      "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3)",
      [objectId, fieldApiName, companyId]
    );
    if (!field.rows.length) throw new Error(`Package permission field is not available: ${fieldApiName}`);
    const role = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [roleId, companyId]);
    if (!role.rows.length) throw new Error(`Package permission role is not available: ${roleId}`);
    const registered = await db(
      `INSERT INTO platform_field_security
       (field_id,role_id,company_id,readable,writable,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8)
       ON CONFLICT(field_id,role_id,company_id)
       DO UPDATE SET readable=CASE WHEN platform_field_security.user_modified THEN platform_field_security.readable ELSE EXCLUDED.readable END,
         writable=CASE WHEN platform_field_security.user_modified THEN platform_field_security.writable ELSE EXCLUDED.writable END,
         source_package_version=EXCLUDED.source_package_version,managed=true,
         package_required=EXCLUDED.package_required
       WHERE platform_field_security.source_package_id=EXCLUDED.source_package_id
       RETURNING id`,
      [field.rows[0].id, roleId, companyId, permission.readable !== false,
        permission.writable === true, packageId, packageVersion, permission.required === true]
    );
    if (!registered.rows?.length && registered.rowCount === 0) {
      throw new Error(`Package field permission is owned by another declaration: ${fieldApiName}`);
    }
  }

  for (const event of Array.isArray(manifest.events) ? manifest.events : []) {
    const eventType = String(event.eventType || event.event_type || "").trim();
    if (!eventType || eventType.length > 200) throw new Error("Package events require an event type of 1 to 200 characters");
    const registered = await db(
      `INSERT INTO platform_event_types(event_type,description,source_package_id,active)
       VALUES($1,$2,$3,TRUE)
       ON CONFLICT(event_type) DO UPDATE SET description=EXCLUDED.description,source_package_id=EXCLUDED.source_package_id,active=TRUE
       WHERE platform_event_types.source_package_id IS NULL OR platform_event_types.source_package_id=EXCLUDED.source_package_id
       RETURNING event_type`,
      [eventType, event.description || null, packageId]
    );
    if (!registered.rows.length) throw new Error(`Package event type is owned by another declaration: ${eventType}`);
  }

  const ownedPermissionCodes = manifest.metadataOwnership?.permissions;
  if (Array.isArray(ownedPermissionCodes) && ownedPermissionCodes.length) {
    const permissions = await db(
      "SELECT id,code FROM permissions WHERE code=ANY($1::text[])",
      [ownedPermissionCodes]
    );
    const permissionsByCode = new Map(permissions.rows.map((permission) => [permission.code, permission]));
    for (const code of ownedPermissionCodes) {
      const permission = permissionsByCode.get(code);
      if (!permission) throw new Error(`Package permission is not seeded: ${code}`);
      await db(
        `INSERT INTO package_metadata_ownership
         (package_id,package_version,metadata_type,metadata_id,managed,package_required,default_snapshot)
         VALUES ($1,$2,'permission',$3,true,true,$4::jsonb)
         ON CONFLICT(package_id,metadata_type,metadata_id) DO UPDATE SET
           package_version=EXCLUDED.package_version,managed=true,package_required=true,updated_at=NOW()`,
        [packageId, packageVersion, permission.id, JSON.stringify({ code })]
      );
    }
  }

  const ownedMetadata = await db(
    `WITH owned AS (
       SELECT 'object'::text AS metadata_type,o.id,o.package_required,o.user_modified,to_jsonb(o) AS snapshot
         FROM platform_objects o WHERE o.package_id=$1
       UNION ALL
       SELECT 'field',f.id,f.package_required,f.user_modified,to_jsonb(f)
         FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id
        WHERE o.package_id=$1 OR f.source_package_id=$1
       UNION ALL
       SELECT 'relationship',r.id,r.package_required,r.user_modified,to_jsonb(r)
         FROM platform_relationships r WHERE r.source_package_id=$1
       UNION ALL
       SELECT CASE WHEN l.page_type IN ('create','edit','quick_create') THEN 'form' ELSE 'layout' END,
              l.id,l.package_required,l.user_modified,to_jsonb(l)
         FROM platform_layouts l WHERE l.source_package_id=$1
       UNION ALL
       SELECT CASE WHEN r.action->>'type'='validation' THEN 'validation' ELSE 'workflow' END,
              r.id,r.package_required,r.user_modified,to_jsonb(r)
         FROM platform_rules r WHERE r.source_package_id=$1
       UNION ALL
       SELECT 'report',r.id,r.package_required,r.user_modified,to_jsonb(r)
         FROM platform_reports r WHERE r.source_package_id=$1
       UNION ALL
       SELECT 'action',a.id,a.package_required,a.user_modified,to_jsonb(a)
         FROM platform_registered_actions a
        WHERE a.source_package_id=$1 OR a.config->>'packageId'=$1::text
       UNION ALL
       SELECT 'button',b.id,b.package_required,b.user_modified,to_jsonb(b)
         FROM platform_buttons b
        WHERE b.source_package_id=$1 OR b.config->>'packageId'=$1::text
       UNION ALL
       SELECT 'list_view',v.id,v.package_required,v.user_modified,to_jsonb(v)
         FROM platform_list_views v WHERE v.source_package_id=$1
       UNION ALL
       SELECT 'permission',p.id,p.package_required,p.user_modified,to_jsonb(p)
         FROM platform_object_permissions p WHERE p.source_package_id=$1
       UNION ALL
       SELECT 'field_permission',p.id,p.package_required,p.user_modified,to_jsonb(p)
         FROM platform_field_security p WHERE p.source_package_id=$1
       UNION ALL
       SELECT 'connector',c.id,c.package_required,c.user_modified,to_jsonb(c)
         FROM platform_connector_definitions c WHERE c.source_package_id=$1
       UNION ALL
       SELECT 'template',t.id,t.package_required,t.user_modified,to_jsonb(t)
         FROM platform_message_templates t WHERE t.source_package_id=$1
       UNION ALL
       SELECT 'app',a.id,a.package_required,a.user_modified,to_jsonb(a)
         FROM platform_apps a WHERE a.source_package_id=$1
       UNION ALL
       SELECT 'page',p.id,p.package_required,p.user_modified,to_jsonb(p)
         FROM platform_pages p WHERE p.source_package_id=$1
       UNION ALL
       SELECT 'page',p.id,false,false,to_jsonb(p) FROM platform_pages p
         JOIN platform_apps a ON a.id=p.app_id
        WHERE a.app_key=('package_' || replace($1::text,'-','_'))
     )
     INSERT INTO package_metadata_ownership
       (package_id,package_version,metadata_type,metadata_id,managed,package_required,user_modified,default_snapshot)
     SELECT $1,$2,metadata_type,id,true,package_required,user_modified,
            jsonb_build_object('packageVersion',$2,'metadata',snapshot)
       FROM owned
     ON CONFLICT(package_id,metadata_type,metadata_id) DO UPDATE SET
       package_version=EXCLUDED.package_version,managed=true,
       package_required=EXCLUDED.package_required,
       user_modified=package_metadata_ownership.user_modified OR EXCLUDED.user_modified,
       default_snapshot=EXCLUDED.default_snapshot,updated_at=NOW()`,
    [packageId, packageVersion]
  );
  await db(
    `UPDATE package_metadata_ownership
        SET managed=false,updated_at=NOW()
      WHERE package_id=$1 AND package_version<>$2 AND managed=true`,
    [packageId, packageVersion]
  );
  for (const table of [
    "platform_objects",
    "platform_fields",
    "platform_relationships",
    "platform_layouts",
    "platform_rules",
    "platform_reports",
    "platform_list_views",
    "platform_object_permissions",
    "platform_field_security",
    "platform_connector_definitions",
    "platform_message_templates",
    "platform_apps",
    "platform_pages",
    "platform_registered_actions",
    "platform_buttons",
  ]) {
    const ownerColumn = table === "platform_objects" ? "package_id" : "source_package_id";
    await db(
      `UPDATE ${table} metadata SET managed=false
        WHERE metadata.${ownerColumn}=$1 AND metadata.source_package_version IS DISTINCT FROM $2
          AND NOT EXISTS (
            SELECT 1 FROM package_metadata_ownership owner
             WHERE owner.package_id=$1 AND owner.metadata_id=metadata.id
               AND owner.package_version=$2 AND owner.managed=true
          )`,
      [packageId, packageVersion]
    );
  }
  return { objects: objectIds.size, ownedMetadata: ownedMetadata.rowCount || 0 };
}

export async function provisionDefaultCompanyPackages(db, { companyId, installedBy = null, packageKeys = ["staff", "retail_pos", "products", "customers"] }) {
  for (const packageKey of packageKeys) {
    const packageResult = await db(
      `SELECT p.id, p.version, p.module_id, p.manifest
       FROM package_registry p
       WHERE p.package_key=$1 AND p.active=true`,
      [packageKey]
    );
    if (!packageResult.rows.length) continue;
    const pkg = packageResult.rows[0];
    if (packageKey === "products") {
      await provisionPackageMetadata(db, {
        packageId: pkg.id,
        moduleId: pkg.module_id,
        companyId,
        manifest: pkg.manifest || {},
        packageVersion: pkg.version,
      });
    }
    await db(
      `INSERT INTO company_package_installations
       (company_id,package_id,version,status,installed_by,installation_type)
       VALUES ($1,$2,$3,'active',$4,'PLATFORM_DEFAULT')
       ON CONFLICT (company_id,package_id) DO NOTHING`,
      [companyId, pkg.id, pkg.version, installedBy]
    );
    await db(
      `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,metadata)
       VALUES ($1,$2,'PLATFORM_DEFAULT',$3,true,$4::jsonb)
       ON CONFLICT(company_id,package_id,source_type,source_key)
       DO UPDATE SET active=true,metadata=EXCLUDED.metadata`,
      [companyId, pkg.id, `platform-default:${pkg.id}`, JSON.stringify({ installationType: "PLATFORM_DEFAULT" })]
    );
    if (packageKey === "staff" || packageKey === "products") {
      await provisionPackageMetadata(db, {
        packageId: pkg.id,
        moduleId: pkg.module_id,
        companyId,
        manifest: pkg.manifest || {},
        packageVersion: pkg.version,
      });
    }
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

export async function removePackageMetadata(db, { companyId, packageId }) {
  const ownership = await db(
    `SELECT metadata_type,metadata_id
       FROM package_metadata_ownership
      WHERE package_id=$1 AND managed=true AND package_required=false AND user_modified=false`,
    [packageId]
  );
  const removable = new Map();
  for (const row of ownership.rows) {
    const ids = removable.get(row.metadata_type) || [];
    ids.push(row.metadata_id);
    removable.set(row.metadata_type, ids);
  }
  const scopedDelete = (table, type, ownerColumn = "source_package_id") => {
    const ids = removable.get(type) || [];
    if (!ids.length) return Promise.resolve({ rowCount: 0 });
    if (table === "platform_relationships") return Promise.resolve({ rowCount: 0 });
    return db(
      `DELETE FROM ${table}
        WHERE id=ANY($1::uuid[]) AND ${ownerColumn}=$2 AND company_id=$3
        RETURNING id`,
      [ids, packageId, companyId]
    );
  };
  const removedIds = [];
  const removeScoped = async (table, type, ownerColumn) => {
    const ids = removable.get(type) || [];
    if (!ids.length) return;
    const result = await scopedDelete(table, type, ownerColumn);
    removedIds.push(...(result.rows || []).map((row) => row.id));
  };

  for (const type of ["field_permission", "permission"]) {
    await removeScoped(type === "permission" ? "platform_object_permissions" : "platform_field_security", type);
  }
  await removeScoped("platform_layouts", "form");
  await removeScoped("platform_layouts", "layout");
  await removeScoped("platform_rules", "workflow");
  await removeScoped("platform_reports", "report");
  await removeScoped("platform_list_views", "list_view");
  await removeScoped("platform_registered_actions", "action");
  await removeScoped("platform_buttons", "button");
  await removeScoped("platform_pages", "page");
  await removeScoped("platform_apps", "app");
  // Connector definitions are global and may be referenced by retained
  // connection configuration or encrypted credentials after an app uninstall.
  await removeScoped("platform_message_templates", "template");
  await removeScoped("platform_relationships", "relationship");
  await removeScoped("platform_fields", "field");

  const objectIds = removable.get("object") || [];
  if (objectIds.length) {
    const deletedObjects = await db(
      `DELETE FROM platform_objects o
        WHERE o.id=ANY($1::uuid[]) AND o.package_id=$3
          AND o.managed=true AND o.package_required=false AND o.user_modified=false
          AND o.company_id=$2
          AND NOT EXISTS (
            SELECT 1 FROM platform_relationships r
             WHERE (r.parent_object_id=o.id OR r.child_object_id=o.id)
               AND r.source_package_id IS DISTINCT FROM $3
          )
          AND NOT EXISTS (
            SELECT 1 FROM platform_fields f WHERE f.object_id=o.id
              AND f.source_package_id IS DISTINCT FROM $3
          )
          AND NOT EXISTS (
            SELECT 1 FROM platform_layouts l WHERE l.object_id=o.id
              AND l.source_package_id IS DISTINCT FROM $3
          )
          AND NOT EXISTS (
            SELECT 1 FROM platform_reports r WHERE r.object_id=o.id
              AND r.source_package_id IS DISTINCT FROM $3
          )
        RETURNING o.id`,
        [objectIds, companyId, packageId]
    );
    removedIds.push(...(deletedObjects.rows || []).map((row) => row.id));
  }

  if (removedIds.length) {
    await db(
      `DELETE FROM package_metadata_ownership
        WHERE package_id=$1 AND metadata_id=ANY($2::uuid[])`,
      [packageId, [...new Set(removedIds)]]
    );
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
        `INSERT INTO package_registry
         (package_key,name,version,description,module_id,manifest,package_type,publisher,category,visible,installable,billable,system_only,display_order,publication_state,licence_mode,available_tiers)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
         ON CONFLICT (package_key) DO UPDATE SET
           name=EXCLUDED.name, version=EXCLUDED.version, description=EXCLUDED.description,
           module_id=EXCLUDED.module_id, manifest=EXCLUDED.manifest, package_type=EXCLUDED.package_type,
           publisher=EXCLUDED.publisher,licence_mode=EXCLUDED.licence_mode,
           active=TRUE,updated_at=NOW()`,
        [
          definition.packageKey, definition.name, definition.version, definition.description,
          moduleResult.rows[0].id, JSON.stringify(definition.manifest),
          definition.manifest.packageType, definition.manifest.publisher, definition.manifest.category,
          definition.manifest.visibility !== "HIDDEN", definition.manifest.installable !== false,
          definition.manifest.billable !== false, definition.manifest.systemOnly === true,
          Number(definition.manifest.displayOrder || 0), definition.manifest.lifecycleState || "PUBLISHED",
          definition.manifest.licenceMode, JSON.stringify(definition.manifest.availableTiers || []),
        ]
      );
      }
      for (const definition of definitions) {
      const packageResult = await pool.query("SELECT id FROM package_registry WHERE package_key=$1", [definition.packageKey]);
      if (!packageResult.rows.length) continue;
      await pool.query("DELETE FROM package_dependencies WHERE package_id=$1", [packageResult.rows[0].id]);
      const dependencies = [
        ...definition.dependencies,
        ...definition.manifest.optionalDependencies.map((dependency) => (
          typeof dependency === "string" ? { packageKey: dependency, optional: true } : { ...dependency, optional: true }
        )),
      ];
      for (const dependency of dependencies) {
        const dependencyKey = typeof dependency === "string" ? dependency : dependency.packageKey || dependency.package_key;
        const dependencyResult = await pool.query("SELECT id FROM package_registry WHERE package_key=$1", [dependencyKey]);
        if (!dependencyResult.rows.length) throw new Error(`Package dependency not found: ${dependencyKey}`);
        await pool.query(
          `INSERT INTO package_dependencies
           (package_id,dependency_id,version_range,min_version,max_version,optional)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            packageResult.rows[0].id,
            dependencyResult.rows[0].id,
            typeof dependency === "string" ? null : dependency.versionRange || dependency.version_range || null,
            typeof dependency === "string" ? null : dependency.minVersion || dependency.min_version || null,
            typeof dependency === "string" ? null : dependency.maxVersion || dependency.max_version || null,
            typeof dependency === "string" ? false : dependency.optional === true,
          ]
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
