import express from "express";
import crypto from "crypto";

import { getPlatformService, isOnlinePlatform } from "../services/onlineOrders/index.js";
import { loadPlatformConfig, decryptSecret } from "../services/onlineOrders/platformConfig.js";
import { logPlatformApiCall } from "../services/onlineOrders/platformLogger.js";
import { createSaleForCompletedOrder } from "../services/onlineOrders/saleCreator.js";
import {
  createGenericOrder,
  getGenericOrder,
  listGenericOrders,
  transitionGenericOrder,
} from "../services/onlineOrders/genericOrderService.js";
import { syncBatchMovement } from "../services/inventory.js";
import { executeWorkflowAction } from "../services/platformWorkflow.js";
import { publishPlatformEvent } from "../services/platformEvents.js";

/*
 * ONLINE ORDERS FOUNDATION (Uber Eats / Deliveroo)
 *
 * Platform-agnostic endpoints for the online-order lifecycle:
 * product platform configuration -> receive order -> accept / reject /
 * preparing / ready / cancel / complete (OTP).
 *
 * Everything platform-specific stays behind services/onlineOrders/*; the POS
 * checkout logic is untouched. External platform calls are currently stubs
 * (services return { simulated: true }) until real credentials are added.
 */

const ACTIVE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY"];

const onlineOrderEventPublisher = (companyId) => ({ client, eventType, payload, actorUserId }) =>
  publishPlatformEvent({
    db: client.query.bind(client),
    companyId,
    eventType,
    payload,
    actorUserId,
  });

export default function createOnlineRouter({
  authenticate,
  authorize,
  db,
  pool,
  writeAudit,
  createInventoryMovement,
}) {
  const router = express.Router();

  /*
   * ------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------
   */

  async function loadOrder(orderId, companyId) {
    const result = await db(
      `
      SELECT *
      FROM online_orders
      WHERE id = $1
        AND company_id = $2
      `,
      [orderId, companyId]
    );

    return result.rows[0] || null;
  }

  async function loadOrderItems(orderId) {
    const result = await db(
      `
      SELECT
        i.*,
        p.track_stock,
        p.batch_tracking
      FROM online_order_items i
      LEFT JOIN products p
        ON p.id = i.product_id
      WHERE i.order_id = $1
      ORDER BY i.created_at, i.id
      `,
      [orderId]
    );

    return result.rows;
  }

  async function recordEvent(
    client,
    {
      orderId,
      eventType,
      fromStatus = null,
      toStatus = null,
      message = null,
      platformResponse = null,
      actorUserId = null,
    }
  ) {
    await client.query(
      `
      INSERT INTO online_order_events (
        order_id, event_type, from_status, to_status, message, platform_response, actor_user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        orderId,
        eventType,
        fromStatus,
        toStatus,
        message,
        platformResponse ? JSON.stringify(platformResponse) : null,
        actorUserId,
      ]
    );
  }

  /*
   * Reserves stock for an online order by deducting it from the normal
   * products.stock_quantity pool (ONLINE_RESERVE movement), so the POS
   * cannot sell the reserved quantity. Completing the order keeps the
   * deduction (permanent consumption); cancelling/rejecting restores it
   * (ONLINE_RELEASE). Only tracked products are reserved.
   */
  async function reserveOrderInventory(client, { companyId, storeId, order, items, userId }) {
    for (const item of items) {
      if (!item.trackStock && !item.track_stock) {
        continue;
      }

      await createInventoryMovement(client, {
        companyId,
        productId: item.productId || item.product_id,
        storeId,
        movementType: "ONLINE_RESERVE",
        quantityChange: -Number(item.quantity),
        referenceType: "ONLINE_ORDER",
        referenceId: order.id,
        reason: `Reserved for ${order.platform} order ${order.external_order_id}`,
        createdBy: userId,
      });
      await syncBatchMovement(client, {
        companyId,
        storeId,
        productId: item.productId || item.product_id,
        quantityChange: -Number(item.quantity),
        batchTracked: item.batchTracking === true || item.batch_tracking === true,
      });
    }
  }

  async function releaseOrderInventory(client, { companyId, storeId, order, items, userId }) {
    for (const item of items) {
      if (!item.track_stock) {
        continue;
      }

      await createInventoryMovement(client, {
        companyId,
        productId: item.product_id,
        storeId,
        movementType: "ONLINE_RELEASE",
        quantityChange: Number(item.quantity),
        referenceType: "ONLINE_ORDER",
        referenceId: order.id,
        reason: `Released reservation for ${order.platform} order ${order.external_order_id}`,
        createdBy: userId,
      });
      await syncBatchMovement(client, {
        companyId,
        storeId,
        productId: item.product_id,
        quantityChange: Number(item.quantity),
        batchTracked: item.batch_tracking === true,
        batchNumber: `ONLINE-RELEASE-${order.id.slice(0, 8).toUpperCase()}`,
      });
    }
  }

  function mapPlatformConfig(row) {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      price: Number(row.price),
      active: row.active,
      availableOnUber: row.available_on_uber === true,
      availableOnDeliveroo: row.available_on_deliveroo === true,
      uberItemId: row.uber_item_id,
      deliverooItemId: row.deliveroo_item_id,
    };
  }

  /*
   * Writes an action-level platform_api_logs row for SIMULATED (stub) service
   * responses so every platform interaction is auditable before real API
   * credentials exist. Real HTTP exchanges are logged by the platform client
   * itself (services/onlineOrders/uberClient.js), so they are not logged here
   * a second time. Logging never throws.
   */
  async function logSimulatedPlatformCall(entry) {
    // Defer logging to avoid lock conflicts with the transaction.
    // The entry is queued and executed after the transaction commits.
    if (!entry.response || entry.response.simulated !== true) {
      return;
    }
    // Use setImmediate to run after the current tick, after commit.
    setImmediate(() => {
      logPlatformApiCall(db, {
        companyId: entry.companyId,
        platform: entry.platform,
        environment: entry.environment || null,
        action: entry.action,
        endpoint: `stub://${entry.platform}/${entry.action}`,
        httpMethod: "STUB",
        requestPayload: entry.requestPayload,
        responseBody: entry.response,
        success: entry.response.success === true,
        errorMessage: entry.response.success === true ? null : entry.response.message || null,
        orderId: entry.orderId,
        productId: entry.productId,
      }).catch((err) => console.error("Deferred platform_api_logs write failed:", err.message));
    });
  }

  /*
   * Flushes queued platform_api_logs entries.
   *
   * It must only ever be called AFTER the order transaction has committed or
   * rolled back. platform_api_logs.order_id references online_orders(id), so
   * the audit insert needs a FOR KEY SHARE lock on the order row: while the
   * action transaction still holds that row FOR UPDATE the insert blocks until
   * the pool's lock_timeout (15s) and is then cancelled. Deferring the write
   * until the row lock is released keeps the audit row and costs no latency.
   *
   * Non-blocking and best-effort: logging never delays or fails an order action.
   */
  function flushPlatformAuditLogs(entries) {
    for (const entry of entries || []) {
      if (!entry.response || entry.response.simulated !== true) {
        continue;
      }

      logPlatformApiCall(db, {
        companyId: entry.companyId,
        platform: entry.platform,
        environment: entry.environment || null,
        action: entry.action,
        endpoint: `stub://${entry.platform}/${entry.action}`,
        httpMethod: "STUB",
        requestPayload: entry.requestPayload,
        responseBody: entry.response,
        success: entry.response.success === true,
        errorMessage: entry.response.success === true ? null : entry.response.message || null,
        orderId: entry.orderId,
        productId: entry.productId,
      }).catch((err) => console.error("Deferred platform_api_logs write failed:", err.message));
    }
  }

  /*
   * ------------------------------------------------------------------
   * Platform status
   * ------------------------------------------------------------------
   */

  router.get("/online/platforms", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const platforms = [];

      for (const platform of ["uber", "deliveroo"]) {
        const service = getPlatformService(platform);
        const runtime = await loadPlatformConfig(db, req.user.companyId, platform);
        const configured = service.isConfigured(runtime);

        platforms.push({
          platform,
          name: service.displayName,
          enabled: runtime.enabled === true,
          environment: runtime.environment,
          credentialsConfigured: configured,
          mode:
            runtime.enabled !== true
              ? "DISABLED"
              : configured
                ? "STUB_CONFIGURED"
                : "STUB_NO_CREDENTIALS",
        });
      }

      res.json({ success: true, data: platforms });
    } catch (error) {
      console.error("Online platforms error:", error);
      res.status(500).json({ success: false, message: "Unable to load online platforms" });
    }
  });

  /*
   * ------------------------------------------------------------------
   * Product platform configuration
   * ------------------------------------------------------------------
   */

  router.get("/online/products", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT
          id, name, sku, price, active,
          available_on_uber, available_on_deliveroo, uber_item_id, deliveroo_item_id
        FROM products
        WHERE company_id = $1
          AND active = true
        ORDER BY name
        `,
        [req.user.companyId]
      );

      res.json({
        success: true,
        data: result.rows.map(mapPlatformConfig),
      });
    } catch (error) {
      console.error("Load online products error:", error);
      res.status(500).json({ success: false, message: "Unable to load product platform configuration" });
    }
  });

  /*
   * PUT /api/online/products/:productId
   * Body: { availableOnUber, availableOnDeliveroo, uberItemId, deliverooItemId }
   * A product can be selected for each platform independently; toggling
   * publish/unpublish is delegated to the platform service (stubbed for now).
   */
  router.put("/online/products/:productId", authenticate, authorize("online_orders.configure"), async (req, res) => {
    try {
      const { availableOnUber, availableOnDeliveroo, uberItemId, deliverooItemId } = req.body;

      const existingResult = await db(
        `
        SELECT
          id, name, price, vat_rate,
          available_on_uber, available_on_deliveroo, uber_item_id, deliveroo_item_id
        FROM products
        WHERE id = $1
          AND company_id = $2
          AND active = true
        `,
        [req.params.productId, req.user.companyId]
      );

      if (!existingResult.rows.length) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }

      const existing = existingResult.rows[0];

      const nextConfig = {
        available_on_uber: availableOnUber === undefined ? existing.available_on_uber : Boolean(availableOnUber),
        available_on_deliveroo:
          availableOnDeliveroo === undefined ? existing.available_on_deliveroo : Boolean(availableOnDeliveroo),
        uber_item_id: uberItemId === undefined ? existing.uber_item_id : uberItemId || null,
        deliveroo_item_id: deliverooItemId === undefined ? existing.deliveroo_item_id : deliverooItemId || null,
      };

      const updated = await db(
        `
        UPDATE products
        SET
          available_on_uber = $2,
          available_on_deliveroo = $3,
          uber_item_id = $4,
          deliveroo_item_id = $5,
          updated_at = NOW()
        WHERE id = $1
          AND company_id = $6
        RETURNING
          id, name, sku, price, active,
          available_on_uber, available_on_deliveroo, uber_item_id, deliveroo_item_id
        `,
        [
          req.params.productId,
          nextConfig.available_on_uber,
          nextConfig.available_on_deliveroo,
          nextConfig.uber_item_id,
          nextConfig.deliveroo_item_id,
          req.user.companyId,
        ]
      );

      const product = mapPlatformConfig(updated.rows[0]);
      const serviceResponses = [];

          for (const platform of ["uber", "deliveroo"]) {
        const service = getPlatformService(platform);
        const key = platform === "uber" ? "availableOnUber" : "availableOnDeliveroo";
        const before = platform === "uber" ? existing.available_on_uber : existing.available_on_deliveroo;
        const after = product[key];

        if (!after && !before) {
          continue;
        }

        const runtime = await loadPlatformConfig(db, req.user.companyId, platform);

        if (after && !before) {
          const response = await service.publishProduct(product, runtime);
          serviceResponses.push(response);

          await logSimulatedPlatformCall({
            companyId: req.user.companyId,
            platform,
            environment: runtime.environment,
            action: "PUBLISH_PRODUCT",
            response,
            productId: product.id,
            requestPayload: { productId: product.id, name: product.name, price: product.price },
          });

          // Persist the platform-assigned item id when the platform returns one.
          if (response.success && response.externalItemId && !product[platform === "uber" ? "uberItemId" : "deliverooItemId"]) {
            const column = platform === "uber" ? "uber_item_id" : "deliveroo_item_id";
            await db(
              `UPDATE products SET ${column} = $2, updated_at = NOW() WHERE id = $1 AND company_id = $3`,
              [product.id, response.externalItemId, req.user.companyId]
            );
            product[platform === "uber" ? "uberItemId" : "deliverooItemId"] = response.externalItemId;
          }
        } else if (after && before) {
          const response = await service.updateProduct(product, runtime);
          serviceResponses.push(response);

          await logSimulatedPlatformCall({
            companyId: req.user.companyId,
            platform,
            environment: runtime.environment,
            action: "UPDATE_PRODUCT",
            response,
            productId: product.id,
            requestPayload: { productId: product.id, name: product.name, price: product.price },
          });
        } else {
          const response = await service.unpublishProduct(product, runtime);
          serviceResponses.push(response);

          await logSimulatedPlatformCall({
            companyId: req.user.companyId,
            platform,
            environment: runtime.environment,
            action: "UNPUBLISH_PRODUCT",
            response,
            productId: product.id,
            requestPayload: { productId: product.id, name: product.name },
          });
        }
      }

      if (writeAudit) {
        await writeAudit(req.user.companyId, req.user.id, "online_product_config", "product", product.id, {
          availableOnUber: product.availableOnUber,
          availableOnDeliveroo: product.availableOnDeliveroo,
        });
      }

      res.json({
        success: true,
        message: "Product platform configuration saved",
        data: { product, platformResponses: serviceResponses },
      });
    } catch (error) {
      console.error("Update online product config error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to save product platform configuration",
        error: error.message,
      });
    }
  });

  /*
   * ------------------------------------------------------------------
   * Deliveroo item mapping
   *
   * Links a Deliveroo menu item (identified by its stable pos_item_id / PLU)
   * to an EXISTING onePOS product. A mapping never creates a product, and
   * never matches by name alone. Once saved, future Deliveroo orders resolve
   * automatically in the webhook intake.
   * ------------------------------------------------------------------
   */

  function mapDeliverooMapping(row) {
    return {
      id: row.id,
      externalItemId: row.external_item_id,
      deliverooItemName: row.deliveroo_item_name,
      productId: row.product_id,
      productName: row.product_name || null,
      productSku: row.product_sku || null,
      storeId: row.store_id,
      active: row.active === true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /* GET /api/online/deliveroo/mappings - saved Deliveroo item -> product links. */
  router.get("/online/deliveroo/mappings", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT m.*, p.name AS product_name, p.sku AS product_sku
        FROM deliveroo_item_mappings m
        LEFT JOIN products p ON p.id = m.product_id
        WHERE m.company_id = $1
        ORDER BY m.updated_at DESC
        `,
        [req.user.companyId]
      );

      res.json({ success: true, data: result.rows.map(mapDeliverooMapping) });
    } catch (error) {
      console.error("Load Deliveroo mappings error:", error);
      res.status(500).json({ success: false, message: "Unable to load Deliveroo item mappings" });
    }
  });

  /*
   * GET /api/online/deliveroo/products?search=...
   *
   * Lightweight, company-scoped onePOS product search used by the mapping UI.
   * Read-only: it never creates a product. Reuses the existing products table
   * (and its price/stock columns) - no second product model.
   */
  router.get("/online/deliveroo/products", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const search = String(req.query.search || "").trim();
      const params = [req.user.companyId];
      let filter = "";

      if (search) {
        params.push(`%${search}%`);
        filter = ` AND (p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})`;
      }

      const result = await db(
        `
        SELECT p.id, p.name, p.sku, p.barcode, p.price, p.vat_rate, p.track_stock
        FROM products p
        WHERE p.company_id = $1
          AND p.active = true${filter}
        ORDER BY p.name
        LIMIT 50
        `,
        params
      );

      res.json({
        success: true,
        data: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          price: Number(row.price),
          vatRate: Number(row.vat_rate),
          trackStock: row.track_stock === true,
        })),
      });
    } catch (error) {
      console.error("Search products for mapping error:", error);
      res.status(500).json({ success: false, message: "Unable to search products" });
    }
  });

  /*
   * PUT /api/online/deliveroo/mappings
   * Body: { externalItemId, deliverooItemName?, productId, active? }
   *
   * Creates or updates the mapping for one Deliveroo item identifier. The
   * product must already exist for this company - nothing is auto-created. The
   * UNIQUE (company_id, external_item_id) constraint is used for an idempotent
   * upsert so re-saving (or mapping from two order lines) cannot duplicate.
   */
  router.put("/online/deliveroo/mappings", authenticate, authorize("online_orders.manage"), async (req, res) => {
    try {
      const { externalItemId, deliverooItemName = null, productId, active = true } = req.body || {};

      const externalId = externalItemId === undefined || externalItemId === null ? "" : String(externalItemId).trim();

      if (!externalId) {
        return res.status(400).json({
          success: false,
          code: "MISSING_EXTERNAL_ITEM_ID",
          message: "A Deliveroo item identifier (pos_item_id / PLU) is required to save a mapping",
        });
      }

      if (!productId) {
        return res.status(400).json({
          success: false,
          code: "MISSING_PRODUCT_ID",
          message: "Select an existing onePOS product to map this Deliveroo item to",
        });
      }

      // The product must already exist for this company - never auto-create.
      const productResult = await db(
        "SELECT id FROM products WHERE id = $1 AND company_id = $2 AND active = true",
        [productId, req.user.companyId]
      );

      if (!productResult.rows.length) {
        return res.status(404).json({ success: false, message: "Product not found for this company" });
      }

      const result = await db(
        `
        INSERT INTO deliveroo_item_mappings (
          company_id, store_id, external_item_id, deliveroo_item_name, product_id, active
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (company_id, external_item_id) DO UPDATE
          SET deliveroo_item_name = EXCLUDED.deliveroo_item_name,
              product_id = EXCLUDED.product_id,
              active = EXCLUDED.active,
              updated_at = NOW()
        RETURNING *
        `,
        [
          req.user.companyId,
          req.user.storeId || null,
          externalId,
          deliverooItemName ? String(deliverooItemName) : null,
          productId,
          active !== false,
        ]
      );

      if (writeAudit) {
        await writeAudit(req.user.companyId, req.user.id, "deliveroo_item_mapped", "deliveroo_item_mapping", result.rows[0].id, {
          externalItemId: externalId,
          productId,
        });
      }

      res.json({
        success: true,
        message: "Deliveroo item mapped",
        data: mapDeliverooMapping(result.rows[0]),
      });
    } catch (error) {
      console.error("Save Deliveroo mapping error:", error);
      res.status(500).json({ success: false, message: "Unable to save Deliveroo item mapping", error: error.message });
    }
  });

  /*
   * ------------------------------------------------------------------
   * Online orders
   * ------------------------------------------------------------------
   */

  router.get("/online/orders", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const { status, platform, limit = 100 } = req.query;
      const conditions = ["o.company_id = $1"];
      const params = [req.user.companyId];

      if (status) {
        params.push(status);
        conditions.push(`o.status = $${params.length}`);
      }

      if (platform) {
        params.push(platform);
        conditions.push(`o.platform = $${params.length}`);
      }

      const result = await db(
        `
        SELECT
          o.*,
          (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id) AS item_count,
          (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id AND i.mapping_status = 'UNMAPPED') AS unmapped_count
        FROM online_orders o
        WHERE ${conditions.join(" AND ")}
        ORDER BY o.created_at DESC
        LIMIT $${params.length + 1}
        `,
        [...params, Math.min(Number(limit) || 100, 500)]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load online orders error:", error);
      res.status(500).json({ success: false, message: "Unable to load online orders" });
    }
  });

  router.get("/online/orders/generic", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const { status, limit = 100 } = req.query;
      const orders = await listGenericOrders(db, req.user.companyId, {
        status: status || null,
        limit,
      });

      res.json({ success: true, data: orders });
    } catch (error) {
      console.error("List generic online orders error:", error);
      res.status(500).json({ success: false, message: "Unable to list online orders" });
    }
  });

  router.get("/online/orders/:id", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const order = await loadOrder(req.params.id, req.user.companyId);

      if (!order) {
        return res.status(404).json({ success: false, message: "Online order not found" });
      }

      const [items, events] = await Promise.all([
        loadOrderItems(order.id),
        db("SELECT * FROM online_order_events WHERE order_id = $1 ORDER BY created_at, id", [order.id]),
      ]);

      res.json({
        success: true,
        data: {
          order,
          items: items.map((item) => ({ ...item, track_stock: undefined })),
          events: events.rows,
        },
      });
    } catch (error) {
      console.error("Load online order error:", error);
      res.status(500).json({ success: false, message: "Unable to load online order" });
    }
  });

  /*
   * POST /api/online/orders/:orderId/items/:itemId/map
   * Body: { productId, saveForFutureDeliveroo? }
   *
   * Maps ONE existing online-order item to an existing onePOS product. It
   * updates the EXISTING row - it never creates a new order or a new item:
   *   - online_order_items.product_id  = selected product
   *   - online_order_items.mapping_status = 'MAPPED'
   *   - the Deliveroo name/quantity/price are left exactly as received
   *   - an event records the change for the audit trail.
   *
   * saveForFutureDeliveroo (default true, Deliveroo items only): persists a
   * deliveroo_item_mappings row keyed by the item's stable Deliveroo id so
   * FUTURE orders resolve automatically. Name alone never creates a mapping.
   */
  router.post("/online/orders/:orderId/items/:itemId/map", authenticate, authorize("online_orders.manage"), async (req, res) => {
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const { productId, saveForFutureDeliveroo = true } = req.body || {};

    if (!productId) {
      return res.status(400).json({
        success: false,
        code: "MISSING_PRODUCT_ID",
        message: "Select an existing onePOS product to map this item to",
      });
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      // The product must already exist for this company - never auto-created.
      const productResult = await client.query(
        "SELECT id, name FROM products WHERE id = $1 AND company_id = $2 AND active = true",
        [productId, req.user.companyId]
      );

      if (!productResult.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Product not found for this company" });
      }

      // Lock the order first, then the item, so concurrent mappings serialize.
      const orderResult = await client.query(
        "SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE",
        [req.params.orderId, req.user.companyId]
      );

      if (!orderResult.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Online order not found" });
      }

      const order = orderResult.rows[0];

      const itemResult = await client.query(
        "SELECT * FROM online_order_items WHERE id = $1 AND order_id = $2 FOR UPDATE",
        [req.params.itemId, order.id]
      );

      if (!itemResult.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Order item not found" });
      }

      const item = itemResult.rows[0];

      // Only product_id + mapping_status change; the Deliveroo name/price/
      // quantity received from the platform are preserved untouched.
      const updatedItem = await client.query(
        `
        UPDATE online_order_items
        SET product_id = $2, mapping_status = 'MAPPED'
        WHERE id = $1
        RETURNING *
        `,
        [item.id, productId]
      );

      let savedMapping = null;

      if (saveForFutureDeliveroo !== false && order.platform === "deliveroo" && item.external_item_id) {
        const mappingResult = await client.query(
          `
          INSERT INTO deliveroo_item_mappings (
            company_id, store_id, external_item_id, deliveroo_item_name, product_id, active
          )
          VALUES ($1,$2,$3,$4,$5,TRUE)
          ON CONFLICT (company_id, external_item_id) DO UPDATE
            SET deliveroo_item_name = EXCLUDED.deliveroo_item_name,
                product_id = EXCLUDED.product_id,
                active = TRUE,
                updated_at = NOW()
          RETURNING *
          `,
          [
            req.user.companyId,
            order.store_id || req.user.storeId || null,
            String(item.external_item_id),
            (item.platform_data && item.platform_data.deliveroo_item_name) || item.product_name || null,
            productId,
          ]
        );

        savedMapping = mapDeliverooMapping(mappingResult.rows[0]);
      }

      await recordEvent(client, {
        orderId: order.id,
        eventType: "ITEM_MAPPED",
        fromStatus: order.status,
        toStatus: order.status,
        message: `${order.platform} item "${item.product_name}" (${item.external_item_id || "no external id"}) mapped to onePOS product "${productResult.rows[0].name}"${savedMapping ? " (saved for future orders)" : ""}`,
        platformResponse: { itemId: item.id, productId, savedForFuture: Boolean(savedMapping) },
        actorUserId: req.user.id,
      });

      await client.query("COMMIT");

      if (writeAudit) {
        await writeAudit(req.user.companyId, req.user.id, "online_order_item_mapped", "online_order", order.id, {
          itemId: item.id,
          externalItemId: item.external_item_id || null,
          productId,
          savedForFuture: Boolean(savedMapping),
        });
      }

      res.json({
        success: true,
        message: "Item mapped to onePOS product",
        data: {
          item: { ...updatedItem.rows[0], track_stock: undefined },
          mapping: savedMapping,
        },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Map online order item error:", error);
      res.status(500).json({ success: false, message: error.message || "Unable to map the order item" });
    } finally {
      client.release();
    }
  });

  /*
   * GET /api/online/api-logs
   *
   * Platform API audit log (every Uber/Deliveroo request+response entry).
   * Stored payloads/headers are already redacted by platformLogger.js -
   * client secrets, access tokens and Authorization headers never appear.
   */
  router.get("/online/api-logs", authenticate, authorize("online_orders.configure"), async (req, res) => {
    try {
      const { platform, orderId, limit = 100 } = req.query;
      const conditions = ["company_id = $1"];
      const params = [req.user.companyId];

      if (platform) {
        params.push(platform);
        conditions.push(`platform = $${params.length}`);
      }

      if (orderId) {
        params.push(orderId);
        conditions.push(`order_id = $${params.length}`);
      }

      const result = await db(
        `
        SELECT *
        FROM platform_api_logs
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
        `,
        [...params, Math.min(Number(limit) || 100, 500)]
      );

      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load platform API logs error:", error);
      res.status(500).json({ success: false, message: "Unable to load platform API logs" });
    }
  });

  /*
   * POST /api/online/uber/sync-menu            (T10-UBER-MENU)
   *
   * OnePOS -> Uber Eats menu synchronisation. The EXISTING Product Master is
   * the source of truth; this endpoint only READS products (company-scoped,
   * only products offered on Uber) and hands them to the Uber service to PUT
   * the menu on the Uber store configured for this company. It NEVER writes
   * to products, inventory, VAT or any POS data, and it never stores a second
   * menu master - the Uber item id is the existing products.uber_item_id
   * (or the product UUID when not yet set), so repeated syncs are idempotent
   * updates, never duplicates.
   *
   * On success the returned per-item mapping (product -> uber item id) is
   * echoed for transparency; saving/refreshing products.uber_item_id happens
   * only for products whose mapped id differs from their UUID (i.e. the id
   * came from a previous explicit mapping) - those are left untouched, so a
   * sync cannot overwrite an operator's explicit mapping.
   */
  router.post("/online/uber/sync-menu", authenticate, authorize("online_orders.configure"), async (req, res) => {
    try {
      const syncResult = await executeWorkflowAction({
        db,
        req,
        companyId: req.user.companyId,
        action: { type: "UBER_UPLOAD_MENU", storeId: req.body?.store_id || null },
      });

      if (syncResult.code === "PLATFORM_DISABLED") {
        return res.status(409).json({
          success: false,
          code: "PLATFORM_DISABLED",
          message: "Uber Eats integration is disabled in Settings - Online Platforms",
        });
      }

      if (syncResult.code === "NOTHING_TO_SYNC") {
        return res.json({
          success: false,
          code: "NOTHING_TO_SYNC",
          message: "No products are marked 'Available on Uber Eats' in the Product Master",
          data: { published: 0, skipped: syncResult.productCount },
        });
      }

      /* Persist the sync outcome on the integration configuration for the
       * Settings status display (last successful sync / last error). */
      try {
        await db(
          `UPDATE integrations
           SET configuration = configuration || $2::jsonb, updated_at = NOW()
           WHERE company_id = $1 AND provider = 'uber'`,
          [
            req.user.companyId,
            JSON.stringify({
              menu_sync_last_attempt: new Date().toISOString(),
              menu_sync_last_success: syncResult.success === true ? new Date().toISOString() : null,
              menu_sync_last_error: syncResult.success === true ? null : String(syncResult.message || syncResult.code || "failed").slice(0, 300),
              menu_sync_last_count: syncResult.meta ? syncResult.meta.publishedCount : null,
            }),
          ]
        );
      } catch (statusError) {
        console.error("Uber menu sync status write failed:", statusError.message);
      }

      return res.json({
        success: syncResult.success === true,
        code: syncResult.code || null,
        message: syncResult.success
          ? `Menu synced to Uber (${syncResult.meta.publishedCount} item(s), ${syncResult.meta.categoryCount} categor${syncResult.meta.categoryCount === 1 ? "y" : "ies"})`
          : syncResult.message || "Uber menu sync failed",
        data: {
          httpStatus: syncResult.httpStatus ?? null,
          published: syncResult.meta ? syncResult.meta.publishedCount : 0,
          skippedInactive: syncResult.meta ? syncResult.meta.skippedInactiveCount : 0,
          categories: syncResult.meta ? syncResult.meta.categoryCount : 0,
          itemIds: syncResult.meta ? syncResult.meta.publishedItemIds : [],
          invalidItems: syncResult.details ? syncResult.details.invalidItems : [],
          uberResponse: syncResult.data ?? null,
        },
      });
    } catch (error) {
      console.error("Uber menu sync error:", error);
      res.status(500).json({ success: false, message: "Uber menu sync failed" });
    }
  });

  /*
   * Store selection uses the package's registered UBER_GET_STORES action.
   * The action loads this tenant's connector and the active environment,
   * keeping discovery scoped to the authenticated company.
   */
  router.get("/online/uber/stores", authenticate, authorize("online_orders.configure"), async (req, res) => {
    try {
      const result = await executeWorkflowAction({
        db,
        req,
        companyId: req.user.companyId,
        action: { type: "UBER_GET_STORES" },
      });
      const response = result?.data || {};
      const rawStores = Array.isArray(response.stores) ? response.stores : Array.isArray(response) ? response : [];
      const stores = rawStores.map((store) => ({
        storeId: store.id || store.store_id || null,
        name: store.name || null,
        brandId: store.brand?.id || store.brand_id || null,
        brandName: store.brand?.description || store.brand?.name || store.brand_name || null,
        status: typeof store.status === "string" ? store.status : store.status?.type || null,
        integrationEnabled: store.integration_enabled == null ? null : store.integration_enabled === true,
      })).filter((store) => store.storeId);

      return res.json({
        success: result?.success === true,
        code: result?.code || null,
        message: result?.message || null,
        data: { stores, httpStatus: result?.httpStatus ?? null },
      });
    } catch (error) {
      console.error("Uber store discovery error:", error);
      return res.status(500).json({ success: false, message: error.message || "Uber store discovery failed" });
    }
  });

  /*
   * GET /api/online/uber/test-connection
   *
   * Minimum Uber Sandbox connection/test flow: calls the official Uber Eats
   * "Get Stores" endpoint (GET /v1/eats/stores) with the credentials stored in
   * Settings to identify the authenticated application/account and return the
   * real store/brand IDs required for menu and order testing.
   *
   * The call runs against the configured environment host first and, for
   * diagnostics, once against the production host as well (store discovery is
   * not guaranteed on the sandbox host; both attempts are returned labeled).
   * Every exchange is logged to platform_api_logs by the Uber client with
   * credentials/tokens redacted. Responds HTTP 200 even when Uber rejects the
   * request, so the exact Uber error is displayed in the UI.
   */
  router.get("/online/uber/test-connection", authenticate, authorize("online_orders.configure"), async (req, res) => {
    try {
      const connectionResult = await executeWorkflowAction({
        db,
        req,
        companyId: req.user.companyId,
        action: { type: "UBER_TEST_CONNECTION" },
      });

      if (connectionResult.code === "PLATFORM_DISABLED") {
        return res.json({
          success: false,
          code: "PLATFORM_DISABLED",
          message: "Uber Eats integration is disabled in Settings - Online Platforms",
          data: { attempts: [], stores: [] },
        });
      }

      return res.json({
        success: connectionResult.success,
        message: connectionResult.message,
        code: connectionResult.code || null,
        data: {
          attempts: connectionResult.attempts,
          stores: connectionResult.stores,
        },
      });
    } catch (error) {
      console.error("Uber test connection error:", error);
      res.status(500).json({ success: false, message: error.message || "Uber test connection failed" });
    }
  });

  /*
   * POST /api/online/orders
   *
   * Receives an incoming online order (today: authenticated test intake;
   * later: called by the platform webhook handler after
   * service.normalizeIncomingOrder). The order is created in RECEIVED state
   * and its inventory is immediately reserved from the shared stock pool
   * (ONLINE_RESERVE), so the POS cannot sell it. Insufficient stock rejects
   * the whole order (transaction rollback).
   */
  router.post("/online/orders", authenticate, authorize("online_orders.manage"), async (req, res) => {
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const {
      platform,
      externalOrderId,
      externalReference,
      customer = {},
      otp,
      fulfilmentType,
      notes,
      deliveryFee = 0,
      items,
    } = req.body;

    if (!isOnlinePlatform(platform)) {
      return res.status(400).json({ success: false, message: "Platform must be 'uber' or 'deliveroo'" });
    }

    // Platform must be enabled in Settings to receive orders.
    const runtime = await loadPlatformConfig(db, req.user.companyId, platform);

    if (runtime.enabled !== true) {
      return res.status(409).json({
        success: false,
        code: "PLATFORM_DISABLED",
        message: `${platform} integration is disabled in Settings - enable it to receive online orders`,
      });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: "At least one order item is required" });
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const externalId = externalOrderId || `SIM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      const duplicate = await client.query(
        "SELECT id FROM online_orders WHERE company_id = $1 AND platform = $2 AND external_order_id = $3",
        [req.user.companyId, platform, externalId]
      );

      if (duplicate.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ success: false, message: "This online order has already been received" });
      }

      // Resolve and validate every product against this platform's configuration.
      const resolvedItems = [];

      for (const item of items) {
        const quantity = Number(item.quantity);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error("Item quantity must be a positive number");
        }

        const productResult = await client.query(
          `
          SELECT
            id, name, price, vat_rate, track_stock, batch_tracking, stock_quantity,
            available_on_uber, available_on_deliveroo
          FROM products
          WHERE id = $1
            AND company_id = $2
            AND active = true
          FOR UPDATE
          `,
          [item.productId, req.user.companyId]
        );

        if (!productResult.rows.length) {
          throw new Error("One or more products were not found for this store");
        }

        const product = productResult.rows[0];
        const availableKey = platform === "uber" ? "available_on_uber" : "available_on_deliveroo";

        if (!product[availableKey]) {
          throw new Error(`${product.name} is not configured for ${platform}`);
        }

        const unitPrice =
          item.unitPrice === undefined || item.unitPrice === null ? Number(product.price) : Number(item.unitPrice);

        resolvedItems.push({
          productId: product.id,
          productName: product.name,
          externalItemId: item.externalItemId || null,
          quantity,
          batchTracking: product.batch_tracking === true,
          unitPrice,
          tax: Number(((unitPrice * quantity * Number(product.vat_rate || 0)) / 100).toFixed(2)),
          total: Number((unitPrice * quantity).toFixed(2)),
          trackStock: product.track_stock,
        });
      }

      const subtotal = resolvedItems.reduce((sum, item) => sum + item.total, 0);
      const tax = resolvedItems.reduce((sum, item) => sum + item.tax, 0);
      const deliveryFeeValue = Number(deliveryFee) || 0;

      const orderResult = await client.query(
        `
        INSERT INTO online_orders (
          company_id, store_id, platform, external_order_id, external_reference,
          status, customer_name, customer_phone, customer_email, delivery_address,
          fulfilment_type, otp_code, currency, subtotal, tax, delivery_fee, total, notes, platform_data,
          inventory_reserved
        )
        VALUES ($1,$2,$3,$4,$5,'RECEIVED',$6,$7,$8,$9,$10,$11,'GBP',$12,$13,$14,$15,$16,$17,TRUE)
        RETURNING *
        `,
        [
          req.user.companyId,
          req.user.storeId || null,
          platform,
          externalId,
          externalReference || null,
          customer.name || null,
          customer.phone || null,
          customer.email || null,
          customer.address || null,
          fulfilmentType === "COLLECTION" ? "COLLECTION" : "DELIVERY",
          otp ? String(otp) : null,
          subtotal.toFixed(2),
          tax.toFixed(2),
          deliveryFeeValue.toFixed(2),
          (subtotal + deliveryFeeValue).toFixed(2),
          notes || null,
          JSON.stringify({
            simulated: true,
            received_via: "onePOS_test_intake",
            platform_enabled: runtime.enabled,
            platform_mode: runtime.configured ? "STUB_CONFIGURED" : "STUB_NO_CREDENTIALS",
          }),
        ]
      );

      const order = orderResult.rows[0];

          for (const item of resolvedItems) {
        await client.query(
          `
          INSERT INTO online_order_items (
            order_id, product_id, external_item_id, product_name, quantity, unit_price, tax, total, platform_data
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          `,
          [
            order.id,
            item.productId,
            item.externalItemId,
            item.productName,
            item.quantity,
            item.unitPrice.toFixed(2),
            item.tax.toFixed(2),
            item.total.toFixed(2),
            JSON.stringify({ simulated: true }),
          ]
        );
      }

      // Reserve the inventory immediately so normal POS sales cannot use it.
      await reserveOrderInventory(client, {
        companyId: req.user.companyId,
        storeId: req.user.storeId || null,
        order,
        items: resolvedItems,
        userId: req.user.id,
      });

      await recordEvent(client, {
        orderId: order.id,
        eventType: "ORDER_RECEIVED",
        toStatus: "RECEIVED",
        message: `Order received from ${platform}${otp ? " (OTP supplied by platform)" : ""}; inventory reserved`,
        platformResponse: { simulated: true },
        actorUserId: req.user.id,
      });

      /*
       * AUTO-ACCEPT (Settings -> Online Platforms -> Order acceptance):
       * a freshly received order is immediately accepted through the SAME
       * platform service used by the manual endpoint - no duplicated Uber
       * API logic. Acceptance failure leaves the order in RECEIVED (pending
       * manual acceptance). Inventory stays reserved either way.
       */
      let autoAccepted = false;

      if (runtime.order_acceptance === "auto") {
        const service = getPlatformService(platform);
        const acceptResponse = platform === "uber"
          ? await executeWorkflowAction({
              db,
              client,
              req,
              companyId: req.user.companyId,
              recordId: order.id,
              action: { type: "UBER_ACCEPT_ORDER", orderId: order.id },
            })
          : await service.acceptOrder(order, runtime);

        await logSimulatedPlatformCall({
          companyId: req.user.companyId,
          platform,
          environment: runtime.environment,
          action: "ACCEPT_ORDER",
          response: acceptResponse,
          orderId: order.id,
          requestPayload: { external_order_id: order.external_order_id, trigger: "auto_accept" },
        });

        if (acceptResponse && acceptResponse.success === true) {
          /*
           * Auto-accept lands directly in PREPARING: acceptance IS the start
           * of preparation in the internal workflow (no separate kitchen
           * button). ACKED_ACCEPTED keeps the platform-acknowledgement trace.
           */
          await client.query(
            "UPDATE online_orders SET status = 'PREPARING', preparing_at = NOW(), accepted_at = NOW(), updated_at = NOW() WHERE id = $1 AND company_id = $2 AND status = 'RECEIVED'",
            [order.id, req.user.companyId]
          );
          await recordEvent(client, {
            orderId: order.id,
            eventType: "ACKED_ACCEPTED",
            fromStatus: "RECEIVED",
            toStatus: "ACCEPTED",
            message: "Platform accept acknowledgement (auto-accept mode)",
            platformResponse: acceptResponse,
            actorUserId: req.user.id,
          });
          await recordEvent(client, {
            orderId: order.id,
            eventType: "ORDER_PREPARING",
            fromStatus: "ACCEPTED",
            toStatus: "PREPARING",
            message: "Order auto-accepted (auto-accept mode enabled in Settings) - preparation started",
            platformResponse: acceptResponse,
            actorUserId: req.user.id,
          });
          autoAccepted = true;
        } else {
          // Acceptance (stub or real) did not confirm - order stays RECEIVED
          // for manual acceptance; the failure is recorded for the audit.
          await recordEvent(client, {
            orderId: order.id,
            eventType: "PLATFORM_CALL_FAILED",
            fromStatus: "RECEIVED",
            message: `Auto-accept did not confirm${acceptResponse && acceptResponse.code ? ` (${acceptResponse.code})` : ""}`,
            platformResponse: acceptResponse,
            actorUserId: req.user.id,
          });
        }
      }

      if (writeAudit) {
        await writeAudit(req.user.companyId, req.user.id, "online_order_received", "online_order", order.id, {
          platform,
          externalOrderId: externalId,
          total: order.total,
          autoAccepted,
        });
      }

      await client.query("COMMIT");

      const finalOrder = await loadOrder(order.id, req.user.companyId);

      res.status(201).json({
        success: true,
        message: autoAccepted
          ? "Online order received, inventory reserved and auto-accepted"
          : "Online order received and inventory reserved",
        data: { order: finalOrder, items: resolvedItems, autoAccepted },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Receive online order error:", error);

      const insufficientStock = /Insufficient stock/i.test(error.message || "");

      res.status(insufficientStock ? 409 : 500).json({
        success: false,
        message: insufficientStock
          ? "Order rejected - insufficient stock"
          : error.message || "Unable to receive online order",
        error: error.message,
      });
    } finally {
      client.release();
    }
  });

  /*
   * Shared lifecycle transition. Flow:
   *   1. lock the order row (FOR UPDATE) and re-check status inside the
   *      transaction, so concurrent actions can never double-transition or
   *      double-release reserved stock
   *   2. call the platform service action (stubbed/mockable for now) - the
   *      PLATFORM decides validity, including the completion OTP; onePOS only
   *      trusts platformResponse.success and never validates an OTP itself
   *   3. only then transition the local order, optionally release reserved
   *      inventory exactly once, record an event with the platform response
   *      and write an audit log.
   */
  async function performOrderAction(req, res, options) {
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const {
      fromStatuses,
      toStatus,
      platformAction,
      callPlatform,
      releaseInventory = false,
      timestampColumn = null,
      reason = null,
      buildMessage = null,
      createSale = null,
      onTransition = null,
    } = options;

    const client = await pool.connect();
    let transactionStarted = false;
    const tStart = Date.now();
    const deferredLogs = [];

    try {
      await client.query("BEGIN");
      transactionStarted = true;
      console.time(`[${req.params.id}] ${toStatus} - total`);

      console.time(`[${req.params.id}] ${toStatus} - lock`);
      let locked;

      try {
        locked = await client.query(
          "SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE NOWAIT",
          [req.params.id, req.user.companyId]
        );
      } catch (lockError) {
        if (lockError.code === "55P03") {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return res.status(409).json({
            success: false,
            code: "ORDER_BUSY",
            message: "An action on this order is already in progress - try again in a moment",
          });
        }
        throw lockError;
      }
      console.timeEnd(`[${req.params.id}] ${toStatus} - lock`);

      if (!locked.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(404).json({ success: false, message: "Online order not found" });
      }

      const order = locked.rows[0];

      if (!fromStatuses.includes(order.status)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          code: "INVALID_STATUS",
          message: `Order in status ${order.status} cannot be moved to ${toStatus}`,
        });
      }

      if (releaseInventory && order.inventory_released === true) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          code: "INVENTORY_ALREADY_RELEASED",
          message: "Reserved stock for this order has already been released",
        });
      }

      console.time(`[${req.params.id}] ${toStatus} - loadPlatformConfig`);
      const runtime = await loadPlatformConfig(db, req.user.companyId, order.platform);
      console.timeEnd(`[${req.params.id}] ${toStatus} - loadPlatformConfig`);
      const service = getPlatformService(order.platform);

      console.time(`[${req.params.id}] ${toStatus} - callPlatform`);
      const platformResponse = await callPlatform(service, order, runtime, client);
      console.timeEnd(`[${req.params.id}] ${toStatus} - callPlatform`);

      // Queue logging for after commit to avoid lock conflicts
      deferredLogs.push({
        companyId: req.user.companyId,
        platform: order.platform,
        environment: runtime.environment,
        action: platformAction,
        response: platformResponse,
        orderId: order.id,
        requestPayload: {
          external_order_id: order.external_order_id,
          from: order.status,
          to: toStatus,
          reason: reason || null,
          otp: (req.body && req.body.otp) || null,
        },
      });

      if (!platformResponse || platformResponse.success !== true) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        // The platform rejected the action - the audit row is still written,
        // but only now that the transaction (and its row lock) is gone.
        flushPlatformAuditLogs(deferredLogs);

        const failureCode = (platformResponse && platformResponse.code) || "PLATFORM_CALL_FAILED";

        await recordEvent(pool, {
          orderId: order.id,
          eventType: "PLATFORM_CALL_FAILED",
          fromStatus: order.status,
          message: `Platform did not confirm ${platformAction}${failureCode ? ` (${failureCode})` : ""}`,
          platformResponse,
          actorUserId: req.user.id,
        });

        const httpStatus =
          failureCode === "PLATFORM_DISABLED"
            ? 409
            : failureCode === "ORDER_NOT_FOUND"
              ? 404
              : failureCode === "STORE_SCOPE_MISMATCH"
                ? 403
                : failureCode === "INVALID_STATUS"
                  ? 409
            : failureCode === "INVALID_OTP" || failureCode === "OTP_REQUIRED"
              ? 400
              : 502;

        return res.status(httpStatus).json({
          success: false,
          code: failureCode,
          message: (platformResponse && platformResponse.message) || "Platform did not confirm the action",
          platformResponse,
        });
      }

      console.time(`[${req.params.id}] ${toStatus} - loadOrderItems`);
      const items = await loadOrderItems(order.id);
      console.timeEnd(`[${req.params.id}] ${toStatus} - loadOrderItems`);

      if (releaseInventory) {
        console.time(`[${req.params.id}] ${toStatus} - releaseOrderInventory`);
        await releaseOrderInventory(client, {
          companyId: req.user.companyId,
          storeId: order.store_id || req.user.storeId || null,
          order,
          items,
          userId: req.user.id,
        });
        console.timeEnd(`[${req.params.id}] ${toStatus} - releaseOrderInventory`);
      }

      let query = "UPDATE online_orders SET status = $2, updated_at = NOW()";
      const params = [order.id, toStatus];

      if (releaseInventory) {
        query += ", inventory_reserved = FALSE, inventory_released = TRUE";
      }

      if (timestampColumn === "completed_at") {
        query += ", completed_at = NOW(), completed_by = $3, otp_verified_at = NOW()";
        params.push(req.user.id);
      } else if (timestampColumn) {
        query += `, ${timestampColumn} = NOW()`;
      }

      if (reason) {
        params.push(reason);
        query += `, cancel_reason = $${params.length}`;
      }

      params.push(req.user.companyId);
      query += ` WHERE id = $1 AND company_id = $${params.length}`;

      if (releaseInventory) {
        query += " AND inventory_released = FALSE";
      }

      console.time(`[${req.params.id}] ${toStatus} - updateOrder`);
      const updateResult = await client.query(query, params);
      console.timeEnd(`[${req.params.id}] ${toStatus} - updateOrder`);

      if (!updateResult.rowCount) {
        throw new Error("Order state changed concurrently - no rows updated");
      }

      console.time(`[${req.params.id}] ${toStatus} - recordEvent`);
      await recordEvent(client, {
        orderId: order.id,
        eventType: `ORDER_${toStatus}`,
        fromStatus: order.status,
        toStatus,
        message: buildMessage
          ? buildMessage(order)
          : `Order moved to ${toStatus} (platform action ${platformAction}: ${
              platformResponse.simulated ? "simulated" : "confirmed"
            })${releaseInventory ? "; inventory released" : ""}`,
        platformResponse,
        actorUserId: req.user.id,
      });
      console.timeEnd(`[${req.params.id}] ${toStatus} - recordEvent`);

      /*
       * Optional extra in-transaction step for routes that need additional
       * records on a successful transition (e.g. the accept route records a
       * separate platform-acknowledgement event before landing in PREPARING).
       * Runs BEFORE COMMIT so it is atomic with the status change.
       */
      if (typeof onTransition === "function") {
        await onTransition(client, { order, toStatus, platformResponse });
      }

      if (writeAudit) {
        await writeAudit(
          req.user.companyId,
          req.user.id,
          `online_order_${toStatus.toLowerCase()}`,
          "online_order",
          order.id,
          { platform: order.platform, from: order.status, to: toStatus }
        );
      }

      /*
       * ONLINE ORDER -> POS SALE (complete only, when the route passes
       * createSale): the sale is created inside this same transaction, after
       * the order status was changed to COMPLETED, so the sale and the status
       * change commit - or roll back - atomically. A failure here means the
       * order is NOT reported as completed. Stock is intentionally NOT moved:
       * it was already deducted at intake (ONLINE_RESERVE), so calling
       * createInventoryMovement here would double-deduct.
       */
      let saleInfo = null;
      if (createSale) {
        console.time(`[${req.params.id}] ${toStatus} - createSale`);
        try {
          saleInfo = await createSale(client, { order, items, user: req.user });
        } catch (saleError) {
          /*
           * A failed sale must never be reported as a completed order: the
           * error is re-thrown so the whole transaction (status change,
           * events, audit) rolls back, and the message tells the operator
           * exactly what happened and that the order is still open.
           */
          throw new Error(
            `Order was NOT completed: the POS sale could not be created (${saleError.message})`
          );
        } finally {
          console.timeEnd(`[${req.params.id}] ${toStatus} - createSale`);
        }

        await recordEvent(client, {
          orderId: order.id,
          eventType: "ONLINE_SALE_CREATED",
          fromStatus: order.status,
          toStatus,
          message: `POS sale ${saleInfo.sale.receipt_number || saleInfo.sale.id} created for the completed order${
            saleInfo.unmappedExcluded
              ? `; ${saleInfo.unmappedExcluded} unmapped item(s) excluded`
              : ""
          }`,
          actorUserId: req.user.id,
        });
      }

      console.time(`[${req.params.id}] ${toStatus} - commit`);
      await client.query("COMMIT");
      console.timeEnd(`[${req.params.id}] ${toStatus} - commit`);

      /*
       * Deferred platform_api_logs write, now that the transaction has
       * committed and the order row lock is released (non-blocking).
       */
      flushPlatformAuditLogs(deferredLogs);

      console.time(`[${req.params.id}] ${toStatus} - loadOrder`);
      const updatedOrder = await loadOrder(order.id, req.user.companyId);
      console.timeEnd(`[${req.params.id}] ${toStatus} - loadOrder`);

      console.timeEnd(`[${req.params.id}] ${toStatus} - total`);

      return res.json({
        success: true,
        message: `Order ${toStatus.toLowerCase()}`,
        data: {
          order: updatedOrder,
          platformResponse,
          ...(saleInfo
            ? { sale: saleInfo.sale, unmappedExcluded: saleInfo.unmappedExcluded }
            : {}),
        },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      // Transaction is gone: flush any queued audit rows before answering.
      flushPlatformAuditLogs(deferredLogs);

      console.error(`Online order ${toStatus} error:`, error);
      return res.status(500).json({ success: false, message: error.message || "Unable to update online order" });
    } finally {
      client.release();
    }
  }

  /*
   * Accept: performs the PLATFORM accept acknowledgement (preserved - some
   * platforms require a separate release/preparation acknowledgement) and
   * then lands the order in PREPARING: the internal onePOS workflow treats
   * acceptance as the start of preparation, so the kitchen sees "Preparing"
   * with no extra button. Event history keeps the ACKED_ACCEPTED ->
   * PREPARING trace (see onTransition).
   */
  router.post("/online/orders/:id/accept", authenticate, authorize("online_orders.manage"), async (req, res) => {
    await performOrderAction(req, res, {
      fromStatuses: ["RECEIVED"],
      toStatus: "PREPARING",
      platformAction: "acceptOrder",
      /* TAT groundwork: manual acceptance IS the start of preparation, so
       * accepted_at and preparing_at are stamped here (preparing_at is the
       * existing timestampColumn below; accepted_at is written explicitly). */
      timestampColumn: "preparing_at",
      callPlatform: (service, order, runtime, client) => order.platform === "uber"
        ? executeWorkflowAction({
            db,
            client,
            req,
            companyId: req.user.companyId,
            recordId: order.id,
            action: { type: "UBER_ACCEPT_ORDER", orderId: order.id },
          })
        : service.acceptOrder(order, runtime),
      buildMessage: (order) => `Order accepted - preparation started (platform call ${order.platform})`,
      onTransition: async (client, { order, toStatus }) => {
        await client.query(
          "UPDATE online_orders SET accepted_at = NOW() WHERE id = $1 AND accepted_at IS NULL",
          [order.id]
        );

        await recordEvent(client, {
          orderId: order.id,
          eventType: "ACKED_ACCEPTED",
          fromStatus: order.status,
          toStatus: "ACCEPTED",
          message: `Platform accept acknowledgement (${order.platform})`,
          platformResponse: { simulated: true },
          actorUserId: req.user.id,
        });
      },
    });
  });

  router.post("/online/orders/:id/reject", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const reason = (req.body && req.body.reason) || "Rejected by store";

    await performOrderAction(req, res, {
      fromStatuses: ["RECEIVED", "ACCEPTED"],
      toStatus: "REJECTED",
      platformAction: "rejectOrder",
      releaseInventory: true,
      reason,
      timestampColumn: "cancelled_at",
      callPlatform: (service, order, runtime, client) => order.platform === "uber"
        ? executeWorkflowAction({
            db,
            client,
            req,
            companyId: req.user.companyId,
            recordId: order.id,
            action: { type: "UBER_DENY_ORDER", orderId: order.id, reason },
          })
        : service.rejectOrder(order, reason, runtime),
      buildMessage: (order) => `Order rejected; inventory reservation released (${order.platform})`,
    });
  });

  router.post("/online/orders/:id/preparing", authenticate, authorize("online_orders.manage"), async (req, res) => {
    await performOrderAction(req, res, {
      fromStatuses: ["ACCEPTED"],
      toStatus: "PREPARING",
      platformAction: "markPreparing",
      timestampColumn: "preparing_at",
      callPlatform: (service, order, runtime) => service.markPreparing(order, runtime),
    });
  });

  router.post("/online/orders/:id/ready", authenticate, authorize("online_orders.manage"), async (req, res) => {
    await performOrderAction(req, res, {
      fromStatuses: ["ACCEPTED", "PREPARING"],
      toStatus: "READY",
      platformAction: "markReady",
      timestampColumn: "ready_at",
      callPlatform: (service, order, runtime) => service.markReady(order, runtime),
    });
  });

  router.post("/online/orders/:id/cancel", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const reason = (req.body && req.body.reason) || "Cancelled";

    await performOrderAction(req, res, {
      fromStatuses: ACTIVE_STATUSES,
      toStatus: "CANCELLED",
      platformAction: "cancelOrder",
      releaseInventory: true,
      reason,
      timestampColumn: "cancelled_at",
      callPlatform: (service, order, runtime) => service.cancelOrder(order, reason, runtime),
      buildMessage: (order) => `Order cancelled; inventory reservation released (${order.platform})`,
    });
  });

  /*
   * Complete with OTP: the UI collects the handover code, the PLATFORM
   * validates it (stub today, real Uber API later) and only a successful
   * platform response marks the local order COMPLETED (otp_verified_at set).
   * An incorrect OTP returns code INVALID_OTP and the order stays open for
   * retry. Inventory was deducted on reservation, so it stays consumed.
   *
   * A shop may hand an order over straight from PREPARING (e.g. collection
   * orders that never needed a "ready" notification), which is why both
   * PREPARING and READY may complete - the transition set is unchanged from
   * the committed behaviour.
   */
  router.post("/online/orders/:id/complete", authenticate, authorize("online_orders.manage"), async (req, res) => {
    await performOrderAction(req, res, {
      fromStatuses: ["READY", "PREPARING"],
      toStatus: "COMPLETED",
      platformAction: "completeOrder",
      timestampColumn: "completed_at",
      callPlatform: (service, order, runtime) =>
        service.completeOrder(order, (req.body && req.body.otp) || "", runtime),
      buildMessage: (order) => `Order completed - OTP verified by platform, inventory permanently consumed (${order.platform})`,
      /*
       * ONLINE ORDER -> POS SALE: on successful completion the completed
       * order becomes a onePOS sale inside the SAME transaction (see
       * performOrderAction). Fails the request (rollback) if the sale cannot
       * be created; retries cannot create a second sale (unique index).
       */
      createSale: (client, context) => createSaleForCompletedOrder(client, context),
    });
  });

  /*
   * Resolves the store a Deliveroo order belongs to. Deliveroo identifies the
   * site with location_id (e.g. "D101"), which is stored in the Deliveroo
   * integration configuration (store_location_id) - never invented. Falls back
   * to the company's default store so an order is still recorded when the
   * location cannot be matched.
   */
  async function resolveDeliverooStoreId(companyId, normalized) {
    const locationId = normalized && normalized.locationId;

    // Match the Deliveroo location_id against the store code first (a store
    // code is the only free-form store identifier the project carries today).
    if (locationId) {
      const matchedStore = await db(
        "SELECT id FROM stores WHERE company_id = $1 AND code = $2 LIMIT 1",
        [companyId, String(locationId)]
      );

      if (matchedStore.rows.length) {
        return matchedStore.rows[0].id;
      }
    }

    const fallback = await db(
      "SELECT id FROM stores WHERE company_id = $1 ORDER BY created_at LIMIT 1",
      [companyId]
    );

    return fallback.rows.length ? fallback.rows[0].id : null;
  }

  /*
   * Resolves a Deliveroo item (by its stable Deliveroo identifier - pos_item_id
   * / PLU from the order line) to a onePOS product.
   *
   * Resolution order:
   *   1. a saved Deliveroo item mapping (deliveroo_item_mappings) - the link the
   *      "Map product" UI creates,
   *   2. the legacy products.deliveroo_item_id column (configured manually in
   *      the Products admin).
   *
   * Matching is ALWAYS by the stable Deliveroo id. Name is never used to create
   * or infer a mapping - an unmatched item simply stays UNMAPPED.
   */
  async function resolveDeliverooProduct(client, companyId, externalItemId) {
    if (!externalItemId) {
      return null;
    }

    const mappingResult = await client.query(
      `
      SELECT p.id, p.name, p.price, p.vat_rate, p.track_stock
      FROM deliveroo_item_mappings m
      INNER JOIN products p ON p.id = m.product_id
      WHERE m.company_id = $1
        AND m.external_item_id = $2
        AND m.active = true
        AND p.active = true
      LIMIT 1
      `,
      [companyId, externalItemId]
    );

    if (mappingResult.rows.length) {
      return mappingResult.rows[0];
    }

    const productResult = await client.query(
      `
      SELECT id, name, price, vat_rate, track_stock
      FROM products
      WHERE company_id = $1
        AND active = true
        AND deliveroo_item_id = $2
      LIMIT 1
      `,
      [companyId, externalItemId]
    );

    return productResult.rows[0] || null;
  }

  /*
   * Maps Deliveroo order items onto onePOS products WITHOUT ever failing the
   * order: an item whose Deliveroo pos_item_id is not linked to a product is
   * kept (mapping_status 'UNMAPPED') so the mapping UI can be built from real
   * data later. Matching is by the stable Deliveroo identifier only.
   */
  async function resolveDeliverooItems(client, companyId, normalized) {
    const mapped = [];
    const unmapped = [];

    for (const item of normalized.items || []) {
      const externalItemId = item.posItemId !== undefined && item.posItemId !== null ? String(item.posItemId) : null;

      const product = await resolveDeliverooProduct(client, companyId, externalItemId);

      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const lineTotal = Number(item.totalPrice) || Number((unitPrice * quantity).toFixed(2));

      const platformData = {
        source: "deliveroo_webhook",
        external_item_id: externalItemId,
        deliveroo_item_name: item.name || item.operationalName || null,
        operational_name: item.operationalName,
        modifiers: item.modifiers,
        discount_amount: item.discountAmount,
        raw: item.raw,
      };

      if (product) {
        mapped.push({
          productId: product.id,
          productName: product.name,
          externalItemId,
          quantity,
          unitPrice,
          tax: Number(((unitPrice * quantity * Number(product.vat_rate || 0)) / 100).toFixed(2)),
          total: lineTotal,
          trackStock: product.track_stock,
          mappingStatus: "MAPPED",
          platformData,
        });
      } else {
        unmapped.push({
          productId: null,
          productName: item.name || item.operationalName || externalItemId || "Unmapped Deliveroo item",
          externalItemId,
          quantity,
          unitPrice,
          tax: 0,
          total: lineTotal,
          trackStock: false,
          mappingStatus: "UNMAPPED",
          platformData,
        });
      }
    }

    return { items: [...mapped, ...unmapped], mapped, unmapped };
  }

  /*
   * Creates the online_orders row for a verified Deliveroo ORDER NEW webhook.
   *
   * IDEMPOTENT: online_orders has UNIQUE (company_id, platform,
   * external_order_id); INSERT ... ON CONFLICT DO NOTHING returns no row when
   * the order already exists, so repeated webhook deliveries can never create
   * a duplicate. The row enters the project's normal initial lifecycle state
   * (RECEIVED) - onePOS never auto-accepts or auto-rejects a Deliveroo order.
   *
   * INVENTORY: exactly the existing behaviour is preserved - tracked, MAPPED
   * items are reserved from the shared stock pool via the same
   * reserveOrderInventory helper used by the manual online-order intake (which
   * itself skips untracked items). Unmapped items have no product to reserve.
   */
  async function createDeliverooOrder({
    companyId,
    normalized,
    storeId,
    loggedPayload,
    signatureState,
  }) {
    if (!pool) {
      return { created: false, reason: "database_not_configured", orderId: null, unmappedCount: 0 };
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const { items, mapped, unmapped } = await resolveDeliverooItems(client, companyId, normalized);

      const subtotal = mapped.reduce((sum, item) => sum + item.total, 0);
      const tax = mapped.reduce((sum, item) => sum + item.tax, 0);
      const deliveryFee = Number(normalized.deliveryFee) || 0;
      const total = normalized.total || Number((subtotal + deliveryFee).toFixed(2));

      const orderResult = await client.query(
        `
        INSERT INTO online_orders (
          company_id, store_id, platform, external_order_id, external_reference,
          status, customer_name, customer_phone, fulfilment_type, otp_code, currency,
          subtotal, tax, delivery_fee, total, notes, platform_data, inventory_reserved
        )
        VALUES ($1,$2,'deliveroo',$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,FALSE)
        ON CONFLICT (company_id, platform, external_order_id) DO NOTHING
        RETURNING *
        `,
        [
          companyId,
          storeId,
          normalized.externalOrderId,
          normalized.externalReference || null,
          normalized.customer.name || null,
          normalized.customer.phone || null,
          normalized.fulfilmentType || "DELIVERY",
          normalized.customer.otp ? String(normalized.customer.otp) : null,
          normalized.currency || "GBP",
          Number(normalized.subtotal || subtotal).toFixed(2),
          tax.toFixed(2),
          deliveryFee.toFixed(2),
          Number(total).toFixed(2),
          normalized.notes || null,
          JSON.stringify({
            received_via: "deliveroo_webhook",
            event: normalized.eventType,
            signature_state: signatureState,
            location_id: normalized.locationId,
            deliveroo_status: normalized.status,
            unmapped_item_count: unmapped.length,
          }),
        ]
      );

      if (!orderResult.rows.length) {
        // Duplicate delivery: no new row may be created.
        await client.query("ROLLBACK");
        transactionStarted = false;

        const existing = await db(
          "SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'deliveroo' AND external_order_id = $2 LIMIT 1",
          [companyId, normalized.externalOrderId]
        );

        return {
          created: false,
          reason: "duplicate",
          orderId: existing.rows.length ? existing.rows[0].id : null,
          orderStatus: existing.rows.length ? existing.rows[0].status : null,
          unmappedCount: 0,
        };
      }

      const order = orderResult.rows[0];

      for (const item of items) {
        await client.query(
          `
          INSERT INTO online_order_items (
            order_id, product_id, external_item_id, product_name, quantity, unit_price, tax, total, mapping_status, platform_data
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            order.id,
            item.productId,
            item.externalItemId,
            item.productName,
            item.quantity,
            item.unitPrice.toFixed(2),
            item.tax.toFixed(2),
            item.total.toFixed(2),
            item.mappingStatus,
            JSON.stringify(item.platformData),
          ]
        );
      }

      // Preserve the existing inventory design: only MAPPED, tracked items are
      // reserved (the shared helper already skips untracked products).
      const reservable = mapped.filter((item) => item.trackStock);
      let inventoryReserved = false;

      if (reservable.length) {
        await reserveOrderInventory(client, {
          companyId,
          storeId,
          order,
          items: reservable,
          userId: null,
        });
        await client.query(
          "UPDATE online_orders SET inventory_reserved = TRUE, updated_at = NOW() WHERE id = $1",
          [order.id]
        );
        inventoryReserved = true;
      }

      // Full incoming payload preserved in the existing event/audit structure.
      await recordEvent(client, {
        orderId: order.id,
        eventType: `DELIVEROO_${String(normalized.eventType || "ORDER_NEW")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .slice(0, 40)}`,
        toStatus: "RECEIVED",
        message:
          `Deliveroo order created from webhook (${signatureState})` +
          (unmapped.length ? `; ${unmapped.length} item(s) without a onePOS mapping` : "") +
          (inventoryReserved ? "; inventory reserved" : ""),
        platformResponse: loggedPayload,
        actorUserId: null,
      });

      await client.query("COMMIT");

      return {
        created: true,
        reason: null,
        orderId: order.id,
        orderStatus: order.status,
        unmappedCount: unmapped.length,
        unmapped,
        inventoryReserved,
      };
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /*
   * Resolves the onePOS store an Uber event/order belongs to. Resolution
   * order (never invented):
   *   1. the Uber store_id saved in the integration configuration (set by
   *      the store.provisioned handler or the Settings "Save this Store ID"
   *      action) - matched against a store code,
   *   2. the store/location id from the event payload (same code match),
   *   3. the company's default store so the order is still recorded when no
   *      explicit mapping exists.
   */
  async function resolveUberStoreId(companyId, { storeId = null, locationId = null } = {}, configuration = {}) {
    const candidates = [storeId, locationId].filter(Boolean).map(String);

    for (const candidate of candidates) {
      const configuredMapping = Array.isArray(configuration.store_mappings)
        ? configuration.store_mappings.find((mapping) => String(mapping.uber_store_id) === candidate)
        : null;
      if (configuredMapping?.onepos_store_id) {
        const mappedStore = await db(
          "SELECT id FROM stores WHERE company_id = $1 AND id = $2 LIMIT 1",
          [companyId, configuredMapping.onepos_store_id]
        );
        return mappedStore.rows[0]?.id || null;
      }

      const matchedStore = await db(
        "SELECT id FROM stores WHERE company_id = $1 AND code = $2 LIMIT 1",
        [companyId, candidate]
      );

      if (matchedStore.rows.length) {
        return matchedStore.rows[0].id;
      }
    }

    if (candidates.length) return null;

    const fallback = await db(
      "SELECT id FROM stores WHERE company_id = $1 ORDER BY created_at LIMIT 2",
      [companyId]
    );

    return fallback.rows.length === 1 ? fallback.rows[0].id : null;
  }

  /*
   * Maps Uber order items onto onePOS products (same policy as Deliveroo):
   * matching is by the stable Uber identifier (pos_item_id) against the
   * products.uber_item_id column ONLY - an unmatched item stays UNMAPPED and
   * is never dropped, so the order still arrives and can be reconciled.
   */
  async function resolveUberItems(client, companyId, normalized) {
    const mapped = [];
    const unmapped = [];

    for (const item of normalized.items || []) {
      const externalItemId = item.externalItemId !== undefined && item.externalItemId !== null ? String(item.externalItemId) : null;

      let product = null;

      if (externalItemId) {
        const productResult = await client.query(
          `
          SELECT id, name, price, vat_rate, track_stock
          FROM products
          WHERE company_id = $1
            AND active = true
            AND uber_item_id = $2
          LIMIT 1
          `,
          [companyId, externalItemId]
        );

        product = productResult.rows[0] || null;
      }

      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      const unitPrice = Number(item.unitPrice) || 0;
      const lineTotal = Number(item.totalPrice) || Number((unitPrice * quantity).toFixed(2));

      const platformData = {
        source: "uber_webhook",
        external_item_id: externalItemId,
        uber_item_name: item.name || item.operationalName || null,
        operational_name: item.operationalName,
        modifiers: item.modifiers,
        special_requests: item.specialRequests,
        raw: item.raw,
      };

      if (product) {
        mapped.push({
          productId: product.id,
          productName: product.name,
          externalItemId,
          quantity,
          unitPrice,
          tax: Number(((unitPrice * quantity * Number(product.vat_rate || 0)) / 100).toFixed(2)),
          total: lineTotal,
          trackStock: product.track_stock,
          mappingStatus: "MAPPED",
          platformData,
        });
      } else {
        unmapped.push({
          productId: null,
          productName: item.name || item.operationalName || externalItemId || "Unmapped Uber Eats item",
          externalItemId,
          quantity,
          unitPrice,
          tax: 0,
          total: lineTotal,
          trackStock: false,
          mappingStatus: "UNMAPPED",
          platformData,
        });
      }
    }

    return { items: [...mapped, ...unmapped], mapped, unmapped };
  }

  /*
   * Creates the online_orders row for a verified Uber orders.notification
   * webhook - IDEMPOTENT (UNIQUE (company_id, platform, external_order_id),
   * ON CONFLICT DO NOTHING) and using the EXISTING lifecycle/inventory
   * machinery: the order enters RECEIVED, tracked+MAPPED items are reserved
   * via reserveOrderInventory, and the full payload is preserved as an event.
   * onePOS never auto-accepts; the existing manual-accept endpoint drives the
   * next transition (status is sent back to Uber by the same accept/complete
   * platform calls used for every other action).
   */
  async function createUberOrder({
    companyId,
    normalized,
    storeId,
    loggedPayload,
    signatureState,
  }) {
    if (!pool) {
      return { created: false, reason: "database_not_configured", orderId: null, unmappedCount: 0 };
    }

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const { items, mapped, unmapped } = await resolveUberItems(client, companyId, normalized);

      const subtotal = mapped.reduce((sum, item) => sum + item.total, 0);
      const tax = mapped.reduce((sum, item) => sum + item.tax, 0);
      const deliveryFee = Number(normalized.deliveryFee) || 0;
      const total = normalized.total || Number((subtotal + deliveryFee).toFixed(2));

      const orderResult = await client.query(
        `
        INSERT INTO online_orders (
          company_id, store_id, platform, external_order_id, external_reference,
          status, customer_name, customer_phone, fulfilment_type, otp_code, currency,
          subtotal, tax, delivery_fee, total, notes, platform_data, inventory_reserved
        )
        VALUES ($1,$2,'uber',$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,FALSE)
        ON CONFLICT (company_id, platform, external_order_id) DO NOTHING
        RETURNING *
        `,
        [
          companyId,
          storeId,
          normalized.externalOrderId,
          normalized.externalReference || null,
          normalized.customer.name || null,
          normalized.customer.phone || null,
          normalized.fulfilmentType || "DELIVERY",
          normalized.customer.otp ? String(normalized.customer.otp) : null,
          normalized.currency || "GBP",
          Number(normalized.subtotal || subtotal).toFixed(2),
          tax.toFixed(2),
          deliveryFee.toFixed(2),
          Number(total).toFixed(2),
          normalized.notes || null,
          JSON.stringify({
            received_via: "uber_webhook",
            event: normalized.eventType,
            signature_state: signatureState,
            uber_store_id: normalized.storeId || null,
            uber_user_id: normalized.userId || null,
            resource_href: normalized.resourceHref || null,
            unmapped_item_count: unmapped.length,
          }),
        ]
      );

      if (!orderResult.rows.length) {
        // Duplicate delivery: no new row may be created.
        await client.query("ROLLBACK");
        transactionStarted = false;

        const existing = await db(
          "SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'uber' AND external_order_id = $2 LIMIT 1",
          [companyId, normalized.externalOrderId]
        );

        return {
          created: false,
          reason: "duplicate",
          orderId: existing.rows.length ? existing.rows[0].id : null,
          orderStatus: existing.rows.length ? existing.rows[0].status : null,
          unmappedCount: 0,
        };
      }

      const order = orderResult.rows[0];

      for (const item of items) {
        await client.query(
          `
          INSERT INTO online_order_items (
            order_id, product_id, external_item_id, product_name, quantity, unit_price, tax, total, mapping_status, platform_data
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            order.id,
            item.productId,
            item.externalItemId,
            item.productName,
            item.quantity,
            item.unitPrice.toFixed(2),
            item.tax.toFixed(2),
            item.total.toFixed(2),
            item.mappingStatus,
            JSON.stringify(item.platformData),
          ]
        );
      }

      // Existing inventory design: only MAPPED, tracked items are reserved.
      const reservable = mapped.filter((item) => item.trackStock);
      let inventoryReserved = false;

      if (reservable.length) {
        await reserveOrderInventory(client, {
          companyId,
          storeId,
          order,
          items: reservable,
          userId: null,
        });
        await client.query(
          "UPDATE online_orders SET inventory_reserved = TRUE, updated_at = NOW() WHERE id = $1",
          [order.id]
        );
        inventoryReserved = true;
      }

      await recordEvent(client, {
        orderId: order.id,
        eventType: `UBER_${String(normalized.eventType || "ORDERS_NOTIFICATION").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40)}`,
        toStatus: "RECEIVED",
        message:
          `Uber Eats order created from webhook (${signatureState})` +
          (unmapped.length ? `; ${unmapped.length} item(s) without a onePOS mapping` : "") +
          (inventoryReserved ? "; inventory reserved" : ""),
        platformResponse: loggedPayload,
        actorUserId: null,
      });

      await client.query("COMMIT");

      return {
        created: true,
        reason: null,
        orderId: order.id,
        orderStatus: order.status,
        unmappedCount: unmapped.length,
        unmapped,
        inventoryReserved,
      };
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /*
   * Records a Deliveroo status-update (or any later) webhook against an
   * existing order. If no order exists yet the event is still stored safely -
   * as a webhook audit row in platform_api_logs (written by the caller) - and
   * NO order is fabricated, so a status update arriving before ORDER NEW can
   * never create a corrupt order. Status transitions are deliberately left to
   * the existing lifecycle endpoints (accept/reject/...), which the platform
   * response drives; this only attaches the event to the order.
   */
  async function attachDeliverooEvent({ companyId, event, loggedPayload, signatureState }) {
    const orderRow = await db(
      "SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'deliveroo' AND external_order_id = $2 LIMIT 1",
      [companyId, event.externalOrderId]
    );

    if (!orderRow.rows.length) {
      return { orderId: null, recorded: false };
    }

    const order = orderRow.rows[0];

    await db(
      `INSERT INTO online_order_events (order_id, event_type, from_status, to_status, message, platform_response)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        order.id,
        String(event.eventType || "WEBHOOK_RECEIVED")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .slice(0, 50),
        order.status,
        null,
        `Deliveroo webhook received (${signatureState})`,
        JSON.stringify(loggedPayload),
      ]
    );

    return { orderId: order.id, recorded: true };
  }

  /*
   * Writes the webhook audit row and returns the transport acknowledgement
   * to Deliveroo.
   *
   * Deliveroo REQUIRES an HTTP 200 OK acknowledgement:
   *   - "Listening for Order Events": the webhook endpoint in your
   *     integration must respond with an HTTP status 200 OK to our requests.
   *   - "Order Integration": send a HTTP 200 response to Deliveroo.
   *   - Legacy POS webhook doc: "It will only work if you send a 200."
   * A 4xx/5xx (or a non-200 such as the previous 202) is treated as a
   * failure / invalid response and triggers retries. This is a genuine
   * transport acknowledgement - it does not simulate any Deliveroo API
   * response and no Deliveroo API is called here.
   */
  async function acknowledgeDeliverooWebhook(res, { companyId, environment, action, payload, signatureHeader, sequenceGuidHeader, hmacHeader, signatureState, verifiedVia, attachedOrderId }) {
    const acknowledgement = { status: "ok" };

    await logPlatformApiCall(db, {
      companyId,
      platform: "deliveroo",
      environment: environment || null,
      action,
      endpoint: "/api/online/deliveroo/webhook",
      httpMethod: "POST",
      requestPayload: payload,
      requestHeaders: {
        "x-deliveroo-sequence-guid": sequenceGuidHeader ? "(present)" : "(absent)",
        "x-deliveroo-hmac-sha256": hmacHeader ? "(present)" : "(absent)",
        "x-deliveroo-signature": signatureHeader ? "(present)" : "(absent)",
        signature_state: signatureState,
        verified_via: verifiedVia,
      },
      responseStatus: 200,
      responseBody: { ...acknowledgement, order_attached: Boolean(attachedOrderId) },
      success: true,
      orderId: attachedOrderId,
    });

    return res.status(200).json(acknowledgement);
  }

  /*
   * GET /api/online/uber/webhook/health
   *
   * Reachability probe (no authentication, no side effects) so the Uber
   * Developer Dashboard URL entry can be smoke-tested before signing
   * deliveries start.
   */
  router.get("/online/uber/webhook/health", (req, res) => {
    res.status(200).json({
      success: true,
      service: "uber-webhook",
      status: "reachable",
    });
  });

  /*
   * POST /api/online/uber/webhook                <- the Uber PRIMARY WEBHOOK URL
   *
   * Public, unauthenticated endpoint: authenticity is enforced via
   * `X-Uber-Signature` (HMAC-SHA256 of the raw body with the Client Secret,
   * hex) whenever the secret is configured in Settings -> Online Platforms ->
   * Uber Eats (Client secret / Webhook secret). The raw body is provided by
   * the express.raw parser mounted in server.js (same mechanism as the
   * Deliveroo webhook).
   *
   * HANDLED EVENTS
   *   store.provisioned      -> map the Uber store onto the onePOS store and
   *                             remember it in the integration configuration
   *                             (store_id / brand_id), so orders from this
   *                             store land on the right tenant/store. Store
   *                             mapping resolution: config store_id, then
   *                             config store_location_id, then the company
   *                             default store - the mapping itself is never
   *                             invented.
   *   store.deprovisioned    -> records the event on the configuration and
   *                             the audit log (no destructive change).
   *   orders.notification    -> creates the online_orders row (RECEIVED,
   *                             idempotent via UNIQUE (company_id, platform,
   *                             external_order_id)) through the SAME
   *                             inventory/reservation/event machinery as the
   *                             Deliveroo intake. Status transitions are left
   *                             to the existing lifecycle endpoints (manual
   *                             accept by default).
   *
   * TRANSPORT ACK: Uber requires HTTP 200 with an EMPTY body - a non-200 or
   * garbage body triggers retries. Intake failures are logged and still
   * acknowledged, so a transient intake problem can never wedge the
   * delivery (the audit log keeps the payload for reprocessing).
   *
   * ISOLATION: the company is resolved EXCLUSIVELY by verifying the request
   * signature against the stored secret of that company's integration row -
   * a request that verifies under company A's secret can never touch
   * company B's data. A request that verifies under NO configured secret is
   * rejected 401; if no secret is configured anywhere the event is recorded
   * transparently as signature-unverified (sandbox setup stage).
   */
  router.post("/online/uber/webhook", async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signatureHeader = req.headers["x-uber-signature"] || null;
    const rawBodyText = rawBody.toString("utf8");

    let payload = null;
    try {
      payload = JSON.parse(rawBodyText);
    } catch {
      payload = null;
    }

    /* The raw webhook payload must never be lost (parsed payload preferred). */
    const loggedPayload = payload !== null ? payload : rawBodyText || null;

    const uber = getPlatformService("uber");
    let integrations = null;

    try {
      integrations = await db(
        "SELECT company_id, active, configuration FROM integrations WHERE provider = 'uber' ORDER BY created_at"
      );

      if (!integrations.rows.length) {
        console.error("Uber webhook received but no Uber Eats integration is configured");
        return res.status(200).send(""); // empty-body ack: no config yet is not a transport error
      }

      /* Resolve the company via signature verification (see ISOLATION above). */
      let matched = null;
      let signatureState = "unverified_no_secret_configured";
      let verifiedVia = null;

      for (const row of integrations.rows) {
        const configuration = row.configuration || {};
        // Uber signs primary-webhook deliveries with the CLIENT SECRET; the
        // dedicated webhook_secret field is honoured as well (rotation path).
        const secret =
          decryptSecret(configuration.client_secret) || decryptSecret(configuration.webhook_secret);

        if (!secret) continue;

        if (uber.verifyWebhookSignature(rawBody, signatureHeader, secret)) {
          matched = row;
          signatureState = "verified";
          verifiedVia = configuration.webhook_secret ? "webhook_secret" : "client_secret";
          break;
        }
      }

      if (!matched) {
        const anySecretConfigured = integrations.rows.some(
          (row) =>
            decryptSecret((row.configuration || {}).client_secret) ||
            decryptSecret((row.configuration || {}).webhook_secret)
        );

        if (anySecretConfigured) {
          await logPlatformApiCall(db, {
            companyId: integrations.rows[0].company_id,
            platform: "uber",
            environment: (integrations.rows[0].configuration || {}).environment || null,
            action: "WEBHOOK_REJECTED",
            endpoint: "/api/online/uber/webhook",
            httpMethod: "POST",
            requestPayload: loggedPayload,
            requestHeaders: { "x-uber-signature": signatureHeader ? "(present - did not verify)" : "(absent)" },
            responseStatus: 401,
            responseBody: { error: "invalid_signature" },
            success: false,
            errorMessage: "Uber webhook signature verification failed",
          });

          return res.status(401).json({ error: "invalid_signature" });
        }

        matched = integrations.rows.find((row) => row.active !== false) || integrations.rows[0];
      }

      const companyId = matched.company_id;
      const configuration = matched.configuration || {};
      const event = payload ? uber.parseWebhookEvent(payload) : null;

      const action = `WEBHOOK_${String((event && event.eventType) || "UNKNOWN")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 80)}`;

      let attachedOrderId = null;
      let storeMappingResult = null;
      let intakeResult = null;
      let cancellationResult = null;

      /*
       * STORE PROVISIONING: remember the Uber store on the integration
       * configuration (idempotent) and record the event. The onePOS store is
       * resolved from the saved mapping - never auto-created.
       */
      if (event && (event.eventKind === "store_provisioned" || event.eventKind === "store_deprovisioned")) {
        try {
          const resolvedStoreId = await resolveUberStoreId(companyId, { storeId: event.storeId }, configuration);

          await db(
            `UPDATE integrations
             SET configuration = configuration || $2::jsonb, updated_at = NOW()
             WHERE company_id = $1 AND provider = 'uber'`,
            [
              companyId,
              JSON.stringify({
                store_id: event.storeId || (configuration.store_id || null),
                uber_org_id: event.userId || (configuration.uber_org_id || null),
                uber_store_status: event.eventKind === "store_provisioned" ? "provisioned" : "deprovisioned",
                last_store_event_at: new Date().toISOString(),
              }),
            ]
          );

          storeMappingResult = { uberStoreId: event.storeId, onePosStoreId: resolvedStoreId };

          /* online_order_events.order_id is NOT NULL, so store-level events are
           * recorded in the platform API audit log (below, with the mapping
           * result) instead of the per-order event table. */
        } catch (provisionError) {
          console.error("Uber store provisioning event failed:", provisionError);
        }
      }

      /*
       * ORDER INTAKE: orders.notification with an inline order payload ->
       * create the online order through the same machinery as Deliveroo.
       * Events without an inline order (id/resource_href only) are attached
       * to the existing order, or stored audit-only if it does not exist yet
       * (no order is ever fabricated from a status notification).
       */
      if (event && event.eventKind === "order_new") {
        const normalized = uber.normalizeIncomingOrder(payload);

        if (normalized) {
          try {
            const storeId = await resolveUberStoreId(companyId, normalized, configuration);

            intakeResult = await createUberOrder({
              companyId,
              normalized,
              storeId,
              loggedPayload,
              signatureState,
            });

            attachedOrderId = intakeResult.orderId;

            console.log(
              `[UBER-WEBHOOK] order intake external_order_id=${normalized.externalOrderId} ` +
                `created=${intakeResult.created} reason=${intakeResult.reason || "n/a"} ` +
                `unmapped_items=${intakeResult.unmappedCount}`
            );
          } catch (intakeError) {
            console.error("Uber order intake failed:", intakeError);
          }
        } else {
          console.error("Uber orders.notification could not be normalised - no order created");
        }
      } else if (event && event.eventKind === "order_cancelled") {
        cancellationResult = { applied: false, reason: null };

        if (signatureState !== "verified") {
          cancellationResult.reason = "signature_not_verified";
        } else if (!event.externalOrderId) {
          cancellationResult.reason = "missing_external_order_id";
        } else {
          try {
            const orderRow = await db(
              `SELECT id, status, store_id
               FROM online_orders
               WHERE company_id = $1 AND platform = 'uber' AND external_order_id = $2
               LIMIT 1`,
              [companyId, event.externalOrderId]
            );
            const order = orderRow.rows[0] || null;

            if (!order) {
              cancellationResult.reason = "order_not_mapped";
            } else if (!order.store_id) {
              cancellationResult.reason = "order_store_not_mapped";
            } else {
              const uberStoreId = event.storeId || event.userId || configuration.store_id || null;
              let resolvedStoreId = order.store_id;

              if (uberStoreId) {
                resolvedStoreId = await resolveUberStoreId(
                  companyId,
                  { storeId: String(uberStoreId) },
                  configuration
                );
              } else {
                const ownedStore = await db(
                  "SELECT id FROM stores WHERE company_id = $1 AND id = $2 LIMIT 1",
                  [companyId, order.store_id]
                );
                resolvedStoreId = ownedStore.rows[0] ? ownedStore.rows[0].id : null;
              }

              if (!resolvedStoreId) {
                cancellationResult.reason = "uber_store_not_mapped";
              } else if (String(resolvedStoreId) !== String(order.store_id)) {
                cancellationResult.reason = "order_store_mismatch";
              } else {
                const transition = await transitionGenericOrder({
                  pool,
                  companyId,
                  orderId: order.id,
                  userId: null,
                  toStatus: "CANCELLED",
                  reason: `Uber cancellation notification (${event.eventType})`,
                  createInventoryMovement,
                });

                if (transition.success) {
                  attachedOrderId = order.id;
                  cancellationResult = { applied: true, fromStatus: order.status, toStatus: "CANCELLED" };
                } else if (order.status === "CANCELLED") {
                  // A redelivered cancellation is already reflected by the
                  // existing status event; do not append another event or release stock twice.
                  attachedOrderId = order.id;
                  cancellationResult = { applied: false, reason: "already_cancelled" };
                } else {
                  cancellationResult.reason = "unsupported_order_state";
                }
              }
            }
          } catch (cancelError) {
            cancellationResult.reason = "cancellation_processing_failed";
            console.error("Uber cancellation webhook could not be applied:", cancelError);
          }
        }
      } else if (event && event.externalOrderId) {
        try {
          const orderRow = await db(
            "SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'uber' AND external_order_id = $2 LIMIT 1",
            [companyId, event.externalOrderId]
          );

          if (orderRow.rows.length) {
            await db(
              `INSERT INTO online_order_events (order_id, event_type, from_status, to_status, message, platform_response)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                orderRow.rows[0].id,
                String(event.eventType || "WEBHOOK_RECEIVED").toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 50),
                orderRow.rows[0].status,
                null,
                `Uber webhook received (${signatureState})`,
                JSON.stringify(loggedPayload),
              ]
            );
            attachedOrderId = orderRow.rows[0].id;
          }
        } catch (attachError) {
          console.error("Uber webhook event attach failed:", attachError);
        }
      }

      /*
       * Transport acknowledgement: HTTP 200 with an EMPTY body (Uber
       * requirement; mirrors acknowledgeDeliverooWebhook's 200 but without a
       * JSON body). Every exchange is written to platform_api_logs with
       * secrets redacted by the logger.
       */
      await logPlatformApiCall(db, {
        companyId,
        platform: "uber",
        environment: configuration.environment || null,
        action,
        endpoint: "/api/online/uber/webhook",
        httpMethod: "POST",
        requestPayload: loggedPayload,
        requestHeaders: {
          "x-uber-signature": signatureHeader ? "(present)" : "(absent)",
          signature_state: signatureState,
          verified_via: verifiedVia,
        },
        responseStatus: 200,
        responseBody: {
          order_attached: Boolean(attachedOrderId),
          store_mapping: storeMappingResult,
          cancellation: cancellationResult,
        },
        success: true,
        orderId: attachedOrderId,
      });

      return res.status(200).send("");
    } catch (error) {
      console.error("Uber webhook error:", error);

      try {
        await logPlatformApiCall(db, {
          companyId: integrations && integrations.rows.length ? integrations.rows[0].company_id : null,
          platform: "uber",
          action: "WEBHOOK_ERROR",
          endpoint: "/api/online/uber/webhook",
          httpMethod: "POST",
          requestPayload: loggedPayload,
          responseStatus: 200,
          responseBody: { acknowledged: true, processing: "error" },
          success: true,
          errorMessage: error.message,
        });
      } catch {
        /* logging must never mask the response */
      }

      /* Still 200/empty: Uber retries a non-200 and we do not want a
       * processing error to wedge the delivery. The full payload is in the
       * platform audit log for reprocessing. */
      return res.status(200).send("");
    }
  });

  /*
   * GET /api/online/deliveroo/webhook/health
   *
   * TEMPORARY reachability probe (no authentication, no side effects): proving
   * this URL answers from the deployed server shows that the webhook path is
   * being served - used while diagnosing Deliveroo sandbox delivery.
   */
  router.get("/online/deliveroo/webhook/health", (req, res) => {
    res.status(200).json({
      success: true,
      service: "deliveroo-webhook",
      status: "reachable",
    });
  });

  /*
   * POST /api/online/deliveroo/webhook
   *
   * Deliveroo Sandbox webhook receiver (public, unauthenticated endpoint -
   * authenticity is enforced via HMAC signature whenever a webhook secret is
   * configured in Settings -> Online Platforms -> Deliveroo). Receive-only:
   * no Deliveroo API is called and no platform response is simulated.
   *
   * The raw body is provided by the express.raw parser mounted in server.js
   * before the global JSON parser (needed for signature verification).
   */
  router.post("/online/deliveroo/webhook", async (req, res) => {
    /*
     * TEMPORARY DIAGNOSTIC (remove once Deliveroo sandbox reachability is
     * confirmed). Runs before signature verification and before any other
     * processing, so even a request whose signature is rejected - or whose
     * processing fails - proves that it reached this deployed server.
     *
     * Logged: timestamp, request id, method, URL, content-type,
     * content-length and the PRESENCE (never the value) of the three
     * Deliveroo signature headers. The webhook secret, tokens, the request
     * body and authentication headers are never logged.
     */
    const diagnosticRequestId = crypto.randomUUID();

    console.log(
      `[DELIVEROO-WEBHOOK-DIAG] ${new Date().toISOString()} id=${diagnosticRequestId} ` +
        `method=${req.method} url=${req.originalUrl} ` +
        `content-type=${req.headers["content-type"] || "(none)"} ` +
        `content-length=${req.headers["content-length"] ?? "(none)"} ` +
        `x-deliveroo-sequence-guid=${req.headers["x-deliveroo-sequence-guid"] ? "present" : "absent"} ` +
        `x-deliveroo-hmac-sha256=${req.headers["x-deliveroo-hmac-sha256"] ? "present" : "absent"} ` +
        `x-deliveroo-signature=${req.headers["x-deliveroo-signature"] ? "present" : "absent"}`
    );

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signatureHeader = req.headers["x-deliveroo-signature"] || null;
    const sequenceGuidHeader = req.headers["x-deliveroo-sequence-guid"] || null;
    const hmacHeader = req.headers["x-deliveroo-hmac-sha256"] || null;
    const rawBodyText = rawBody.toString("utf8");

    let payload = null;
    try {
      payload = JSON.parse(rawBodyText);
    } catch {
      payload = null;
    }

    /*
     * The raw webhook payload must never be lost: when the body is not valid
     * JSON the raw text is logged verbatim (parsed payload preferred when
     * available). Signature verification above/below is unaffected.
     */
    const loggedPayload = payload !== null ? payload : rawBodyText || null;

    const deliveroo = getPlatformService("deliveroo");
    let integrations = null;

    try {
      integrations = await db(
        "SELECT company_id, active, configuration FROM integrations WHERE provider = 'deliveroo' ORDER BY created_at"
      );

      if (!integrations.rows.length) {
        console.error("Deliveroo webhook received but no Deliveroo integration is configured");
        return res.status(500).json({ error: "no_deliveroo_configuration" });
      }

      /*
       * Resolve the company: prefer the integration whose webhook secret
       * verifies the request signature. Deliveroo's current webhooks sign
       *
       *   HMAC-SHA256(secret, sequenceGuid + " " + rawBody)   -> X-Deliveroo-Hmac-Sha256
       *
       * with X-Deliveroo-Sequence-Guid carrying the GUID (legacy POS callbacks
       * use " \n " instead of " "). The older raw-body-only
       * X-Deliveroo-Signature check is kept as a fallback so the existing
       * Postman signature test keeps working.
       *
       * If a secret is configured somewhere but NOTHING verifies -> reject
       * (401). If no secret is configured at all (sandbox setup stage), fall
       * back to the first active integration and record the event as
       * signature-unverified - transparently, never pretending it was
       * verified.
       */
      let matched = null;
      let signatureState = "unverified_no_secret_configured";
      let verifiedVia = null;

      for (const row of integrations.rows) {
        const secret = decryptSecret(row.configuration && row.configuration.webhook_secret);

        if (!secret) {
          continue;
        }

        const guidVariant = deliveroo.verifySequenceGuidSignature(
          rawBody,
          sequenceGuidHeader,
          hmacHeader,
          secret
        );

        if (guidVariant) {
          matched = row;
          signatureState = "verified";
          verifiedVia = guidVariant;
          break;
        }

        if (signatureHeader && deliveroo.verifyWebhookSignature(rawBody, signatureHeader, secret)) {
          matched = row;
          signatureState = "verified";
          verifiedVia = "raw_body_fallback";
          break;
        }
      }

      if (!matched) {
        const anySecretConfigured = integrations.rows.some(
          (row) => row.configuration && decryptSecret(row.configuration.webhook_secret)
        );

        if (anySecretConfigured) {
          await logPlatformApiCall(db, {
            companyId: integrations.rows[0].company_id,
            platform: "deliveroo",
            environment:
              (integrations.rows[0].configuration && integrations.rows[0].configuration.environment) || null,
            action: "WEBHOOK_REJECTED",
            endpoint: "/api/online/deliveroo/webhook",
            httpMethod: "POST",
            requestPayload: loggedPayload,
            requestHeaders: {
              "x-deliveroo-sequence-guid": sequenceGuidHeader ? "(present - did not verify)" : "(absent)",
              "x-deliveroo-hmac-sha256": hmacHeader ? "(present - did not verify)" : "(absent)",
              "x-deliveroo-signature": signatureHeader ? "(present - did not verify)" : "(absent)",
            },
            responseStatus: 401,
            responseBody: { error: "invalid_signature" },
            success: false,
            errorMessage: "Deliveroo webhook signature verification failed",
          });

          return res.status(401).json({ error: "invalid_signature" });
        }

        matched = integrations.rows.find((row) => row.active !== false) || integrations.rows[0];
      }

      const companyId = matched.company_id;
      const configuration = matched.configuration || {};
      const event = payload ? deliveroo.parseWebhookEvent(payload) : null;

      const action = `WEBHOOK_${String((event && event.eventType) || "UNKNOWN")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .slice(0, 80)}`;

      /*
       * ORDER INTAKE.
       *
       *   order.new          -> create the online_orders row (idempotently) in
       *                         the project's initial lifecycle state (RECEIVED)
       *                         and store the full payload as an event. The
       *                         Deliveroo order is NEVER auto-accepted/rejected.
       *   order.status_update-> attach the event to the existing order. If the
       *                         order does not exist yet (update arrived first)
       *                         the event is only stored in the webhook audit
       *                         log - no order is fabricated.
       *
       * A failure to build the local order must not break the transport
       * acknowledgement Deliveroo requires: the error is logged and HTTP 200
       * is still returned (the webhook can safely be re-delivered).
       */
      let attachedOrderId = null;
      let intakeResult = null;

      if (event && event.eventKind === "order_new") {
        const normalized = deliveroo.normalizeIncomingOrder(payload);

        if (normalized) {
          try {
            const storeId = await resolveDeliverooStoreId(companyId, normalized);

            intakeResult = await createDeliverooOrder({
              companyId,
              normalized,
              storeId,
              loggedPayload,
              signatureState,
            });

            attachedOrderId = intakeResult.orderId;

            console.log(
              `[DELIVEROO-WEBHOOK] order intake external_order_id=${normalized.externalOrderId} ` +
                `created=${intakeResult.created} reason=${intakeResult.reason || "n/a"} ` +
                `unmapped_items=${intakeResult.unmappedCount}`
            );
          } catch (intakeError) {
            console.error("Deliveroo order intake failed:", intakeError);
          }
        } else {
          console.error("Deliveroo ORDER NEW webhook could not be normalised - no order created");
        }
      } else if (event && event.externalOrderId) {
        try {
          const attached = await attachDeliverooEvent({
            companyId,
            event,
            loggedPayload,
            signatureState,
          });

          attachedOrderId = attached.orderId;
        } catch (attachError) {
          console.error("Deliveroo webhook event attach failed:", attachError);
        }
      }

      return await acknowledgeDeliverooWebhook(res, {
        companyId,
        environment: configuration.environment || null,
        action,
        payload: loggedPayload,
        signatureHeader,
        sequenceGuidHeader,
        hmacHeader,
        signatureState,
        verifiedVia,
        attachedOrderId,
      });
    } catch (error) {
      console.error("Deliveroo webhook error:", error);

      try {
        await logPlatformApiCall(db, {
          companyId: integrations && integrations.rows.length ? integrations.rows[0].company_id : null,
          platform: "deliveroo",
          action: "WEBHOOK_ERROR",
          endpoint: "/api/online/deliveroo/webhook",
          httpMethod: "POST",
          requestPayload: loggedPayload,
          responseStatus: 500,
          responseBody: { error: "webhook_processing_failed" },
          success: false,
          errorMessage: error.message,
        });
      } catch {
        /* logging must never mask the response */
      }

      return res.status(500).json({ error: "webhook_processing_failed" });
    }
  });

  /*
   * ------------------------------------------------------------------
   * Generic online orders (external client app)
   * ------------------------------------------------------------------
   */

  router.post("/online/orders/generic", authenticate, authorize("online_orders.manage"), async (req, res) => {
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const {
      externalOrderId,
      storeId,
      customer = {},
      fulfilmentType,
      items,
      notes,
      payment,
    } = req.body;

    try {
      const result = await createGenericOrder({
        db,
        pool,
        companyId: req.user.companyId,
        userId: req.user.id,
        storeId: storeId || req.user.storeId,
        externalOrderId,
        fulfilmentType,
        items,
        customer,
        notes,
        payment,
        createInventoryMovement,
        publishEvent: onlineOrderEventPublisher(req.user.companyId),
      });

      if (result.duplicate) {
        return res.json({
          success: true,
          message: "This online order has already been received",
          data: { orderId: result.orderId, duplicate: true, status: result.status },
        });
      }

      if (writeAudit) {
        await writeAudit(
          req.user.companyId,
          req.user.id,
          "online_order.created",
          "online_order",
          result.order.id,
          { externalOrderId, fulfilmentType, itemCount: result.items.length }
        );
      }

      res.status(201).json({
        success: true,
        message: "Online order received",
        data: { order: result.order, items: result.items },
      });
    } catch (error) {
      console.error("Create generic online order error:", error);

      const insufficientStock = /Insufficient stock/i.test(error.message || "");

      res.status(insufficientStock ? 409 : 500).json({
        success: false,
        message: error.message || "Unable to create online order",
        error: error.message,
      });
    }
  });

  router.get("/online/orders/generic/:id", authenticate, authorize("online_orders.view"), async (req, res) => {
    try {
      const order = await getGenericOrder(db, req.user.companyId, req.params.id);

      if (!order) {
        return res.status(404).json({ success: false, message: "Online order not found" });
      }

      const items = await db(
        `
        SELECT i.*, p.track_stock
        FROM online_order_items i
        LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1
        ORDER BY i.created_at, i.id
        `,
        [req.params.id]
      );

      const events = await db(
        "SELECT * FROM online_order_events WHERE order_id = $1 ORDER BY created_at, id",
        [req.params.id]
      );

      res.json({
        success: true,
        data: { order, items: items.rows.map((i) => ({ ...i, track_stock: undefined })), events: events.rows },
      });
    } catch (error) {
      console.error("Get generic online order error:", error);
      res.status(500).json({ success: false, message: "Unable to load online order" });
    }
  });

  router.post("/online/orders/generic/:id/accept", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const { reason } = req.body || {};
    const result = await transitionGenericOrder({
      pool,
      companyId: req.user.companyId,
      orderId: req.params.id,
      userId: req.user.id,
      toStatus: "PREPARING",
      reason,
      createSale: (client, context) => createSaleForCompletedOrder(client, context),
      createInventoryMovement,
      publishEvent: onlineOrderEventPublisher(req.user.companyId),
    });

    if (!result.success) {
      return res.status(result.error === "Order not found" ? 404 : 409).json({
        success: false,
        message: result.error,
      });
    }

    res.json({ success: true, message: "Order accepted - preparation started" });
  });

  router.post("/online/orders/generic/:id/ready", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const { reason } = req.body || {};

    const orderResult = await db(
      "SELECT fulfilment_type, status FROM online_orders WHERE id = $1 AND company_id = $2",
      [req.params.id, req.user.companyId]
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({ success: false, message: "Online order not found" });
    }

    const order = orderResult.rows[0];
    const toStatus =
      order.fulfilment_type === "SELF_PICKUP"
        ? "READY_FOR_PICKUP"
        : order.fulfilment_type === "DELIVERY"
          ? "READY_FOR_DELIVERY"
          : "READY";

    const result = await transitionGenericOrder({
      pool,
      companyId: req.user.companyId,
      orderId: req.params.id,
      userId: req.user.id,
      toStatus,
      reason,
      publishEvent: onlineOrderEventPublisher(req.user.companyId),
    });

    if (!result.success) {
      return res.status(result.error === "Order not found" ? 404 : 409).json({
        success: false,
        message: result.error,
      });
    }

    res.json({ success: true, message: `Order marked ready (${toStatus})` });
  });

  router.post("/online/orders/generic/:id/complete", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const { reason } = req.body || {};

    const orderResult = await db(
      "SELECT fulfilment_type, status FROM online_orders WHERE id = $1 AND company_id = $2",
      [req.params.id, req.user.companyId]
    );

    if (!orderResult.rows.length) {
      return res.status(404).json({ success: false, message: "Online order not found" });
    }

    const order = orderResult.rows[0];
    let toStatus;

    if (order.status === "READY_FOR_PICKUP") {
      toStatus = "COLLECTED";
    } else if (order.status === "COMPLETED" || order.status === "CANCELLED" || order.status === "REJECTED") {
      return res.status(409).json({
        success: false,
        message: `Order in status ${order.status} cannot be completed`,
      });
    } else {
      toStatus = "COMPLETED";
    }

    const result = await transitionGenericOrder({
      pool,
      companyId: req.user.companyId,
      orderId: req.params.id,
      userId: req.user.id,
      toStatus,
      reason,
      createSale: (client, context) => createSaleForCompletedOrder(client, context),
      publishEvent: onlineOrderEventPublisher(req.user.companyId),
    });

    if (!result.success) {
      return res.status(result.error === "Order not found" ? 404 : 409).json({
        success: false,
        message: result.error,
      });
    }

    const updatedOrder = await getGenericOrder(db, req.user.companyId, req.params.id);

    res.json({
      success: true,
      message: "Order completed",
      data: { order: updatedOrder, ...(result.sale ? { sale: result.sale } : {}) },
    });
  });

  router.post("/online/orders/generic/:id/cancel", authenticate, authorize("online_orders.manage"), async (req, res) => {
    const { reason } = req.body || {};

    const result = await transitionGenericOrder({
      pool,
      companyId: req.user.companyId,
      orderId: req.params.id,
      userId: req.user.id,
      toStatus: "CANCELLED",
      reason: reason || "Cancelled",
      createInventoryMovement,
      publishEvent: onlineOrderEventPublisher(req.user.companyId),
    });

    if (!result.success) {
      return res.status(result.error === "Order not found" ? 404 : 409).json({
        success: false,
        message: result.error,
      });
    }

    const updatedOrder = await getGenericOrder(db, req.user.companyId, req.params.id);

    res.json({
      success: true,
      message: "Order cancelled",
      data: { order: updatedOrder },
    });
  });

  return router;
}
