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
-- COMPANY SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS company_settings (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    date_format VARCHAR(40) NOT NULL DEFAULT 'DD/MM/YYYY',
    vat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
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
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100),
    barcode VARCHAR(100),
    description TEXT,
    price NUMERIC(12,2) NOT NULL DEFAULT 0,
    cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
    vat_applicable BOOLEAN NOT NULL DEFAULT TRUE,
    age_restricted BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE INDEX IF NOT EXISTS idx_products_company
ON products(company_id);

CREATE INDEX IF NOT EXISTS idx_products_barcode
ON products(barcode);

CREATE INDEX IF NOT EXISTS idx_products_sku
ON products(sku);

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
            'ONLINE_RELEASE'
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
        status IN ('DRAFT', 'RECEIVED', 'CANCELLED')
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
    unit_cost NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),
    line_total NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_purchases_company_date
ON purchases(company_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase
ON purchase_items(purchase_id);

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
    postcode VARCHAR(30),
    loyalty_number VARCHAR(100),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_company
ON customers(company_id);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_integrations_company_provider
ON integrations(company_id, provider);

-- ============================================================
-- ONLINE ORDERS (UBER EATS / DELIVEROO)
-- ============================================================

CREATE TABLE IF NOT EXISTS online_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('uber', 'deliveroo')),
    external_order_id VARCHAR(255) NOT NULL,
    external_reference VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED' CHECK (
        status IN ('RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED')
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

('product.view', 'View Products', 'View products'),
('product.create', 'Create Product', 'Create products'),
('product.edit', 'Edit Product', 'Edit products'),
('product.delete', 'Delete Product', 'Delete products'),

('customer.view', 'View Customers', 'View customers'),
('customer.create', 'Create Customer', 'Create customers'),
('customer.edit', 'Edit Customer', 'Edit customers'),
('customer.delete', 'Delete Customer', 'Delete customers'),

('purchase.view', 'View Purchases', 'View purchase orders'),
('purchase.create', 'Create Purchase', 'Create purchase orders'),
('purchase.edit', 'Edit Purchase', 'Edit purchase orders'),
('purchase.delete', 'Delete / Cancel Purchase', 'Delete or cancel purchase orders'),

('inventory.view', 'View Inventory', 'View stock overview'),
('inventory.movements.view', 'View Stock Movements', 'View stock movement ledger'),
('inventory.adjust', 'Adjust Inventory', 'Adjust stock levels'),

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
('report.export', 'Export Reports', 'Export reports to CSV'),

('user.manage', 'Manage Users', 'Manage users'),
('role.manage', 'Manage Roles', 'Manage roles and permissions'),
('payment.manage', 'Manage Payments', 'Manage payment settings'),
('integration.manage', 'Manage Integrations', 'Manage integrations'),
('settings.manage', 'Manage Settings', 'Manage settings'),

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
