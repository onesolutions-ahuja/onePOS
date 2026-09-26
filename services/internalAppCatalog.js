const CATALOG = [
  {
    key: "retail_pos",
    name: "POS & Sales",
    description: "Till sales, payments, returns and order processing.",
    route: "/app/sales",
    landingRoute: "/app",
    permissions: ["sale.view", "sale.create", "sale.refund"],
    storeScoped: true,
    category: "Operations",
  },
  {
    key: "products",
    name: "Products",
    description: "Product catalogue, categories and global product references.",
    route: "/app/products",
    permissions: ["product.view", "inventory.view"],
    storeScoped: false,
    category: "Catalogue & Supply",
  },
  {
    key: "inventory",
    name: "Inventory",
    description: "Stock, replenishment and inventory movements.",
    route: "/app/inventory",
    permissions: ["inventory.view"],
    storeScoped: true,
    category: "Catalogue & Supply",
  },
  {
    key: "batch_expiry",
    name: "Batch & Expiry",
    description: "Batch stock, expiry tracking and FEFO inventory controls.",
    route: "/app/inventory",
    permissions: ["inventory.view", "inventory.adjust"],
    storeScoped: true,
    category: "Catalogue & Supply",
  },
  {
    key: "hospitality",
    name: "Hospitality",
    description: "Floor plans, tables and reservations as an installable hospitality foundation.",
    route: "/app/custom/hospitality",
    permissions: ["hospitality.tables.view", "hospitality.reservations.view"],
    storeScoped: true,
    category: "Operations",
  },
  {
    key: "kds",
    name: "Kitchen Display",
    description: "Kitchen tickets and preparation status, licensed independently from core EPOS.",
    route: "/app/custom/kds",
    permissions: ["hospitality.kds.view"],
    storeScoped: true,
    category: "Operations",
  },
  {
    key: "customer_credit",
    name: "Customer Credit",
    description: "Customer credit accounts, protected ledger transactions and credit controls.",
    route: "/app/customers",
    permissions: ["customer.credit.view", "customer.credit.manage"],
    storeScoped: true,
    category: "Business",
  },
  {
    key: "customers",
    name: "Customers",
    description: "Customer records, loyalty and customer activity.",
    route: "/app/customers",
    permissions: ["customer.view"],
    storeScoped: false,
    category: "Business",
  },
  {
    key: "suppliers",
    name: "Suppliers",
    description: "Supplier records, purchasing and supplier accounts.",
    route: "/app/suppliers",
    permissions: ["inventory.view", "purchase.view"],
    storeScoped: false,
    category: "Catalogue & Supply",
  },
  {
    key: "staff",
    name: "Staff",
    description: "Users, employees, roles and store access.",
    route: "/app/employees",
    permissions: ["user.view"],
    storeScoped: false,
    category: "Administration",
  },
  {
    key: "reports",
    name: "Reports",
    description: "Operational, sales and configurable Platform reports.",
    route: "/app/reports",
    permissions: ["reports.summary.view", "reports.custom.view"],
    storeScoped: false,
    category: "Business",
  },
  {
    key: "online_orders",
    name: "Online Orders",
    description: "Online order intake and preparation workflows.",
    route: "/app/order-prep",
    permissions: ["online_orders.view"],
    storeScoped: true,
    category: "Operations",
  },
  {
    key: "integrations",
    name: "Integrations",
    description: "External delivery, payment and communication connections.",
    route: "/app/integrations",
    permissions: ["integration.manage"],
    storeScoped: false,
    category: "Administration",
  },
  {
    key: "uber_eats",
    name: "Uber Eats",
    description: "Uber Eats connection and online order integration.",
    route: "/app/integrations",
    permissions: ["online_orders.view", "online_orders.configure"],
    storeScoped: false,
    category: "Administration",
  },
  {
    key: "platform",
    name: "Platform",
    description: "Configurable objects, metadata, apps and workflow administration.",
    route: "/app/settings/platform",
    permissions: ["settings.manage"],
    storeScoped: false,
    category: "Administration",
  },
];

export const internalAppCatalog = Object.freeze(
  CATALOG.map((entry) => Object.freeze({ ...entry, permissions: Object.freeze([...entry.permissions]) }))
);

export const internalAppCatalogSchema = `
  ALTER TABLE platform_modules ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  CREATE TABLE IF NOT EXISTS platform_module_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES platform_modules(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_module_access_scope
    ON platform_module_access(module_id, company_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
  CREATE INDEX IF NOT EXISTS idx_platform_module_access_company
    ON platform_module_access(company_id, store_id, enabled);
`;

export function catalogEntry(moduleKey) {
  return internalAppCatalog.find((entry) => entry.key === moduleKey) || null;
}

export function hasCatalogPermission(entry, permissions = [], isAdmin = false) {
  if (isAdmin === true) return true;
  return entry.permissions.some((permission) => permissions.includes(permission));
}

export async function seedInternalAppCatalog(pool) {
  for (const entry of internalAppCatalog) {
    await pool.query(
      `INSERT INTO platform_modules (module_key, name, version, description, installed, metadata)
       VALUES ($1, $2, '1.0.0', $3, TRUE, $4::jsonb)
       ON CONFLICT (module_key) DO UPDATE SET
         name=EXCLUDED.name,
         description=EXCLUDED.description,
         metadata=EXCLUDED.metadata,
         updated_at=NOW()`,
      [entry.key, entry.name, entry.description, JSON.stringify(entry)]
    );
  }
}
