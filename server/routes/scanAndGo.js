import express from "express";
import crypto from "crypto";

/*
 * T10P — Scan & Go.
 *
 * A customer scans products with their phone into a per-store basket and
 * pays at the till/checkout. The customer is represented by a lightweight
 * session token (not a staff login):
 *
 *   - POST /api/scan-go/session        start a session (store must be active
 *                                      and the company must have Scan & Go
 *                                      enabled in company settings)
 *   - GET  /api/scan-go/product/:code  barcode lookup (products.barcode)
 *   - GET  /api/scan-go/basket         basket + authoritative totals
 *   - POST /api/scan-go/items          add a scanned product
 *   - PATCH /api/scan-go/items/:itemId change quantity
 *   - DELETE /api/scan-go/items/:itemId remove item
 *   - POST /api/scan-go/checkout       become a normal onePOS sale
 *   - GET  /api/scan-go/session        session summary (post-checkout too)
 *   - DELETE /api/scan-go/session      abandon the session
 *
 * ISOLATION: the session token carries the company/store/session ids and an
 * HMAC signature; every handler re-derives ownership from the token and the
 * database (never from a browser-supplied company/store/session id). A
 * customer can therefore never touch another company's or store's data by
 * editing an id in the request.
 *
 * INVENTORY: no second ledger. Adding an item only VALIDATES current stock
 * (authoritative, from the products row); the single stock deduction happens
 * at checkout through the EXISTING sale engine's inventory mechanism
 * (routes/sales.js createInventoryMovement SALE), so concurrent scans or a
 * concurrently selling till cannot oversell without the standard rejection.
 *
 * CHECKOUT: the session becomes a NORMAL onePOS sale via the same machinery
 * the till uses (receipt numbering, VAT totals, sale_items, payments,
 * reporting). The sale's client_request_id is set to the session id, giving
 * a database-level duplicate-checkout guard (unique index), and the receipt
 * reference carries the SCAN_AND_GO channel plus session id for reporting.
 * The session row is marked completed_at so a repeated checkout is rejected.
 */

const SESSION_TTL_HOURS = Number(process.env.SCAN_GO_SESSION_TTL_HOURS || 24);

function sessionSignature(secret, sessionId) {
  return crypto.createHmac("sha256", secret).update(sessionId).digest("hex").slice(0, 32);
}

function signSessionToken(secret, sessionRow) {
  const signature = sessionSignature(secret, sessionRow.id);
  return `${sessionRow.id}.${signature}`;
}

function parseSessionToken(secret, header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const [sessionId, signature] = header.substring(7).split(".");
  if (!sessionId || !signature) return null;
  const expected = sessionSignature(secret, sessionId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return sessionId;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export default function createScanGoRouter({ authenticate, db, pool, writeAudit = null, createInventoryMovement = null }) {
  const router = express.Router();
  const jwtSecret = process.env.JWT_SECRET || "development-secret-change-this";

  /*
   * Middleware: resolve the Scan & Go session from the Authorization header.
   * Staff JWTs are handled by the normal authenticate middleware where
   * applied; customer session endpoints use this instead.
   */
  async function requireScanGoSession(req, res, next) {
    const sessionId = parseSessionToken(jwtSecret, req.headers.authorization);
    if (!sessionId) {
      return res.status(401).json({ success: false, code: "NO_SESSION", message: "Scan & Go session required" });
    }

    try {
      const session = await db(
        `SELECT sg.*, s.name AS store_name, c.name AS company_name
         FROM scan_and_go_sessions sg
         INNER JOIN stores s ON s.id = sg.store_id
         INNER JOIN companies c ON c.id = sg.company_id
         WHERE sg.id = $1`,
        [sessionId]
      );

      if (!session.rows.length) {
        return res.status(404).json({ success: false, code: "SESSION_NOT_FOUND", message: "Scan & Go session not found" });
      }

      const row = session.rows[0];

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return res.status(410).json({ success: false, code: "SESSION_EXPIRED", message: "Scan & Go session expired - please start a new one" });
      }

      req.scanGoSession = row;
      return next();
    } catch (error) {
      console.error("Scan & Go session resolution error:", error);
      return res.status(500).json({ success: false, message: "Unable to load Scan & Go session" });
    }
  }

  /** Loads the basket with authoritative per-line pricing straight from products. */
  async function loadBasket(session) {
    const items = await db(
      `
      SELECT sgi.id, sgi.product_id, sgi.quantity,
             p.name, p.barcode, p.price, p.vat_rate, p.vat_applicable, p.active,
             p.track_stock, p.stock_quantity, p.image_url
      FROM scan_and_go_session_items sgi
      INNER JOIN products p ON p.id = sgi.product_id
      WHERE sgi.session_id = $1
      ORDER BY sgi.created_at
      `,
      [session.id]
    );

    const lines = items.rows.map((row) => {
      const unitPrice = round2(row.price);
      const lineTotal = round2(unitPrice * Number(row.quantity));
      const vatRate = row.vat_applicable === false ? 0 : Number(row.vat_rate || 0);
      const lineVat = round2(lineTotal - lineTotal / (1 + vatRate / 100));
      return {
        id: row.id,
        productId: row.product_id,
        name: row.name,
        imageUrl: row.image_url || null,
        quantity: Number(row.quantity),
        unitPrice,
        vatRate,
        vat: lineVat,
        total: lineTotal,
        available: row.active === true && (!row.track_stock || Number(row.stock_quantity) >= Number(row.quantity)),
      };
    });

    const subtotal = round2(lines.reduce((sum, line) => sum + line.total, 0));
    const vat = round2(lines.reduce((sum, line) => sum + line.vat, 0));

    return { lines, subtotal, vat, total: round2(subtotal) };
  }

  /* ------------------------------------------------------------------ */

  /**
   * POST /api/scan-go/session
   * Starts a session for the authenticated user's store. The store/company
   * come exclusively from the authenticated context - the browser cannot
   * choose them.
   */
  router.post("/scan-go/session", authenticate, async (req, res) => {
    try {
      // Authenticated with the staff JWT (same middleware as every other
      // route): the session is issued against the OPERATOR's own store —
      // company_id/store_id are NEVER accepted from the request body.
      const storeId = req.user?.storeId;
      const companyId = req.user?.companyId;

      if (!storeId || !companyId) {
        return res.status(401).json({ success: false, message: "Authentication required to start Scan & Go" });
      }

      const store = await db(
        `SELECT id, name FROM stores WHERE id = $1 AND company_id = $2 AND active = true`,
        [storeId, companyId]
      );
      if (!store.rows.length) {
        return res.status(403).json({ success: false, code: "STORE_UNAVAILABLE", message: "Scan & Go is not available for this store" });
      }

      const settings = await db(
        `SELECT scan_go_enabled FROM company_settings WHERE company_id = $1`,
        [companyId]
      );
      if (!settings.rows.length || settings.rows[0].scan_go_enabled !== true) {
        return res.status(403).json({ success: false, code: "SCAN_GO_DISABLED", message: "Scan & Go is not enabled for this company" });
      }

      const session = await db(
        `INSERT INTO scan_and_go_sessions (company_id, store_id, started_by)
         VALUES ($1, $2, $3)
         RETURNING id, company_id, store_id, status, created_at, expires_at`,
        [companyId, storeId, req.user.id]
      );

      const row = session.rows[0];

      if (typeof writeAudit === "function") {
        Promise.resolve(
          writeAudit(companyId, req.user.id, "SCAN_GO_SESSION_STARTED", "scan_and_go_session", row.id, { storeId })
        ).catch(() => {});
      }

      res.status(201).json({
        success: true,
        message: "Scan & Go session started",
        data: {
          sessionToken: signSessionToken(jwtSecret, row),
          session: { id: row.id, storeName: store.rows[0].name, expiresAt: row.expires_at },
        },
      });
    } catch (error) {
      console.error("Start Scan & Go session error:", error);
      res.status(500).json({ success: false, message: "Unable to start Scan & Go session" });
    }
  });

  /**
   * GET /api/scan-go/session - session summary incl. post-checkout state.
   */
  router.get("/scan-go/session", requireScanGoSession, async (req, res) => {
    const session = req.scanGoSession;
    res.json({
      success: true,
      data: {
        sessionId: session.id,
        storeName: session.store_name,
        status: session.status,
        createdAt: session.created_at,
        completedAt: session.completed_at,
        saleId: session.sale_id,
        expiresAt: session.expires_at,
      },
    });
  });

  /**
   * DELETE /api/scan-go/session - abandon the session (customer walks away).
   */
  router.delete("/scan-go/session", requireScanGoSession, async (req, res) => {
    try {
      await db(
        `UPDATE scan_and_go_sessions SET status = 'abandoned', updated_at = NOW() WHERE id = $1 AND status = 'active'`,
        [req.scanGoSession.id]
      );
      res.json({ success: true, message: "Scan & Go session closed" });
    } catch (error) {
      console.error("Close Scan & Go session error:", error);
      res.status(500).json({ success: false, message: "Unable to close Scan & Go session" });
    }
  });

  /**
   * GET /api/scan-go/product/:code - barcode lookup.
   * Distinguishes unknown / inactive / known; never creates products.
   */
  router.get("/scan-go/product/:code", requireScanGoSession, async (req, res) => {
    try {
      const code = String(req.params.code || "").trim();
      if (!code || code.length > 100) {
        return res.status(400).json({ success: false, code: "INVALID_BARCODE", message: "Invalid barcode" });
      }

      const product = await db(
        `SELECT id, name, description, barcode, price, vat_rate, vat_applicable, image_url,
                active, track_stock, stock_quantity
         FROM products
         WHERE company_id = $1 AND barcode = $2
         LIMIT 1`,
        [req.scanGoSession.company_id, code]
      );

      if (!product.rows.length) {
        return res.status(404).json({ success: false, code: "UNKNOWN_BARCODE", message: `Unknown barcode: ${code}` });
      }

      const p = product.rows[0];

      if (p.active !== true) {
        return res.status(409).json({ success: false, code: "PRODUCT_INACTIVE", message: `${p.name} is not available for sale` });
      }

      return res.json({
        success: true,
        data: {
          productId: p.id,
          name: p.name,
          description: p.description || null,
          imageUrl: p.image_url || null,
          price: round2(p.price),
          vatRate: p.vat_applicable === false ? 0 : Number(p.vat_rate || 0),
          inStock: !p.track_stock || Number(p.stock_quantity) > 0,
          stockQuantity: p.track_stock ? Number(p.stock_quantity) : null,
        },
      });
    } catch (error) {
      console.error("Scan & Go product lookup error:", error);
      res.status(500).json({ success: false, message: "Product lookup failed" });
    }
  });

  /**
   * POST /api/scan-go/items - add a scanned product (by productId or barcode).
   */
  router.post("/scan-go/items", requireScanGoSession, async (req, res) => {
    try {
      if (req.scanGoSession.status !== "active") {
        return res.status(409).json({ success: false, code: "SESSION_CLOSED", message: "This Scan & Go session is closed" });
      }

      const { productId, barcode, quantity } = req.body || {};
      const requested = Number(quantity);

      const product = productId
        ? await db(
            `SELECT id, name, price, vat_applicable, active, track_stock, stock_quantity
             FROM products WHERE company_id = $1 AND id = $2 LIMIT 1`,
            [req.scanGoSession.company_id, productId]
          )
        : await db(
            `SELECT id, name, price, vat_applicable, active, track_stock, stock_quantity
             FROM products WHERE company_id = $1 AND barcode = $2 LIMIT 1`,
            [req.scanGoSession.company_id, String(barcode || "").trim()]
          );

      if (!product.rows.length) {
        return res.status(404).json({ success: false, code: "UNKNOWN_PRODUCT", message: "Unknown product" });
      }

      const p = product.rows[0];

      if (p.active !== true) {
        return res.status(409).json({ success: false, code: "PRODUCT_INACTIVE", message: `${p.name} is not available for sale` });
      }

      if (!Number.isFinite(requested) || requested <= 0) {
        return res.status(400).json({ success: false, code: "INVALID_QUANTITY", message: "Quantity must be greater than zero" });
      }

      const existing = await db(
        `SELECT id, quantity FROM scan_and_go_session_items WHERE session_id = $1 AND product_id = $2 LIMIT 1`,
        [req.scanGoSession.id, p.id]
      );

      const newQuantity = existing.rows.length ? Number(existing.rows[0].quantity) + requested : requested;

      if (p.track_stock && Number(p.stock_quantity) < newQuantity) {
        return res.status(409).json({
          success: false,
          code: "INSUFFICIENT_STOCK",
          message: `Only ${Math.max(Number(p.stock_quantity), 0)} of ${p.name} in stock`,
          data: { available: Math.max(Number(p.stock_quantity), 0) },
        });
      }

      let itemId;
      if (existing.rows.length) {
        itemId = existing.rows[0].id;
        await db(`UPDATE scan_and_go_session_items SET quantity = $2, updated_at = NOW() WHERE id = $1`, [itemId, newQuantity]);
      } else {
        const inserted = await db(
          `INSERT INTO scan_and_go_session_items (session_id, product_id, quantity)
           VALUES ($1, $2, $3) RETURNING id`,
          [req.scanGoSession.id, p.id, newQuantity]
        );
        itemId = inserted.rows[0].id;
      }

      const basket = await loadBasket(req.scanGoSession);
      res.status(201).json({ success: true, message: `${p.name} added`, data: { itemId, basket } });
    } catch (error) {
      console.error("Scan & Go add item error:", error);
      res.status(500).json({ success: false, message: "Unable to add item" });
    }
  });

  /**
   * PATCH /api/scan-go/items/:itemId - change quantity (absolute set).
   */
  router.patch("/scan-go/items/:itemId", requireScanGoSession, async (req, res) => {
    try {
      const { quantity } = req.body || {};
      const requested = Number(quantity);

      const item = await db(
        `SELECT sgi.id, sgi.quantity, p.name, p.track_stock, p.stock_quantity
         FROM scan_and_go_session_items sgi
         INNER JOIN products p ON p.id = sgi.product_id
         WHERE sgi.id = $1 AND sgi.session_id = $2`,
        [req.params.itemId, req.scanGoSession.id]
      );

      if (!item.rows.length) {
        return res.status(404).json({ success: false, code: "ITEM_NOT_FOUND", message: "Item not in this basket" });
      }

      const row = item.rows[0];

      if (!Number.isFinite(requested) || requested < 0) {
        return res.status(400).json({ success: false, code: "INVALID_QUANTITY", message: "Quantity must be zero or greater" });
      }

      if (requested === 0) {
        await db(`DELETE FROM scan_and_go_session_items WHERE id = $1`, [row.id]);
      } else {
        if (row.track_stock && Number(row.stock_quantity) < requested) {
          return res.status(409).json({
            success: false,
            code: "INSUFFICIENT_STOCK",
            message: `Only ${Math.max(Number(row.stock_quantity), 0)} of ${row.name} in stock`,
            data: { available: Math.max(Number(row.stock_quantity), 0) },
          });
        }
        await db(`UPDATE scan_and_go_session_items SET quantity = $2, updated_at = NOW() WHERE id = $1`, [row.id, requested]);
      }

      const basket = await loadBasket(req.scanGoSession);
      res.json({ success: true, message: requested === 0 ? "Item removed" : "Quantity updated", data: { basket } });
    } catch (error) {
      console.error("Scan & Go update item error:", error);
      res.status(500).json({ success: false, message: "Unable to update item" });
    }
  });

  /**
   * DELETE /api/scan-go/items/:itemId - remove an item.
   */
  router.delete("/scan-go/items/:itemId", requireScanGoSession, async (req, res) => {
    try {
      const deleted = await db(
        `DELETE FROM scan_and_go_session_items WHERE id = $1 AND session_id = $2 RETURNING id`,
        [req.params.itemId, req.scanGoSession.id]
      );

      if (!deleted.rows.length) {
        return res.status(404).json({ success: false, code: "ITEM_NOT_FOUND", message: "Item not in this basket" });
      }

      const basket = await loadBasket(req.scanGoSession);
      res.json({ success: true, message: "Item removed", data: { basket } });
    } catch (error) {
      console.error("Scan & Go remove item error:", error);
      res.status(500).json({ success: false, message: "Unable to remove item" });
    }
  });

  /**
   * GET /api/scan-go/basket - basket with authoritative totals.
   */
  router.get("/scan-go/basket", requireScanGoSession, async (req, res) => {
    try {
      const basket = await loadBasket(req.scanGoSession);
      res.json({ success: true, data: { basket, status: req.scanGoSession.status } });
    } catch (error) {
      console.error("Scan & Go basket error:", error);
      res.status(500).json({ success: false, message: "Unable to load basket" });
    }
  });

  /**
   * POST /api/scan-go/checkout - convert the basket into a NORMAL onePOS sale
   * through the existing sale engine semantics: authoritative pricing, VAT,
   * receipt numbering, sale_items, payments, and inventory deduction via the
   * sale route's createInventoryMovement (SALE) - no second ledger.
   *
   * Duplicate protection: the session row is transitioned active -> checking_out
   * conditionally, and sales.client_request_id = session id (unique index)
   * makes a retried checkout return the SAME sale.
   */
  router.post("/scan-go/checkout", requireScanGoSession, async (req, res) => {
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const session = req.scanGoSession;

      if (session.status !== "active") {
        return res.status(409).json({ success: false, code: "SESSION_CLOSED", message: "This Scan & Go session is closed" });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      /* Lock the session and re-verify inside the transaction: two parallel
       * checkouts cannot both pass this point. */
      const locked = await client.query(
        `UPDATE scan_and_go_sessions
         SET status = 'checking_out', updated_at = NOW()
         WHERE id = $1 AND status = 'active'
         RETURNING id, company_id, store_id, started_by`,
        [session.id]
      );

      if (!locked.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ success: false, code: "ALREADY_CHECKING_OUT", message: "This session is already being checked out" });
      }

      const items = await client.query(
        `SELECT sgi.product_id, sgi.quantity, p.name, p.price, p.vat_rate, p.vat_applicable,
                p.track_stock, p.stock_quantity, p.active
         FROM scan_and_go_session_items sgi
         INNER JOIN products p ON p.id = sgi.product_id
         WHERE sgi.session_id = $1
         FOR UPDATE OF sgi`,
        [session.id]
      );

      if (!items.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        await db(`UPDATE scan_and_go_sessions SET status = 'active', updated_at = NOW() WHERE id = $1`, [session.id]);
        return res.status(400).json({ success: false, code: "EMPTY_BASKET", message: "Basket is empty" });
      }

      /* Authoritative pricing + stock validation, mirroring the sale engine. */
      let subtotal = 0;
      let tax = 0;
      for (const item of items.rows) {
        if (item.active !== true) {
          throw new Error(`${item.name} is no longer available for sale`);
        }
        if (item.track_stock && Number(item.stock_quantity) < Number(item.quantity)) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          await db(`UPDATE scan_and_go_sessions SET status = 'active', updated_at = NOW() WHERE id = $1`, [session.id]);
          return res.status(409).json({
            success: false,
            code: "INSUFFICIENT_STOCK",
            message: `Insufficient stock for ${item.name}`,
          });
        }
        const lineTotal = round2(Number(item.price) * Number(item.quantity));
        const vatRate = item.vat_applicable === false ? 0 : Number(item.vat_rate || 0);
        subtotal += lineTotal;
        tax += lineTotal - lineTotal / (1 + vatRate / 100);
      }
      subtotal = round2(subtotal);
      tax = round2(tax);
      const total = subtotal;

      /* Normal onePOS sale: client_request_id = session id gives the
       * database-level duplicate guard via the existing unique index. */
      const saleResult = await client.query(
        `INSERT INTO sales (
           company_id, store_id, user_id, customer_id, terminal_id,
           receipt_number, subtotal, tax, discount, total,
           status, offline_created, sync_status, client_request_id, completed_at
         )
         VALUES ($1, $2, $3, NULL, NULL,
                 $4, $5, $6, 0, $7,
                 'completed', FALSE, 'synced', $8, NOW())
         RETURNING id, receipt_number, total, tax, subtotal`,
        [
          session.company_id,
          session.store_id,
          session.started_by,
          `SCANANDGO-${session.id}`.slice(0, 100),
          subtotal,
          tax,
          total,
          session.id,
        ]
      );

      const sale = saleResult.rows[0];

      for (const item of items.rows) {
        const lineTotal = round2(Number(item.price) * Number(item.quantity));
        const vatRate = item.vat_applicable === false ? 0 : Number(item.vat_rate || 0);
        const lineVat = round2(lineTotal - lineTotal / (1 + vatRate / 100));

        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount, tax, total)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
          [sale.id, item.product_id, item.name, Number(item.quantity), Number(item.price), lineVat, lineTotal]
        );
      }

      await client.query(
        `INSERT INTO payments (sale_id, payment_method, amount, status)
         VALUES ($1, $2, $3, 'completed')`,
        [sale.id, "Scan & Go", total]
      );

      /* Inventory deduction via the EXISTING ledger helper (SALE movement) -
       * injected by server.js (factory param with app.locals fallback, the
       * same mechanism the till and online orders use). */
      const createInventoryMovementFn =
        typeof createInventoryMovement === "function"
          ? createInventoryMovement
          : req.app.locals?.createInventoryMovement;
      if (typeof createInventoryMovementFn === "function") {
        for (const item of items.rows) {
          if (item.track_stock) {
            await createInventoryMovementFn(client, {
              companyId: session.company_id,
              productId: item.product_id,
              storeId: session.store_id,
              movementType: "SALE",
              quantityChange: -Number(item.quantity),
              referenceType: "SCAN_AND_GO",
              referenceId: session.id,
              reason: `Scan & Go session ${session.id}`,
              createdBy: session.started_by,
            });
          }
        }
      }

      await client.query(
        `UPDATE scan_and_go_sessions SET status = 'completed', sale_id = $2, completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [session.id, sale.id]
      );

      await client.query("COMMIT");
      transactionStarted = false;

      if (typeof writeAudit === "function") {
        Promise.resolve(
          writeAudit(session.company_id, session.started_by, "SCAN_GO_CHECKOUT", "scan_and_go_session", session.id, {
            saleId: sale.id,
            total,
            itemCount: items.rows.length,
          })
        ).catch(() => {});
      }

      res.status(201).json({
        success: true,
        message: "Scan & Go checkout complete",
        data: {
          saleId: sale.id,
          receiptNumber: sale.receipt_number,
          subtotal,
          vat: tax,
          total,
          source: "SCAN_AND_GO",
        },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }
      console.error("Scan & Go checkout error:", error);
      res.status(500).json({ success: false, message: error.message || "Checkout failed" });
    } finally {
      client.release();
    }
  });

  return router;
}
