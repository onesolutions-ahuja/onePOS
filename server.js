import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { initializeDatabase } from "./database/init.js";

const { Pool } = pg;

const app = express();

const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

/*
|--------------------------------------------------------------------------
| PostgreSQL
|--------------------------------------------------------------------------
*/

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  : null;

/*
|--------------------------------------------------------------------------
| Database helper
|--------------------------------------------------------------------------
*/

async function db(query, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(query, params);
}

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/api/health", async (req, res) => {
  let database = "not configured";

  if (pool) {
    try {
      await db("SELECT NOW()");
      database = "connected";
    } catch (error) {
      console.error("Database health check failed:", error.message);
      database = "error";
    }
  }

  res.json({
    success: true,
    app: "onePOS",
    status: "online",
    version: "0.1.0",
    database,
    time: new Date().toISOString(),
  });
});

/*
|--------------------------------------------------------------------------
| API information
|--------------------------------------------------------------------------
*/

app.get("/api", (req, res) => {
  res.json({
    name: "onePOS API",
    version: "0.1.0",
    status: "online",
  });
});

/*
|--------------------------------------------------------------------------
| JWT
|--------------------------------------------------------------------------
*/

const JWT_SECRET =
  process.env.JWT_SECRET || "development-secret-change-this";

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      companyId: user.company_id,
      storeId: user.store_id,
      roleId: user.role_id,
      username: user.username,
    },
    JWT_SECRET,
    {
      expiresIn: "12h",
    }
  );
}

/*
|--------------------------------------------------------------------------
| Authentication middleware
|--------------------------------------------------------------------------
*/

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const token = header.substring(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

/*
|--------------------------------------------------------------------------
| Login
|--------------------------------------------------------------------------
*/

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    const result = await db(
      `
      SELECT
        u.id,
        u.username,
        u.password_hash,
        u.full_name,
        u.company_id,
        u.store_id,
        u.role_id,
        u.active,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE LOWER(u.username) = LOWER($1)
      LIMIT 1
      `,
      [username.trim()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.status(403).json({
        success: false,
        message: "User account is disabled",
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const token = createToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.full_name,
        role: user.role_name,
        companyId: user.company_id,
        storeId: user.store_id,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

/*
|--------------------------------------------------------------------------
| Current user
|--------------------------------------------------------------------------
*/

app.get("/api/auth/me", authenticate, async (req, res) => {
  try {
    const result = await db(
      `
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.company_id,
        u.store_id,
        r.name AS role_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1
      `,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.full_name,
        role: user.role_name,
        companyId: user.company_id,
        storeId: user.store_id,
      },
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve user",
    });
  }
});

/*
|--------------------------------------------------------------------------
| Products
|--------------------------------------------------------------------------
*/

app.get("/api/products", authenticate, async (req, res) => {
  try {
    const result = await db(
      `
      SELECT
        id,
        name,
        sku,
        barcode,
        price,
        cost_price,
        stock_quantity,
        category_id,
        active
      FROM products
      WHERE company_id = $1
        AND active = true
      ORDER BY name
      `,
      [req.user.companyId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Unable to load products",
    });
  }
});

/*
|--------------------------------------------------------------------------
| Create sale
|--------------------------------------------------------------------------
*/

app.post("/api/sales", authenticate, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const {
      items = [],
      subtotal = 0,
      tax = 0,
      discount = 0,
      total = 0,
      paymentMethod = "cash",
    } = req.body;

    if (!items.length) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Sale contains no items",
      });
    }

    const sale = await client.query(
      `
      INSERT INTO sales (
        company_id,
        store_id,
        user_id,
        subtotal,
        tax,
        discount,
        total,
        payment_method,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed')
      RETURNING id, created_at
      `,
      [
        req.user.companyId,
        req.user.storeId,
        req.user.id,
        subtotal,
        tax,
        discount,
        total,
        paymentMethod,
      ]
    );

    for (const item of items) {
      await client.query(
        `
        INSERT INTO sale_items (
          sale_id,
          product_id,
          quantity,
          unit_price,
          discount,
          total
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          sale.rows[0].id,
          item.productId,
          item.quantity,
          item.unitPrice,
          item.discount || 0,
          item.total,
        ]
      );
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      sale: sale.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("Sale error:", error);

    res.status(500).json({
      success: false,
      message: "Sale could not be completed",
    });
  } finally {
    client.release();
  }
});

/*
|--------------------------------------------------------------------------
| Serve React
|--------------------------------------------------------------------------
*/

const distPath = path.join(__dirname, "dist");

app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      success: false,
      message: "API endpoint not found",
    });
  }

  res.sendFile(path.join(distPath, "index.html"));
});

/*
|--------------------------------------------------------------------------
| TEMPORARY DATABASE SETUP
|--------------------------------------------------------------------------
*/

app.get("/api/setup/database", async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({
        success: false,
        message: "DATABASE_URL is not configured",
      });
    }

    await db(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

      CREATE TABLE IF NOT EXISTS refunds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id UUID NOT NULL REFERENCES sales(id),
        user_id UUID NOT NULL REFERENCES users(id),
        amount NUMERIC(12,2) NOT NULL,
        reason TEXT,
        payment_method VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

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
      await db(
        `
        INSERT INTO permissions (code, name)
        VALUES ($1, $2)
        ON CONFLICT (code) DO NOTHING
        `,
        [code, name]
      );
    }

    res.json({
      success: true,
      message: "onePOS database initialized successfully"
    });

  } catch (error) {
    console.error("Database setup error:", error);

    res.status(500).json({
      success: false,
      message: "Database setup failed",
      error: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

async function startServer() {
  try {
    if (pool) {
      await initializeDatabase(pool);
    } else {
      console.log("onePOS: DATABASE_URL is not configured");
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`onePOS running on port ${PORT}`);
    });
  } catch (error) {
    console.error("onePOS startup failed:", error);
    process.exit(1);
  }
}

startServer();
