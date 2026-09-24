import { syncBatchMovement } from "../services/inventory.js";
import { calculateExchangeSettlement } from "../services/exchangeRules.js";
import { roundCurrency } from "../src/utils/saleTotals.js";

/*
 * Product exchanges on the EXISTING returns/sales/stock/payment foundations.
 * Called from routes/returns.js so the exchange shares its permissions,
 * idempotency conventions, refund-allocation helpers and inventory primitive.
 * One router, one returns system, one stock system, one payment system.
 */
export function registerExchangeRoutes({
  router,
  db,
  pool,
  authenticate,
  authorize,
  tenantScope,
  nextReturnNumber,
  loadSalePayments,
  allocateRefund,
  refundedByMethodForSale,
  totalRefundedForSale,
  resolveSaleRef,
  lookupSaleLines,
  loadSaleVat,
  loadExchangeProduct,
  catalogueUnitValue,
  writeAudit = null,
  createInventoryMovement,
  canonicalTransactionWriter = null,
}) {
  const round2 = roundCurrency;
  const PAYMENT_METHODS = ["cash", "card", "customer_credit", "gift_card", "voucher", "cheque", "bank_transfer", "online"];
  const RETURN_PERMISSIONS_CREATE = ["returns.create", "sale.refund"];

  async function effectiveExchangeMode(companyId) {
    try {
      const settings = await db("SELECT exchange_mode FROM company_settings WHERE company_id=$1", [companyId]);
      const raw = settings.rows[0]?.exchange_mode;
      if (["receipt", "normal", "both"].includes(raw)) return raw;
    } catch { /* pre-migration: default open */ }
    return "both";
  }

  async function persistExchange(req, client, args) {
    const { companyId, exchangeStoreId, mode, saleId, returnLegs, replacementLegs,
      returnTotal, replacementTotal, difference, paymentLines, requestKey, returnNumber, customerId } = args;
    const created = await client.query(
      `INSERT INTO stock_returns (company_id, store_id, return_type, return_number, sale_id, request_key, reason, refund_amount, refund_method, status, created_by, exchange_mode, exchange_difference, replacement_total)
       VALUES ($1,$2,'CUSTOMER',$3,$4,$5,$6,$7,$8,'COMPLETED',$9,$10,$11,$12) RETURNING id`,
      [companyId, exchangeStoreId, returnNumber, saleId, requestKey,
        req.body?.reason || `Exchange (${mode})`, returnTotal,
        difference < 0 && mode === "receipt" ? "original_tender" : null,
        req.user.id, mode, difference, replacementTotal]
    );
    const returnId = created.rows[0].id;
    for (const leg of returnLegs) {
      await client.query(
        "INSERT INTO stock_return_items (return_id, product_id, sale_item_id, quantity, reason) VALUES ($1,$2,$3,$4,$5)",
        [returnId, leg.productId, leg.saleItemId, leg.quantity, req.body?.reason || null]
      );
      if (leg.trackStock !== false) {
        await createInventoryMovement(client, {
          companyId, productId: leg.productId, storeId: exchangeStoreId,
          movementType: "CUSTOMER_RETURN", quantityChange: leg.quantity,
          referenceType: "CUSTOMER_RETURN", referenceId: returnId,
          reason: req.body?.reason || `Exchange return (${mode})`, createdBy: req.user.id,
        });
        await syncBatchMovement(client, {
          companyId,
          storeId: exchangeStoreId,
          productId: leg.productId,
          quantityChange: leg.quantity,
          batchTracked: leg.product?.batch_tracking === true,
          batchNumber: `RETURNS-${returnId.slice(0, 8).toUpperCase()}`,
        });
      }
    }
    let replSubtotal = 0;
    let replTax = 0;
    const replLines = [];
    for (const leg of replacementLegs) {
      const gross = round2(leg.unit * leg.quantity);
      const rate = Number(leg.product.vat_rate) || 0;
      const tax = round2((gross * rate) / (100 + rate));
      replSubtotal = round2(replSubtotal + round2(gross - tax));
      replTax = round2(replTax + tax);
      replLines.push({ ...leg, gross, tax });
    }
    const replacementReceipt = `EXC-${returnNumber}`;
    const replacement = await client.query(
      `INSERT INTO sales (company_id, store_id, user_id, receipt_number, subtotal, tax, discount, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,'completed') RETURNING id`,
      [companyId, exchangeStoreId, req.user.id, replacementReceipt, replSubtotal, replTax, replacementTotal]
    );
    const replacementSaleId = replacement.rows[0].id;
    for (const leg of replLines) {
      await client.query(
        "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, discount, tax, total) VALUES ($1,$2,$3,$4,$5,0,$6,$7)",
        [replacementSaleId, leg.product.id, leg.product.name, leg.quantity, leg.unit, leg.tax, leg.gross]
      );
      if (leg.product.track_stock !== false) {
        await createInventoryMovement(client, {
          companyId, productId: leg.product.id, storeId: exchangeStoreId,
          movementType: "SALE", quantityChange: -leg.quantity,
          referenceType: "SALE", referenceId: replacementSaleId,
          reason: `Exchange replacement (${mode})`, createdBy: req.user.id,
        });
        await syncBatchMovement(client, {
          companyId,
          storeId: exchangeStoreId,
          productId: leg.product.id,
          quantityChange: -leg.quantity,
          batchTracked: leg.product.batch_tracking === true,
        });
      }
    }
    if (returnTotal > 0) {
      await client.query(
        "INSERT INTO payments (sale_id, payment_method, amount, status) VALUES ($1,'exchange_credit',$2,'completed')",
        [replacementSaleId, round2(Math.min(returnTotal, replacementTotal))]
      );
    }
    if (difference > 0) {
      for (const line of paymentLines) {
        await client.query(
          "INSERT INTO payments (sale_id, payment_method, amount, status) VALUES ($1,$2,$3,'completed')",
          [replacementSaleId, line.method, line.amount]
        );
      }
    } else if (difference < 0) {
      const credit = Math.abs(difference);
      if (mode === "receipt") {
        const salePayments = await loadSalePayments(client, saleId);
        const refundedByMethod = await refundedByMethodForSale(client, saleId);
        const { allocation, unallocated } = allocateRefund(salePayments, credit, refundedByMethod);
        if (unallocated > 0.005 || !allocation.length) throw new Error("Exchange credit exceeds the remaining refundable amount");
        for (const row of allocation) {
          await client.query(
            "INSERT INTO refunds (sale_id, user_id, amount, reason, payment_method, return_id) VALUES ($1,$2,$3,$4,$5,$6)",
            [saleId, req.user.id, row.amount, req.body?.reason || "Exchange credit", row.method, returnId]
          );
          if (row.method === "customer_credit" && customerId) {
            await client.query(
              `INSERT INTO customer_credit_ledger
                (company_id, store_id, customer_id, transaction_type, amount,
                 reference_type, reference_id, description, idempotency_key, created_by)
               VALUES ($1,$2,$3,'debit_note',$4,'exchange_return',$5,$6,$7,$8)
               ON CONFLICT (company_id, idempotency_key) DO NOTHING`,
              [
                companyId,
                exchangeStoreId,
                customerId,
                round2(row.amount),
                returnId,
                req.body?.reason || "Customer credit exchange refund",
                `exchange_credit_refund:${returnId}`,
                req.user.id,
              ]
            );
          }
        }
        await client.query("UPDATE stock_returns SET refund_method=$1 WHERE id=$2", ["original_tender", returnId]);
      } else {
        await client.query(
          "INSERT INTO refunds (sale_id, user_id, amount, reason, payment_method, return_id) VALUES ($1,$2,$3,$4,$5,$6)",
          [replacementSaleId, req.user.id, credit, req.body?.reason || "No-receipt exchange credit", req.body?.paymentMethod || "cash", returnId]
        );
      }
    }
    await client.query("UPDATE stock_returns SET replacement_sale_id=$1 WHERE id=$2", [replacementSaleId, returnId]);
    return { returnId, replacementSaleId, replacementReceipt };
  }

  async function valueReturnLeg(client, req, mode, returnItems, companyId, exchangeStoreId) {
    // Returns { saleId, storeId, total, legs }. Throws with statusCode.
    if (mode === "receipt") {
      const sale = await resolveSaleRef(client, req, req.body?.saleId ?? req.body?.receipt);
      if (!sale) { const e = new Error("Original sale not found"); e.statusCode = 404; throw e; }
      const sources = await lookupSaleLines(client, sale.id);
      let total = 0;
      const legs = [];
      for (const line of returnItems) {
        const source = sources.get(String(line?.saleItemId || ""));
        if (!source) { const e = new Error("Unknown saleItemId"); e.statusCode = 404; throw e; }
        if (line?.productId != null && String(line.productId) !== String(source.productId)) { const e = new Error("productId mismatch"); e.statusCode = 400; throw e; }
        const quantity = Number(line.quantity);
        if (source.remainingQuantity <= 0) { const e = new Error("already been fully returned"); e.statusCode = 400; throw e; }
        if (quantity - source.remainingQuantity > 1e-9) { const e = new Error(`exceeds remaining ${source.remainingQuantity}`); e.statusCode = 400; throw e; }
        total = round2(total + round2(source.unitRefundValue * quantity));
        legs.push({ productId: source.productId, quantity, saleItemId: source.id, trackStock: source.trackStock });
      }
      return { saleId: sale.id, customerId: sale.customer_id, storeId: exchangeStoreId || sale.store_id, total, legs };
    }
    if (!exchangeStoreId) { const e = new Error("store-bound session required"); e.statusCode = 400; throw e; }
    const vat = await loadSaleVat(client, companyId);
    let total = 0;
    const legs = [];
    for (const line of returnItems) {
      if (!line?.productId) { const e = new Error("return productId required"); e.statusCode = 400; throw e; }
      const product = await loadExchangeProduct(client, companyId, line.productId);
      if (!product || product.id === "misc-placeholder") { const e = new Error("Return product not found"); e.statusCode = 404; throw e; }
      const quantity = Number(line.quantity);
      const unit = catalogueUnitValue(product, vat);
      total = round2(total + round2(unit * quantity));
      legs.push({ productId: product.id, quantity, saleItemId: null, trackStock: product.track_stock !== false });
    }
    return { saleId: null, customerId: null, storeId: exchangeStoreId, total, legs };
  }

  async function valueReplacementLeg(client, companyId, replacementItems) {
    const vat = await loadSaleVat(client, companyId);
    let total = 0;
    const legs = [];
    for (const line of replacementItems) {
      if (!line?.productId) { const e = new Error("replacement productId required"); e.statusCode = 400; throw e; }
      const product = await loadExchangeProduct(client, companyId, line.productId);
      if (!product || product.id === "misc-placeholder") { const e = new Error("Replacement not found"); e.statusCode = 404; throw e; }
      const quantity = Number(line.quantity);
      const unit = catalogueUnitValue(product, vat);
      total = round2(total + round2(unit * quantity));
      legs.push({ product, quantity, unit });
    }
    return { total, legs };
  }

  function settleTopUp(body, difference) {
    const raw = Array.isArray(body?.payments) ? body.payments : [];
    if (raw.length) {
      const seen = new Set();
      let sum = 0;
      const lines = [];
      for (const entry of raw) {
        const method = String(entry?.paymentMethod || "").trim();
        const amount = Number(entry?.amount);
        if (!PAYMENT_METHODS.includes(method) || !Number.isFinite(amount) || amount <= 0) { const e = new Error("Invalid payment line"); e.statusCode = 400; throw e; }
        if (seen.has(method)) { const e = new Error("Duplicate payment method"); e.statusCode = 400; throw e; }
        seen.add(method);
        sum = round2(sum + round2(amount));
        lines.push({ method, amount: round2(amount) });
      }
      if (Math.abs(sum - difference) > 0.005) { const e = new Error("Settlement mismatch"); e.statusCode = 400; throw e; }
      if (seen.has("customer_credit") && seen.size > 1) { const e = new Error("Customer credit cannot be combined"); e.statusCode = 400; throw e; }
      return lines;
    }
    const single = body?.paymentMethod != null ? String(body.paymentMethod).trim() : "";
    if (!PAYMENT_METHODS.includes(single)) { const e = new Error("payment method required"); e.statusCode = 400; throw e; }
    return [{ method: single, amount: difference }];
  }

  router.post("/returns/exchanges", authenticate, authorize(...RETURN_PERMISSIONS_CREATE), async (req, res) => {
    const companyId = req.user.companyId;
    const mode = String(req.body?.mode || "").trim().toLowerCase();
    if (!["receipt", "normal"].includes(mode)) {
      return res.status(400).json({ success: false, message: "mode receipt|normal" });
    }
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fail = async (status, message) => {
        await client.query("ROLLBACK").catch(() => {});
        return res.status(status).json({ success: false, message });
      };
      const configured = await effectiveExchangeMode(companyId);
      if (configured !== "both" && configured !== mode) return await fail(403, `limited to '${configured}'`);
      const scope = tenantScope(req);
      const rItems = Array.isArray(req.body?.returnItems) ? req.body.returnItems : [];
      const pItems = Array.isArray(req.body?.replacementItems) ? req.body.replacementItems : [];
      if (!rItems.length || !pItems.length) return await fail(400, "return + replacement required");
      for (const line of [...rItems, ...pItems]) {
        if (!Number.isFinite(Number(line?.quantity)) || Number(line.quantity) <= 0) return await fail(400, "qty > 0");
      }
      const requestKey = req.body?.requestKey != null ? String(req.body.requestKey).slice(0, 100) : null;
      if (requestKey) {
        const dup = await client.query(
          "SELECT id, return_number FROM stock_returns WHERE company_id=$1 AND request_key=$2",
          [companyId, requestKey]
        );
        if (dup.rows.length) {
          await client.query("ROLLBACK");
          return res.status(200).json({ success: true, duplicate: true,
            message: `Exchange ${dup.rows[0].return_number} already processed.`,
            data: { id: dup.rows[0].id, returnNumber: dup.rows[0].return_number } });
        }
      }
      let valued;
      try {
        valued = await valueReturnLeg(client, req, mode, rItems, companyId, scope.storeScoped ? scope.storeId : null);
        if (mode === "receipt") {
          await client.query(
            "SELECT id FROM sales WHERE id=$1 AND company_id=$2 FOR UPDATE",
            [valued.saleId, companyId]
          );
          valued = await valueReturnLeg(client, req, mode, rItems, companyId, scope.storeScoped ? scope.storeId : null);
        }
      } catch (e) { return await fail(e.statusCode || 400, e.message); }
      let replaced;
      try {
        replaced = await valueReplacementLeg(client, companyId, pItems);
      } catch (e) { return await fail(e.statusCode || 400, e.message); }
      const settlement = calculateExchangeSettlement(valued.total, replaced.total);
      const difference = settlement.difference;
      let paymentLines = [];
      try {
        if (difference > 0) paymentLines = settleTopUp(req.body, difference);
        else if (difference < 0 && mode === "receipt") {
          const payments = await loadSalePayments(client, valued.saleId);
          const totalPaid = round2(payments.reduce((s, p) => s + p.amount, 0));
          const already = await totalRefundedForSale(client, valued.saleId);
          if (Math.abs(difference) - round2(totalPaid - already) > 0.01) throw Object.assign(new Error("exceeds refundable"), { statusCode: 409 });
        }
      } catch (e) { return await fail(e.statusCode || 400, e.message); }
      const returnNumber = await nextReturnNumber(client, companyId);
      let persisted;
      try {
        persisted = await persistExchange(req, client, {
          companyId, exchangeStoreId: valued.storeId, mode, saleId: valued.saleId,
          returnLegs: valued.legs, replacementLegs: replaced.legs,
          returnTotal: valued.total, replacementTotal: replaced.total,
          difference, paymentLines, requestKey, returnNumber,
          customerId: valued.customerId,
        });
      } catch (e) { return await fail(e.statusCode || 400, e.message); }
      let canonicalTransactionId = null;
      if (typeof canonicalTransactionWriter === "function") {
        canonicalTransactionId = await canonicalTransactionWriter(client, {
          companyId,
          storeId: valued.storeId,
          userId: req.user.id,
          transactionType: "EXCHANGE",
          originalTransactionId: valued.saleId,
          referenceNumber: returnNumber,
          customerId: valued.customerId,
          subtotal: replaced.total - valued.total,
          tax: 0,
          total: difference,
          paymentSourceSaleId: persisted.replacementSaleId,
          relatedReferenceIds: [persisted.returnId, persisted.replacementSaleId],
          lines: [
            ...valued.legs.map((leg) => ({
              productId: leg.productId,
              productName: leg.product?.name || "Returned product",
              quantity: -Number(leg.quantity),
              unitPrice: Number(leg.unit) || 0,
              tax: 0,
              total: -(Number(leg.unit) || 0) * Number(leg.quantity),
            })),
            ...replaced.legs.map((leg) => ({
              productId: leg.product.id,
              productName: leg.product.name,
              quantity: Number(leg.quantity),
              unitPrice: Number(leg.unit) || 0,
              tax: Number(leg.tax) || 0,
              total: Number(leg.gross) || 0,
            })),
          ],
        });
        await client.query(
          "UPDATE stock_returns SET canonical_transaction_id=$1 WHERE id=$2",
          [canonicalTransactionId, persisted.returnId]
        );
      }
      if (typeof writeAudit === "function") {
        try {
          await writeAudit(companyId, req.user.id, "exchange.completed", "return", persisted.returnId,
            { mode, originalSaleId: valued.saleId, replacementSaleId: persisted.replacementSaleId,
                canonicalTransactionId,
              storeId: valued.storeId,
              returnTotal: valued.total, replacementTotal: replaced.total, difference, returnNumber });
        } catch { /* audit never fails */ }
      }
      await client.query("COMMIT");
      return res.status(201).json({ success: true, message: `Exchange ${returnNumber} completed.`,
        data: { id: persisted.returnId, returnNumber, mode, saleId: valued.saleId,
          replacementSaleId: persisted.replacementSaleId, replacementReceipt: persisted.replacementReceipt,
          returnTotal: valued.total, replacementTotal: replaced.total, difference,
          settlement: difference > 0 ? "charge" : difference < 0 ? "refund" : "even" } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      // eslint-disable-next-line no-console
      console.error("Exchange error:", error);
      const message = error.message || "Unable to process the exchange";
      if (message.includes("not found") || message.includes("already been")) return res.status(404).json({ success: false, message });
      if (message.includes("Insufficient stock")) return res.status(400).json({ success: false, message });
      if (message.includes("refund")) return res.status(409).json({ success: false, message });
      return res.status(400).json({ success: false, message });
    } finally {
      client.release();
    }
  });
}

// Backwards-compatible public export for callers/tests that historically
// imported the settlement helper from the route module. The implementation
// remains canonical in services/exchangeRules.js.
export { calculateExchangeSettlement } from "../services/exchangeRules.js";
