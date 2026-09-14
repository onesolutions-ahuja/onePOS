import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

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
| Start
|--------------------------------------------------------------------------
*/

app.listen(PORT, "0.0.0.0", () => {
  console.log(`onePOS running on port ${PORT}`);
});
