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

    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

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
          'RETURN_OUT'
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
          'RETURN_IN', 'RETURN_OUT'
        )
      );

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product
    ON inventory_movements(product_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_company
    ON inventory_movements(company_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
    ON inventory_movements(movement_type, created_at);

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
      sale_id UUID,
      purchase_id UUID,
      supplier_id UUID,
      request_key VARCHAR(100),
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
      total NUMERIC(12,2) NOT NULL
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
  `);

  const permissions = [
    ["sale.create", "Create Sale"],
    ["sale.discount", "Apply Discount"],
    ["sale.void_item", "Void Item"],
    ["sale.void", "Void Sale"],
    ["sale.refund", "Refund Sale"],
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
    ["inventory.view", "View Inventory"],
    ["inventory.adjust", "Adjust Inventory"],
    ["customer.view", "View Customers"],
    ["customer.create", "Create Customer"],
    ["customer.edit", "Edit Customer"],
    ["report.view", "View Reports"],
    ["report.export", "Export Reports"],
    ["user.manage", "Manage Users"],
    ["role.manage", "Manage Roles"],
    ["payment.manage", "Manage Payments"],
    ["integration.manage", "Manage Integrations"],
    ["settings.manage", "Manage Settings"]
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

  console.log("onePOS: database ready");
}
