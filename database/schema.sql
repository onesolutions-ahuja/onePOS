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
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- STORES
-- ============================================================

CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    code VARCHAR(50),
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    postcode VARCHAR(30),
    phone VARCHAR(50),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stores_company
ON stores(company_id);

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
-- ROLES
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
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
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255),
    pin_hash TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company
ON users(company_id);

CREATE INDEX IF NOT EXISTS idx_users_store
ON users(store_id);

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

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    barcode VARCHAR(100),
    description TEXT,
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
    stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
    low_stock_level NUMERIC(12,3) NOT NULL DEFAULT 0,
    track_stock BOOLEAN NOT NULL DEFAULT TRUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_company
ON products(company_id);

CREATE INDEX IF NOT EXISTS idx_products_barcode
ON products(barcode);

CREATE INDEX IF NOT EXISTS idx_products_sku
ON products(sku);

-- ============================================================
-- CUSTOMERS
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    loyalty_number VARCHAR(100),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_company
ON customers(company_id);

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
    completed_at TIMESTAMPTZ
);

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
    total NUMERIC(12,2) NOT NULL
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
-- REFUNDS
-- ============================================================

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_id UUID NOT NULL REFERENCES sales(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(12,2) NOT NULL,
    reason TEXT,
    payment_method VARCHAR(50),
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
-- TILL SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS till_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    terminal_id UUID NOT NULL REFERENCES terminals(id),
    user_id UUID NOT NULL REFERENCES users(id),

    opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    closing_cash NUMERIC(12,2),

    expected_cash NUMERIC(12,2),
    cash_difference NUMERIC(12,2),

    status VARCHAR(50) NOT NULL DEFAULT 'open',

    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_till_sessions_terminal
ON till_sessions(terminal_id);

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

    details JSONB,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_company
ON audit_logs(company_id);

CREATE INDEX IF NOT EXISTS idx_audit_created
ON audit_logs(created_at);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, name, description)
VALUES
('sale.create', 'Create Sale', 'Create sales'),
('sale.discount', 'Apply Discount', 'Apply discounts'),
('sale.void_item', 'Void Item', 'Void individual sale items'),
('sale.void', 'Void Sale', 'Void complete sales'),
('sale.refund', 'Refund Sale', 'Process refunds'),
('sale.refund_without_receipt', 'Refund Without Receipt', 'Allow refunds without receipt'),
('sale.price_change', 'Change Price', 'Change item price at till'),
('sale.hold', 'Hold Sale', 'Hold and retrieve sales'),

('cash.open_drawer', 'Open Cash Drawer', 'Open cash drawer'),
('cash.payout', 'Cash Payout', 'Remove cash from till'),
('cash.adjustment', 'Cash Adjustment', 'Adjust till cash'),
('till.open', 'Open Till', 'Open till session'),
('till.close', 'Close Till', 'Close till session'),

('product.view', 'View Products', 'View products'),
('product.create', 'Create Product', 'Create products'),
('product.edit', 'Edit Product', 'Edit products'),
('product.delete', 'Delete Product', 'Delete products'),

('inventory.view', 'View Inventory', 'View stock'),
('inventory.adjust', 'Adjust Inventory', 'Adjust stock'),

('customer.view', 'View Customers', 'View customers'),
('customer.create', 'Create Customer', 'Create customers'),
('customer.edit', 'Edit Customer', 'Edit customers'),

('report.view', 'View Reports', 'View reports'),
('report.export', 'Export Reports', 'Export reports'),

('user.manage', 'Manage Users', 'Manage users'),
('role.manage', 'Manage Roles', 'Manage roles'),
('payment.manage', 'Manage Payments', 'Manage payment settings'),
('integration.manage', 'Manage Integrations', 'Manage integrations'),
('settings.manage', 'Manage Settings', 'Manage settings')

ON CONFLICT (code) DO NOTHING;
