import express from "express";
import { dispatchIntegrationEvent } from "../services/integrationDispatcher.js";
import { validateSalesReturn } from "../src/services/salesReturn.js";

/*
 * T9M-SMALL - Sales Returns (customer + supplier) built on the existing
 * stock_returns / stock_return_items / inventory_movements / refunds
 * architecture. Every query is company-scoped, and store-scoped wherever the
 * session carries a storeId (store-level access applies app-wide).
 *
 * Permissions: returns.create (create returns), returns.view (history).
 * Returns without those codes fall back to the legacy sale.refund permission
 * so existing role setups keep working.
 */

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const RETURN_PERMISSIONS_CREATE = ["returns.create", "sale.refund"];
const RETURN_PERMISSIONS_VIEW = ["returns.view", "reports.returns.view", "sale.refund"];

export default function createReturnsRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  writeAudit = null,
}) {
  const router = express.Router();

  /* ------------------------------------------------------------ helpers */

  function tenantScope(req) {
    // Store-level access applies only when the session actually carries one.
    return req.user.storeId
      ? { storeScoped: true, storeId: req.user.storeId }
      : { storeScoped: false, storeId: null };
  }

  async function nextReturnNumber(client, companyId) {
    // RET-<zero-padded per-company sequence>. Computed inside the return's
    // transaction; the sequence lives on the stock_returns rows themselves.
    const result = await client.query(
      `SELECT COALESCE(MAX(NULLIF(SUBSTRING(return_number FROM '[0-9]+$'), '')::int), 0) + 1 AS next_number
       FROM stock_returns WHERE company_id = $1 AND return_number IS NOT NULL`,
      [companyId]
    );
    let candidate = result.rows[0].next_number;
    // Defensive loop: return_number has a UNIQUE constraint; on the (rare)
    // race where another company row already holds the number, step forward.
    for (;;) {
      const clash = await client.query(
        "SELECT 1 FROM stock_returns WHERE return_number = $1 LIMIT 1",
        [`RET-${String(candidate).padStart(4, "0")}`]
      );
      if (!clash.rows.length) return `RET-${String(candidate).padStart(4, "0")}`;
      candidate += 1;
    }
  }

  /**
   * Load a sale FOR RETURN (authoritative data for both the UI and the
   * validation inside the create transaction): header + items + per-item
   * already-returned quantities + refund summary. Company-scoped always;
   * store-scoped when the session has a store.
   */
  async function loadSaleForReturn(clientOrDb, { saleId, companyId, storeId }) {
    const storeClause = storeId ? "AND s.store_id = $3" : "";
    const params = storeId ? [saleId, companyId, storeId] : [saleId, companyId];
    const saleResult = await clientOrDb.query(
      `SELECT s.id, s.company_id, s.store_id, s.customer_id, s.receipt_number, s.status,
              s.subtotal, s.tax, s.discount, s.total, s.created_at, s.completed_at,
              cst.name AS customer_name, cst.phone AS customer_phone, cst.email AS customer_email,
              pay.payment_method, pay.amount AS payment_amount, pay.status AS payment_status
       FROM sales s
       LEFT JOIN customers cst ON cst.id = s.customer_id
       LEFT JOIN payments pay ON pay.sale_id = s.id
       WHERE s.id = $1 AND s.company_id = $2 ${storeClause}
       LIMIT 1`,
      params
    );
    if (!saleResult.rows.length) return null;
    const sale = saleResult.rows[0];

    const itemsResult = await clientOrDb.query(
      `SELECT si.id, si.product_id, si.product_name, si.quantity, si.unit_price,
              si.discount, si.tax, si.total,
              pr.track_stock,
              COALESCE(agg.returned_quantity, 0) AS returned_quantity
       FROM sale_items si
       LEFT JOIN products pr ON pr.id = si.product_id
       LEFT JOIN (
         SELECT sri.sale_item_id, SUM(sri.quantity) AS returned_quantity
         FROM stock_return_items sri
         INNER JOIN stock_returns sr ON sr.id = sri.return_id
         WHERE sr.return_type = 'CUSTOMER' AND sr.status = 'COMPLETED'
         GROUP BY sri.sale_item_id
       ) agg ON agg.sale_item_id = si.id
       WHERE si.sale_id = $1
       ORDER BY si.id`,
      [saleId]
    );

    const refundsResult = await clientOrDb.query(
      `SELECT COALESCE(SUM(amount), 0) AS refunded FROM refunds WHERE sale_id = $1`,
      [saleId]
    );

    return {
      sale,
      items: itemsResult.rows.map((row) => {
        const quantity = Number(row.quantity);
        const returnedQuantity = Number(row.returned_quantity);
        const unitPrice = Number(row.unit_price) || 0;
        const lineTotal = Number(row.total) || 0;
        const lineQty = quantity || 1;
        return {
          id: row.id,
          productId: row.product_id,
          productName: row.product_name,
          quantity,
          unitPrice,
          trackStock: row.track_stock !== false, // default true when unknown
          returnedQuantity,
          remainingQuantity: Math.max(0, round2(quantity - returnedQuantity)),
          unitRefundValue: round2(lineTotal / lineQty),
          maxRefundValue: round2((lineTotal / lineQty) * Math.max(0, quantity - returnedQuantity)),
        };
      }),
      refunded: Number(refundsResult.rows[0].refunded) || 0,
    };
  }

  /* ------------------------------------------------- GET /returns/lookup */

  /*
   * Find a completed sale for return by receipt number or sale ID.
   * Tenant/store scoped; returns the authoritative already-returned and
   * remaining quantities per item plus the refund summary. Does NOT leak
   * other tenants' sales (404 with a generic message on any miss).
   */
  router.get(
    "/returns/lookup",
    authenticate,
    authorize(...RETURN_PERMISSIONS_CREATE),
    async (req, res) => {
      try {
        const search = String(req.query.receipt || "").trim();
        if (!search) {
          return res.status(400).json({ success: false, message: "A receipt number or sale ID is required." });
        }
        const { storeScoped, storeId } = tenantScope(req);
        const client = await pool.connect();
        try {
          // Accept either the receipt number or a raw sale UUID.
          const saleIdProbe = await client.query(
            `SELECT id FROM sales
             WHERE company_id = $1 ${storeScoped ? "AND store_id = $2" : ""}
               AND (receipt_number = $${storeScoped ? 3 : 2} OR id::text = $${storeScoped ? 3 : 2})
             LIMIT 1`,
            storeScoped
              ? [req.user.companyId, storeId, search]
              : [req.user.companyId, search]
          );
          if (!saleIdProbe.rows.length) {
            return res.status(404).json({ success: false, message: "Sale not found. Check the receipt number." });
          }
          const loaded = await loadSaleForReturn(client, {
            saleId: saleIdProbe.rows[0].id,
            companyId: req.user.companyId,
            storeId: storeScoped ? storeId : null,
          });
          if (!loaded) {
            return res.status(404).json({ success: false, message: "Sale not found. Check the receipt number." });
          }
          const returnable = loaded.sale.status === "completed" || loaded.sale.status === "COMPLETED";
          const totalReturnable = round2(loaded.items.reduce((sum, item) => sum + item.maxRefundValue, 0));
          return res.json({
            success: true,
            data: {
              sale: {
                id: loaded.sale.id,
                receiptNumber: loaded.sale.receipt_number,
                status: loaded.sale.status,
                returnable,
                saleDate: loaded.sale.completed_at || loaded.sale.created_at,
                customer: loaded.sale.customer_name
                  ? { name: loaded.sale.customer_name, phone: loaded.sale.customer_phone, email: loaded.sale.customer_email }
                  : null,
                payment: loaded.sale.payment_method
                  ? { method: loaded.sale.payment_method, amount: Number(loaded.sale.payment_amount), status: loaded.sale.payment_status }
                  : null,
                totals: { subtotal: Number(loaded.sale.subtotal), tax: Number(loaded.sale.tax), discount: Number(loaded.sale.discount), total: Number(loaded.sale.total) },
                refunded: round2(loaded.refunded),
                returnableValue: round2(Math.min(totalReturnable, Math.max(0, Number(loaded.sale.total) - loaded.refunded))),
              },
              items: loaded.items,
            },
          });
        } finally {
          client.release();
        }
      } catch (error) {
        console.error("Return lookup error:", error);
        return res.status(500).json({ success: false, message: "Unable to look up the sale." });
      }
    }
  );

  /* --------------------------------------------- GET /returns (history) */

  router.get(
    "/returns",
    authenticate,
    authorize(...RETURN_PERMISSIONS_VIEW),
    async (req, res) => {
      try {
        const { storeScoped, storeId } = tenantScope(req);
        const params = [req.user.companyId];
        let storeClause = "";
        if (storeScoped) {
          params.push(storeId);
          storeClause = `AND sr.store_id = $${params.length}`;
        }
        params.push(500);
        const result = await db(
          `SELECT sr.id, sr.return_number, sr.return_type, sr.status, sr.refund_amount, sr.refund_method,
                  sr.sale_id, sr.purchase_id, sr.reason, sr.created_at,
                  u.username AS created_by,
                  s.receipt_number AS sale_receipt, s.total AS sale_total,
                  p.reference_number AS purchase_reference, p.supplier_name,
                  cst.name AS customer_name,
                  COALESCE(item_summary.item_count, 0) AS item_count,
                  COALESCE(item_summary.quantity, 0) AS quantity
           FROM stock_returns sr
           LEFT JOIN users u ON u.id = sr.created_by
           LEFT JOIN sales s ON s.id = sr.sale_id
           LEFT JOIN purchases p ON p.id = sr.purchase_id
           LEFT JOIN customers cst ON cst.id = s.customer_id
           LEFT JOIN (
             SELECT return_id, COUNT(*) AS item_count, SUM(quantity) AS quantity
             FROM stock_return_items GROUP BY return_id
           ) item_summary ON item_summary.return_id = sr.id
           WHERE sr.company_id = $1 ${storeClause}
           ORDER BY sr.created_at DESC
           LIMIT $${params.length}`,
          params
        );
        return res.json({
          success: true,
          data: result.rows.map((row) => ({
            id: row.id,
            returnNumber: row.return_number,
            returnType: row.return_type,
            status: row.status || "COMPLETED",
            refundAmount: row.refund_amount === null ? null : Number(row.refund_amount),
            refundMethod: row.refund_method,
            saleId: row.sale_id,
            purchaseId: row.purchase_id,
            originalInvoice: row.return_type === "CUSTOMER" ? row.sale_receipt : row.purchase_reference,
            customerName: row.return_type === "CUSTOMER" ? row.customer_name : row.supplier_name,
            itemCount: Number(row.item_count) || 0,
            quantity: Number(row.quantity) || 0,
            reason: row.reason,
            createdBy: row.created_by,
            createdAt: row.created_at,
          })),
        });
      } catch (error) {
        console.error("Load returns error:", error);
        return res.status(500).json({ success: false, message: "Unable to load returns" });
      }
    }
  );

  /* -------------------------------------- GET /returns/:id (detail view) */

  router.get(
    "/returns/:id",
    authenticate,
    authorize(...RETURN_PERMISSIONS_VIEW),
    async (req, res) => {
      try {
        const { storeScoped, storeId } = tenantScope(req);
        const params = storeScoped
          ? [req.params.id, req.user.companyId, storeId]
          : [req.params.id, req.user.companyId];
        const storeClause = storeScoped ? "AND sr.store_id = $3" : "";
        const result = await db(
          `SELECT sr.id, sr.return_number, sr.return_type, sr.status, sr.refund_amount, sr.refund_method,
                  sr.sale_id, sr.purchase_id, sr.reason, sr.created_at, u.username AS created_by
           FROM stock_returns sr
           LEFT JOIN users u ON u.id = sr.created_by
           WHERE sr.id = $1 AND sr.company_id = $2 ${storeClause}`,
          params
        );
        if (!result.rows.length) {
          return res.status(404).json({ success: false, message: "Return not found" });
        }
        const returnRow = result.rows[0];
        const items = await db(
          `SELECT sri.product_id, sri.quantity, sri.reason,
                  COALESCE(si.product_name, pr.name) AS product_name,
                  si.unit_price
           FROM stock_return_items sri
           LEFT JOIN sale_items si ON si.id = sri.sale_item_id
           LEFT JOIN products pr ON pr.id = sri.product_id
           WHERE sri.return_id = $1`,
          [req.params.id]
        );
        return res.json({
          success: true,
          data: {
            ...returnRow,
            refundAmount: returnRow.refund_amount === null ? null : Number(returnRow.refund_amount),
            items: items.rows.map((row) => ({ ...row, quantity: Number(row.quantity) })),
          },
        });
      } catch (error) {
        console.error("Return detail error:", error);
        return res.status(500).json({ success: false, message: "Unable to load the return" });
      }
    }
  );

  /* -------------------------------------------- POST /returns/customer */

  router.post(
    "/returns/customer",
    authenticate,
    authorize(...RETURN_PERMISSIONS_CREATE),
    async (req, res) => {
      const { saleId = null, items = [], reason = null, requestKey = null } = req.body || {};
      if (!saleId) return res.status(400).json({ success: false, message: "A sale is required." });
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ success: false, message: "At least one return line is required." });
      }
      if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured." });

      const { storeScoped, storeId } = tenantScope(req);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Idempotency: one requestKey = one return (per company).
        if (requestKey) {
          const key = String(requestKey).slice(0, 100);
          const duplicate = await client.query(
            "SELECT id, return_number FROM stock_returns WHERE company_id=$1 AND request_key=$2",
            [req.user.companyId, key]
          );
          if (duplicate.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              success: false,
              message: "This return has already been processed.",
              data: { returnNumber: duplicate.rows[0].return_number, duplicate: true },
            });
          }
        }

        // Load the sale with the SAME authoritative loader the lookup uses,
        // row-locked so two concurrent returns cannot double-count stock.
        {
          const lock = await client.query(
            `SELECT id FROM sales WHERE id=$1 AND company_id=$2 ${storeScoped ? "AND store_id=$3" : ""} FOR UPDATE`,
            storeScoped ? [saleId, req.user.companyId, storeId] : [saleId, req.user.companyId]
          );
          if (!lock.rows.length) throw new Error("Sale not found for this store");
        }

        const loaded = await loadSaleForReturn(client, {
          saleId,
          companyId: req.user.companyId,
          storeId: storeScoped ? storeId : null,
        });
        if (!loaded) throw new Error("Sale not found for this store");
        if (loaded.sale.status !== "completed" && loaded.sale.status !== "COMPLETED") {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, message: "Only completed sales can be returned." });
        }

        // Authoritative validation against sale_items + aggregated returns.
        const saleItems = loaded.items.map((item) => ({
          id: item.id,
          product_id: item.productId,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total: round2(item.unitPrice * item.quantity) === round2(item.total || 0)
            ? item.total || 0
            : item.total || round2(item.unitPrice * item.quantity),
          returned_quantity: item.returnedQuantity,
        }));
        const requested = items.map((item) => ({
          saleItemId: item.saleItemId,
          productId: item.productId,
          quantity: Number(item.quantity),
        }));
        const validation = validateSalesReturn({ saleId, items: requested }, saleItems);
        if (!validation.valid) {
          await client.query("ROLLBACK");
          return res.status(400).json({ success: false, message: validation.errors.map((e) => e.message).join("; ") });
        }

        const returnNumber = await nextReturnNumber(client, req.user.companyId);
        const created = await client.query(
          `INSERT INTO stock_returns (company_id, store_id, return_type, return_number, sale_id, request_key, reason, refund_amount, refund_method, status, created_by)
           VALUES ($1,$2,'CUSTOMER',$3,$4,$5,$6,$7,$8,'COMPLETED',$9) RETURNING id`,
          [
            req.user.companyId,
            storeScoped ? storeId : loaded.sale.store_id,
            returnNumber,
            saleId,
            requestKey ? String(requestKey).slice(0, 100) : null,
            reason || null,
            0, // updated below once lines are priced
            null,
            req.user.id,
          ]
        );
        const returnId = created.rows[0].id;

        let refundAmount = 0;
        const refundReasons = new Set();
        const itemReasons = new Set();

        for (const item of items) {
          const quantity = Number(item.quantity);
          if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) {
            throw new Error("Invalid return line");
          }
          const source = loaded.items.find((row) => row.id === item.saleItemId);
          if (!source || source.productId !== item.productId) {
            throw new Error("Return line does not belong to the sale");
          }
          // Re-check remaining against live aggregated data (already inside
          // the FOR UPDATE lock, so this is race-safe).
          const returned = await client.query(
            `SELECT COALESCE(SUM(sri.quantity),0) AS quantity
             FROM stock_return_items sri
             INNER JOIN stock_returns sr ON sr.id = sri.return_id
             WHERE sr.return_type='CUSTOMER' AND sr.status='COMPLETED' AND sr.sale_id=$1 AND sri.sale_item_id=$2`,
            [saleId, item.saleItemId]
          );
          const remaining = round2(source.quantity - Number(returned.rows[0].quantity));
          if (round2(quantity) > remaining) {
            throw new Error("Return quantity exceeds the remaining returnable quantity");
          }

          await client.query(
            "INSERT INTO stock_return_items (return_id, product_id, sale_item_id, quantity, reason) VALUES ($1,$2,$3,$4,$5)",
            [returnId, item.productId, item.saleItemId, quantity, item.reason || null]
          );
          if (item.reason) itemReasons.add(item.reason);

          // Stock back into inventory via the EXISTING movement mechanism.
          // track_stock=false products skip the ledger like POS sales do.
          if (source.trackStock) {
            await createInventoryMovement(client, {
              companyId: req.user.companyId,
              productId: item.productId,
              storeId: storeScoped ? storeId : loaded.sale.store_id,
              movementType: "CUSTOMER_RETURN",
              quantityChange: quantity,
              referenceType: "SALE_RETURN",
              referenceId: returnId,
              reason: item.reason || reason,
              createdBy: req.user.id,
            });
          }

          refundAmount += source.unitRefundValue * quantity;
        }

        refundAmount = round2(refundAmount);

        // Refund recorded against the sale via the existing refunds table,
        // capped by what has actually been paid minus prior refunds, and
        // LINKED to this return for a complete audit trail.
        if (refundAmount > 0) {
          const paymentResult = await client.query(
            `SELECT COALESCE(SUM(amount),0) AS total_paid,
                    (SELECT payment_method FROM payments WHERE sale_id=$1 AND status='completed' ORDER BY created_at DESC LIMIT 1) AS payment_method
             FROM payments WHERE sale_id=$1 AND status='completed'`,
            [saleId]
          );
          const totalPaid = Number(paymentResult.rows[0].total_paid) || 0;
          const refundMethod = paymentResult.rows[0].payment_method || loaded.sale.payment_method || null;
          const alreadyRefunded = Number(
            (await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE sale_id=$1", [saleId])).rows[0].total
          ) || 0;
          const remainingRefundable = round2(totalPaid - alreadyRefunded);
          if (refundAmount > remainingRefundable + 0.01) {
            throw new Error(
              `Refund amount ${refundAmount.toFixed(2)} exceeds the remaining refundable amount ${remainingRefundable.toFixed(2)}`
            );
          }
          await client.query(
            "INSERT INTO refunds (sale_id, user_id, amount, reason, payment_method, return_id) VALUES ($1,$2,$3,$4,$5,$6)",
            [saleId, req.user.id, refundAmount, reason || [...itemReasons].join("; ") || null, refundMethod, returnId]
          );
          await client.query(
            "UPDATE stock_returns SET refund_amount=$1, refund_method=$2 WHERE id=$3",
            [refundAmount, refundMethod, returnId]
          );
        }

        if (reason) refundReasons.add(reason);

        await client.query("COMMIT");

        /*
         * T10R: Customer loyalty reversal on refunds - fire-and-forget after return commit
         * Loyalty failures must never block a completed return.
         */
        if (loaded.sale.customer_id && refundAmount > 0) {
          Promise.resolve(
            (async () => {
              try {
                // Check if loyalty is enabled for this company
                const settings = await db(
                  `SELECT loyalty_enabled, loyalty_earning_rate FROM company_settings WHERE company_id = $1`,
                  [req.user.companyId]
                );
                if (!settings.rows.length || !settings.rows[0].loyalty_enabled) return;

                const earningRate = Number(settings.rows[0].loyalty_earning_rate) || 0.01;
                const loyaltyToReverse = Number(refundAmount) * earningRate;

                if (loyaltyToReverse <= 0) return;

                // Get current balance
                const balanceResult = await db(
                  `SELECT balance FROM customer_loyalty_balances WHERE company_id = $1 AND customer_id = $2`,
                  [req.user.companyId, loaded.sale.customer_id]
                );

                if (!balanceResult.rows.length) return;

                const currentBalance = Number(balanceResult.rows[0].balance);
                const reverseAmount = Math.min(loyaltyToReverse, currentBalance);

                if (reverseAmount <= 0) return;

                // Update balance
                const newBalance = currentBalance - reverseAmount;
                await db(
                  `UPDATE customer_loyalty_balances SET balance = $1, updated_at = NOW() WHERE company_id = $2 AND customer_id = $3`,
                  [newBalance, req.user.companyId, loaded.sale.customer_id]
                );

                // Record reversal transaction
                await db(
                  `
                  INSERT INTO customer_loyalty_transactions 
                    (company_id, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by)
                  VALUES ($1, $2, 'REVERSE', $3, $4, 'return', $5, 'Refund processed', $6)
                  `,
                  [req.user.companyId, loaded.sale.customer_id, -reverseAmount, newBalance, returnId, req.user.id]
                );

                // Audit log for loyalty reversal
                if (typeof writeAudit === "function") {
                  writeAudit(
                    req.user.companyId,
                    req.user.id,
                    "loyalty.reversed",
                    "customer",
                    loaded.sale.customer_id,
                    { returnId, amount: reverseAmount, balanceAfter: newBalance }
                  ).catch((auditError) => console.error("Loyalty audit write error:", auditError));
                }
              } catch (loyaltyError) {
                console.error("Loyalty reversal error:", loyaltyError);
                // Do not throw - loyalty failures must not block returns
              }
            })()
          ).catch(() => {});
        }

        /* T9G: fire-and-forget integration dispatch (never blocks/throws). */
        dispatchIntegrationEvent({
          event: "SALES_RETURN_CREATED",
          deps: { db },
          context: { companyId: req.user.companyId, storeId: storeScoped ? storeId : loaded.sale.store_id },
          entityId: returnId,
        }).catch(() => {});

        return res.status(201).json({
          success: true,
          message: `Return ${returnNumber} processed.`,
          data: {
            id: returnId,
            returnNumber,
            refund: refundAmount > 0
              ? { amount: refundAmount, method: loaded.sale.payment_method || null }
              : { amount: 0, method: null },
          },
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Customer return error:", error);
        const message = error.message || "Unable to process the return";
        if (message.includes("not found")) {
          return res.status(404).json({ success: false, message });
        }
        return res.status(400).json({ success: false, message });
      } finally {
        client.release();
      }
    }
  );

  /* --------------------------------------------- POST /returns/supplier */

  router.post(
    "/returns/supplier",
    authenticate,
    authorize(...RETURN_PERMISSIONS_CREATE),
    async (req, res) => {
      const { purchaseId = null, items = [], reason = null, requestKey = null } = req.body || {};
      if (!purchaseId) return res.status(400).json({ success: false, message: "A purchase is required." });
      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ success: false, message: "At least one return line is required." });
      }
      if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured." });

      const { storeScoped, storeId } = tenantScope(req);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        if (requestKey) {
          const key = String(requestKey).slice(0, 100);
          const duplicate = await client.query(
            "SELECT id, return_number FROM stock_returns WHERE company_id=$1 AND request_key=$2",
            [req.user.companyId, key]
          );
          if (duplicate.rows.length) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              success: false,
              message: "This return request has already been processed.",
              data: { returnNumber: duplicate.rows[0].return_number, duplicate: true },
            });
          }
        }

        const parent = await client.query(
          `SELECT id, store_id, supplier_id FROM purchases
           WHERE id=$1 AND company_id=$2 AND status='RECEIVED' ${storeScoped ? "AND store_id=$3" : ""} FOR UPDATE`,
          storeScoped ? [purchaseId, req.user.companyId, storeId] : [purchaseId, req.user.companyId]
        );
        if (!parent.rows.length) throw new Error("Purchase not found for this store");

        const returnNumber = await nextReturnNumber(client, req.user.companyId);
        const created = await client.query(
          `INSERT INTO stock_returns (company_id, store_id, return_type, return_number, purchase_id, supplier_id, request_key, reason, status, created_by)
           VALUES ($1,$2,'SUPPLIER',$3,$4,$5,$6,$7,'COMPLETED',$8) RETURNING id`,
          [
            req.user.companyId,
            storeScoped ? storeId : parent.rows[0].store_id,
            returnNumber,
            purchaseId,
            parent.rows[0].supplier_id || null,
            requestKey ? String(requestKey).slice(0, 100) : null,
            reason || null,
            req.user.id,
          ]
        );
        const returnId = created.rows[0].id;

        for (const item of items) {
          const quantity = Number(item.quantity);
          if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) {
            throw new Error("Invalid return line");
          }
          const source = await client.query(
            "SELECT id, product_id, quantity FROM purchase_items WHERE id=$1 AND purchase_id=$2",
            [item.purchaseItemId, purchaseId]
          );
          if (!source.rows.length || source.rows[0].product_id !== item.productId) {
            throw new Error("Return line does not belong to the purchase");
          }
          const returned = await client.query(
            `SELECT COALESCE(SUM(sri.quantity),0) AS quantity
             FROM stock_return_items sri
             INNER JOIN stock_returns sr ON sr.id = sri.return_id
             WHERE sr.return_type='SUPPLIER' AND sr.status='COMPLETED' AND sr.purchase_id=$1 AND sri.purchase_item_id=$2`,
            [purchaseId, item.purchaseItemId]
          );
          const remaining = round2(Number(source.rows[0].quantity) - Number(returned.rows[0].quantity));
          if (round2(quantity) > remaining) {
            throw new Error("Return quantity exceeds the remaining returnable quantity");
          }
          await client.query(
            "INSERT INTO stock_return_items (return_id, product_id, purchase_item_id, quantity, reason) VALUES ($1,$2,$3,$4,$5)",
            [returnId, item.productId, item.purchaseItemId, quantity, item.reason || null]
          );
          await createInventoryMovement(client, {
            companyId: req.user.companyId,
            productId: item.productId,
            storeId: storeScoped ? storeId : parent.rows[0].store_id,
            movementType: "SUPPLIER_RETURN",
            quantityChange: -quantity,
            referenceType: "PURCHASE_RETURN",
            referenceId: returnId,
            reason: item.reason || reason,
            createdBy: req.user.id,
          });
        }

        await client.query("COMMIT");
        return res.status(201).json({
          success: true,
          message: `Return ${returnNumber} processed.`,
          data: { id: returnId, returnNumber },
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error("Supplier return error:", error);
        const message = error.message || "Unable to process the return";
        if (message.includes("not found")) {
          return res.status(404).json({ success: false, message });
        }
        return res.status(400).json({ success: false, message });
      } finally {
        client.release();
      }
    }
  );

  /* --------------------------------- GET /supplier-returns/available */

  router.get(
    "/supplier-returns/available",
    authenticate,
    authorize(...RETURN_PERMISSIONS_CREATE),
    async (req, res) => {
      try {
        const { storeScoped, storeId } = tenantScope(req);
        const params = [req.user.companyId];
        let storeClause = "";
        if (storeScoped) {
          params.push(storeId);
          storeClause = `AND p.store_id = $${params.length}`;
        }
        const result = await db(
          `SELECT p.id AS purchase_id, p.reference_number, p.purchase_date, p.supplier_name,
                  pi.id AS purchase_item_id, pi.product_id, pr.name AS product_name,
                  pi.quantity AS received_quantity,
                  COALESCE((SELECT SUM(ri.quantity) FROM stock_return_items ri
                            INNER JOIN stock_returns r ON r.id = ri.return_id
                            WHERE r.return_type='SUPPLIER' AND r.status='COMPLETED' AND r.purchase_id=p.id AND ri.purchase_item_id=pi.id),0) AS returned_quantity
           FROM purchases p
           INNER JOIN purchase_items pi ON pi.purchase_id = p.id
           INNER JOIN products pr ON pr.id = pi.product_id
           WHERE p.company_id = $1 ${storeClause} AND p.status = 'RECEIVED'
           ORDER BY p.purchase_date DESC, p.created_at DESC`,
          params
        );
        return res.json({
          success: true,
          data: result.rows.map((row) => ({
            ...row,
            received_quantity: Number(row.received_quantity),
            returned_quantity: Number(row.returned_quantity),
            remaining_quantity: round2(Number(row.received_quantity) - Number(row.returned_quantity)),
          })),
        });
      } catch (error) {
        console.error("Load supplier returns error:", error);
        return res.status(500).json({ success: false, message: "Unable to load supplier return options" });
      }
    }
  );

  return router;
}
