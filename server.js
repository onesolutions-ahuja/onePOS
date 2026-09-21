import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";
import { initializeDatabase } from "./database/init.js";
import { createAuditWriter } from "./services/auditLog.js";
import { createSessionToken, createAuthenticate } from "./services/session.js";
import createTillRouter from "./routes/till.js";
import createCustomersRouter from "./routes/customers.js";
import createProductsRouter from "./routes/products.js";
import createEanLookupRouter from "./routes/eanLookup.js";
import createSuppliersRouter from "./routes/suppliers.js";
import createPurchasesRouter from "./routes/purchases.js";
import createInventoryRouter from "./routes/inventory.js";
import createSalesRouter from "./routes/sales.js";
import createSelfCheckoutRouter, { createSelfCheckoutModeGate } from "./routes/selfCheckout.js";
import createScanGoRouter from "./routes/scanAndGo.js";
import createReturnsRouter from "./routes/returns.js";
import createReportsRouter from "./routes/reports.js";
import createSecureInvoiceRouter from "./routes/secureInvoice.js";
import createSettingsRouter from "./routes/settings.js";
import createWhatsAppSettingsRouter from "./routes/whatsapp.js";
import createInvoiceDeliveryRouter from "./routes/invoiceDelivery.js";
import createAdminRouter from "./routes/admin.js";
import createIntegrationsRouter from "./routes/integrations.js";
import createDashboardRouter from "./routes/dashboard.js";
import createGlobalProductsRouter from "./routes/globalProducts.js";
import createReplenishmentRouter from "./routes/replenishment.js";
import createOnlineRouter from "./routes/online.js";
import createCustomerAuthRouter from "./routes/customerAuth.js";
import createAccountingExportRouter from "./routes/accountingExport.js"; // T10V - accounting integration export
import createJarvisRouter from "./routes/jarvis.js"; // JARVIS V1 - authenticated AI assistant questions
import { createJarvis } from "./services/jarvis/index.js";

const { Pool } = pg;

const app = express();

const PORT = process.env.PORT || 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
|--------------------------------------------------------------------------
| Middleware
|--------------------------------------------------------------------------
*/

app.use(cors());

/*
 * Deliveroo webhooks are HMAC-signed over the RAW request body - parse it
 * before the global JSON parser consumes the stream (express.raw sets
 * req.body to a Buffer; express.json then skips the already-parsed body).
 */
app.use("/api/online/deliveroo/webhook", express.raw({ type: "*/*", limit: "1mb" }));

/*
 * Uber primary webhook is HMAC-signed (X-Uber-Signature) over the RAW body -
 * same raw-parsing mechanism as the Deliveroo webhook above.
 */
app.use("/api/online/uber/webhook", express.raw({ type: "*/*", limit: "1mb" }));

app.use(express.json({ limit: "10mb" }));

/* T10D: Self-Checkout mode gate — ahead of EVERY API router so a
 * self-checkout mode token is refused for privileged operations
 * server-side (never merely hidden in the UI). */
app.use(createSelfCheckoutModeGate());
app.use(express.urlencoded({ limit: "10mb", extended: true }));

/*
|--------------------------------------------------------------------------
| PostgreSQL
|-------------------------------------------------------------------------- */
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
      /*
       * Startup safety: without these bounds a single abandoned connection
       * (e.g. a transaction left "idle in transaction" while an outbound
       * platform HTTP call never returns) keeps its row locks forever, every
       * later query - including the schema DDL run at boot - waits on it
       * indefinitely, app.listen() is never reached and the platform reports
       * "No open ports detected".
       *
       *   - connectionTimeoutMillis: fail fast instead of hanging on connect
       *   - idle_in_transaction_session_timeout: Postgres aborts an abandoned
       *     open transaction (releasing its locks) instead of keeping it
       *   - lock_timeout / statement_timeout: a blocked query errors out
       *     rather than waiting forever
       */
      connectionTimeoutMillis: 15000,
      idle_in_transaction_session_timeout: 30000,
      lock_timeout: 15000,
      statement_timeout: 120000,
    })
  : null;

app.locals.pool = pool;
/* T10P: Scan & Go checkout deducts stock through the SAME inventory ledger
 * helper the till and online orders use (no second inventory mechanism). */
app.locals.createInventoryMovement = createInventoryMovement;

/*
 * A backend error on an idle pool connection (network blip, Postgres restart,
 * idle-in-transaction termination) must never take the whole server down.
 * The broken client is simply removed from the pool; in-flight requests that
 * used it get their own query error which the route handlers report normally.
 */
if (pool) {
  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool client error (connection discarded):", error.message);
  });
}

/*
 * Last-resort process guards: a single stray async rejection (fire-and-forget
 * delivery, integration dispatch, a dropped socket mid-write) must never kill
 * the till server - a dead backend shows up to every open POS screen as
 * "Failed to fetch". Log with full stack and keep serving; Node's default
 * behaviour for these events is to terminate the process.
 */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (server kept alive):", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception (server kept alive):", error);
});

async function db(query, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(query, params);
}

const paymentProviders = new Map();

async function testPaymentTerminal(terminal) {
  if (!terminal || !terminal.active || !terminal.provider || !terminal.connection_url) {
    return { status: "NOT_CONFIGURED", message: "Not configured" };
  }

  const provider = paymentProviders.get(terminal.provider.toLowerCase());

  if (!provider) {
    return { status: "PROVIDER_NOT_SUPPORTED", message: "Provider not supported" };
  }

  return provider.testConnection(terminal);
}

/*
 * Audit logging must never break the operation being audited - see
 * services/auditLog.js (unknown users are nulled to satisfy the FK; other
 * failures are logged and swallowed so a committed business action stands).
 */
const writeAudit = createAuditWriter({ db });

/*
|--------------------------------------------------------------------------
| JWT / Authentication (session layer - services/session.js)
|--------------------------------------------------------------------------
*/

const createToken = createSessionToken;
const authenticate = createAuthenticate();

/*
|--------------------------------------------------------------------------
| JARVIS AI assistant (V1 - authenticated text questions)
|--------------------------------------------------------------------------
|
| Built once at boot from the environment. GEMINI_API_KEY is read here,
| server-side only: it is never sent to the browser and never returned in a
| response. The AI provider sits behind a service abstraction
| (services/jarvis/*) so a future OpenAI / local model does not change this
| endpoint. See JARVIS.md.
|
| This changes NO existing behaviour - it only adds the JARVIS service used
| by the dedicated routes/jarvis.js router registered further below.
*/
const jarvis = createJarvis();

/*
|--------------------------------------------------------------------------
| Authorization (reuses the existing permissions / role_permissions model)
|--------------------------------------------------------------------------
|
| `authorize` is intended to be used after `authenticate`. It resolves the
| permission codes granted to `req.user.roleId` via `role_permissions` and
| requires the user to hold at least one of the supplied codes.
|
| Administrator/Owner roles (as defined by `canViewCompanyCustomers`) retain
| full access, matching the existing behaviour for those accounts.
*/

async function getRolePermissionCodes(roleId) {
  if (!roleId) return [];

  const result = await db(
    `
    SELECT p.code
    FROM role_permissions rp
    INNER JOIN permissions p
      ON p.id = rp.permission_id
    WHERE rp.role_id = $1
    `,
    [roleId]
  );

  return result.rows.map((row) => row.code);
}

function authorize(...permissionCodes) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    try {
      const isAdmin = await canViewCompanyCustomers(req.user);
      if (isAdmin) {
        return next();
      }

      const codes = await getRolePermissionCodes(req.user.roleId);

      if (permissionCodes.some((code) => codes.includes(code))) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action",
      });
    } catch (error) {
      console.error("Authorization error:", error);

      return res.status(500).json({
        success: false,
        message: "Authorization check failed",
      });
    }
  };
}

async function associateCustomerWithStore(client, customerId, storeId, companyId, lastPurchaseAt = null) {
  const customer = await client.query(
    `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND active = true`,
    [customerId, companyId]
  );
  if (!customer.rows.length) throw new Error("Customer not found");

  const store = await client.query(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2 AND active = true`,
    [storeId, companyId]
  );
  if (!store.rows.length) throw new Error("Store not found");

  const result = await client.query(
    `
    INSERT INTO customer_stores (customer_id, store_id, last_purchase_at)
    VALUES ($1,$2,$3)
    ON CONFLICT (customer_id, store_id) DO UPDATE SET
      active = true,
      last_purchase_at = CASE
        WHEN EXCLUDED.last_purchase_at IS NULL THEN customer_stores.last_purchase_at
        WHEN customer_stores.last_purchase_at IS NULL THEN EXCLUDED.last_purchase_at
        WHEN EXCLUDED.last_purchase_at > customer_stores.last_purchase_at THEN EXCLUDED.last_purchase_at
        ELSE customer_stores.last_purchase_at
      END
    RETURNING id, customer_id, store_id, created_at, last_purchase_at, active
    `,
    [customerId, storeId, lastPurchaseAt]
  );
  return result.rows[0];
}

async function canViewCompanyCustomers(user) {
  const result = await db(
    `SELECT 1 FROM roles WHERE id = $1 AND company_id = $2 AND LOWER(name) IN ('administrator', 'admin', 'owner') LIMIT 1`,
    [user.roleId, user.companyId]
  );
  return result.rows.length > 0;
}

async function canAccessStore(user, storeId) {
  // Admin/Owner bypass
  if (await canViewCompanyCustomers(user)) {
    return true;
  }
  
  // Check if store is in user's assigned stores
  if (!user.assignedStoreIds || !Array.isArray(user.assignedStoreIds)) {
    return false;
  }
  
  return user.assignedStoreIds.includes(storeId);
}

const inventoryMovementTypes = new Set([
  "OPENING",
  "PURCHASE",
  "SALE",
  "CUSTOMER_RETURN",
  "SUPPLIER_RETURN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "RETURN_IN",
  "RETURN_OUT",
  "ONLINE_RESERVE",
  "ONLINE_RELEASE",
]);

async function createInventoryMovement(client, {
  companyId,
  productId,
  storeId,
  movementType,
  quantityChange,
  referenceType = null,
  referenceId = null,
  reason = null,
  notes = null,
  createdBy = null,
}) {
  const quantity = Number(quantityChange);

  if (
    !inventoryMovementTypes.has(movementType) ||
    !Number.isFinite(quantity) ||
    (quantity === 0 && movementType !== "OPENING")
  ) {
    throw new Error("Invalid inventory movement");
  }

  const productResult = await client.query(
    `
    SELECT
      id,
      name,
      price,
      vat_rate,
      track_stock,
      stock_quantity
    FROM products
    WHERE id = $1
      AND company_id = $2
      AND active = true
    FOR UPDATE
    `,
    [productId, companyId]
  );

  if (!productResult.rows.length) {
    throw new Error("Product not found");
  }

  const product = productResult.rows[0];
  const currentBalance = Number(product.stock_quantity);
  const newBalance = currentBalance + quantity;

  /*
   * SALE movements may drive the balance negative: a paid sale is the
   * authoritative record and must never be rolled back because stock ran
   * out. Every other movement type (adjustments, returns, transfers…)
   * still keeps the non-negative-balance guard.
   */
  if (newBalance < 0 && movementType !== "SALE") {
    throw new Error(`Insufficient stock for ${product.name}`);
  }

  await client.query(
    `
    UPDATE products
    SET
      stock_quantity = $1,
      updated_at = NOW()
    WHERE id = $2
      AND company_id = $3
    `,
    [newBalance, productId, companyId]
  );

  const movementResult = await client.query(
    `
    INSERT INTO inventory_movements (
      company_id,
      product_id,
      store_id,
      movement_type,
      quantity_change,
      balance_after,
      reference_type,
      reference_id,
      reason,
      notes,
      created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING
      id,
      product_id,
      store_id,
      movement_type,
      quantity_change,
      balance_after,
      reference_type,
      reference_id,
      reason,
      notes,
      created_by,
      created_at
    `,
    [
      companyId,
      productId,
      storeId || null,
      movementType,
      quantity,
      newBalance,
      referenceType,
      referenceId,
      reason && String(reason).trim() ? String(reason).trim() : null,
      notes && String(notes).trim() ? String(notes).trim() : null,
      createdBy,
    ]
  );

  return {
    product,
    balance: newBalance,
    movement: movementResult.rows[0],
  };
}

/*
|--------------------------------------------------------------------------
| Health
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
    version: "0.2.0",
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
    version: "0.2.0",
    status: "online",
  });
});

/*
|--------------------------------------------------------------------------
| LOGIN
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

    await db(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );

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
| CURRENT USER
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
    console.error("Current user error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve user",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CURRENT SESSION PERMISSIONS (sidebar/UI gating)
|--------------------------------------------------------------------------
|
| GET /api/auth/me/permissions
|
| Read-only convenience for UI gating — reports the SAME permission model
| the server-side `authorize()` helper enforces: Administrator/Admin/Owner
| roles bypass permission checks (reported via `isAdmin`), every other role
| reports the codes granted through role_permissions. It never grants
| anything on its own; every endpoint keeps enforcing its own checks.
| (T10B-SMALL: the frontend AdminLayout calls this to show/hide gated
| sidebar entries such as Reports, Returns, Order Prep and Integrations.)
*/

app.get("/api/auth/me/permissions", authenticate, async (req, res) => {
  try {
    const isAdmin = await canViewCompanyCustomers(req.user);

    let permissions = [];
    if (!isAdmin && req.user.roleId) {
      permissions = await getRolePermissionCodes(req.user.roleId);
    }

    res.json({
      success: true,
      data: {
        isAdmin,
        permissions,
      },
    });
  } catch (error) {
    console.error("Current user permissions error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve permissions",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CHANGE PASSWORD
|--------------------------------------------------------------------------
*/

app.post("/api/auth/change-password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters",
      });
    }

    // Fetch existing hash
    const result = await db(
      `
      SELECT id, password_hash
      FROM users
      WHERE id = $1
      LIMIT 1
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

    const validCurrent = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!validCurrent) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Reuse the same bcrypt hashing used at registration/login
    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await db(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [newPasswordHash, user.id]
    );

    res.json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to change password",
    });
  }
});

/*
|--------------------------------------------------------------------------
| CUSTOMER DATA FOUNDATION
|--------------------------------------------------------------------------
*/

app.use(
  "/api",
  createCustomersRouter({
    authenticate,
    authorize,
    db,
    pool,
    canViewCompanyCustomers,
    associateCustomerWithStore,
  })
);

/*

/*
|--------------------------------------------------------------------------
| DASHBOARD SUMMARY
|--------------------------------------------------------------------------
*/

app.use("/api", createEanLookupRouter({ authenticate, db }));

/* T10D: Self-Checkout session routes (enter/exit the restricted mode). */
app.use("/api", createSelfCheckoutRouter({ authenticate, authorize, db, bcrypt, writeAudit }));

/* T10P: Scan & Go — customer scan sessions (token-authenticated, store/company
 * resolved server-side from the session; see routes/scanAndGo.js). */
app.use("/api", createScanGoRouter({ authenticate, db, pool, writeAudit }));

app.use(
  "/api",
  createGlobalProductsRouter({ authenticate, authorize, db })
);

app.use("/api", createDashboardRouter({ authenticate, db }));

/*
 * JARVIS AI assistant (V1) - POST /api/jarvis, GET /api/jarvis/status.
 * Authenticated with the existing session middleware; the caller's company,
 * store, role and permission codes come from the verified session claims and
 * the existing role_permissions lookup (read-only).
 */
app.use(
  "/api",
  createJarvisRouter({
    authenticate,
    jarvis,
    getRolePermissionCodes,
  })
);

app.use("/api", createSettingsRouter({ authenticate, authorize, db, pool, writeAudit, testPaymentTerminal }));
app.use("/api", createCustomerAuthRouter); /* routes/customerAuth.js exports a router instance (self-contained) */
app.use("/api", createWhatsAppSettingsRouter({ authenticate, authorize, db, pool, writeAudit }));
app.use("/api", createInvoiceDeliveryRouter({ authenticate, authorize, db, pool, writeAudit }));

/*
|--------------------------------------------------------------------------
| CATEGORIES & PRODUCTS
|--------------------------------------------------------------------------
|
| Product and category routes are registered via routes/products.js,
| receiving the existing authenticate, authorize, db, pool and
| createInventoryMovement functions so behaviour is unchanged.
|
| Route ordering preserved:
|   GET  /api/categories            (product.view)
|   POST /api/categories            (product.create)
|   PUT  /api/categories/:id        (product.edit)
|   DEL  /api/categories/:id        (product.delete)
|   GET  /api/products              (product.view)
|   GET  /api/products/:id          (product.view)
|   POST /api/products              (product.create)
|   PUT  /api/products/:id          (product.edit)
|   DEL  /api/products/:id          (product.delete)
*/
app.use(
  "/api",
  createProductsRouter({
    authenticate,
    authorize,
    db,
    pool,
    createInventoryMovement,
    writeAudit,
  })
);

/*
|--------------------------------------------------------------------------
| INVENTORY - MOVEMENTS / ADJUSTMENTS / RECONCILIATION
|--------------------------------------------------------------------------
|
| Inventory routes are registered via routes/inventory.js, receiving the
| existing authenticate, authorize, db, pool, createInventoryMovement
| and inventoryMovementTypes so behaviour is unchanged.
|
| Route ordering preserved:
|   GET  /api/inventory/movements       (inventory.view)
|   POST /api/inventory/adjustments     (inventory.adjust)
|   GET  /api/inventory/reconciliation  (inventory.view)
*/
app.use(
  "/api",
  createInventoryRouter({
    authenticate,
    authorize,
    db,
    pool,
    createInventoryMovement,
    inventoryMovementTypes,
  })
);

/* T10H: read-only replenishment suggestions (planning layer, no writes). */
app.use("/api", createReplenishmentRouter({ authenticate, authorize, db }));

/*
|--------------------------------------------------------------------------
| SUPPLIERS
|--------------------------------------------------------------------------
|
| Supplier routes are registered via routes/suppliers.js, receiving the
| existing authenticate, authorize and db functions so behaviour is
| unchanged.
|
| Route ordering preserved:
|   GET  /api/suppliers              (inventory.view)
|   GET  /api/suppliers/:id          (inventory.view)
|   POST /api/suppliers              (inventory.adjust)
|   PUT  /api/suppliers/:id          (inventory.adjust)
|   PATCH /api/suppliers/:id/status  (inventory.adjust)
*/

app.use(
  "/api",
  createSuppliersRouter({
    authenticate,
    authorize,
    db,
  })
);

/*
|--------------------------------------------------------------------------
| PURCHASES / GOODS RECEIVED
|--------------------------------------------------------------------------
|
| Purchase and receive routes are registered via routes/purchases.js,
| receiving the existing authenticate, authorize, db, pool and
| createInventoryMovement functions so behaviour is unchanged.
|
| Route ordering preserved:
|   GET  /api/purchases              (inventory.view)
|   GET  /api/purchases/:id          (inventory.view)
|   POST /api/purchases              (inventory.adjust)
|   POST /api/purchases/:id/receive  (inventory.adjust)
*/
app.use(
  "/api",
  createPurchasesRouter({
    authenticate,
    authorize,
    db,
    pool,
    createInventoryMovement,
  })
);

app.use("/api", createSalesRouter({ authenticate, authorize, db, pool, createInventoryMovement, associateCustomerWithStore, writeAudit, selfCheckoutMode: (req) => req.user?.mode === "self_checkout" }));

app.use("/api", createReturnsRouter({ authenticate, authorize, db, pool, createInventoryMovement, writeAudit }));

app.use("/api", createAdminRouter({ authenticate, authorize, db, pool, canViewCompanyCustomers, bcrypt }));

app.use("/api", createReportsRouter({ authenticate, authorize, db }));

/*
|--------------------------------------------------------------------------
| SECURE INVOICE LINKS (T9P)
|--------------------------------------------------------------------------
|
| Public token-based invoice download at GET /i/:token (outside /api - the
| opaque token is the only credential; no IDs in the URL, hash-only token
| storage, generic 404s) plus admin create/revoke endpoints under
| /api/sales/:saleId/secure-links using the existing permission model.
*/
app.use(createSecureInvoiceRouter({ db, pool, authenticate, authorize, writeAudit }));

/*
| Online Orders (Uber Eats / Deliveroo foundation) - product platform
| configuration and online order lifecycle. Platform-specific logic stays
| isolated in services/onlineOrders/* (stubbed until real API credentials).
*/

app.use(
  "/api",
  createOnlineRouter({
    authenticate,
    authorize,
    db,
    pool,
    writeAudit,
    createInventoryMovement,
  })
);

/*
| T9A - generic integration foundation (provider-agnostic). Credentials are
| encrypted at rest; no Sales/Purchases data is sent anywhere by this module.
*/
app.use(
  "/api",
  createIntegrationsRouter({
    authenticate,
    authorize,
    db,
    pool,
    writeAudit,
  })
);

/*
| T10V - accounting integration export: wires the T10W normalizers + T10X
| dispatcher to real sale data over the existing T9A connection system.
| All routes are accounting.export gated and company-scoped.
*/
app.use(
  "/api/accounting",
  createAccountingExportRouter({
    authenticate,
    authorize,
    db,
    writeAudit,
  })
);


app.get("/api/held-sales", authenticate, authorize("sale.hold"), async (req, res) => {
  try {
    const result = await db(
      `SELECT id, customer_id, items, discount_type, discount_value, notes, created_at FROM held_sales WHERE company_id=$1 AND store_id=$2 AND user_id=$3 ORDER BY created_at DESC`,
      [req.user.companyId, req.user.storeId, req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Load held sales error:", error);
    res.status(500).json({ success: false, message: "Unable to load held sales" });
  }
});

app.post("/api/held-sales", authenticate, authorize("sale.hold"), async (req, res) => {
  const { items, miscLines, customerId = null, discountType = null, discountValue = 0, notes = null } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, message: "Cannot hold an empty sale" });
  try {
    const result = await db(
      `INSERT INTO held_sales (company_id,store_id,user_id,customer_id,items,discount_type,discount_value,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at`,
      [req.user.companyId, req.user.storeId, req.user.id, customerId, JSON.stringify({ items, miscLines: Array.isArray(miscLines) ? miscLines : [] }), discountType, Number(discountValue) || 0, notes || null]
    );
    res.status(201).json({ success: true, message: "Sale held", data: result.rows[0] });
  } catch (error) {
    console.error("Hold sale error:", error);
    res.status(500).json({ success: false, message: "Unable to hold sale" });
  }
});

app.delete("/api/held-sales/:id", authenticate, authorize("sale.hold"), async (req, res) => {
  try {
    const result = await db("DELETE FROM held_sales WHERE id=$1 AND company_id=$2 AND store_id=$3 AND user_id=$4 RETURNING id", [req.params.id, req.user.companyId, req.user.storeId, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Held sale not found" });
    res.json({ success: true, message: "Held sale removed" });
  } catch (error) { res.status(500).json({ success: false, message: "Unable to remove held sale" }); }
});

/*
|--------------------------------------------------------------------------
| TILL SESSIONS & CASH MANAGEMENT
|--------------------------------------------------------------------------
|
| A till session is opened per terminal (till) for a store. One open session
| is allowed per terminal. Sales created while a session is open are linked
| to the session's terminal; cash sales contribute to expected cash at close,
| card sales do not. Cash movements record manual cash-in / cash-out.
|
| Routes are registered via routes/till.js, receiving the existing
| authenticate, authorize, db, getRolePermissionCodes and
| canViewCompanyCustomers functions so behaviour is unchanged.
*/

app.use(
  "/api",
  createTillRouter({
    authenticate,
    authorize,
    db,
    getRolePermissionCodes,
    canViewCompanyCustomers,
  })
);

/*
|--------------------------------------------------------------------------
| DATABASE SETUP
|--------------------------------------------------------------------------
|
| Safe to run repeatedly.
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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      ["customer.view", "View Customers"],
      ["customer.create", "Create Customer"],
      ["customer.edit", "Edit Customer"],
      ["customer.delete", "Delete Customer"],
      ["purchase.view", "View Purchases"],
      ["purchase.create", "Create Purchase"],
      ["purchase.edit", "Edit Purchase"],
      ["purchase.delete", "Delete / Cancel Purchase"],
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
      ["online_orders.view", "View Online Orders"],
      ["online_orders.manage", "Manage Online Orders"],
      ["online_orders.configure", "Configure Online Platforms"],
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
      message: "onePOS database initialized successfully",
    });
  } catch (error) {
    console.error("Database setup error:", error);

    res.status(500).json({
      success: false,
      message: "Database setup failed",
      error: error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| React frontend
|--------------------------------------------------------------------------
*/

const distPath = path.join(__dirname, "dist");

/*
 * Keep the operational React application separate from the public marketing
 * entry point. These routes are registered after every API and secure invoice
 * route, so neither can be intercepted by the frontend fallback.
 */
/*
 * T10V: the offline service worker must be reachable as a real script.
 * The app-shell route below answers every /app/* path with index.html and its
 * extension guard 404s asset-like paths; both would break
 * navigator.serviceWorker.register("/app/offline-sw.js"). Serve the worker
 * itself first, uncached, so a rebuilt shell can always replace an older
 * worker and purge that worker's stale shell cache.
 */
app.get("/app/offline-sw.js", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.type("application/javascript");
  res.sendFile(path.join(distPath, "app", "offline-sw.js"));
});

app.get(["/login", "/app", "/app/*", "/customer-display"], (req, res) => {
  /* T10V: never satisfy a missing static asset with HTML. A stale cached
     index.html can reference a hashed bundle that a rebuild replaced; serving
     HTML for the .js request turns the page blank. Return 404 instead so the
     browser fails fast and a reload picks up the fresh index. */
  if (path.extname(req.path) && req.path !== "/" && !req.path.endsWith(".html")) {
    return res.status(404).type("text").send("Not found");
  }
  /* T10V: the app shell must never be cached — it references hashed bundles
     that a rebuild replaces. A cached shell is what produced the blank page
     (stale HTML requesting a no-longer-existing asset). */
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(distPath, "app", "index.html"));
});

app.use(express.static(distPath));

/*
 * Marketing site fallback - serve marketing index.html for all non-app,
 * non-API, non-secure-invoice routes to enable client-side routing.
 */
app.use((req, res) => {
  // Skip API routes, app routes, and secure invoice routes
  if (req.path.startsWith("/api/") || req.path.startsWith("/login") || req.path.startsWith("/app") || req.path.startsWith("/i/")) {
    return res.status(404).json({
      success: false,
      message: "Not found",
    });
  }
  
  // Serve marketing site for all other routes
  res.sendFile(path.join(distPath, "index.html"));
});

/*
|--------------------------------------------------------------------------
| Unknown API routes
|--------------------------------------------------------------------------
*/

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
| START
|--------------------------------------------------------------------------
*/

async function startServer() {
  try {
    if (pool) {
      console.log("onePOS: checking database...");

      /*
       * Database initialization must never leave the process without an open
       * port: Render reports "No open ports detected" and kills the deploy if
       * the HTTP listener is not reached. Failures/timeouts are therefore
       * logged and the server still starts (API calls that need the database
       * surface their own error), which keeps the deployment alive and
       * diagnosable instead of hanging or crash-looping.
       */
      try {
        await db("SELECT NOW()");

        await initializeDatabase(pool);

        console.log("onePOS: database ready");
      } catch (dbError) {
        console.error(
          "onePOS: database initialization failed - starting server anyway:",
          dbError.message
        );
      }
    } else {
      console.log(
        "onePOS: DATABASE_URL is not configured"
      );
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `onePOS running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "onePOS startup failed:",
      error
    );

    process.exit(1);
  }
}

startServer();
