import bcrypt from "bcryptjs";

export async function initializeDatabase(pool) {
  console.log("onePOS: checking database...");

  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

    ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
    /* Till Misc Item: line type on sale items (existing rows read as PRODUCT). */
    ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'PRODUCT';
    /* One invisible MISC placeholder product per company (Till Misc Item). */
    CREATE UNIQUE INDEX IF NOT EXISTS uq_products_misc_per_company
      ON products(company_id) WHERE sku = 'MISC' AND active = false;

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

    CREATE TABLE IF NOT EXISTS terminals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      terminal_number VARCHAR(50),
      device_identifier VARCHAR(255),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS company_settings (
      company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      date_format VARCHAR(40) NOT NULL DEFAULT 'DD/MM/YYYY',
      vat_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
      loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      loyalty_earning_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0100,
      scan_go_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      product_view VARCHAR(20) NOT NULL DEFAULT 'image',
      dock_quick_access JSONB NOT NULL DEFAULT '["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]'::jsonb,
      customer_display_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      online_ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      online_payment_methods JSONB NOT NULL DEFAULT '["card", "cash", "cod"]'::jsonb,
      /* Configurable sale invoice/receipt prefixes per sale source. */
      till_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'TO',
      delivery_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'DEL',
      self_checkout_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'SC',
      updated_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    CREATE TABLE IF NOT EXISTS user_stores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE (user_id, store_id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_stores_store
    ON user_stores(store_id, active);

    CREATE INDEX IF NOT EXISTS idx_user_stores_user
    ON user_stores(user_id, active);

    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Global reference data only; customer products and pricing remain separate.
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

    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS dock_quick_access JSONB NOT NULL DEFAULT '["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]'::jsonb;
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS customer_display_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS self_checkout_key_hash VARCHAR(100);
    ALTER TABLE ean_product_master ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

    /* Product image (data URL or remote URL). Additive; NULL = no image. */
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT NULL;
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
      stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
      low_stock_level NUMERIC(12,3) NOT NULL DEFAULT 0,
      track_stock BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS available_on_uber BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS available_on_deliveroo BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS uber_item_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS deliveroo_item_id VARCHAR(255);

    /* Per-product VAT applicability: existing products keep their current
     * behaviour (column defaults to TRUE, so every pre-existing row is
     * standard-applicable and nothing changes until a user edits it). */
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS vat_applicable BOOLEAN NOT NULL DEFAULT TRUE;

    /* T10C age verification: existing products default to NOT age restricted,
     * so pre-existing rows behave exactly as before. */
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS age_restricted BOOLEAN NOT NULL DEFAULT FALSE;

    /* T10U negative-inventory billing safety: OFF by default so existing
     * behaviour (insufficient stock rejected) is unchanged until an
     * Administrator explicitly enables it. */
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS allow_negative_inventory_billing BOOLEAN NOT NULL DEFAULT FALSE;
    /* Scan & Go feature flag consumed by routes/settings.js (additive; safe
       against databases created before the column existed). */
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS scan_go_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    /* Till product browser presentation ('image' | 'compact'). */
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS product_view VARCHAR(20) NOT NULL DEFAULT 'image';
    /* Online-ordering feature flags consumed by routes/settings.js. */
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS online_ordering_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS online_payment_methods JSONB NOT NULL DEFAULT '["card", "cash", "cod"]'::jsonb;
    /* Configurable sale invoice/receipt prefixes per sale source. */
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS till_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'TO';
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS delivery_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'DEL';
    ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS self_checkout_invoice_prefix VARCHAR(10) NOT NULL DEFAULT 'SC';
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS loyalty_enabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE company_settings
      ADD COLUMN IF NOT EXISTS loyalty_earning_rate NUMERIC(5,4) NOT NULL DEFAULT 0.0100;

    /* T10P Scan & Go: customer scan sessions. A session is scoped to exactly
     * one company+store, holds its basket in a child table, and links to the
     * onePOS sale created at checkout (sales.client_request_id = session id
     * provides the database-level duplicate-checkout guard). Additive; no
     * changes to existing sales/inventory semantics. */
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

    /* T10P: sale rows created from a Scan & Go checkout carry the session id
     * in client_request_id (existing unique index enforces one sale per
     * session); receipt_number is prefixed SCANANDGO-<session> so reporting
     * can identify the channel without a schema change. */

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

    ALTER TABLE inventory_movements
      DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

    ALTER TABLE inventory_movements
      ADD CONSTRAINT inventory_movements_movement_type_check CHECK (
        movement_type IN (
          'OPENING', 'PURCHASE', 'SALE', 'CUSTOMER_RETURN',
          'SUPPLIER_RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
          'RETURN_IN', 'RETURN_OUT',
          'ONLINE_RESERVE', 'ONLINE_RELEASE'
        )
      );

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
    ON inventory_movements(product_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_company
    ON inventory_movements(company_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
    ON inventory_movements(movement_type, created_at);

    /*
     * ONLINE ORDERS FOUNDATION
     *
     * Online orders received from delivery platforms (Uber Eats / Deliveroo).
     * Kept fully separate from POS sales; inventory is reserved from the
     * same products.stock_quantity pool the POS uses, via ONLINE_RESERVE /
     * ONLINE_RELEASE inventory movements.
     */
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

    /*
     * Incoming platform items may arrive WITHOUT a onePOS product mapping;
     * those are stored (never dropped) with product_id NULL and
     * mapping_status 'UNMAPPED' so the mapping UI can be built later.
     */
    ALTER TABLE online_order_items
      ALTER COLUMN product_id DROP NOT NULL;

    ALTER TABLE online_order_items
      ADD COLUMN IF NOT EXISTS mapping_status VARCHAR(20) NOT NULL DEFAULT 'MAPPED';

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
     * Links a Deliveroo menu item (by its stable pos_item_id / PLU) to a
     * onePOS product so future Deliveroo orders resolve automatically.
     * A mapping never creates a onePOS product, and matching never happens by
     * name alone.
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

    ALTER TABLE online_orders
      ADD COLUMN IF NOT EXISTS inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS inventory_released BOOLEAN NOT NULL DEFAULT FALSE;

    /*
     * PLATFORM API AUDIT LOG (Uber / Deliveroo)
     *
     * Every outbound platform API request and its response is recorded here
     * for debugging/auditing. Request payloads and headers are stored
     * REDACTED - client secrets, access tokens, API keys and Authorization
     * headers are replaced before insert (see
     * services/onlineOrders/platformLogger.js).
     */
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

    INSERT INTO inventory_movements (
      company_id, product_id, store_id, movement_type,
      quantity_change, balance_after, reference_type, reason
    )
    SELECT
      p.company_id, p.id, store.id, 'OPENING',
      p.stock_quantity, p.stock_quantity, 'MIGRATION',
      'Opening balance migrated from products.stock_quantity'
    FROM products p
    LEFT JOIN LATERAL (
      SELECT id
      FROM stores
      WHERE company_id = p.company_id
        AND active = true
      ORDER BY created_at, id
      LIMIT 1
    ) store ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM inventory_movements existing
      WHERE existing.product_id = p.id
    );

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

    ALTER TABLE suppliers
      ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

    CREATE INDEX IF NOT EXISTS idx_suppliers_company
    ON suppliers(company_id);

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

    /* T10Y — customer credit account (credit OFF by default; balance is
       derived from customer_credit_ledger, never stored here). */
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS credit_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NULL;

    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS postcode VARCHAR(30),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

    /* T10Y — immutable customer credit ledger; balance is derived via
       SUM(amount * sign) over transaction_type (see services/customerCredit.js). */
    CREATE TABLE IF NOT EXISTS customer_credit_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      store_id UUID NULL REFERENCES stores(id) ON DELETE SET NULL,
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      transaction_type VARCHAR(30) NOT NULL CHECK (transaction_type IN
        ('credit_sale', 'payment', 'credit_note', 'debit_note', 'opening')),
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
       * completed (online_orders exists further up in this script). The
       * UNIQUE index below makes duplicate sales on retry impossible.
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

    INSERT INTO customer_stores (customer_id, store_id, last_purchase_at)
    SELECT
      s.customer_id,
      s.store_id,
      MAX(COALESCE(s.completed_at, s.created_at))
    FROM sales s
    INNER JOIN customers c ON c.id = s.customer_id
    WHERE s.customer_id IS NOT NULL
      AND s.store_id IS NOT NULL
    GROUP BY s.customer_id, s.store_id
    ON CONFLICT (customer_id, store_id) DO UPDATE SET
      last_purchase_at = CASE
        WHEN customer_stores.last_purchase_at IS NULL THEN EXCLUDED.last_purchase_at
        WHEN EXCLUDED.last_purchase_at > customer_stores.last_purchase_at THEN EXCLUDED.last_purchase_at
        ELSE customer_stores.last_purchase_at
      END;

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
      item_type VARCHAR(20) NOT NULL DEFAULT 'PRODUCT'
    );

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

    CREATE TABLE IF NOT EXISTS refunds (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id UUID NOT NULL REFERENCES sales(id),
      user_id UUID NOT NULL REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      reason TEXT,
      payment_method VARCHAR(50),
      /* T9M-SMALL: links the refund to its stock_returns record. */
      return_id UUID REFERENCES stock_returns(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    ALTER TABLE till_sessions
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id) ON DELETE SET NULL;

     CREATE TABLE IF NOT EXISTS cash_movements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      till_session_id UUID NOT NULL REFERENCES till_sessions(id),
      user_id UUID NOT NULL REFERENCES users(id),
      type VARCHAR(50) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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

    CREATE TABLE IF NOT EXISTS integrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      provider VARCHAR(100) NOT NULL,
      configuration JSONB,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    /*
     * Online platform (Uber / Deliveroo) settings are stored here, one row
     * per company + provider. Secrets inside the "configuration" JSONB are
     * encrypted by the application (AES-256-GCM, see
     * services/onlineOrders/platformConfig.js).
     */
    ALTER TABLE integrations
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    DELETE FROM integrations a
    USING integrations b
    WHERE a.company_id = b.company_id
      AND a.provider = b.provider
      AND (a.created_at, a.id) < (b.created_at, b.id);

    CREATE UNIQUE INDEX IF NOT EXISTS ux_integrations_company_provider
    ON integrations(company_id, provider);

    /*
     * T9M-SMALL - Sales Returns hardening: human-readable return references,
     * lifecycle status and refund linkage. Idempotent for existing installs.
     */
    ALTER TABLE stock_returns
      ADD COLUMN IF NOT EXISTS return_number VARCHAR(30) UNIQUE,
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
      ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS refund_method VARCHAR(50);

    ALTER TABLE refunds
      ADD COLUMN IF NOT EXISTS return_id UUID REFERENCES stock_returns(id) ON DELETE SET NULL;
  `);

  const permissions = [
    ["sale.view", "View Sales"],
    ["sale.create", "Create Sale"],
    ["sale.edit", "Edit Sale"],
    ["sale.delete", "Delete / Void Sale"],
    ["sale.invoice.view", "View Invoices"],
    ["sale.invoice.reprint", "Reprint Invoice"],
    ["sale.discount", "Apply Discount"],
    ["sale.void_item", "Void Item"],
    ["sale.void", "Void Sale"],
    ["sale.refund", "Refund Sale"],
    ["sale.refund_without_receipt", "Refund Without Receipt"],
    ["sale.price_change", "Change Price"],
    ["sale.hold", "Hold Sale"],
    ["cash.open_drawer", "Open Cash Drawer"],
    ["cash.payout", "Cash Payout"],
    ["cash.adjustment", "Cash Adjustment"],
    ["till.open", "Open Till"],
    ["till.close", "Close Till"],
    ["product.view", "View Products"],
    ["product.create", "Create Product"],
    ["product.edit", "Edit Product"],
    ["product.delete", "Delete Product"],
    ["global_product.view", "View Global Products"],
    ["global_product.create", "Create Global Product"],
    ["global_product.edit", "Edit Global Product"],
    ["global_product.delete", "Delete Global Product"],
    ["category.view", "View Categories"],
    ["category.create", "Create Category"],
    ["category.edit", "Edit Category"],
    ["category.delete", "Delete Category"],
    ["customer.view", "View Customers"],
    ["customer.create", "Create Customer"],
    ["customer.edit", "Edit Customer"],
    ["customer.delete", "Delete Customer"],
    ["purchase.view", "View Purchases"],
    ["purchase.create", "Create Purchase"],
    ["purchase.edit", "Edit Purchase"],
    ["purchase.delete", "Delete / Cancel Purchase"],
    ["store.view", "View Stores"],
    ["store.create", "Create Store"],
    ["store.edit", "Edit Store"],
    ["store.delete", "Delete Store"],
    ["user.view", "View Users"],
    ["user.create", "Create User"],
    ["user.edit", "Edit User"],
    ["user.delete", "Delete User"],
    ["inventory.view", "View Inventory"],
    ["inventory.movements.view", "View Stock Movements"],
    ["inventory.adjust", "Adjust Inventory"],
    ["inventory.replenishment.view", "View Replenishment Suggestions"],
    ["returns.view", "View Returns"],
    ["returns.create", "Create Returns"],
    ["returns.approve", "Approve / Process Returns"],
    ["reports.sales.view", "Sales Report"],
    ["reports.products.view", "Product Sales Report"],
    ["reports.customers.view", "Customer Report"],
    ["reports.inventory.view", "Inventory Overview"],
    ["reports.inventory_movements.view", "Stock Movement Ledger"],
    ["reports.low_stock.view", "Low Stock Report"],
    ["reports.payments.view", "Payments Report"],
    ["reports.purchases.view", "Purchase Report"],
    ["reports.returns.view", "Sales Returns Report"],
    ["reports.profit.view", "Profit Report"],
    ["reports.till.view", "Till Report"],
    ["reports.vat.view", "Tax / VAT Report"],
    ["reports.summary.view", "Reports Summary"],
    ["report.export", "Export Reports"],
    ["user.manage", "Manage Users"],
    ["role.manage", "Manage Roles"],
    ["payment.manage", "Manage Payments"],
    ["integration.manage", "Manage Integrations"],
    ["settings.manage", "Manage Settings"],
    /* T10V - accounting integration export (push sales through the T9A connections). */
    ["accounting.export", "Export to Accounting"],
    ["online_orders.view", "View Online Orders"],
    ["online_orders.manage", "Manage Online Orders"],
    ["online_orders.configure", "Configure Online Platforms"],
    /* T10Z - Combos / Meal Deals. Granular, matching the existing naming style. */
    ["combo.view", "View Combo / Meal Deals"],
    ["combo.create", "Create Combo / Meal Deals"],
    ["combo.edit", "Edit Combo / Meal Deals"],
    ["combo.delete", "Delete Combo / Meal Deals"],
    ["combo.activate", "Activate / Deactivate Combo / Meal Deals"]
  ];

  for (const [code, name] of permissions) {
    await pool.query(
      `
      INSERT INTO permissions (code, name)
      VALUES ($1, $2)
      ON CONFLICT (code) DO NOTHING
      `,
      [code, name]
    );
  }

  /*
   * T9A - generic integration foundation. The table name
   * "integrations" is already used by the Online Orders platform
   * configuration, so the generic module uses "integration_connections".
   */
  await pool.query(
    `
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
    `
  );

  /* T9P - secure invoice link foundation (hash-only token storage).
   * Applied idempotently; mirrors database/secure_invoice_links.sql. */
  await pool.query(`
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
    `);

  /*
   * T10Z — Combos / Meal Deals. Additive: existing sales, products, pricing
   * and inventory are untouched. A deal references EXISTING product ids and
   * category ids (no product data is copied into a second product table), and
   * its price is applied by the single shared engine in
   * services/comboPricing.js. Nothing here creates fake "meal deal" products.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS combo_deals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      deal_type VARCHAR(30) NOT NULL DEFAULT 'meal_deal' CHECK (
        deal_type IN ('meal_deal', 'bundle')
      ),
      deal_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (deal_price >= 0),
      store_scope VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (
        store_scope IN ('all', 'selected')
      ),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT combo_deals_date_range CHECK (
        starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
      )
    );

    CREATE INDEX IF NOT EXISTS idx_combo_deals_company
    ON combo_deals(company_id, active);

    CREATE TABLE IF NOT EXISTS combo_deal_groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID NOT NULL REFERENCES combo_deals(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      required_quantity INTEGER NOT NULL DEFAULT 1 CHECK (required_quantity > 0),
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_combo_deal_groups_deal
    ON combo_deal_groups(deal_id, display_order);

    CREATE TABLE IF NOT EXISTS combo_deal_group_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES combo_deal_groups(id) ON DELETE CASCADE,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT combo_deal_group_products_unique UNIQUE (group_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_combo_group_products_group
    ON combo_deal_group_products(group_id);

    CREATE INDEX IF NOT EXISTS idx_combo_group_products_product
    ON combo_deal_group_products(product_id);

    CREATE TABLE IF NOT EXISTS combo_deal_group_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES combo_deal_groups(id) ON DELETE CASCADE,
      category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      CONSTRAINT combo_deal_group_categories_unique UNIQUE (group_id, category_id)
    );

    CREATE INDEX IF NOT EXISTS idx_combo_group_categories_group
    ON combo_deal_group_categories(group_id);

    CREATE TABLE IF NOT EXISTS combo_deal_stores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deal_id UUID NOT NULL REFERENCES combo_deals(id) ON DELETE CASCADE,
      store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      CONSTRAINT combo_deal_stores_unique UNIQUE (deal_id, store_id)
    );

    CREATE INDEX IF NOT EXISTS idx_combo_deal_stores_deal
    ON combo_deal_stores(deal_id);

    /*
     * Per-sale audit of the meal deals that were applied. This is the ONLY
     * record of a deal on a sale: the sale and its lines keep their ordinary
     * shape, and no synthetic product row is ever inserted.
     */
    CREATE TABLE IF NOT EXISTS sale_combo_applications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
      deal_id UUID REFERENCES combo_deals(id) ON DELETE SET NULL,
      deal_name VARCHAR(200) NOT NULL,
      deal_type VARCHAR(30) NOT NULL DEFAULT 'meal_deal',
      deal_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      original_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      deal_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_sale_combo_applications_sale
    ON sale_combo_applications(sale_id);

    CREATE INDEX IF NOT EXISTS idx_sale_combo_applications_company
    ON sale_combo_applications(company_id, created_at DESC);
  `);

  console.log("onePOS: database ready");
}
