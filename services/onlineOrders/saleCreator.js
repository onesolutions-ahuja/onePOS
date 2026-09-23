/*
 * ONLINE ORDER -> POS SALE
 *
 * When an Uber Eats / Deliveroo online order is successfully COMPLETED, the
 * completed order must become a onePOS sale so it appears on the Sales page
 * and in reports, without double-counting inventory: the stock for the order
 * was already deducted at intake (ONLINE_RESERVE / permanent consumption),
 * so this module NEVER calls createInventoryMovement.
 *
 * The caller MUST pass the transaction client of the completion flow, so the
 * sale and the order's COMPLETED status commit (or roll back) together:
 *   - sale creation failure rolls back the completion - onePOS never reports
 *     an order as completed without its sale,
 *   - the sales.online_order_id unique index plus an in-transaction existence
 *     check make duplicate sales impossible if completion is retried.
 *
 * Conventions follow the POS sale identity (see src/pages/pos/POS.jsx):
 *   total = subtotal (incl. discounts) + VAT, with item.total being
 *   unit_price x quantity EXCLUDING tax - exactly how online_order_items
 *   store their numbers at intake. Delivery fee is NOT part of a POS sale.
 */
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/*
 * Payment method recorded against the resulting POS sale. Platform orders
 * (Uber Eats / Deliveroo) always reconcile to the platform's own tender name so
 * the sale is auditable against the platform payout; generic/direct orders use
 * the payment method captured on the order at intake (defaulting to Cash when
 * the customer has not selected a method yet), which preserves the existing
 * accounting behaviour for store-handled tenders.
 */
const PAYMENT_METHODS = {
  uber: "Uber Eats",
  deliveroo: "Deliveroo",
};

export async function createSaleForCompletedOrder(client, { order, items, user }) {
  if (!client) throw new Error("createSaleForCompletedOrder requires the transaction client");
  if (!order || !order.id) throw new Error("createSaleForCompletedOrder requires the completed online order");
  if (!user || !user.id) throw new Error("createSaleForCompletedOrder requires the completing user");

  const paymentMethod = order.payment_method || PAYMENT_METHODS[order.platform] || "Cash";

  const allItems = Array.isArray(items) ? items : [];
  const mappedItems = allItems.filter(
    (item) => item.mapping_status === "MAPPED" && item.product_id
  );
  const unmappedExcluded = allItems.length - mappedItems.length;

  /*
   * Duplicate protection 1/2: inside the same transaction as the completion.
   * The order row is locked FOR UPDATE by the completion flow, so a concurrent
   * completion cannot be here at the same time; this catches any retry that
   * reaches sale creation again. The sales.online_order_id unique index is
   * the second, database-level guard.
   */
  const existing = await client.query(
    "SELECT * FROM sales WHERE online_order_id = $1",
    [order.id]
  );
  if (existing.rows.length) {
    return {
      sale: existing.rows[0],
      unmappedExcluded,
      alreadyExisted: true,
    };
  }

  const storeId = order.store_id || (user && user.storeId) || null;
  if (!storeId) {
    throw new Error("Online order has no store - cannot create a POS sale");
  }

  /*
   * Totals over the MAPPED items only. The stored online_order_items figures
   * are preserved as-is: online_order_items.total is unit_price x quantity
   * (this is what the platform charged for the food), so
   *   subtotal = sum(item.total), tax = sum(item.tax)  (informational, kept
   *   for VAT reporting exactly like online_orders.tax),
   *   total = subtotal
   * i.e. the sale total is the mapped items subtotal and never includes the
   * delivery fee. payment.amount equals this total, so the sale reconciles
   * with what the platform collected for the food.
   */
  const subtotal = round2(
    mappedItems.reduce((sum, item) => sum + round2(Number(item.total)), 0)
  );
  const tax = round2(mappedItems.reduce((sum, item) => sum + (Number(item.tax) || 0), 0));
  const discount = 0;
  const total = subtotal;

  /*
   * Receipt number carries the platform's own order reference so staff can
   * match a Sales row to the Uber Eats / Deliveroo order. The prefix is the
   * company's configurable delivery invoice prefix (Settings, default DEL);
   * when unavailable, the legacy platform-name prefix applies unchanged.
   */
  let receiptPrefix = paymentMethod.toUpperCase().replace(/\s+/g, "-");
  try {
    const prefixSettings = await client.query(
      "SELECT delivery_invoice_prefix FROM company_settings WHERE company_id = $1",
      [order.company_id]
    );
    if (prefixSettings.rows.length && prefixSettings.rows[0].delivery_invoice_prefix) {
      receiptPrefix = String(prefixSettings.rows[0].delivery_invoice_prefix).trim();
    }
  } catch {
    /* Settings row missing/unreadable → legacy platform-name prefix. */
  }
  const receiptNumber = `${receiptPrefix}-${order.external_order_id}`.slice(0, 100);

  const saleResult = await client.query(
    `
    INSERT INTO sales (
      company_id, store_id, terminal_id, user_id, customer_id,
      receipt_number, subtotal, tax, discount, total,
      status, offline_created, sync_status, created_at, completed_at,
      online_order_id
    )
    VALUES (
      $1, $2, NULL, $3, NULL,
      $4, $5, $6, $7, $8,
      'completed', FALSE, 'synced', NOW(), NOW(),
      $9
    )
    RETURNING *
    `,
    [
      order.company_id,
      storeId,
      user.id,
      receiptNumber,
      subtotal,
      tax,
      discount,
      total,
      order.id,
    ]
  );
  const sale = saleResult.rows[0];

  for (const item of mappedItems) {
    await client.query(
      `
      INSERT INTO sale_items (
        sale_id, product_id, product_name, quantity, unit_price, discount, tax, total
      )
      VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
      `,
      [
        sale.id,
        item.product_id,
        item.product_name,
        Number(item.quantity),
        Number(item.unit_price),
        Number(item.tax) || 0,
        Number(item.total) || 0,
      ]
    );
  }

  await client.query(
    `
    INSERT INTO payments (sale_id, payment_method, amount, status)
    VALUES ($1, $2, $3, 'completed')
    `,
    [sale.id, paymentMethod, total]
  );

  return { sale, unmappedExcluded, alreadyExisted: false };
}
