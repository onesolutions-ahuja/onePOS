import express from "express";

import { getPlatformService, isOnlinePlatform } from "../services/onlineOrders/index.js";
import { loadPlatformConfig } from "../services/onlineOrders/platformConfig.js";
import { logPlatformApiCall } from "../services/onlineOrders/platformLogger.js";

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
        p.track_stock
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
  async function logSimulatedPlatformCall({
    companyId,
    platform,
    environment,
    action,
    response,
    requestPayload,
    orderId = null,
    productId = null,
  }) {
    if (!response || response.simulated !== true) {
      return;
    }

    await logPlatformApiCall(db, {
      companyId,
      platform,
      environment: environment || null,
      action,
      endpoint: `stub://${platform}/${action}`,
      httpMethod: "STUB",
      requestPayload,
      responseBody: response,
      success: response.success === true,
      errorMessage: response.success === true ? null : response.message || null,
      orderId,
      productId,
    });
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
          (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id) AS item_count
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
   * Extracts the store/brand identifiers needed for menu and order testing
   * from an official Uber "Get Stores" response:
   *   { stores: [ { id, name, brand: { id, description }, location, status } ] }
   * Tolerates minor shape variations; never invents IDs.
   */
  function extractUberStoreIds(data) {
    const stores = Array.isArray(data && data.stores) ? data.stores : Array.isArray(data) ? data : [];

    return stores.map((store) => ({
      storeId: store.id || store.store_id || null,
      name: store.name || null,
      brandId: (store.brand && store.brand.id) || store.brand_id || null,
      brandName:
        (store.brand && (store.brand.description || store.brand.name)) || store.brand_name || null,
      status: store.status
        ? typeof store.status === "string"
          ? store.status
          : store.status.type || null
        : null,
      integrationEnabled:
        store.integration_enabled === undefined || store.integration_enabled === null
          ? null
          : store.integration_enabled === true,
    }));
  }

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
      const runtime = await loadPlatformConfig(db, req.user.companyId, "uber");

      if (runtime.enabled !== true) {
        return res.json({
          success: false,
          code: "PLATFORM_DISABLED",
          message: "Uber Eats integration is disabled in Settings - Online Platforms",
          data: { attempts: [], stores: [] },
        });
      }

      const service = getPlatformService("uber");
      const environments = [runtime.environment || "sandbox"];

      if (environments[0] !== "production") {
        environments.push("production"); // diagnostic second host
      }

      const attempts = [];

      for (const environment of environments) {
        const response = await service.getStores({ ...runtime, environment });

        attempts.push({
          environment,
          success: response.success === true,
          httpStatus: response.httpStatus ?? null,
          code: response.code || null,
          message: response.message || null,
          stores: response.success ? extractUberStoreIds(response.data) : [],
          uberResponse: response.data ?? null,
        });

        if (response.success) {
          break; // first successful host wins
        }
      }

      const successAttempt = attempts.find((attempt) => attempt.success);
      const lastAttempt = attempts[attempts.length - 1];

      /*
       * HTTP 200 with an empty stores list is NOT an authentication failure -
       * it means connectivity is fine but Uber has not provisioned a Sandbox
       * store for this application yet (per the official sandbox guide, test
       * stores are provisioned by Uber's Integration Tech Support).
       */
      const successMessage = successAttempt
        ? successAttempt.stores.length
          ? `Uber connection OK (${successAttempt.environment}) - ${successAttempt.stores.length} store(s) found`
          : successAttempt.environment === "sandbox"
            ? "No Sandbox stores are currently provisioned for this application."
            : "No stores are currently provisioned for this application."
        : null;

      return res.json({
        success: Boolean(successAttempt),
        message: successMessage || lastAttempt.message || "Uber API rejected the request - see the raw response",
        code: successAttempt ? null : lastAttempt.code || null,
        data: {
          attempts,
          stores: successAttempt ? successAttempt.stores : [],
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
            id, name, price, vat_rate, track_stock, stock_quantity,
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

      if (writeAudit) {
        await writeAudit(req.user.companyId, req.user.id, "online_order_received", "online_order", order.id, {
          platform,
          externalOrderId: externalId,
          total: order.total,
        });
      }

      await client.query("COMMIT");

      res.status(201).json({
        success: true,
        message: "Online order received and inventory reserved",
        data: { order, items: resolvedItems },
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
    } = options;

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      await client.query("BEGIN");
      transactionStarted = true;

      // Row lock for the whole action: two concurrent requests (e.g. a
      // double-clicked Cancel) serialize here, so stock is released once.
      const locked = await client.query(
        "SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE",
        [req.params.id, req.user.companyId]
      );

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

      // Belt-and-braces: reserved stock can only ever be released once.
      if (releaseInventory && order.inventory_released === true) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          code: "INVENTORY_ALREADY_RELEASED",
          message: "Reserved stock for this order has already been released",
        });
      }

      const runtime = await loadPlatformConfig(db, req.user.companyId, order.platform);
      const service = getPlatformService(order.platform);

      // Platform call first: the platform confirms or rejects the action.
      // The stub simulates this today; the real API slots in unchanged.
      const platformResponse = await callPlatform(service, order, runtime);

      // Action-level audit entry for simulated (stub) platform responses.
      await logSimulatedPlatformCall({
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

        const failureCode = (platformResponse && platformResponse.code) || "PLATFORM_CALL_FAILED";

        await recordEvent(db, {
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

      const items = await loadOrderItems(order.id);

      if (releaseInventory) {
        await releaseOrderInventory(client, {
          companyId: req.user.companyId,
          storeId: order.store_id || req.user.storeId || null,
          order,
          items,
          userId: req.user.id,
        });
      }

      let query = "UPDATE online_orders SET status = $2, updated_at = NOW()";
      const params = [order.id, toStatus];

      if (releaseInventory) {
        // Reservation becomes a permanent release of the hold.
        query += ", inventory_reserved = FALSE, inventory_released = TRUE";
      }

      if (timestampColumn === "completed_at") {
        // Only reached because the platform confirmed the handover OTP.
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
        // SQL-level guarantee against a double release.
        query += " AND inventory_released = FALSE";
      }

      const updateResult = await client.query(query, params);

      if (!updateResult.rowCount) {
        throw new Error("Order state changed concurrently - no rows updated");
      }

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

      await client.query("COMMIT");

      const updatedOrder = await loadOrder(order.id, req.user.companyId);

      return res.json({
        success: true,
        message: `Order ${toStatus.toLowerCase()}`,
        data: { order: updatedOrder, platformResponse },
      });
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error(`Online order ${toStatus} error:`, error);
      return res.status(500).json({ success: false, message: error.message || "Unable to update online order" });
    } finally {
      client.release();
    }
  }

  router.post("/online/orders/:id/accept", authenticate, authorize("online_orders.manage"), async (req, res) => {
    await performOrderAction(req, res, {
      fromStatuses: ["RECEIVED"],
      toStatus: "ACCEPTED",
      platformAction: "acceptOrder",
      timestampColumn: "accepted_at",
      callPlatform: (service, order, runtime) => service.acceptOrder(order, runtime),
      buildMessage: (order) => `Order accepted (platform call ${order.platform})`,
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
      callPlatform: (service, order, runtime) => service.rejectOrder(order, reason, runtime),
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
      fromStatuses: ["PREPARING"],
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
    });
  });

  return router;
}








