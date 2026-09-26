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
    uber_eats: "Uber Eats",
    supplier_core: "Supplier Core",
  };
  const packageDescriptions = {
    retail_pos: "Sales, payments, returns and order processing.",
    products: "The canonical product catalogue and product references.",
    inventory: "Stock, replenishment and inventory movements.",
    batch_expiry: "Batch stock, expiry tracking and FEFO inventory controls.",
    hospitality: "Floor plans, tables and reservations.",
    kds: "Kitchen display tickets and preparation status.",
    customer_credit: "Customer credit accounts, payments and protected credit controls.",
    suppliers: "Supplier purchasing operations.",
    customers: "Customer records and customer activity.",
    staff: "Employees, users, roles and store access.",
    reports: "Operational and custom report administration.",
    platform: "Customer-configurable Platform metadata and builders.",
    online_orders: "Online order intake and preparation.",
    integrations: "External delivery, payment and communication integrations.",
    uber_eats: "Uber Eats connection and online order integration.",
    supplier_core: "Canonical supplier identity and supplier-product sourcing metadata.",
  };
  const entitlementKeys = {
    retail_pos: "pos", products: "pos", inventory: "inventory", batch_expiry: "batch_expiry",
    hospitality: "hospitality", kds: "kds", customer_credit: "credit_control", suppliers: "purchasing", customers: "customers", staff: "staff",
    reports: "reports", online_orders: "online_orders", integrations: "integrations",
    uber_eats: "integrations", platform: "platform",
  };
  const dependencies = {
    retail_pos: ["products"],
    inventory: ["products"],
    batch_expiry: ["inventory", "products"],
    hospitality: ["retail_pos", "customers"],
    kds: ["hospitality", "retail_pos"],
    customer_credit: ["customers", "retail_pos"],
    suppliers: ["supplier_core"],
    reports: [],
    platform: [],
    uber_eats: ["integrations", "online_orders"],
  };
  const packageType = entry.packageType === "FOUNDATION" || entry.technical === true
    ? "FOUNDATION"
    : "APPLICATION";
  const billable = packageType === "APPLICATION" && entry.billable !== false;
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
      licenceRequired: billable,
      billable,
      visibility: entry.visibility || (packageType === "FOUNDATION" ? "HIDDEN" : "PUBLIC"),
      installable: entry.installable !== false,
      systemOnly: entry.systemOnly === true || packageType === "FOUNDATION",
      permissions: entry.permissions,
      storeScoped: entry.storeScoped === true,
      category: entry.category,
      dependencies: Array.isArray(entry.dependencies) ? entry.dependencies : (dependencies[entry.key] || []),
      optionalFeatures: Array.isArray(entry.optionalFeatures) ? entry.optionalFeatures : [],
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities : [entry.key],
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
      if (object.company_id && object.company_id !== objectCompanyId) {
        throw new Error(`Platform object belongs to another company: ${objectKey}`);
      }
      await db(
          "UPDATE platform_objects SET package_id=$1,module_id=COALESCE(module_id,$2),company_id=COALESCE(company_id,$3),label=CASE WHEN user_modified THEN label ELSE $4 END,plural_label=CASE WHEN user_modified THEN plural_label ELSE $5 END,description=CASE WHEN user_modified THEN description ELSE $6 END,source_package_version=$8,managed=true,package_required=$9,active=true,updated_at=NOW() WHERE id=$7 RETURNING *",
          [packageId, moduleId, objectCompanyId, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, object.id, packageVersion, definition.required === true]
      );
    } else {
      const result = await db(
        `INSERT INTO platform_objects
         (module_id,package_id,object_key,label,plural_label,description,company_id,source_table,source_package_version,managed,package_required)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING *`,
        [moduleId, packageId, objectKey, definition.label.trim(), definition.pluralLabel || definition.plural_label || null, definition.description || null, objectCompanyId, definition.sourceTable || definition.source_table || null, packageVersion, definition.required === true]
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
          "UPDATE platform_fields SET label=CASE WHEN user_modified THEN label ELSE $1 END,field_type=CASE WHEN user_modified THEN field_type ELSE $2 END,required=$3,readable=CASE WHEN user_modified THEN readable ELSE $4 END,writable=CASE WHEN user_modified THEN writable ELSE $5 END,options=CASE WHEN user_modified THEN options ELSE $6::jsonb END,config=CASE WHEN user_modified THEN config ELSE $7::jsonb END,source_package_id=$9,source_package_version=$10,managed=true,package_required=$11,source_column=CASE WHEN user_modified THEN source_column ELSE $12 END,active=true WHERE id=$8",
          [field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), existingField.rows[0].id, packageId, packageVersion, field.required === true, field.sourceColumn || field.source_column || apiName]
        );
      } else {
        await db(
          `INSERT INTO platform_fields
           (object_id,api_name,label,field_type,required,readable,writable,options,config,company_id,source_package_id,source_package_version,managed,package_required,source_column)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,true,$13,$14)`,
          [object.id, apiName, field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), companyId || null, packageId, packageVersion, field.required === true, field.sourceColumn || field.source_column || apiName]
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
    const parentFieldKey = relationship.parentFieldApiName || relationship.parent_field_api_name;
    if (parentFieldKey) {
      const fieldResult = await db(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3) LIMIT 1",
        [parentObjectId, parentFieldKey, companyId]
      );
      if (!fieldResult.rows.length) throw new Error(`Package relationship field not found: ${parentFieldKey}`);
    }
    await db(
      `INSERT INTO platform_relationships
       (parent_object_id,child_object_id,relationship_key,relationship_type,child_field_id,active,source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,true,$8)
       ON CONFLICT (parent_object_id,relationship_key)
       DO UPDATE SET child_object_id=EXCLUDED.child_object_id,relationship_type=EXCLUDED.relationship_type,child_field_id=EXCLUDED.child_field_id,source_package_id=EXCLUDED.source_package_id,source_package_version=EXCLUDED.source_package_version,managed=true,package_required=EXCLUDED.package_required,active=true`,
      [parentObjectId, childObjectId, relationship.relationshipKey || relationship.relationship_key, relationship.relationshipType || relationship.relationship_type || "lookup", childFieldId, packageId, packageVersion, relationship.required === true]
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
      [appResult.rows[0].id, companyId || null, pageKey, page.label.trim(), page.routePath || `/app/custom/${pageKey}`, JSON.stringify(page.definition || { presentation_mode: "landing", runtime_component: page.runtimeComponent || page.runtime_component || null, components: [] })]
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
       (company_id,object_id,action_key,label,description,handler_key,required_permission,config,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,true)
       ON CONFLICT (company_id,action_key) WHERE company_id IS NOT NULL
       DO UPDATE SET object_id=EXCLUDED.object_id,label=EXCLUDED.label,description=EXCLUDED.description,
         handler_key=EXCLUDED.handler_key,required_permission=EXCLUDED.required_permission,
         config=COALESCE(platform_registered_actions.config,'{}'::jsonb) || EXCLUDED.config,
         active=true,updated_at=NOW()
       WHERE platform_registered_actions.config->>'packageOwned'='true'
         AND platform_registered_actions.config->>'packageId'=EXCLUDED.config->>'packageId'
       RETURNING id`,
      [companyId || null, objectId, actionKey, action.label.trim(), action.description || null, handlerKey, action.requiredPermission || action.required_permission || null, JSON.stringify({ packageOwned: true, packageId })]
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
       (company_id,object_id,button_key,label,action_key,placement,visibility_rule,config,active,target_type,target_key,variant,required_permission,input_mappings)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,true,'action',$5,$9,$10,'{}'::jsonb)
       ON CONFLICT (company_id,button_key) WHERE company_id IS NOT NULL
       DO UPDATE SET object_id=EXCLUDED.object_id,label=EXCLUDED.label,action_key=EXCLUDED.action_key,
         placement=EXCLUDED.placement,visibility_rule=EXCLUDED.visibility_rule,
         config=COALESCE(platform_buttons.config,'{}'::jsonb) || EXCLUDED.config,
         active=true,target_type='action',target_key=EXCLUDED.target_key,variant=EXCLUDED.variant,
         required_permission=EXCLUDED.required_permission,updated_at=NOW()
       WHERE platform_buttons.config->>'packageOwned'='true'
         AND platform_buttons.config->>'packageId'=EXCLUDED.config->>'packageId'
       RETURNING id`,
      [companyId || null, objectId, button.buttonKey || button.button_key, button.label.trim(), actionKey, button.placement || "record", JSON.stringify(button.visibilityRule || button.visibility_rule || {}), JSON.stringify({ packageOwned: true, packageId, ...(button.config || {}) }), button.variant || "primary", button.requiredPermission || button.required_permission || null]
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
      "SELECT id,action FROM platform_rules WHERE object_id=$1 AND company_id IS NOT DISTINCT FROM $2 AND name=$3 LIMIT 1",
      [objectId, companyId || null, rule.name.trim()]
    );
    const ruleAction = { ...(rule.action || {}), packageKey: manifest.packageKey || rule.packageKey };
    if (existingRule.rows.length) {
      continue;
    }
    await db(
      `INSERT INTO platform_rules
       (object_id,name,trigger_key,conditions,action,active,company_id,lifecycle_status)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,false,$6,'INACTIVE')`,
      [
        objectId,
        rule.name.trim(),
        rule.triggerKey || rule.trigger_key,
        JSON.stringify(rule.conditions || []),
        JSON.stringify(ruleAction),
        companyId || null,
      ]
    );
  }

  const ownedMetadata = await db(
    `WITH owned AS (
       SELECT 'object'::text AS metadata_type,id FROM platform_objects WHERE package_id=$1
       UNION ALL
       SELECT 'field',f.id FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE o.package_id=$1
       UNION ALL
       SELECT 'relationship',r.id FROM platform_relationships r
        WHERE r.source_package_id=$1
       UNION ALL
       SELECT 'layout',id FROM platform_layouts WHERE source_package_id=$1
       UNION ALL
       SELECT 'workflow',id FROM platform_rules WHERE source_package_id=$1
       UNION ALL
       SELECT 'report',id FROM platform_reports WHERE source_package_id=$1
       UNION ALL
       SELECT 'action',id FROM platform_registered_actions WHERE config->>'packageId'=$1::text
       UNION ALL
       SELECT 'button',id FROM platform_buttons WHERE config->>'packageId'=$1::text
       UNION ALL
       SELECT 'page',p.id FROM platform_pages p
         JOIN platform_apps a ON a.id=p.app_id
        WHERE a.app_key=('package_' || replace($1::text,'-','_'))
     )
     INSERT INTO package_metadata_ownership
       (package_id,package_version,metadata_type,metadata_id,managed,package_required,default_snapshot)
     SELECT $1,$2,metadata_type,id,true,false,jsonb_build_object('packageVersion',$2)
       FROM owned
     ON CONFLICT(package_id,metadata_type,metadata_id) DO UPDATE SET
       package_version=EXCLUDED.package_version,managed=true,updated_at=NOW()`,
    [packageId, packageVersion]
  );
  return { objects: objectIds.size, ownedMetadata: ownedMetadata.rowCount || 0 };
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
        `INSERT INTO package_registry
         (package_key,name,version,description,module_id,manifest,package_type,publisher,category,visible,installable,billable,system_only,display_order,publication_state)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (package_key) DO UPDATE SET
           name=EXCLUDED.name, version=EXCLUDED.version, description=EXCLUDED.description,
           module_id=EXCLUDED.module_id, manifest=EXCLUDED.manifest, package_type=EXCLUDED.package_type,
           publisher=EXCLUDED.publisher,category=EXCLUDED.category,visible=EXCLUDED.visible,
           installable=EXCLUDED.installable,billable=EXCLUDED.billable,system_only=EXCLUDED.system_only,
           display_order=EXCLUDED.display_order,publication_state=EXCLUDED.publication_state,active=TRUE,updated_at=NOW()`,
        [
          definition.packageKey, definition.name, definition.version, definition.description,
          moduleResult.rows[0].id, JSON.stringify(definition.manifest),
          definition.manifest.packageType, definition.manifest.publisher, definition.manifest.category,
          definition.manifest.visibility !== "HIDDEN", definition.manifest.installable !== false,
          definition.manifest.billable !== false, definition.manifest.systemOnly === true,
          Number(definition.manifest.displayOrder || 0), definition.manifest.publicationState || "PUBLISHED",
        ]
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
