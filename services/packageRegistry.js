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
    uber_eats: "Uber Eats connection and online order integration.",
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
    reports: [],
    platform: [],
    uber_eats: ["integrations", "online_orders"],
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
        "SELECT id,company_id,source_package_id FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3)",
        [object.id, apiName, companyId]
      );
      if (existingField.rows.length) {
        if (existingField.rows[0].company_id && existingField.rows[0].company_id !== companyId) {
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
          "UPDATE platform_fields SET label=CASE WHEN user_modified THEN label ELSE $1 END,field_type=CASE WHEN user_modified THEN field_type ELSE $2 END,required=$3,readable=CASE WHEN user_modified THEN readable ELSE $4 END,writable=CASE WHEN user_modified THEN writable ELSE $5 END,options=CASE WHEN user_modified THEN options ELSE $6::jsonb END,config=CASE WHEN user_modified THEN config ELSE $7::jsonb END,source_package_id=$9,source_package_version=$10,managed=true,package_required=$11,active=true WHERE id=$8",
          [field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), existingField.rows[0].id, packageId, packageVersion, field.required === true]
        );
      } else {
        await db(
          `INSERT INTO platform_fields
           (object_id,api_name,label,field_type,required,readable,writable,options,config,company_id,source_package_id,source_package_version,managed,package_required)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,true,$13)`,
          [object.id, apiName, field.label.trim(), field.fieldType || field.field_type || "text", field.required === true, field.readable !== false, field.writable === true, JSON.stringify(field.options || []), JSON.stringify({ ...(field.config || {}), packageContract: field.required === true ? "required" : "default", packageOwned: true, packageId }), companyId || null, packageId, packageVersion, field.required === true]
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
    const registeredRelationship = await db(
      `INSERT INTO platform_relationships
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
        JSON.stringify({ packageOwned: true, packageId }), packageId, packageVersion,
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
      "SELECT id,source_package_id,user_modified FROM platform_rules WHERE object_id=$1 AND company_id IS NOT DISTINCT FROM $2 AND name=$3 LIMIT 1",
      [objectId, companyId || null, rule.name.trim()]
    );
    const ruleAction = { ...(rule.action || {}), packageKey: manifest.packageKey || rule.packageKey };
    if (existingRule.rows.length) {
      if (existingRule.rows[0].source_package_id !== packageId) {
        throw new Error(`Package workflow name is owned by another declaration: ${rule.name}`);
      }
      await db(
        `UPDATE platform_rules
            SET trigger_key=CASE WHEN user_modified THEN trigger_key ELSE $1 END,
                conditions=CASE WHEN user_modified THEN conditions ELSE $2::jsonb END,
                action=CASE WHEN user_modified THEN action ELSE $3::jsonb END,
                source_package_version=$4,managed=true,package_required=$5,
                updated_at=NOW()
          WHERE id=$6`,
        [rule.triggerKey || rule.trigger_key, JSON.stringify(rule.conditions || []),
          JSON.stringify(ruleAction), packageVersion, rule.required === true, existingRule.rows[0].id]
      );
      continue;
    }
    await db(
      `INSERT INTO platform_rules
       (object_id,name,trigger_key,conditions,action,active,company_id,lifecycle_status,
        source_package_id,source_package_version,managed,package_required)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,false,$6,'INACTIVE',$7,$8,true,$9)`,
      [
        objectId,
        rule.name.trim(),
        rule.triggerKey || rule.trigger_key,
        JSON.stringify(rule.conditions || []),
        JSON.stringify(ruleAction),
        companyId || null,
        packageId,
        packageVersion,
        rule.required === true,
      ]
    );
  }

  const layouts = [
    ...(Array.isArray(manifest.layouts) ? manifest.layouts : []),
    ...(Array.isArray(manifest.forms) ? manifest.forms.filter((form) =>
      (form.objectKey || form.object_key) && form.definition && typeof form.definition === "object"
    ).map((form) => ({
      ...form,
      pageType: form.pageType || form.page_type || "edit",
    })) : []),
  ];
  for (const layout of layouts) {
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

  const ownedMetadata = await db(
    `WITH owned AS (
       SELECT 'object'::text AS metadata_type,o.id,o.package_required,o.user_modified,to_jsonb(o) AS snapshot
         FROM platform_objects o WHERE o.package_id=$1
       UNION ALL
       SELECT 'field',f.id,f.package_required,f.user_modified,to_jsonb(f)
         FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE o.package_id=$1
       UNION ALL
       SELECT 'relationship',r.id,r.package_required,r.user_modified,to_jsonb(r)
         FROM platform_relationships r WHERE r.source_package_id=$1
       UNION ALL
       SELECT CASE WHEN l.page_type IN ('create','edit','quick_create') THEN 'form' ELSE 'layout' END,
              l.id,l.package_required,l.user_modified,to_jsonb(l)
         FROM platform_layouts l WHERE l.source_package_id=$1
       UNION ALL
       SELECT 'workflow',r.id,r.package_required,r.user_modified,to_jsonb(r)
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
