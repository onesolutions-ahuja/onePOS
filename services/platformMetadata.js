const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
import { internalAppCatalogSchema, seedInternalAppCatalog } from "./internalAppCatalog.js";
import { packageRegistrySchema, seedPackageRegistry } from "./packageRegistry.js";

export function toSafeApiName(label, fallback = "field") {
  const normalized = String(label || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 100)
    .replace(/_+$/g, "");
  return normalized || fallback;
}

export const platformSchema = `
  CREATE TABLE IF NOT EXISTS platform_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    installed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ${internalAppCatalogSchema}
  ${packageRegistrySchema}
  CREATE TABLE IF NOT EXISTS platform_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES platform_modules(id) ON DELETE SET NULL,
    package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
    object_key VARCHAR(100) NOT NULL UNIQUE,
    label VARCHAR(200) NOT NULL,
    plural_label VARCHAR(200),
    description TEXT,
    source_table VARCHAR(100),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    company_scoped BOOLEAN NOT NULL DEFAULT TRUE,
    store_scoped BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_table IS NULL OR source_table ~ '^[a-z_][a-z0-9_]*$')
  );
  CREATE TABLE IF NOT EXISTS platform_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    api_name VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    field_type VARCHAR(30) NOT NULL CHECK (field_type IN ('text','number','decimal','currency','boolean','date','datetime','email','phone','select','picklist','multiselect','lookup','formula','rollup')),
    source_column VARCHAR(100),
    required BOOLEAN NOT NULL DEFAULT FALSE,
    readable BOOLEAN NOT NULL DEFAULT TRUE,
    writable BOOLEAN NOT NULL DEFAULT FALSE,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, api_name)
  );
  CREATE TABLE IF NOT EXISTS platform_field_security (
    field_id UUID NOT NULL REFERENCES platform_fields(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    readable BOOLEAN NOT NULL DEFAULT TRUE,
    writable BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (field_id, role_id, company_id)
  );
  CREATE TABLE IF NOT EXISTS platform_record_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    object_key VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    field_api_name VARCHAR(100),
    old_value JSONB,
    new_value JSONB,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create','update','delete')),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS platform_approval_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, name)
  );
  CREATE TABLE IF NOT EXISTS platform_approval_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL REFERENCES platform_approval_processes(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order > 0),
    label VARCHAR(200) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    UNIQUE (process_id, step_order)
  );
  CREATE TABLE IF NOT EXISTS platform_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL REFERENCES platform_approval_processes(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_id UUID NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    current_step INTEGER NOT NULL DEFAULT 1,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS platform_approval_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES platform_approval_requests(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approve','reject')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS platform_value_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_set_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, value_set_key)
  );
  CREATE TABLE IF NOT EXISTS platform_value_set_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_set_id UUID NOT NULL REFERENCES platform_value_sets(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (value_set_id, value)
  );
  CREATE TABLE IF NOT EXISTS platform_record_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_type_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    default_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, record_type_key)
  );
  CREATE TABLE IF NOT EXISTS platform_record_type_picklist_values (
    record_type_id UUID NOT NULL REFERENCES platform_record_types(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES platform_fields(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (record_type_id, field_id, value)
  );
  CREATE TABLE IF NOT EXISTS platform_record_associations (
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_id UUID NOT NULL,
    record_type_id UUID REFERENCES platform_record_types(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (object_id, record_id)
  );
  CREATE TABLE IF NOT EXISTS platform_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    child_object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    relationship_key VARCHAR(100) NOT NULL,
    relationship_type VARCHAR(30) NOT NULL CHECK (relationship_type IN ('lookup','one_to_many','many_to_many')),
    child_field_id UUID REFERENCES platform_fields(id) ON DELETE RESTRICT,
    on_delete VARCHAR(20) NOT NULL DEFAULT 'restrict' CHECK (on_delete IN ('restrict','cascade','set_null')),
    on_update VARCHAR(20) NOT NULL DEFAULT 'restrict' CHECK (on_update IN ('restrict','cascade','set_null')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (parent_object_id, relationship_key),
    CHECK (parent_object_id <> child_object_id)
  );
  CREATE TABLE IF NOT EXISTS platform_list_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    view_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort JSONB NOT NULL DEFAULT '{"field":null,"direction":"asc"}'::jsonb,
    page_size INTEGER NOT NULL DEFAULT 50,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, view_key)
  );
  CREATE TABLE IF NOT EXISTS platform_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    report_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{"groupBy":null,"metrics":[{"type":"count"}]}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, report_key)
  );
  CREATE TABLE IF NOT EXISTS platform_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    page_type VARCHAR(30) NOT NULL CHECK (page_type IN ('list','detail','create','edit')),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    layout_key VARCHAR(100) NOT NULL DEFAULT '',
    definition JSONB NOT NULL DEFAULT '{"components":[]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, page_type, role_id, company_id)
  );
  CREATE TABLE IF NOT EXISTS platform_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    app_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{"defaultPage":null,"theme":{"primary":"#0f172a"}}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, app_key)
  );
  CREATE TABLE IF NOT EXISTS platform_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES platform_apps(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    page_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    route_path VARCHAR(200) NOT NULL DEFAULT '/',
    page_type VARCHAR(30) NOT NULL DEFAULT 'page' CHECK (page_type IN ('page','dashboard','modal')),
    definition JSONB NOT NULL DEFAULT '{"components":[]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (app_id, company_id, page_key)
  );
  CREATE TABLE IF NOT EXISTS platform_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    trigger_key VARCHAR(100) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    action JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_platform_objects_package ON platform_objects(package_id);
  CREATE TABLE IF NOT EXISTS platform_automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES platform_rules(id) ON DELETE SET NULL,
    object_id UUID REFERENCES platform_objects(id) ON DELETE SET NULL,
    record_id UUID,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trigger VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_platform_fields_object ON platform_fields(object_id, display_order);
  CREATE INDEX IF NOT EXISTS idx_platform_field_security_role ON platform_field_security(role_id, company_id);
  CREATE INDEX IF NOT EXISTS idx_platform_record_history_record ON platform_record_history(object_id, record_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_approval_requests_company ON platform_approval_requests(company_id, status, submitted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_value_sets_company ON platform_value_sets(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_value_set_values_set ON platform_value_set_values(value_set_id, display_order);
  CREATE INDEX IF NOT EXISTS idx_platform_layouts_object ON platform_layouts(object_id, page_type);
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_fields DROP CONSTRAINT IF EXISTS platform_fields_object_id_api_name_key;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_global_name ON platform_fields(object_id, api_name) WHERE company_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_tenant_name ON platform_fields(object_id, company_id, api_name) WHERE company_id IS NOT NULL;
  ALTER TABLE platform_record_associations ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'::jsonb;
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='platform_fields'::regclass
      AND conname='platform_fields_field_type_check' AND pg_get_constraintdef(oid) NOT LIKE '%formula%' AND pg_get_constraintdef(oid) NOT LIKE '%rollup%') THEN
      ALTER TABLE platform_fields DROP CONSTRAINT platform_fields_field_type_check;
      ALTER TABLE platform_fields ADD CONSTRAINT platform_fields_field_type_check
        CHECK (field_type IN ('text','number','decimal','currency','boolean','date','datetime','email','phone','select','picklist','multiselect','lookup','formula','rollup'));
    END IF;
  END $$;
  ALTER TABLE platform_relationships ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE platform_rules ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS layout_key VARCHAR(100) NOT NULL DEFAULT '';
  ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS record_type_id UUID REFERENCES platform_record_types(id) ON DELETE CASCADE;
  ALTER TABLE platform_record_types ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_layouts_object_page_key
    ON platform_layouts(object_id, page_type, layout_key) WHERE layout_key <> '';
  CREATE INDEX IF NOT EXISTS idx_platform_objects_company ON platform_objects(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_rules_company ON platform_rules(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_record_types_object ON platform_record_types(object_id, company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_record_associations_type ON platform_record_associations(object_id, record_type_id);
`;

const retailObjects = [
  {
    key: "customer", label: "Customer", plural: "Customers", table: "customers",
    fields: [
      ["name", "Name", "text", "name", true], ["phone", "Phone", "phone", "phone", false],
      ["email", "Email", "email", "email", false], ["credit_limit", "Credit Limit", "currency", "credit_limit", false],
    ],
  },
  {
    key: "product", label: "Product", plural: "Products", table: "products",
    fields: [
      ["name", "Name", "text", "name", true], ["sku", "SKU", "text", "sku", false],
      ["barcode", "Barcode", "text", "barcode", false], ["price", "Price", "currency", "price", false],
      ["active", "Active", "boolean", "active", false],
      ["cost_price", "Cost Price", "currency", "cost_price", false],
      ["vat_rate", "VAT Rate", "decimal", "vat_rate", false],
      ["vat_applicable", "VAT Applicable", "boolean", "vat_applicable", false],
      ["age_restricted", "Age Restricted", "boolean", "age_restricted", false],
      ["track_stock", "Track Stock", "boolean", "track_stock", false],
      ["stock_quantity", "Stock Quantity", "decimal", "stock_quantity", false],
      ["low_stock_level", "Low Stock Level", "decimal", "low_stock_level", false],
      ["category_id", "Category", "lookup", "category_id", false],
    ],
  },
  {
    key: "sale", label: "Sale", plural: "Sales", table: "sales",
    fields: [
      ["invoice_number", "Receipt Number", "text", "receipt_number", false],
      ["total", "Total", "currency", "total", false], ["status", "Status", "select", "status", false],
      ["created_at", "Created", "datetime", "created_at", false],
    ],
  },
  {
    key: "supplier", label: "Supplier", plural: "Suppliers", table: "suppliers",
    fields: [
      ["name", "Name", "text", "name", true], ["contact_name", "Contact Name", "text", "contact_name", false],
      ["email", "Email", "email", "email", false], ["phone", "Phone", "phone", "phone", false],
      ["address", "Address", "text", "address", false], ["notes", "Notes", "text", "notes", false],
    ],
  },
  {
    key: "store", label: "Store", plural: "Stores", table: "stores",
    fields: [["name", "Name", "text", "name", true], ["code", "Code", "text", "code", false], ["active", "Active", "boolean", "active", false]],
  },
  {
    key: "employee", label: "Employee", plural: "Employees", table: "users",
    fields: [["full_name", "Full Name", "text", "full_name", true], ["username", "Username", "text", "username", true], ["email", "Email", "email", "email", false], ["active", "Active", "boolean", "active", false]],
  },
];

const operationalObjects = [
  { key: "inventory", label: "Inventory", plural: "Inventory", table: "product_store_stock", fields: [
    ["product_id", "Product", "lookup", "product_id", false], ["store_id", "Store", "lookup", "store_id", false], ["quantity", "Quantity", "decimal", "quantity", false], ["updated_at", "Updated", "datetime", "updated_at", false],
  ] },
  { key: "inventory_movement", label: "Inventory Movement", plural: "Inventory Movements", table: "inventory_movements", fields: [
    ["product_id", "Product", "lookup", "product_id", false], ["movement_type", "Movement Type", "text", "movement_type", false], ["quantity_change", "Quantity Change", "decimal", "quantity_change", false], ["balance_after", "Balance After", "decimal", "balance_after", false], ["created_at", "Created", "datetime", "created_at", false],
  ] },
  { key: "purchase", label: "Purchase", plural: "Purchases", table: "purchases", fields: [
    ["reference_number", "Reference", "text", "reference_number", false], ["supplier_id", "Supplier", "lookup", "supplier_id", false], ["store_id", "Store", "lookup", "store_id", false], ["purchase_date", "Purchase Date", "date", "purchase_date", false], ["notes", "Notes", "text", "notes", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false],
  ] },
  { key: "purchase_receipt", label: "Purchase Receipt", plural: "Purchase Receipts", table: "purchase_receipts", fields: [
    ["purchase_id", "Purchase", "lookup", "purchase_id", false], ["reference_number", "Reference", "text", "reference_number", false], ["received_at", "Received", "datetime", "received_at", false], ["notes", "Notes", "text", "notes", false],
  ] },
  { key: "supplier_invoice", label: "Supplier Invoice", plural: "Supplier Invoices", table: "supplier_invoices", fields: [
    ["invoice_number", "Invoice Number", "text", "invoice_number", false], ["supplier_id", "Supplier", "lookup", "supplier_id", false], ["purchase_id", "Purchase", "lookup", "purchase_id", false], ["invoice_date", "Invoice Date", "date", "invoice_date", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false],
  ] },
  { key: "online_order", label: "Online Order", plural: "Online Orders", table: "online_orders", fields: [
    ["external_order_id", "Order Reference", "text", "external_order_id", false], ["platform", "Channel", "text", "platform", false], ["fulfilment_type", "Fulfilment", "text", "fulfilment_type", false], ["customer_name", "Customer", "text", "customer_name", false], ["store_id", "Store", "lookup", "store_id", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false], ["created_at", "Created", "datetime", "created_at", false],
  ] },
];

export async function initializePlatformMetadata(pool, { includeOperationalObjects = false } = {}) {
  await pool.query(platformSchema);
  await seedInternalAppCatalog(pool);
  await seedPackageRegistry(pool);
  const moduleResult = await pool.query(
    `INSERT INTO platform_modules (module_key, name, version, description, installed)
     VALUES ('retail_pos', 'Retail POS', '1.0.0', 'Core onePOS retail application', TRUE)
     ON CONFLICT (module_key) DO UPDATE SET name=EXCLUDED.name, version=EXCLUDED.version
     RETURNING id`
  );
  const moduleId = moduleResult.rows[0].id;
  for (const object of [...retailObjects, ...(includeOperationalObjects ? operationalObjects : [])]) {
    const objectResult = await pool.query(
      `INSERT INTO platform_objects (module_id, package_id, object_key, label, plural_label, source_table)
       VALUES ($1,(SELECT id FROM package_registry WHERE module_id=$1),$2,$3,$4,$5)
       ON CONFLICT (object_key) DO UPDATE SET label=EXCLUDED.label, plural_label=EXCLUDED.plural_label, source_table=EXCLUDED.source_table, active=TRUE
       WHERE platform_objects.company_id IS NULL AND platform_objects.module_id=EXCLUDED.module_id
       RETURNING id`,
      [moduleId, object.key, object.label, object.plural, object.table]
    );
    // Core Retail POS mappings must remain available after startup. The conflict
    // guard prevents a reserved key owned by a tenant/another module from being
    // reactivated, repurposed, or having its fields overwritten by this seed.
    if (!objectResult.rows.length) continue;
    const objectId = objectResult.rows[0].id;
    for (let index = 0; index < object.fields.length; index += 1) {
      const [apiName, label, fieldType, sourceColumn, required] = object.fields[index];
      await pool.query(
        `INSERT INTO platform_fields (object_id, api_name, label, field_type, source_column, required, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (object_id, api_name) WHERE company_id IS NULL DO UPDATE SET label=EXCLUDED.label, field_type=EXCLUDED.field_type, source_column=EXCLUDED.source_column, required=EXCLUDED.required, display_order=EXCLUDED.display_order`,
        [objectId, apiName, label, fieldType, sourceColumn, required, index]
      );
    }
  }
}

export function isSafeIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}
