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
  batchId = null,
  transactionId = null,
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
        RETURNING quantity
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

  const canonicalTransactionId = transactionId
    || (["SALE", "RETURN", "EXCHANGE", "CUSTOMER_RETURN"].includes(String(referenceType || "").toUpperCase()) ? referenceId : null);
  if (batchId || canonicalTransactionId) {
    try {
      await client.query(
        "UPDATE inventory_movements SET batch_id=COALESCE($1,batch_id), transaction_id=COALESCE($2,transaction_id) WHERE id=$3",
        [batchId || null, canonicalTransactionId || null, movementResult.rows[0].id]
      );
      movementResult.rows[0].batch_id = batchId || null;
      movementResult.rows[0].transaction_id = canonicalTransactionId || null;
    } catch (error) {
      if (error?.code !== "42703") throw error;
      console.warn("Inventory relationship columns are pending database migration");
    }
  }

  if (storeId) {
    await client.query(
      `
      INSERT INTO inventory_balance_rollups
        (company_id, store_id, product_id, ledger_quantity, movement_count,
         last_movement_at, discrepancy, updated_at)
      VALUES ($1,$2,$3,$4,1,NOW(),0,NOW())
      ON CONFLICT (company_id, store_id, product_id)
      DO UPDATE SET ledger_quantity = inventory_balance_rollups.ledger_quantity + EXCLUDED.ledger_quantity,
                    movement_count = inventory_balance_rollups.movement_count + 1,
                    last_movement_at = NOW(),
                    discrepancy = (inventory_balance_rollups.ledger_quantity + EXCLUDED.ledger_quantity)
                      - COALESCE((SELECT quantity FROM product_store_stock
                                  WHERE company_id=$1 AND store_id=$2 AND product_id=$3), 0),
                    updated_at = NOW()
      `,
      [companyId, storeId, productId, quantity]
    );
  }

  return {
    product,
    balance: newBalance,
    storeBalance: storePosition ? Number(storePosition.rows[0].quantity) : null,
    movement: movementResult.rows[0],
  };
}

/* Recalculate persisted rollups from the immutable movement ledger.  When
 * rebuild is requested, missing/stale rows are replaced and zero positions
 * are retained so reconciliation can expose drift. */
export async function rebuildInventoryBalances(client, { companyId, storeId = null, productId = null } = {}) {
  const args = [companyId];
  const where = ["m.company_id = $1", "m.store_id IS NOT NULL"];
  if (storeId) { args.push(storeId); where.push(`m.store_id = $${args.length}`); }
  if (productId) { args.push(productId); where.push(`m.product_id = $${args.length}`); }
  await client.query(
    `DELETE FROM inventory_balance_rollups r WHERE r.company_id=$1
      ${storeId ? `AND r.store_id=$2` : ""} ${productId ? `AND r.product_id=$${storeId ? 3 : 2}` : ""}`,
    args
  );
  const result = await client.query(
    `INSERT INTO inventory_balance_rollups
      (company_id,store_id,product_id,ledger_quantity,movement_count,last_movement_at,discrepancy)
     SELECT m.company_id,m.store_id,m.product_id,COALESCE(SUM(m.quantity_change),0),
            COUNT(*),MAX(m.created_at),
            COALESCE(SUM(m.quantity_change),0)-COALESCE(ps.quantity,0)
     FROM inventory_movements m
     LEFT JOIN product_store_stock ps ON ps.company_id=m.company_id
       AND ps.store_id=m.store_id AND ps.product_id=m.product_id
     WHERE ${where.join(" AND ")}
     GROUP BY m.company_id,m.store_id,m.product_id,ps.quantity
     ON CONFLICT (company_id,store_id,product_id) DO UPDATE SET
       ledger_quantity=EXCLUDED.ledger_quantity,movement_count=EXCLUDED.movement_count,
       last_movement_at=EXCLUDED.last_movement_at,discrepancy=EXCLUDED.discrepancy,updated_at=NOW()
     RETURNING *`,
    args
  );
  return result.rows;
}

export async function reconcileInventoryBalances(client, { companyId, storeId = null, productId = null } = {}) {
  const args = [companyId];
  const movementWhere = ["m.company_id=$1", "m.store_id IS NOT NULL"];
  const stockWhere = ["ps.company_id=$1"];
  if (storeId) {
    args.push(storeId);
    movementWhere.push(`m.store_id=$${args.length}`);
    stockWhere.push(`ps.store_id=$${args.length}`);
  }
  if (productId) {
    args.push(productId);
    movementWhere.push(`m.product_id=$${args.length}`);
    stockWhere.push(`ps.product_id=$${args.length}`);
  }
  const result = await client.query(
    `WITH ledger AS (
       SELECT m.company_id,m.store_id,m.product_id,COALESCE(SUM(m.quantity_change),0) AS ledger_quantity,
              COUNT(*) AS movement_count,MAX(m.created_at) AS last_movement_at
       FROM inventory_movements m WHERE ${movementWhere.join(" AND ")}
       GROUP BY m.company_id,m.store_id,m.product_id
     )
     SELECT COALESCE(l.company_id,ps.company_id) AS company_id,
            COALESCE(l.store_id,ps.store_id) AS store_id,
            COALESCE(l.product_id,ps.product_id) AS product_id,
            COALESCE(l.ledger_quantity,0) AS ledger_quantity,
            COALESCE(ps.quantity,0) AS persisted_quantity,
            COALESCE(l.ledger_quantity,0)-COALESCE(ps.quantity,0) AS discrepancy,
            COALESCE(l.movement_count,0) AS movement_count,l.last_movement_at
     FROM ledger l
     FULL OUTER JOIN product_store_stock ps ON ps.company_id=l.company_id
       AND ps.store_id=l.store_id AND ps.product_id=l.product_id
     WHERE ${stockWhere.join(" AND ")} OR l.company_id IS NOT NULL
     ORDER BY ABS(COALESCE(l.ledger_quantity,0)-COALESCE(ps.quantity,0)) DESC`,
    args
  );
  return result.rows;
}

/*
 * BATCH / EXPIRY TRACKING — store-level batch helpers.
 *
 * Batches live on inventory_batches (company + store + product + batch
 * number). Every quantity change goes THROUGH createInventoryMovement so
 * the products aggregate, product_store_stock and the movement ledger stay
 * authoritative; these helpers additionally keep the batch row consistent
 * inside the same transaction. Nothing here deletes expired stock.
 */

export const BATCH_LIMITS = {
  maxLines: 200,
  maxBatchNumberLength: 100,
};

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

/*
 * FEFO ordering: First Expired, First Out. NULL expiry (undated stock)
 * sorts after any dated batch. Pure function — exported for reuse and so
 * a future automatic FEFO allocator and the UI agree on one ordering.
 */
export function fefoCompare(a, b) {
  const aExp = a.expiry_date ? String(a.expiry_date).slice(0, 10) : null;
  const bExp = b.expiry_date ? String(b.expiry_date).slice(0, 10) : null;
  if (aExp === null && bExp === null) return 0;
  if (aExp === null) return 1;
  if (bExp === null) return -1;
  if (aExp < bExp) return -1;
  if (aExp > bExp) return 1;
  return 0;
}

/*
 * Expiry status per the business rules: expired / expiring / valid.
 * `expiringSoonDays` is the company-wide window (default 7). Pure function.
 */
export function expiryStatus(expiryDate, { now = new Date(), expiringSoonDays = 7 } = {}) {
  if (!expiryDate) return "none";
  const dateOnly = String(expiryDate).slice(0, 10);
  const expiry = new Date(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime())) return "none";
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const days = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= expiringSoonDays) return "expiring";
  return "valid";
}

/*
 * Upsert the batch row WITHOUT writing any movement — the bookkeeping half
 * of receiveInventoryBatch, for callers that record the authoritative
 * movement themselves (purchase receiving). Creates the batch when absent,
 * accumulates otherwise; batch number optional (undated stock).
 */
export async function upsertBatchRow(client, {
  companyId,
  storeId,
  productId,
  batchNumber = null,
  manufacturingDate = null,
  manufacturingDateSource = null,
  expiryDate = null,
  expiryDateSource = null,
  quantity,
}) {
  const qty = round3(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Batch quantity must be greater than zero");
  }
  if (batchNumber != null && String(batchNumber).trim().length > BATCH_LIMITS.maxBatchNumberLength) {
    throw new Error("Batch number too long");
  }
  const number = batchNumber != null && String(batchNumber).trim() !== ""
    ? String(batchNumber).trim()
    : null;

  if (number) {
    const upsert = await client.query(
      `
      INSERT INTO inventory_batches (company_id, store_id, product_id, batch_number, expiry_date, quantity)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (company_id, store_id, product_id, batch_number)
      DO UPDATE SET quantity = inventory_batches.quantity + $6,
                    expiry_date = COALESCE($5, inventory_batches.expiry_date),
                    updated_at = NOW()
      RETURNING id, batch_number, expiry_date, quantity
      `,
      [companyId, storeId, productId, number, expiryDate, qty]
    );
    if (manufacturingDate || manufacturingDateSource || expiryDateSource) {
      await client.query(
        `UPDATE inventory_batches SET manufacturing_date=$1, manufacturing_date_source=$2, expiry_date_source=$3 WHERE id=$4`,
        [manufacturingDate, manufacturingDateSource, expiryDateSource, upsert.rows[0].id]
      );
    }
    return upsert.rows[0];
  }
  /* Undated/numberless batch row (expiry may still be set). */
  const inserted = await client.query(
    `
    INSERT INTO inventory_batches (company_id, store_id, product_id, batch_number, expiry_date, quantity)
    VALUES ($1, $2, $3, NULL, $4, $5)
    RETURNING id, batch_number, manufacturing_date, expiry_date, manufacturing_date_source, expiry_date_source, quantity
    `,
    [companyId, storeId, productId, expiryDate, qty]
  );
  if (manufacturingDate || manufacturingDateSource || expiryDateSource) {
    await client.query(
      `UPDATE inventory_batches SET manufacturing_date=$1, manufacturing_date_source=$2, expiry_date_source=$3 WHERE id=$4`,
      [manufacturingDate, manufacturingDateSource, expiryDateSource, inserted.rows[0].id]
    );
  }
  return inserted.rows[0];
}

/*
 * Receive stock into a batch (batch API / OPENING semantics).
 * Creates the batch when absent (batch number optional for undated stock),
 * accumulates otherwise — a new delivery never overwrites the existing
 * batch. The caller must already be inside the surrounding transaction and
 * have validated company/store scope.
 */
export async function receiveInventoryBatch(client, {
  companyId,
  storeId,
  productId,
  batchNumber = null,
  expiryDate = null,
  quantity,
  referenceType = null,
  referenceId = null,
  reason = null,
  notes = null,
  createdBy = null,
}) {
  const qty = round3(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Batch quantity must be greater than zero");
  }

  // The shared movement primitive does the authoritative stock write.
  const result = await createInventoryMovement(client, {
    companyId,
    productId,
    storeId,
    movementType: referenceType === "OPENING" ? "OPENING" : "ADJUSTMENT_IN",
    quantityChange: qty,
    referenceType,
    referenceId,
    reason: reason || "Batch stock received",
    notes,
    createdBy,
  });

  const batch = await upsertBatchRow(client, {
    companyId,
    storeId,
    productId,
    batchNumber,
    expiryDate,
    quantity: qty,
  });

  return { movement: result.movement, balance: result.balance, storeBalance: result.storeBalance, batch };
}

/*
 * Allocate a consumption across batch rows WITHOUT writing any movement.
 * For callers that record the authoritative movement themselves (the sale
 * engine) and only need the batch bookkeeping kept in step. `mode`:
 *   - "explicit": the caller names the batch (batchId) — quantity must fit;
 *   - "fefo": batches are picked by nearest expiry (FEFO readiness).
 * Insufficient batch coverage is reconciled (rows zeroed, shortfall
 * disclosed as an `unbatched` line) rather than throwing, so legacy stock
 * that was never batched cannot block a sale; callers get the breakdown.
 */
export async function allocateBatchConsumption(client, {
  companyId,
  storeId,
  productId,
  quantity,
  mode = "fefo",
  batchId = null,
  now = new Date(),
}) {
  const qty = round3(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Batch quantity must be greater than zero");
  }

  const candidates = await client.query(
    `
    SELECT id, batch_number, expiry_date, quantity
    FROM inventory_batches
    WHERE company_id = $1 AND store_id = $2 AND product_id = $3 AND quantity > 0
    FOR UPDATE
    `,
    [companyId, storeId, productId]
  );

  const remaining = { current: qty };
  let batches;
  if (mode === "explicit") {
    const chosen = candidates.rows.filter((row) => row.id === batchId);
    if (!chosen.length) throw new Error("Batch not found for this store");
    batches = chosen;
  } else {
    batches = [...candidates.rows].sort(fefoCompare);
  }

  const consumed = [];
  for (const batch of batches) {
    if (remaining.current <= 0) break;
    const available = Number(batch.quantity);
    const take = Math.min(available, remaining.current);
    await client.query(
      `UPDATE inventory_batches SET quantity = quantity - $1, updated_at = NOW() WHERE id = $2`,
      [take, batch.id]
    );
    consumed.push({
      batchId: batch.id,
      batchNumber: batch.batch_number,
      expiryDate: batch.expiry_date,
      quantity: take,
    });
    remaining.current = round3(remaining.current - take);
  }
  if (round3(remaining.current) > 0) {
    /*
     * Batch bookkeeping is short (e.g. legacy stock never opened as batch
     * rows): reconcile the rows to the already-recorded movement — zero out
     * what remains without going negative — and disclose the shortfall so
     * ledger consumers can see batch coverage lags. Never throws.
     */
    const shortfall = round3(remaining.current);
    await client.query(
      `
      UPDATE inventory_batches
      SET quantity = GREATEST(quantity - $1, 0), updated_at = NOW()
      WHERE company_id = $2 AND store_id = $3 AND product_id = $4
      `,
      [shortfall, companyId, storeId, productId]
    );
    consumed.push({
      batchId: null,
      batchNumber: null,
      expiryDate: null,
      quantity: shortfall,
      unbatched: true,
    });
    remaining.current = 0;
  }

  return {
    consumed,
    expiryStatuses: consumed.map((c) => expiryStatus(c.expiryDate, { now })),
  };
}

/*
 * Consume stock batch-aware (ADJUSTMENT_OUT / wastage via the batch API).
 * Writes the authoritative movement FIRST (createInventoryMovement
 * validates and throws before it writes anything, so a rejected consume
 * can never leave batch rows already debited), then allocates the batch
 * debits through allocateBatchConsumption.
 */
export async function consumeInventoryBatch(client, {
  companyId,
  storeId,
  productId,
  quantity,
  mode = "explicit",
  batchId = null,
  movementType = "ADJUSTMENT_OUT",
  referenceType = null,
  referenceId = null,
  reason = null,
  notes = null,
  createdBy = null,
  now = new Date(),
}) {
  const qty = round3(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("Batch quantity must be greater than zero");
  }

  const result = await createInventoryMovement(client, {
    companyId,
    productId,
    storeId,
    movementType,
    quantityChange: -qty,
    referenceType,
    referenceId,
    reason,
    notes,
    createdBy,
  });

  const { consumed, expiryStatuses } = await allocateBatchConsumption(client, {
    companyId,
    storeId,
    productId,
    quantity: qty,
    mode,
    batchId,
    now,
  });

  return { movement: result.movement, balance: result.balance, storeBalance: result.storeBalance, consumed, expiryStatuses };
}

/*
 * Keep batch quantities aligned for callers that already wrote the
 * authoritative inventory movement. This is intentionally bookkeeping-only:
 * stock totals and the movement ledger continue to be owned by
 * createInventoryMovement.
 */
export async function syncBatchMovement(client, {
  companyId,
  storeId,
  productId,
  quantityChange,
  batchTracked = false,
  batchNumber = null,
  manufacturingDate = null,
  manufacturingDateSource = null,
  expiryDate = null,
  expiryDateSource = null,
  mode = "fefo",
  batchId = null,
  now = new Date(),
}) {
  if (!batchTracked || !storeId) return null;
  const quantity = round3(quantityChange);
  if (!Number.isFinite(quantity) || quantity === 0) return null;

  if (quantity > 0) {
    return {
      received: await upsertBatchRow(client, {
        companyId,
        storeId,
        productId,
        batchNumber,
        manufacturingDate,
        manufacturingDateSource,
        expiryDate,
        expiryDateSource,
        quantity,
      }),
    };
  }

  return {
    consumed: await allocateBatchConsumption(client, {
      companyId,
      storeId,
      productId,
      quantity: Math.abs(quantity),
      mode,
      batchId,
      now,
    }),
  };
}
