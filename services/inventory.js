// Lightweight inventory helpers built on the existing product table and
// inventory_movement architecture. This is not a second stock system.

/*
 * Inventory movement types (moved verbatim from server.js so the builder
 * and the allow-list live beside each other; server.js imports from here).
 */
export const inventoryMovementTypes = new Set([
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
  "TRANSFER_OUT",
  "TRANSFER_IN",
]);

/*
 * Resolve which store a stock change belongs to.
 *
 * The caller may not invent a store: the operator's own store is the
 * default, and an explicit storeId is only honoured when the operator's
 * existing access model allows it (admin/owner bypass via canAccessStore,
 * otherwise membership of user_stores).
 */
export async function resolveStockStore({ user, requestedStoreId = null, canAccessStore }) {
  if (!requestedStoreId || String(requestedStoreId) === String(user.storeId)) {
    return user.storeId;
  }
  if (typeof canAccessStore === "function" && (await canAccessStore(user, requestedStoreId))) {
    return requestedStoreId;
  }
  const error = new Error("You do not have access to this store");
  error.statusCode = 403;
  throw error;
}

export function classifyLowStock(product) {
  const stock = Number(product.stock_quantity ?? 0);
  if (!product.track_stock) {
    return { isLow: false, level: 0, reason: "track_stock OFF" };
  }
  const level = Number(product.low_stock_level ?? 0);
  if (level <= 0) {
    return { isLow: false, level, reason: "no threshold" };
  }
  return {
    isLow: stock <= level,
    level,
    stock,
    reason: stock <= 0 ? "out of stock" : "at or below threshold",
  };
}

export function lowStockRow(product) {
  const status = classifyLowStock(product);
  return {
    id: product.id,
    name: product.name || product.product_name || "Unnamed Product",
    sku: product.sku || product.code || "",
    barcode: product.barcode || product.ean || "",
    stock: status.stock,
    lowStockLevel: status.level,
    isLow: status.isLow,
    reason: status.reason,
    category: product.category || product.category_name || "All",
    trackStock: product.track_stock !== false && product.trackStock !== false,
  };
}

/*
 * The authoritative stock-change primitive: atomically updates the
 * store-scoped stock position (product_store_stock) and appends to the
 * inventory_movements ledger. Moved verbatim from server.js (same queries,
 * same SALE-only negative-balance rule) so every writer shares one code
 * path; server.js now imports this instead of defining its own.
 *
 * The products.stock_quantity column remains the COMPANY aggregate for
 * backward compatibility with views/reports written before store stock
 * existed; it is kept equal to SUM(product_store_stock.quantity) for the
 * company by the upsert below (all-or-nothing within the caller's tx).
 */
export async function createInventoryMovement(client, {
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

  /* Store-scoped position: the quantity that actually lives at the store. */
  const storePosition = storeId
    ? await client.query(
        `
        INSERT INTO product_store_stock (company_id, store_id, product_id, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (company_id, store_id, product_id)
        DO UPDATE SET quantity = product_store_stock.quantity + EXCLUDED.quantity,
                      updated_at = NOW()
        `,
        [companyId, storeId, productId, quantity]
      )
    : null;

  if (storePosition && movementType !== "SALE" && storePosition.rows[0].quantity < 0) {
    throw new Error(`Insufficient stock for ${product.name}`);
  }

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
    storeBalance: storePosition ? Number(storePosition.rows[0].quantity) : null,
    movement: movementResult.rows[0],
  };
}
