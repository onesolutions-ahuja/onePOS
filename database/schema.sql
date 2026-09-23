CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- COMPANY / CHAIN
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    legal_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    timezone VARCHAR(100) NOT NULL DEFAULT 'Europe/London',
    logo_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) UNIQUE NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS licence_entitlements (
    licence_id UUID NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
    entitlement_key VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (licence_id, entitlement_key)
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS licence_id UUID REFERENCES licences(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_companies_licence ON companies(licence_id);

CREATE TABLE IF NOT EXISTS tenant_database_configs (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    database_mode VARCHAR(30) NOT NULL DEFAULT 'ONEPOS_MANAGED'
      CHECK (database_mode IN ('ONEPOS_MANAGED', 'CUSTOMER_MANAGED')),
    host VARCHAR(255),
    port INTEGER,
    database_name VARCHAR(255),
    username VARCHAR(255),
    password_ciphertext TEXT,
    ssl_mode VARCHAR(30) NOT NULL DEFAULT 'require',
    active BOOLEAN NOT NULL DEFAULT FALSE,
    schema_state VARCHAR(40) NOT NULL DEFAULT 'UNINITIALIZED',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID
);

-- ============================================================
-- STORES
-- ============================================================

CREATE TABLE IF NOT EXISTS business_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, code),
    UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_business_divisions_company
ON business_divisions(company_id, active);

CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    business_division_id UUID REFERENCES business_divisions(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    postcode VARCHAR(30),
    phone VARCHAR(50),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    /* Self-Checkout device pairing: bcrypt hash of the device key an admin
       generates in Settings. The login screen uses it to mint a restricted
       self_checkout mode token WITHOUT any staff session on that device. */
    self_checkout_key_hash VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_company
ON stores(company_id);
CREATE INDEX IF NOT EXISTS idx_stores_division
ON stores(company_id, business_division_id);

-- ============================================================
-- TILLS / TERMINALS
-- ============================================================

CREATE TABLE IF NOT EXISTS terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    terminal_number VARCHAR(50),
    device_identifier VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_terminals_store
ON terminals(store_id);

-- ============================================================
-- COMPANY SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS company_settings (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    date_format VARCHAR(40) NOT NULL DEFAULT 'DD/MM/YYYY',
    vat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
    loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    loyalty_earning_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0100,
    /* T10U: negative-inventory billing safety — OFF by default. */
    allow_negative_inventory_billing BOOLEAN NOT NULL DEFAULT FALSE,
    /* T10P: Scan & Go feature flag — OFF by default. */
    scan_go_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    /* Product exchange mode: 'receipt' (invoice only) | 'normal' (no receipt
       only) | 'both' (cashier chooses; default). Consumed by the till
       Exchange workflow and enforced server-side on POST /api/returns/exchanges. */
    exchange_mode VARCHAR(20) NOT NULL DEFAULT 'both',
    batch_inventory_mode VARCHAR(20) NOT NULL DEFAULT 'none' CHECK (batch_inventory_mode IN ('required_dates','optional_dates','none')),
    batch_default_mfg_rule VARCHAR(20) NOT NULL DEFAULT 'none',
    batch_default_expiry_rule VARCHAR(20) NOT NULL DEFAULT 'none',
    batch_default_expiry_days INTEGER NOT NULL DEFAULT 365,
    /* Till product browser presentation: 'image' (default) or 'compact'. */
    product_view VARCHAR(20) NOT NULL DEFAULT 'image',
    /* Admin dock quick-access pages shown directly on the bottom bar
       (T10W): ordered page names; the launcher always exposes every page.
       Default mirrors the original fixed dock layout. */
    dock_quick_access JSONB NOT NULL DEFAULT '["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]'::jsonb,
    /* Customer-facing bill display (second monitor). OFF = the till header
       button stays hidden and /customer-display shows its disabled screen. */
    customer_display_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    online_ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    online_payment_methods JSONB NOT NULL DEFAULT '["card", "cash", "cod"]'::jsonb,
    /* Configurable sale invoice/receipt prefixes per sale source.
       Till and self-checkout receipts use PREFIX-YYYYMMDD-NNNN through the
       existing per-terminal sequencing; delivery (online order) receipts use
       PREFIX-<platform external order id>. */
    till_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'TO',
    delivery_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'DEL',
    self_checkout_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'SC',
    default_landing_page VARCHAR(40) NOT NULL DEFAULT 'dashboard',
    /* JARVES licence control: company allowance (0 = disabled) + per-user
       opt-in; enforced by services/jarvis/licensing.js. */
    jarves_licence_users INTEGER NOT NULL DEFAULT 0,
    updated_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- PAYMENT TERMINALS
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_terminals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    provider VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    terminal_identifier VARCHAR(255),
    connection_url VARCHAR(500),
    api_credentials TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_result VARCHAR(100),
    last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_terminals_company
ON payment_terminals(company_id, store_id);

-- ============================================================
-- HARDWARE CONFIGURATION
-- ============================================================

CREATE TABLE IF NOT EXISTS hardware_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    device_type VARCHAR(30) NOT NULL CHECK (
        device_type IN ('BARCODE_SCANNER', 'CASH_DRAWER', 'RECEIPT_PRINTER')
    ),
    device_name VARCHAR(150),
    connection_type VARCHAR(50),
    connection_address VARCHAR(500),
    paper_width VARCHAR(20),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_result VARCHAR(150),
    last_tested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, store_id, device_type)
);

CREATE INDEX IF NOT EXISTS idx_hardware_configurations_store
ON hardware_configurations(company_id, store_id);

-- ============================================================
-- ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
    default_landing_page VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_company
ON roles(company_id);

-- ============================================================
-- PERMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255),
    pin_hash TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    /* JARVES per-user opt-in; count vs company_settings.jarves_licence_users
       is enforced by services/jarvis/licensing.js (never above the allowance). */
    jarves_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company
ON users(company_id);

CREATE INDEX IF NOT EXISTS idx_users_store
ON users(store_id);

CREATE TABLE IF NOT EXISTS user_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, store_id)
);

-- ============================================================
-- USER PREFERENCES (onePOS Admin presentation)
-- Per-user UI preferences (layout preset / appearance / accent).
-- Presentation only — never business data; each user controls their
-- own row (admin appearance is a USER preference, not a company one).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE terminals ADD COLUMN IF NOT EXISTS app_profile VARCHAR(30) NOT NULL DEFAULT 'admin';
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_landing_page VARCHAR(40) NOT NULL DEFAULT 'dashboard';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_landing_page VARCHAR(40);

CREATE TABLE IF NOT EXISTS user_business_divisions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_division_id UUID NOT NULL REFERENCES business_divisions(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, business_division_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stores_store
ON user_stores(store_id, active);

CREATE INDEX IF NOT EXISTS idx_user_stores_user
ON user_stores(user_id, active);

CREATE TABLE IF NOT EXISTS custom_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    data_source VARCHAR(30) NOT NULL DEFAULT 'sales' CHECK (data_source = 'sales'),
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_reports_company_active
ON custom_reports(company_id, archived_at, updated_at DESC);
CREATE TABLE IF NOT EXISTS custom_report_users (
    report_id UUID NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_report_users_user
ON custom_report_users(user_id, report_id);

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_company
ON categories(company_id);

-- ============================================================
-- PRODUCTS
-- ============================================================

-- ============================================================
-- GLOBAL EAN REFERENCE (separate from customer products; no pricing)
-- ============================================================

CREATE TABLE IF NOT EXISTS ean_product_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ean VARCHAR(14) NOT NULL CHECK (ean ~ '^([0-9]{8}|[0-9]{12,14})$'),
    product_name VARCHAR(255) NOT NULL,
    brand VARCHAR(200),
    category VARCHAR(200),
    subcategory VARCHAR(200),
    unit_description VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ean_product_master_ean
ON ean_product_master(ean);

ALTER TABLE ean_product_master ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

ALTER TABLE ean_product_master ADD COLUMN IF NOT EXISTS source TEXT NULL;

-- EAN lookup audit only; no limits, pricing or customer product changes.
CREATE TABLE IF NOT EXISTS ean_lookup_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    ean VARCHAR(14) NOT NULL,
    lookup_result VARCHAR(9) NOT NULL CHECK (lookup_result IN ('FOUND', 'NOT_FOUND')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ean_lookup_usage_company_created
ON ean_lookup_usage(company_id, created_at);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    parent_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_kind VARCHAR(20) NOT NULL DEFAULT 'standard'
      CHECK (product_kind IN ('standard', 'variant', 'bundle')),
    variant_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    barcode VARCHAR(100),
    description TEXT,
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
    vat_applicable BOOLEAN NOT NULL DEFAULT TRUE,
    age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
    batch_tracking BOOLEAN NOT NULL DEFAULT FALSE,
    stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    low_stock_level NUMERIC(12,3) NOT NULL DEFAULT 0,
    track_stock BOOLEAN NOT NULL DEFAULT TRUE,
    available_on_uber BOOLEAN NOT NULL DEFAULT FALSE,
    available_on_deliveroo BOOLEAN NOT NULL DEFAULT FALSE,
    uber_item_id VARCHAR(255),
    deliveroo_item_id VARCHAR(255),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Product image (data URL or remote URL), set from the Product Master form
-- or pre-filled from the global catalogue. Additive; NULL = no image.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_products_company
ON products(company_id);

CREATE INDEX IF NOT EXISTS idx_products_barcode
ON products(barcode);

CREATE INDEX IF NOT EXISTS idx_products_sku
ON products(sku);

CREATE INDEX IF NOT EXISTS idx_products_parent
ON products(parent_product_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_variant_attributes
ON products(company_id, parent_product_id, variant_attributes)
WHERE parent_product_id IS NOT NULL AND active = true;

CREATE TABLE IF NOT EXISTS product_modifier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    max_selections INTEGER NOT NULL DEFAULT 1 CHECK (max_selections > 0),
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS product_modifier_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES product_modifier_groups(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    track_stock BOOLEAN NOT NULL DEFAULT FALSE,
    inventory_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS product_bundle_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    component_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    UNIQUE (bundle_product_id, component_product_id),
    CHECK (bundle_product_id <> component_product_id)
);

/*
 * Till Misc Item (manual-price sale line): one invisible MISC placeholder
 * product per company. sale_items.product_id is NOT NULL, so misc lines
 * reference this company row; the description lives on sale_items.product_name
 * and item_type='MISC' keeps the line distinguishable from real products.
 */
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_misc_per_company
ON products(company_id)
WHERE sku = 'MISC'
  AND active = false;

-- ============================================================
-- INVENTORY MOVEMENTS / STOCK LEDGER
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    movement_type VARCHAR(30) NOT NULL CHECK (
        movement_type IN (
            'OPENING',
            'PURCHASE',
            'SALE',
            'CUSTOMER_RETURN',
            'SUPPLIER_RETURN',
            'ADJUSTMENT_IN',
            'ADJUSTMENT_OUT',
            'RETURN_IN',
            'RETURN_OUT',
            'ONLINE_RESERVE',
            'ONLINE_RELEASE',
            'TRANSFER_OUT',
            'TRANSFER_IN'
        )
    ),
    quantity_change NUMERIC(12,3) NOT NULL,
    balance_after NUMERIC(12,3) NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    reason TEXT,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
ON inventory_movements(product_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_company
ON inventory_movements(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
ON inventory_movements(movement_type, created_at);

-- ------------------------------------------------------------
-- STOCK BY STORE — store/location-level stock positions.
-- Products stay company-level; the quantity physically living at each
-- store is tracked here, one row per (company, store, product). Updated
-- only via services/inventory.js createInventoryMovement, in step with
-- inventory_movements and products.stock_quantity in the same transaction.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_store_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, store_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_store_stock_store
ON product_store_stock(company_id, store_id);

CREATE INDEX IF NOT EXISTS idx_product_store_stock_product
ON product_store_stock(company_id, product_id);

-- ------------------------------------------------------------
-- INVENTORY BATCHES — store-level batch/expiry tracking.
-- Company → Product → StoreProduct(stock) → InventoryBatch. The same
-- product carries different batches/expiries per store; batch numbers may
-- repeat across stores, never twice within one store's product. Quantities
-- mutate only through the batch-aware inventory movement helpers.
-- Expired batches are never auto-deleted.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    batch_number VARCHAR(100),
    manufacturing_date DATE,
    expiry_date DATE,
    manufacturing_date_source VARCHAR(10),
    expiry_date_source VARCHAR(10),
    quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, store_id, product_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_store
ON inventory_batches(company_id, store_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product
ON inventory_batches(company_id, product_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry
ON inventory_batches(company_id, store_id, expiry_date);

-- ------------------------------------------------------------
-- STOCK TRANSFERS — moving stock between a company's own stores.
-- Execution is atomic: TRANSFER_OUT (source) and TRANSFER_IN (destination)
-- inventory movements for every line are written in one transaction with
-- the transfer as their reference. Multi-product capable via items.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    transfer_number VARCHAR(30) UNIQUE,
    from_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    to_store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_company
ON stock_transfers(company_id, created_at);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer
ON stock_transfer_items(transfer_id);

-- ============================================================
-- SUPPLIERS
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200);

CREATE INDEX IF NOT EXISTS idx_suppliers_company
ON suppliers(company_id);

-- ============================================================
-- PURCHASES / GOODS RECEIVED
-- ============================================================

CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    supplier_name VARCHAR(200),
    reference_number VARCHAR(100),
    purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (
        status IN ('DRAFT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')
    ),
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, reference_number)
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    received_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0 AND received_quantity <= quantity),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    batch_number VARCHAR(100),
    manufacturing_date DATE,
    expiry_date DATE
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reference_number VARCHAR(100),
    notes TEXT
);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
    purchase_item_id UUID NOT NULL REFERENCES purchase_items(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    batch_number VARCHAR(100),
    manufacturing_date DATE,
    expiry_date DATE
);

CREATE INDEX IF NOT EXISTS idx_purchase_receipts_purchase ON purchase_receipts(purchase_id, received_at);

CREATE INDEX IF NOT EXISTS idx_purchases_company_date
ON purchases(company_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
ON purchase_items(purchase_id);

CREATE TABLE IF NOT EXISTS supplier_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    supplier_sku VARCHAR(100),
    supplier_description TEXT,
    cost_price NUMERIC(12,2) NOT NULL CHECK (cost_price >= 0),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    preferred BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (company_id, supplier_id, product_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(company_id, supplier_id, active);
CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(company_id, product_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_products_one_preferred
ON supplier_products(company_id, product_id)
WHERE preferred = TRUE AND active = TRUE;

CREATE TABLE IF NOT EXISTS stock_returns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    return_type VARCHAR(20) NOT NULL CHECK (return_type IN ('CUSTOMER', 'SUPPLIER')),
    /* T9M-SMALL: short human-readable return reference, e.g. RET-0001 */
    return_number VARCHAR(30) UNIQUE,
    sale_id UUID,
    purchase_id UUID,
    supplier_id UUID,
    request_key VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
    refund_amount NUMERIC(12,2),
    refund_method VARCHAR(50),
    reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_returns_request
ON stock_returns(company_id, request_key)
WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS stock_return_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id UUID NOT NULL REFERENCES stock_returns(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    sale_item_id UUID,
    purchase_item_id UUID,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_returns_company
ON stock_returns(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_return_items_return
ON stock_return_items(return_id);

CREATE TABLE IF NOT EXISTS supplier_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_PAID','PAID','VOID')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50),
    reference VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','COMPLETED','CANCELLED')),
    notes TEXT,
    idempotency_key VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    UNIQUE (payment_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS supplier_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    entry_type VARCHAR(30) NOT NULL CHECK (entry_type IN ('INVOICE','PAYMENT','RETURN_CREDIT','OPENING')),
    reference_type VARCHAR(40),
    reference_id UUID,
    reference VARCHAR(100),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    debit BOOLEAN NOT NULL,
    description TEXT,
    idempotency_key VARCHAR(100),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_ledger_account
ON supplier_ledger_entries(company_id, supplier_id, created_at, id);
ALTER TABLE supplier_ledger_entries ADD COLUMN IF NOT EXISTS reference VARCHAR(100);
ALTER TABLE supplier_ledger_entries ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_ledger_idempotency
ON supplier_ledger_entries(company_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- Product exchanges: link columns on the existing return leg so one exchange
-- is traceable (return -> original sale / replacement sale) without a second
-- returns/inventory/payment system.
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS exchange_mode VARCHAR(20);
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS replacement_sale_id UUID;
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS replacement_total NUMERIC(12,2);
ALTER TABLE stock_returns ADD COLUMN IF NOT EXISTS exchange_difference NUMERIC(12,2);

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS price_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    channel VARCHAR(50) NOT NULL DEFAULT 'retail',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS price_list_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    UNIQUE (price_list_id, product_id)
);

CREATE TABLE IF NOT EXISTS scheduled_product_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percent','fixed')),
    discount_value NUMERIC(12,2) NOT NULL CHECK (discount_value >= 0),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    buy_quantity INTEGER CHECK (buy_quantity IS NULL OR buy_quantity > 0),
    get_quantity INTEGER CHECK (get_quantity IS NULL OR get_quantity >= 0),
    offer_type VARCHAR(20) CHECK (offer_type IS NULL OR offer_type IN ('fixed_set','percent')),
    set_price NUMERIC(12,2) CHECK (set_price IS NULL OR set_price >= 0),
    discount_percent NUMERIC(5,2) CHECK (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_price_list_prices_product ON price_list_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_product_prices_active ON scheduled_product_prices(product_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotions_product_active ON promotions(company_id, product_id, active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    postcode VARCHAR(30),
    loyalty_number VARCHAR(100),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    /*
     * T10Y — Customer credit account fields. Credit is OFF for every
     * existing customer (default FALSE); balance is DERIVED from the
     * customer_credit_ledger (never stored/mutated here).
     */
    credit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    credit_limit NUMERIC(12,2) NULL
);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group_id UUID REFERENCES customer_groups(id) ON DELETE SET NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list_id UUID REFERENCES price_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_company
ON customers(company_id);

-- ============================================================
-- T10Y — CUSTOMER CREDIT LEDGER
-- Immutable, auditable credit transactions. Outstanding balance is
-- always DERIVED: SUM(amount * sign(transaction_type)). Every row is
-- company-scoped; reference_type/reference_id link back to the sale,
-- payment or adjustment that produced it.
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NULL REFERENCES stores(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN
        ('credit_sale', 'payment', 'credit_note', 'debit_note', 'opening')),
    /* Unsigned magnitude in major units; direction comes from
       transaction_type (credit_sale/credit_note/opening increase,
       payment/debit_note decrease). */
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    balance_after NUMERIC(12,2) NULL,
    reference_type VARCHAR(40) NULL,
    reference_id UUID NULL,
    description TEXT NULL,
    vat_amount NUMERIC(12,2) NULL,
    net_amount NUMERIC(12,2) NULL,
    gross_amount NUMERIC(12,2) NULL,
    vat_rate NUMERIC(6,3) NULL,
    payment_method VARCHAR(40) NULL,
    idempotency_key VARCHAR(120) NULL,
    created_by UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_customer
ON customer_credit_ledger(company_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference
ON customer_credit_ledger(reference_type, reference_id);
CREATE TABLE IF NOT EXISTS customer_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_purchase_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (customer_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_stores_store
ON customer_stores(store_id, active);

CREATE INDEX IF NOT EXISTS idx_customer_stores_customer
ON customer_stores(customer_id, active);

-- ============================================================
-- CUSTOMER LOYALTY
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_loyalty_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    balance NUMERIC(12,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_loyalty_balances_customer
ON customer_loyalty_balances(customer_id);

CREATE TABLE IF NOT EXISTS customer_loyalty_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL,
    amount NUMERIC(12,4) NOT NULL,
    balance_after NUMERIC(12,4) NOT NULL,
    reference_type VARCHAR(50),
    reference_id UUID,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer
ON customer_loyalty_transactions(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_reference
ON customer_loyalty_transactions(reference_type, reference_id);

-- T10R: idempotent earning. At most one EARN per sale, enforced by the
-- database so a retried/lost-acknowledgement sale can never award points
-- twice. Balance upserts must be reversed when this fires.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loyalty_earn_per_sale
ON customer_loyalty_transactions (company_id, reference_id)
WHERE transaction_type = 'EARN' AND reference_type = 'sale';

-- T10R: manual/admin point adjustments - permission-controlled,
-- auditable, referenceable to a sale/invoice.
CREATE TABLE IF NOT EXISTS customer_loyalty_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    points NUMERIC(12,4) NOT NULL,
    reason TEXT,
    reference_id UUID NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_adjustments_customer
ON customer_loyalty_adjustments(customer_id, created_at DESC);

-- ============================================================
-- HOSPITALITY FOUNDATION
-- ============================================================

CREATE TABLE IF NOT EXISTS hospitality_floors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, store_id, name)
);
CREATE TABLE IF NOT EXISTS hospitality_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    floor_id UUID NOT NULL REFERENCES hospitality_floors(id) ON DELETE CASCADE,
    table_number VARCHAR(30) NOT NULL,
    name VARCHAR(100),
    capacity INTEGER NOT NULL DEFAULT 2 CHECK (capacity > 0),
    shape VARCHAR(20) NOT NULL DEFAULT 'square',
    position_x NUMERIC(8,2) NOT NULL DEFAULT 0,
    position_y NUMERIC(8,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'EMPTY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, store_id, floor_id, table_number)
);
CREATE TABLE IF NOT EXISTS hospitality_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    table_id UUID REFERENCES hospitality_tables(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    customer_name VARCHAR(200) NOT NULL,
    reservation_date DATE NOT NULL,
    reservation_time TIME NOT NULL,
    guests INTEGER NOT NULL CHECK (guests > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hospitality_kds_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    sale_id UUID,
    table_id UUID REFERENCES hospitality_tables(id) ON DELETE SET NULL,
    order_number VARCHAR(50),
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    station VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),
    store_id UUID NOT NULL REFERENCES stores(id),
    terminal_id UUID REFERENCES terminals(id),
    user_id UUID NOT NULL REFERENCES users(id),
    customer_id UUID REFERENCES customers(id),

    receipt_number VARCHAR(100),

    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,

    status VARCHAR(50) NOT NULL DEFAULT 'completed',

    offline_created BOOLEAN NOT NULL DEFAULT FALSE,
    sync_status VARCHAR(50) NOT NULL DEFAULT 'synced',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    /*
     * ONLINE ORDER -> POS SALE: set when an Uber Eats / Deliveroo order is
     * completed. UNIQUE (below) makes duplicate sales on retry impossible.
     * The FK itself is added after online_orders exists (see ONLINE ORDERS
     * section) because this table is created earlier in this script.
     */
    online_order_id UUID
);

ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS client_request_id UUID;
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS client_request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_client_request
ON sales(company_id, client_request_id);

/*
 * Receipt numbers are authoritative and sequential per terminal per
 * business day (T8E). Partial on terminal_id so Online Order receipts
 * (terminal_id IS NULL) are exempt from the pattern entirely.
 */
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_terminal_receipt
ON sales(terminal_id, receipt_number)
WHERE terminal_id IS NOT NULL
  AND receipt_number LIKE '%-%-%';

CREATE INDEX IF NOT EXISTS idx_sales_company
ON sales(company_id);

CREATE INDEX IF NOT EXISTS idx_sales_store
ON sales(store_id);

CREATE INDEX IF NOT EXISTS idx_sales_created
ON sales(created_at);

CREATE INDEX IF NOT EXISTS idx_sales_receipt
ON sales(receipt_number);

-- ============================================================
-- SALE ITEMS
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    product_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL,
    item_type VARCHAR(20) NOT NULL DEFAULT 'PRODUCT',
    discount_type VARCHAR(20),
    discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    original_unit_price NUMERIC(12,2),
    original_tax NUMERIC(12,2),
    original_total NUMERIC(12,2),
    discounted_by UUID REFERENCES users(id) ON DELETE SET NULL
   ,modifier_data JSONB NOT NULL DEFAULT '[]'::jsonb
   ,bundle_components JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS sale_item_modifiers (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   sale_item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
   modifier_option_id UUID NOT NULL REFERENCES product_modifier_options(id),
   quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
   unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
   total NUMERIC(12,2) NOT NULL CHECK (total >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale
ON sale_items(sale_id);

-- ============================================================
-- PAYMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

    payment_method VARCHAR(50) NOT NULL,

    amount NUMERIC(12,2) NOT NULL,

    provider VARCHAR(100),
    terminal_id VARCHAR(100),
    provider_transaction_id VARCHAR(255),

    status VARCHAR(50) NOT NULL DEFAULT 'completed',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_sale
ON payments(sale_id);

-- ============================================================
-- LAYAWAYS / DEPOSITS
-- ============================================================

CREATE TABLE IF NOT EXISTS layaways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
      CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
    due_date DATE,
    notes TEXT,
    completed_sale_id UUID REFERENCES sales(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layaways_store_status
ON layaways(company_id, store_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS layaway_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layaway_id UUID NOT NULL REFERENCES layaways(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    product_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
    track_stock BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_layaway_items_layaway ON layaway_items(layaway_id);

CREATE TABLE IF NOT EXISTS layaway_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layaway_id UUID NOT NULL REFERENCES layaways(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    payment_method VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    provider VARCHAR(100),
    provider_transaction_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_layaway_payments_layaway ON layaway_payments(layaway_id);

CREATE TABLE IF NOT EXISTS held_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    items JSONB NOT NULL,
    discount_type VARCHAR(20),
    discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_held_sales_store
ON held_sales(company_id, store_id, created_at);

-- ============================================================
-- REFUNDS
-- ============================================================

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT,
    payment_method VARCHAR(50),
    /* T9M-SMALL: links the refund to its stock_returns record (nullable for
       legacy/manual refunds created before returns existed). */
    return_id UUID REFERENCES stock_returns(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DISCOUNTS
-- ============================================================

CREATE TABLE IF NOT EXISTS discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,
    value NUMERIC(12,2) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    requires_permission BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SALE DISCOUNTS (audit trail for discounts applied to a sale)
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    item_id UUID REFERENCES sale_items(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,
    value NUMERIC(12,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_discounts_sale
ON sale_discounts(sale_id);

-- ============================================================
-- SALE PRICE OVERRIDES (audit trail for manual price changes)
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_price_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    user_id UUID NOT NULL REFERENCES users(id),
    original_unit_price NUMERIC(12,2) NOT NULL,
    overridden_unit_price NUMERIC(12,2) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_price_overrides_sale
ON sale_price_overrides(sale_id);

-- ============================================================
-- TILL SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS till_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    terminal_id UUID NOT NULL REFERENCES terminals(id),
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id),

    opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    closing_cash NUMERIC(12,2),

    expected_cash NUMERIC(12,2),
    cash_difference NUMERIC(12,2),

    status VARCHAR(50) NOT NULL DEFAULT 'open',

    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_till_sessions_terminal
ON till_sessions(terminal_id);

-- T-TILL: at most one open session per till — makes the API's
-- "no two simultaneously open sessions" rule atomic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_till_sessions_open_per_terminal
ON till_sessions(terminal_id)
WHERE status = 'open';

-- ============================================================
-- CASH MOVEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS cash_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    till_session_id UUID NOT NULL REFERENCES till_sessions(id),
    user_id UUID NOT NULL REFERENCES users(id),

    type VARCHAR(50) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- T-TILL: who/where recorded the movement (denormalised for audit;
-- the session row carries till+store via its terminal).
ALTER TABLE cash_movements
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS terminal_id UUID REFERENCES terminals(id) ON DELETE SET NULL;

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    company_id UUID NOT NULL REFERENCES companies(id),
    user_id UUID REFERENCES users(id),

    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,

    business_division_id UUID,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    terminal_id UUID REFERENCES terminals(id) ON DELETE SET NULL,
    session_id UUID,

    ip_address INET,
    actor_username VARCHAR(255),

    details JSONB,

    result VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_company
ON audit_logs(company_id);

CREATE INDEX IF NOT EXISTS idx_audit_created
ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_audit_company_action
ON audit_logs(company_id, action);

CREATE INDEX IF NOT EXISTS idx_audit_entity
ON audit_logs(entity_type, entity_id)
WHERE entity_id IS NOT NULL;

-- ============================================================
-- STAFF ATTENDANCE (CLOCK IN / CLOCK OUT)
-- ============================================================
-- One attendance session per staff member per company: an OPEN row
-- (clock_out NULL) is the user's active clock-in.
-- uq_attendance_open_per_user makes "at most one open session per user"
-- atomic. worked_minutes is computed SERVER-SIDE from clock_in/clock_out
-- at clock-out time; the client never supplies it.

CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    clock_out TIMESTAMPTZ,
    worked_minutes INTEGER,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_clock_out_after_in CHECK (
        clock_out IS NULL OR clock_out >= clock_in
    )
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_company_created
ON attendance_records(company_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_store_created
ON attendance_records(company_id, store_id, clock_in DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_user_created
ON attendance_records(user_id, clock_in DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_open_per_user
ON attendance_records(user_id)
WHERE status = 'open';

-- ============================================================
-- API / INTEGRATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    key_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    configuration JSONB,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_integrations_company_provider
ON integrations(company_id, provider);

-- ============================================================
-- SCAN & GO (T10P) — customer scan sessions
-- ============================================================

CREATE TABLE IF NOT EXISTS scan_and_go_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id),
    status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (
        status IN ('active', 'checking_out', 'completed', 'abandoned', 'expired')
    ),
    started_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sale_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_scan_go_sessions_company_store
    ON scan_and_go_sessions(company_id, store_id, created_at);

CREATE TABLE IF NOT EXISTS scan_and_go_session_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES scan_and_go_sessions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scan_and_go_session_items_unique UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_go_session_items_session
    ON scan_and_go_session_items(session_id);

-- ============================================================
-- ONLINE ORDERS (UBER EATS / DELIVEROO)
-- ============================================================

CREATE TABLE IF NOT EXISTS online_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('uber', 'deliveroo', 'direct')),
    external_order_id VARCHAR(255) NOT NULL,
    external_reference VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED' CHECK (
        status IN ('RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'READY_FOR_PICKUP', 'READY_FOR_DELIVERY', 'COLLECTED', 'COMPLETED', 'REJECTED', 'CANCELLED')
    ),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(255),
    delivery_address TEXT,
    fulfilment_type VARCHAR(20) NOT NULL DEFAULT 'DELIVERY',
    otp_code VARCHAR(20),
    otp_verified_at TIMESTAMPTZ,
    currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    payment_method VARCHAR(50),
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    cancel_reason TEXT,
    inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    inventory_released BOOLEAN NOT NULL DEFAULT FALSE,
    platform_data JSONB,
    accepted_at TIMESTAMPTZ,
    preparing_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT online_orders_platform_external_unique UNIQUE (company_id, platform, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_online_orders_company
ON online_orders(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_online_orders_status
ON online_orders(company_id, status, created_at);

/*
 * ONLINE ORDER -> POS SALE link (column declared on the sales table above,
 * before online_orders existed; the FK is added here). The UNIQUE index is
 * the database-level guarantee that completing an order can never create a
 * second sale, no matter how completion is retried.
 */
ALTER TABLE sales
    ADD COLUMN IF NOT EXISTS online_order_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_online_order
ON sales(online_order_id);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_sales_online_order') THEN
        ALTER TABLE sales
            ADD CONSTRAINT fk_sales_online_order
            FOREIGN KEY (online_order_id) REFERENCES online_orders(id);
    END IF;
END $$;

/*
 * An incoming platform item may arrive WITHOUT a onePOS product mapping (e.g.
 * a Deliveroo item whose POS id is not yet linked in Products). Such an item
 * must never be dropped or fail the whole order, so product_id is nullable and
 * mapping_status records whether the link exists (MAPPED / UNMAPPED). Items
 * are matched by product_id and by external_item_id (the platform POS id).
 */
CREATE TABLE IF NOT EXISTS online_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    external_item_id VARCHAR(255),
    product_name VARCHAR(255) NOT NULL,
    quantity NUMERIC(12,3) NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    total NUMERIC(12,2) NOT NULL,
    mapping_status VARCHAR(20) NOT NULL DEFAULT 'MAPPED',
    platform_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_order_items_order
ON online_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_online_order_items_external
ON online_order_items(external_item_id);

CREATE TABLE IF NOT EXISTS online_order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    from_status VARCHAR(30),
    to_status VARCHAR(30),
    message TEXT,
    platform_response JSONB,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_order_events_order
ON online_order_events(order_id, created_at);

/*
 * DELIVEROO ITEM -> onePOS PRODUCT MAPPING
 *
 * Persists the link between a Deliveroo menu item and a onePOS product so
 * future Deliveroo orders resolve automatically. Matching is by the stable
 * Deliveroo item identifier (pos_item_id / PLU delivered on the order line),
 * never by name alone. A mapping never creates a onePOS product.
 */
CREATE TABLE IF NOT EXISTS deliveroo_item_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    external_item_id VARCHAR(255) NOT NULL,
    deliveroo_item_name VARCHAR(255),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT deliveroo_item_mappings_company_item_unique UNIQUE (company_id, external_item_id)
);

CREATE INDEX IF NOT EXISTS idx_deliveroo_item_mappings_company
ON deliveroo_item_mappings(company_id, external_item_id);

-- ============================================================
-- PLATFORM API AUDIT LOG (UBER / DELIVEROO)
-- Every platform API request/response, secrets redacted by
-- services/onlineOrders/platformLogger.js before insert.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_api_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('uber', 'deliveroo')),
    environment VARCHAR(20),
    action VARCHAR(100) NOT NULL,
    endpoint VARCHAR(500),
    http_method VARCHAR(10),
    request_payload JSONB,
    request_headers JSONB,
    response_status INTEGER,
    response_body JSONB,
    success BOOLEAN,
    error_message TEXT,
    duration_ms INTEGER,
    order_id UUID REFERENCES online_orders(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_api_logs_company
ON platform_api_logs(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_api_logs_platform
ON platform_api_logs(company_id, platform, created_at);

CREATE INDEX IF NOT EXISTS idx_platform_api_logs_order
ON platform_api_logs(order_id);

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, name, description)
VALUES
('sale.view', 'View Sales', 'View sales history and receipts'),
('sale.create', 'Create Sale', 'Create sales'),
('sale.edit', 'Edit Sale', 'Edit completed sales'),
('sale.delete', 'Delete / Void Sale', 'Delete or void sales'),
('sale.invoice.view', 'View Invoices', 'View sale invoices'),
('sale.invoice.reprint', 'Reprint Invoice', 'Reprint or download sale invoices'),
('sale.discount', 'Apply Discount', 'Apply discounts'),
('sale.void_item', 'Void Item', 'Void individual sale items'),
('sale.refund', 'Refund Sale', 'Process refunds'),
('sale.refund_without_receipt', 'Refund Without Receipt', 'Allow refunds without receipt'),
('sale.price_change', 'Change Price', 'Change item price at till'),
('sale.hold', 'Hold Sale', 'Hold and retrieve sales'),

('cash.open_drawer', 'Open Cash Drawer', 'Open cash drawer'),
('cash.payout', 'Cash Payout', 'Remove cash from till'),
('cash.adjustment', 'Cash Adjustment', 'Adjust till cash'),
('till.open', 'Open Till', 'Open till session'),
('till.close', 'Close Till', 'Close till session'),

('attendance.view', 'View Staff Attendance', 'View staff attendance records'),

('product.view', 'View Products', 'View products'),
('product.create', 'Create Product', 'Create products'),
('product.edit', 'Edit Product', 'Edit products'),
('product.delete', 'Delete Product', 'Delete products'),

('global_product.view', 'View Global Products', 'View global product catalogue'),
('global_product.create', 'Create Global Product', 'Create global products'),
('global_product.edit', 'Edit Global Product', 'Edit global products'),
('global_product.delete', 'Delete Global Product', 'Delete global products'),

('category.view', 'View Categories', 'View product categories'),
('category.create', 'Create Category', 'Create product categories'),
('category.edit', 'Edit Category', 'Edit product categories'),
('category.delete', 'Delete Category', 'Delete product categories'),

('customer.view', 'View Customers', 'View customers'),
('customer.create', 'Create Customer', 'Create customers'),
('customer.edit', 'Edit Customer', 'Edit customers'),
('customer.delete', 'Delete Customer', 'Delete customers'),

('purchase.view', 'View Purchases', 'View purchase orders'),
('purchase.create', 'Create Purchase', 'Create purchase orders'),
('purchase.edit', 'Edit Purchase', 'Edit purchase orders'),
('purchase.delete', 'Delete / Cancel Purchase', 'Delete or cancel purchase orders'),

('store.view', 'View Stores', 'View store information'),
('store.create', 'Create Store', 'Create new stores'),
('store.edit', 'Edit Store', 'Edit store information'),
('store.delete', 'Delete Store', 'Delete stores'),

('user.view', 'View Users', 'View user accounts'),
('user.create', 'Create User', 'Create user accounts'),
('user.edit', 'Edit User', 'Edit user accounts'),
('user.delete', 'Delete User', 'Delete user accounts'),

('inventory.view', 'View Inventory', 'View stock overview'),
('inventory.movements.view', 'View Stock Movements', 'View stock movement ledger'),
('inventory.adjust', 'Adjust Inventory', 'Adjust stock levels'),
('inventory.replenishment.view', 'View Replenishment Suggestions', 'View low-stock reorder suggestions'),

('returns.view', 'View Returns', 'View return history'),
('returns.create', 'Create Returns', 'Process customer and supplier returns'),
('returns.approve', 'Approve / Process Returns', 'Approve and process pending returns'),

('reports.sales.view', 'Sales Report', 'View the daily sales report'),
('reports.products.view', 'Product Sales Report', 'View the product sales report'),
('reports.customers.view', 'Customer Report', 'View the customer spend report'),
('reports.inventory.view', 'Inventory Overview', 'View the inventory overview report'),
('reports.inventory_movements.view', 'Stock Movement Ledger', 'View the stock movement ledger report'),
('reports.low_stock.view', 'Low Stock Report', 'View the low stock report (included in inventory overview)'),
('reports.payments.view', 'Payments Report', 'View the payment method breakdown report'),
('reports.purchases.view', 'Purchase Report', 'View the purchase orders report'),
('reports.returns.view', 'Sales Returns Report', 'View the sales returns report'),
('reports.profit.view', 'Profit Report', 'View the profit / margin report'),
('reports.till.view', 'Till Report', 'View the till session report'),
('reports.vat.view', 'Tax / VAT Report', 'View the tax/VAT report'),
('reports.summary.view', 'Reports Summary', 'View the reports summary cards'),
('reports.custom.view', 'View Custom Reports', 'View saved custom sales reports'),
('reports.custom.create', 'Create Custom Reports', 'Create and duplicate custom sales reports'),
('reports.custom.edit', 'Edit Custom Reports', 'Edit owned custom sales reports'),
('reports.custom.delete', 'Archive Custom Reports', 'Archive owned custom sales reports'),
('reports.custom.share', 'Share Custom Reports', 'Map custom reports to company users'),
('report.export', 'Export Reports', 'Export reports to CSV'),

('user.manage', 'Manage Users', 'Manage users'),
('role.manage', 'Manage Roles', 'Manage roles and permissions'),
('payment.manage', 'Manage Payments', 'Manage payment settings'),
('integration.manage', 'Manage Integrations', 'Manage integrations'),
('settings.manage', 'Manage Settings', 'Manage settings'),
('package.manage', 'Manage Packages', 'Install, deactivate and uninstall packages'),
('module.access.manage', 'Manage Module Access', 'Enable or disable company module access'),

/* T10V - accounting integration export (push sales to the connected
   accounting system through the existing T9A connections). */
('accounting.export', 'Export to Accounting', 'Push sales to the connected accounting integration'),

('online_orders.view', 'View Online Orders', 'View online platform orders'),
('online_orders.manage', 'Manage Online Orders', 'Accept, reject, cancel and complete online orders'),
('online_orders.configure', 'Configure Online Platforms', 'Configure product availability on Uber Eats / Deliveroo')

ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- INTEGRATIONS - generic integration foundation (T9A)
-- NOTE: the table name "integrations" is already used by the Online
-- Orders platform configuration (company + provider + JSONB config).
-- The generic module therefore uses "integration_connections" and must
-- not be renamed without migrating that subsystem first.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    provider_name VARCHAR(100),
    integration_type VARCHAR(50) NOT NULL DEFAULT 'generic',
    base_url TEXT,
    auth_type VARCHAR(30) NOT NULL DEFAULT 'none' CHECK (
        auth_type IN ('none', 'api_key', 'bearer', 'basic')
    ),
    credentials_encrypted TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_company
ON integration_connections(company_id);

CREATE INDEX IF NOT EXISTS idx_integration_connections_store
ON integration_connections(store_id);

CREATE TABLE IF NOT EXISTS integration_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL DEFAULT 'POST' CHECK (
        method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')
    ),
    path TEXT NOT NULL,
    entity_type VARCHAR(50) NOT NULL DEFAULT 'sale',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_endpoints_integration
ON integration_endpoints(integration_id);

CREATE TABLE IF NOT EXISTS integration_field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id UUID NOT NULL REFERENCES integration_endpoints(id) ON DELETE CASCADE,
    partner_field_path TEXT NOT NULL,
    onepos_source_path TEXT,
    mapping_type VARCHAR(20) NOT NULL DEFAULT 'direct' CHECK (
        mapping_type IN ('direct', 'constant', 'template')
    ),
    static_value TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    /* direct mappings must carry a source path; constant/template use static_value. */
    CONSTRAINT integration_mappings_direct_requires_source CHECK (
        mapping_type <> 'direct' OR onepos_source_path IS NOT NULL
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_field_mappings_endpoint
ON integration_field_mappings(endpoint_id);

CREATE TABLE IF NOT EXISTS integration_api_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    endpoint_id UUID REFERENCES integration_endpoints(id) ON DELETE SET NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    correlation_id VARCHAR(100),
    method VARCHAR(10) NOT NULL,
    url TEXT NOT NULL,
    request_headers TEXT,
    request_body TEXT,
    response_status INTEGER,
    response_headers TEXT,
    response_body TEXT,
    duration_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_api_logs_company_created
ON integration_api_logs(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_api_logs_integration
ON integration_api_logs(integration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_api_logs_entity
ON integration_api_logs(entity_type, entity_id);

-- ============================================================
-- SECURE INVOICE LINKS (T9P)
-- ============================================================
--
-- Non-guessable, hash-only download links for sale receipts/invoices.
-- The plaintext token is the customer's credential: it is shown once at
-- creation and is NEVER stored - only a SHA-256 hash is persisted. Lookup
-- is by hash so a database leak cannot expose live links. Tokens are
-- company-scoped through the referenced sale (tenant isolation is the
-- token relationship, exactly as required).
--
-- No receipt/sale data is duplicated here: the table only associates a
-- token with an existing sale.
--
-- Safe to run repeatedly (idempotent).

CREATE TABLE IF NOT EXISTS secure_invoice_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    token_hash VARCHAR(64) NOT NULL UNIQUE,

    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_secure_invoice_links_sale
ON secure_invoice_links(sale_id);

CREATE INDEX IF NOT EXISTS idx_secure_invoice_links_company_created
ON secure_invoice_links(company_id, created_at DESC);

-- ============================================================
-- METADATA-DRIVEN PLATFORM (additive, existing tables remain authoritative)
-- ============================================================

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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_platform_objects_package ON platform_objects(package_id);

CREATE TABLE IF NOT EXISTS platform_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    api_name VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    field_type VARCHAR(30) NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_platform_field_security_role
ON platform_field_security(role_id, company_id);

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

CREATE INDEX IF NOT EXISTS idx_platform_record_history_record
ON platform_record_history(object_id, record_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_platform_approval_requests_company
ON platform_approval_requests(company_id, status, submitted_at DESC);

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
    relationship_type VARCHAR(30) NOT NULL DEFAULT 'lookup',
    child_field_id UUID REFERENCES platform_fields(id) ON DELETE RESTRICT,
    on_delete VARCHAR(20) NOT NULL DEFAULT 'restrict',
    on_update VARCHAR(20) NOT NULL DEFAULT 'restrict',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (parent_object_id, relationship_key)
);

CREATE TABLE IF NOT EXISTS platform_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    page_type VARCHAR(30) NOT NULL,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    record_type_id UUID REFERENCES platform_record_types(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    layout_key VARCHAR(100) NOT NULL DEFAULT '',
    definition JSONB NOT NULL DEFAULT '{"components":[]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS layout_key VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS record_type_id UUID REFERENCES platform_record_types(id) ON DELETE CASCADE;
ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_layouts_object_page_key
    ON platform_layouts(object_id, page_type, layout_key) WHERE layout_key <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_layouts_default_scope
    ON platform_layouts(object_id, page_type, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE is_default=true AND role_id IS NULL AND active=true;


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

CREATE TABLE IF NOT EXISTS platform_message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    api_key VARCHAR(100) NOT NULL,
    description TEXT,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
    object_id UUID REFERENCES platform_objects(id) ON DELETE SET NULL,
    subject TEXT,
    body TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, api_key)
);
CREATE INDEX IF NOT EXISTS idx_platform_message_templates_company
    ON platform_message_templates(company_id, active);

CREATE TABLE IF NOT EXISTS platform_action_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_platform_action_jobs_due
    ON platform_action_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS platform_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(200),
    message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'UNREAD' CHECK (status IN ('UNREAD','READ','ARCHIVED')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_notifications_company
ON platform_notifications(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_workflow_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES platform_rules(id) ON DELETE SET NULL,
    workflow_name VARCHAR(200),
    object_id UUID REFERENCES platform_objects(id) ON DELETE SET NULL,
    record_id UUID,
    trigger_key VARCHAR(100),
    parent_run_id UUID REFERENCES platform_workflow_runs(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED','WAITING','STOPPED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_text TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_workflow_runs_company
ON platform_workflow_runs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_workflow_step_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES platform_workflow_runs(id) ON DELETE CASCADE,
    step_identifier VARCHAR(200),
    step_order INTEGER NOT NULL DEFAULT 0,
    action_type VARCHAR(60),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED','WAITING','STOPPED')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_text TEXT,
    durable_job_id UUID REFERENCES platform_action_jobs(id) ON DELETE SET NULL,
    child_run_id UUID REFERENCES platform_workflow_runs(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_workflow_step_runs_run_order
ON platform_workflow_step_runs(run_id, step_order);

CREATE TABLE IF NOT EXISTS platform_workflow_compensation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES platform_workflow_runs(id) ON DELETE CASCADE,
    step_run_id UUID REFERENCES platform_workflow_step_runs(id) ON DELETE SET NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    action_type VARCHAR(60),
    status VARCHAR(20) NOT NULL,
    error_text TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_workflow_compensation_once
ON platform_workflow_compensation_runs(run_id, step_run_id);

CREATE TABLE IF NOT EXISTS platform_communication_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
    template_id UUID REFERENCES platform_message_templates(id) ON DELETE SET NULL,
    object_id UUID REFERENCES platform_objects(id) ON DELETE SET NULL,
    record_id UUID,
    recipient TEXT NOT NULL,
    provider_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    provider_message_id VARCHAR(255),
    triggered_by_rule UUID REFERENCES platform_rules(id) ON DELETE SET NULL,
    attempted_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_communication_deliveries_company
    ON platform_communication_deliveries(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{"fields":[],"filters":[],"sort":[],"groupBy":null,"metrics":[{"type":"count"}]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, report_key)
);

CREATE TABLE IF NOT EXISTS platform_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    app_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, app_key)
);

CREATE TABLE IF NOT EXISTS platform_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES platform_apps(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    page_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    route_path VARCHAR(200) NOT NULL DEFAULT '/',
    page_type VARCHAR(30) NOT NULL DEFAULT 'object',
    definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, page_key)
);

-- Tenant field definitions and extension values reuse Platform metadata.
ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE platform_fields DROP CONSTRAINT IF EXISTS platform_fields_object_id_api_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_global_name ON platform_fields(object_id, api_name) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_tenant_name ON platform_fields(object_id, company_id, api_name) WHERE company_id IS NOT NULL;
ALTER TABLE platform_record_associations ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'::jsonb;
