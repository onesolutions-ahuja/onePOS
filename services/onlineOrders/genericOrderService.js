import {
  GENERIC_ORDER_STATUSES,
  FULFILMENT_TYPES,
  canTransition,
  resolveNextStatus,
} from "./genericOrderTypes.js";
import { syncBatchMovement } from "../inventory.js";

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export async function createGenericOrder({
  db,
  pool,
  companyId,
  userId,
  storeId,
  externalOrderId,
  fulfilmentType,
  items,
  customer: { id: customerId, name, phone, email, address } = {},
  notes,
  payment,
  createInventoryMovement,
  publishEvent,
}) {
  if (!externalOrderId) {
    throw new Error("externalOrderId is required");
  }

  if (!FULFILMENT_TYPES[fulfilmentType]) {
    throw new Error(`Invalid fulfilment type: ${fulfilmentType}`);
  }

  if (!Array.isArray(items) || !items.length) {
    throw new Error("At least one order item is required");
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    if (storeId) {
      const storeCheck = await client.query(
        "SELECT id FROM stores WHERE id = $1 AND company_id = $2 AND active = true",
        [storeId, companyId]
      );
      if (!storeCheck.rows.length) {
        throw new Error("Store not found or not owned by this company");
      }
    }

    if (customerId) {
      const customerCheck = await client.query(
        "SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND active = true",
        [customerId, companyId]
      );
      if (!customerCheck.rows.length) {
        throw new Error("Customer not found or not owned by this company");
      }
    }

    const resolvedItems = [];

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for product ${item.productId}`);
      }

      const productResult = await client.query(
        `
        SELECT
          id, name, sku, barcode, price, cost_price, vat_rate, vat_applicable,
          track_stock, batch_tracking, stock_quantity, low_stock_level, active
        FROM products
        WHERE id = $1
          AND company_id = $2
          AND active = true
        FOR UPDATE
        `,
        [item.productId, companyId]
      );

      if (!productResult.rows.length) {
        throw new Error(`Product not found: ${item.productId}`);
      }

      const product = productResult.rows[0];
      const serverPrice = Number(product.price);
      const serverVatRate = Number(product.vat_rate) || 20;

      const lineTotal = round2(serverPrice * quantity);
      const lineTax = round2((lineTotal * serverVatRate) / 100);

      resolvedItems.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku || null,
        barcode: product.barcode || null,
        quantity,
        unitPrice: serverPrice,
        vatRate: serverVatRate,
        tax: lineTax,
        total: lineTotal,
        batchTracking: product.batch_tracking === true,
        trackStock: product.track_stock,
      });
    }

    const subtotal = round2(resolvedItems.reduce((sum, item) => sum + item.total, 0));
    const tax = round2(resolvedItems.reduce((sum, item) => sum + item.tax, 0));

    const idempotencyCheck = await client.query(
      "SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'direct' AND external_order_id = $2",
      [companyId, externalOrderId]
    );

    if (idempotencyCheck.rows.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return { duplicate: true, orderId: idempotencyCheck.rows[0].id, status: idempotencyCheck.rows[0].status };
    }

    const customerData = customerId
      ? JSON.stringify({ id: customerId, name, phone, email, address })
      : JSON.stringify({ name, phone, email, address });

    const paymentMethod = (payment && payment.method) || null;
    const paymentStatus = (payment && payment.status) || "pending";

    const orderResult = await client.query(
      `
      INSERT INTO online_orders (
        company_id, store_id, customer_id, platform, external_order_id, external_reference,
        status, fulfilment_type, customer_name, customer_phone, customer_email,
        delivery_address, customer_data, currency, subtotal, tax, total, notes,
        payment_method, payment_status, inventory_reserved
      )
      VALUES ($1,$2,$3,'direct',$4,$5,'RECEIVED',$6,$7,$8,$9,$10,$11,'GBP',$12,$13,$14,$15,$16,$17,FALSE)
      RETURNING *
      `,
      [
        companyId,
        storeId || null,
        customerId || null,
        externalOrderId,
        `${externalOrderId}-ref`,
        fulfilmentType,
        name || null,
        phone || null,
        email || null,
        address || null,
        customerData,
        subtotal.toFixed(2),
        tax.toFixed(2),
        round2(subtotal + tax).toFixed(2),
        notes || null,
        paymentMethod,
        paymentStatus,
      ]
    );

    const order = orderResult.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `
        INSERT INTO online_order_items (
          order_id, product_id, product_name, quantity, unit_price, vat_rate, tax, total, mapping_status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MAPPED')
        `,
        [
          order.id,
          item.productId,
          item.productName,
          item.quantity,
          item.unitPrice.toFixed(2),
          item.vatRate,
          item.tax.toFixed(2),
          item.total.toFixed(2),
        ]
      );
    }

    if (storeId) {
      if (typeof createInventoryMovement === "function") {
        /*
         * Canonical path: reuse the shared stock primitive so the reservation
         * is visible to the POS stock check (products.stock_quantity) and is
         * symmetric with the release that cancels perform. createInventoryMovement
         * enforces the non-negative-balance rule and throws
         * "Insufficient stock for <name>" when there is not enough stock.
         */
        for (const item of resolvedItems) {
          if (!item.trackStock) continue;

          await createInventoryMovement(client, {
            companyId,
            productId: item.productId,
            storeId,
            movementType: "ONLINE_RESERVE",
            quantityChange: -item.quantity,
            referenceType: "ONLINE_ORDER",
            referenceId: order.id,
            reason: `Reserved for online order ${externalOrderId}`,
            createdBy: userId,
          });
          await syncBatchMovement(client, {
            companyId,
            storeId,
            productId: item.productId,
            quantityChange: -item.quantity,
            batchTracked: item.batchTracking,
          });
        }
      } else {
        /*
         * Legacy inline reservation (kept for callers that do not inject the
         * shared movement service). Updates the store-scoped position only.
         */
        for (const item of resolvedItems) {
          if (!item.trackStock) continue;

          const stockResult = await client.query(
            `
            SELECT quantity FROM product_store_stock
            WHERE company_id = $1 AND store_id = $2 AND product_id = $3
            `,
            [companyId, storeId, item.productId]
          );

          if (stockResult.rows.length) {
            const available = Number(stockResult.rows[0].quantity);
            if (available < item.quantity) {
              throw new Error(`Insufficient stock for ${item.productName}`);
            }

            await client.query(
              `
              UPDATE product_store_stock
              SET quantity = quantity - $1, updated_at = NOW()
              WHERE company_id = $2 AND store_id = $3 AND product_id = $4
              `,
              [item.quantity, companyId, storeId, item.productId]
            );
          } else {
            await client.query(
              `
              INSERT INTO product_store_stock (company_id, store_id, product_id, quantity, updated_at)
              VALUES ($1,$2,$3,-$4,NOW())
              `,
              [companyId, storeId, item.productId, item.quantity]
            );
          }

          await client.query(
            `
            INSERT INTO inventory_movements (
              company_id, product_id, store_id, movement_type, quantity_change,
              balance_after, reference_type, reference_id, reason, created_by
            )
            SELECT
              $1, $2, $3, 'ONLINE_RESERVE', -$4,
              p.stock_quantity - $4, 'ONLINE_ORDER', $5,
              $6, $7
            FROM products p
            WHERE p.id = $2 AND p.company_id = $1
            `,
            [
              companyId,
              item.productId,
              storeId,
              item.quantity,
              order.id,
              `Reserved for online order ${externalOrderId}`,
              userId,
            ]
          );
        }
      }

      await client.query(
        "UPDATE online_orders SET inventory_reserved = TRUE WHERE id = $1",
        [order.id]
      );
    }

    await client.query(
      `
      INSERT INTO online_order_events (
        order_id, event_type, to_status, message
      )
      VALUES ($1, 'ORDER_RECEIVED', 'RECEIVED', $2)
      `,
      [order.id, `Online order received; external_order_id=${externalOrderId}`]
    );

    if (typeof publishEvent === "function") {
      await publishEvent({
        client,
        eventType: "online_order.created",
        payload: { orderId: order.id, platform: order.platform, storeId: order.store_id, status: order.status },
        actorUserId: userId,
      });
    }

    await client.query("COMMIT");

    return { duplicate: false, order: orderResult.rows[0], items: resolvedItems };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getGenericOrder(db, companyId, orderId) {
  const result = await db(
    `
    SELECT o.*,
      (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id) AS item_count,
      (SELECT COUNT(*) FROM online_order_events e WHERE e.order_id = o.id) AS event_count
    FROM online_orders o
    WHERE o.id = $1
      AND o.company_id = $2
      AND o.platform = 'direct'
    `,
    [orderId, companyId]
  );

  return result.rows[0] || null;
}

export async function listGenericOrders(db, companyId, { status, limit = 100 } = {}) {
  const params = [companyId];
  let conditions = ["o.company_id = $1", "o.platform = 'direct'"];

  if (status) {
    params.push(status);
    conditions.push(`o.status = $${params.length}`);
  }

  const result = await db(
    `
    SELECT o.*,
      (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id) AS item_count
    FROM online_orders o
    WHERE ${conditions.join(" AND ")}
    ORDER BY o.created_at DESC
    LIMIT $${params.length + 1}
    `,
    params.concat(Math.min(Number(limit) || 100, 500))
  );

  return result.rows;
}

export async function transitionGenericOrder({
  pool,
  companyId,
  orderId,
  userId,
  toStatus,
  reason = null,
  createSale = null,
  createInventoryMovement = null,
  publishEvent = null,
}) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const orderResult = await client.query(
      "SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE",
      [orderId, companyId]
    );

    if (!orderResult.rows.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return { success: false, error: "Order not found" };
    }

    const order = orderResult.rows[0];

    if (
      order.status === GENERIC_ORDER_STATUSES.CANCELLED ||
      order.status === GENERIC_ORDER_STATUSES.REJECTED ||
      order.status === GENERIC_ORDER_STATUSES.COMPLETED
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return { success: false, error: `Order in status ${order.status} cannot be transitioned` };
    }

    if (!canTransition(order.fulfilment_type, order.status, toStatus)) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return {
        success: false,
        error: `Invalid transition: ${order.status} -> ${toStatus}`,
      };
    }

    const fromStatus = order.status;

    const timestampColumns = {
      [GENERIC_ORDER_STATUSES.PREPARING]: "preparing_at",
      [GENERIC_ORDER_STATUSES.READY_FOR_PICKUP]: "ready_at",
      [GENERIC_ORDER_STATUSES.READY_FOR_DELIVERY]: "ready_at",
      [GENERIC_ORDER_STATUSES.READY]: "ready_at",
      [GENERIC_ORDER_STATUSES.COLLECTED]: "completed_at",
      [GENERIC_ORDER_STATUSES.COMPLETED]: "completed_at",
      [GENERIC_ORDER_STATUSES.CANCELLED]: "cancelled_at",
      [GENERIC_ORDER_STATUSES.REJECTED]: "cancelled_at",
    };

    const params = [toStatus, order.id];
    let updateQuery = "UPDATE online_orders SET status = $1, updated_at = NOW()";

    const tsCol = timestampColumns[toStatus];
    if (tsCol) {
      updateQuery += `, ${tsCol} = NOW()`;
    }

    if (reason) {
      params.push(reason);
      updateQuery += `, cancel_reason = $${params.length}`;
    }

    params.push(companyId);
    updateQuery += ` WHERE id = $2 AND company_id = $${params.length}`;

    await client.query(updateQuery, params);

    await client.query(
      `
      INSERT INTO online_order_events (order_id, event_type, from_status, to_status, message, actor_user_id)
      VALUES ($1, 'STATUS_CHANGED', $2, $3, $4, $5)
      `,
      [
        order.id,
        fromStatus,
        toStatus,
        `Order status changed ${fromStatus} -> ${toStatus}${reason ? ` (${reason})` : ""}`,
        userId,
      ]
    );

    const isCancelled =
      toStatus === GENERIC_ORDER_STATUSES.CANCELLED ||
      toStatus === GENERIC_ORDER_STATUSES.REJECTED;
    const isFulfilled =
      toStatus === GENERIC_ORDER_STATUSES.COLLECTED ||
      toStatus === GENERIC_ORDER_STATUSES.COMPLETED;

    let saleInfo = null;
    let inventoryReleased = false;

    if (
      isCancelled &&
      typeof createInventoryMovement === "function" &&
      order.inventory_reserved &&
      !order.inventory_released
    ) {
      const items = await loadOrderItems(client, order.id);
      const storeId = order.store_id || null;

      for (const item of items) {
        if (!item.track_stock) continue;

        await createInventoryMovement(client, {
          companyId,
          productId: item.product_id,
          storeId,
          movementType: "ONLINE_RELEASE",
          quantityChange: Number(item.quantity),
          referenceType: "ONLINE_ORDER",
          referenceId: order.id,
          reason: `Released reservation for online order ${order.external_order_id}`,
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

      await client.query(
        "UPDATE online_orders SET inventory_reserved = FALSE, inventory_released = TRUE WHERE id = $1",
        [order.id]
      );

      inventoryReleased = true;
    }

    if (isFulfilled && typeof createSale === "function") {
      const items = await loadOrderItems(client, order.id);

      try {
        saleInfo = await createSale(client, {
          order,
          items,
          user: { id: userId, storeId: order.store_id || null },
        });

        await client.query(
          `
          INSERT INTO online_order_events (order_id, event_type, from_status, to_status, message, actor_user_id)
          VALUES ($1, 'ONLINE_SALE_CREATED', $2, $3, $4, $5)
          `,
          [
            order.id,
            fromStatus,
            toStatus,
            saleInfo.alreadyExisted
              ? `POS sale ${saleInfo.sale.receipt_number || saleInfo.sale.id} already existed for the order`
              : `POS sale ${saleInfo.sale.receipt_number || saleInfo.sale.id} created for the completed order`,
            userId,
          ]
        );
      } catch (saleError) {
        throw new Error(
          `Order was NOT fulfilled: the POS sale could not be created (${saleError.message})`
        );
      }
    }

    if (typeof publishEvent === "function") {
      const eventType = toStatus === GENERIC_ORDER_STATUSES.CANCELLED
        ? "online_order.cancelled"
        : toStatus === GENERIC_ORDER_STATUSES.COMPLETED
          ? "online_order.completed"
          : fromStatus === GENERIC_ORDER_STATUSES.RECEIVED && toStatus === GENERIC_ORDER_STATUSES.PREPARING
            ? "online_order.accepted"
            : "online_order.status_changed";
      await publishEvent({
        client,
        eventType,
        payload: {
          orderId: order.id,
          platform: order.platform,
          storeId: order.store_id,
          fromStatus,
          toStatus,
        },
        actorUserId: userId,
      });
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return {
      success: true,
      inventoryReleased,
      sale: saleInfo ? saleInfo.sale : null,
    };
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

async function loadOrderItems(client, orderId) {
  const result = await client.query(
    `
    SELECT
      i.id,
      i.product_id,
      i.product_name,
      i.quantity,
      i.unit_price,
      i.tax,
      i.total,
      i.mapping_status,
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
