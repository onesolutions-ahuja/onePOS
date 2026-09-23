import express from "express";
import { PAYMENT_METHODS } from "./sales.js";

/*
 * Layaways deliberately use the same sale, payment and inventory tables as a
 * normal checkout.  The layaway tables are only the reservation/collection
 * ledger; no stock is deducted until the layaway is completed.
 */
export const LAYAWAY_PAYMENT_METHODS = PAYMENT_METHODS;

export default function createLayawaysRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
}) {
  const router = express.Router();
  const money = (value) => Math.round(Number(value || 0) * 100) / 100;
  const normalizePaymentMethod = (value) => {
    const method = String(value || "").trim();
    return LAYAWAY_PAYMENT_METHODS.includes(method) ? method : null;
  };

  router.get("/layaways", authenticate, authorize("layaway.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT l.*, c.name AS customer_name, u.username AS created_by_name
         FROM layaways l
         LEFT JOIN customers c ON c.id = l.customer_id
         LEFT JOIN users u ON u.id = l.created_by
         WHERE l.company_id = $1 AND l.store_id = $2
         ORDER BY l.created_at DESC LIMIT 500`,
        [req.user.companyId, req.user.storeId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("List layaways error:", error);
      res.status(500).json({ success: false, message: "Unable to load layaways" });
    }
  });

  router.get("/layaways/:id", authenticate, authorize("layaway.view"), async (req, res) => {
    try {
      const layaway = await db(
        `SELECT l.*, c.name AS customer_name, c.phone AS customer_phone
         FROM layaways l LEFT JOIN customers c ON c.id = l.customer_id
         WHERE l.id = $1 AND l.company_id = $2 AND l.store_id = $3`,
        [req.params.id, req.user.companyId, req.user.storeId]
      );
      if (!layaway.rows.length) return res.status(404).json({ success: false, message: "Layaway not found" });
      const items = await db("SELECT * FROM layaway_items WHERE layaway_id = $1 ORDER BY id", [req.params.id]);
      const payments = await db(
        "SELECT id, payment_method, amount, provider, provider_transaction_id, status, created_at FROM layaway_payments WHERE layaway_id = $1 ORDER BY created_at",
        [req.params.id]
      );
      res.json({ success: true, data: { ...layaway.rows[0], items: items.rows, payments: payments.rows } });
    } catch (error) {
      console.error("Get layaway error:", error);
      res.status(500).json({ success: false, message: "Unable to load layaway" });
    }
  });

  router.post("/layaways", authenticate, authorize("layaway.create"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const { items = [], customerId = null, deposit = 0, paymentMethod = null, dueDate = null, notes = null } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, message: "At least one item is required" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (customerId) {
        const customer = await client.query(
          "SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND active = true",
          [customerId, req.user.companyId]
        );
        if (!customer.rows.length) throw Object.assign(new Error("Customer not found"), { statusCode: 400 });
      }
      const normalized = [];
      for (const item of items) {
        const quantity = Number(item.quantity);
        if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error("Invalid item"), { statusCode: 400 });
        const product = await client.query(
          `SELECT id, name, price, vat_rate, track_stock FROM products
           WHERE id = $1 AND company_id = $2 AND active = true FOR UPDATE`,
          [item.productId, req.user.companyId]
        );
        if (!product.rows.length) throw Object.assign(new Error("Product not found"), { statusCode: 400 });
        const p = product.rows[0];
        // Prices and VAT are authoritative catalogue values; client values are
        // intentionally ignored to prevent discounted/under-taxed deposits.
        const unitPrice = money(p.price);
        const tax = money(quantity * unitPrice * Number(p.vat_rate || 0) / 100);
        const total = money(quantity * unitPrice + tax);
        normalized.push({ productId: p.id, productName: p.name, quantity, unitPrice, tax, total, trackStock: p.track_stock !== false });
      }
      const total = money(normalized.reduce((sum, item) => sum + item.total, 0));
      const initialDeposit = money(deposit);
      if (initialDeposit < 0 || initialDeposit > total) throw Object.assign(new Error("Deposit must be between zero and the total"), { statusCode: 400 });
      const initialPaymentMethod = initialDeposit > 0 ? normalizePaymentMethod(paymentMethod) : null;
      if (initialDeposit > 0 && !initialPaymentMethod) throw Object.assign(new Error(`paymentMethod must be one of ${LAYAWAY_PAYMENT_METHODS.join(", ")}`), { statusCode: 400 });
      const created = await client.query(
        `INSERT INTO layaways
          (company_id, store_id, customer_id, created_by, total, paid_amount, balance, due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$5::numeric-$6::numeric,$7,$8)
         RETURNING *`,
        [req.user.companyId, req.user.storeId, customerId, req.user.id, total, initialDeposit, dueDate, notes]
      );
      const layaway = created.rows[0];
      for (const item of normalized) {
        await client.query(
          `INSERT INTO layaway_items (layaway_id, product_id, product_name, quantity, unit_price, tax, total, track_stock)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [layaway.id, item.productId, item.productName, item.quantity, item.unitPrice, item.tax, item.total, item.trackStock]
        );
      }
      if (initialDeposit > 0) {
        await client.query(
          `INSERT INTO layaway_payments
             (layaway_id, company_id, store_id, user_id, payment_method, amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [layaway.id, req.user.companyId, req.user.storeId, req.user.id, initialPaymentMethod, initialDeposit]
        );
      }
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: layaway });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Create layaway error:", error);
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Unable to create layaway" });
    } finally {
      client.release();
    }
  });

  router.post("/layaways/:id/payments", authenticate, authorize("layaway.payment"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const amount = money(req.body?.amount);
    const paymentMethod = normalizePaymentMethod(req.body?.paymentMethod);
    if (!(amount > 0) || !paymentMethod) return res.status(400).json({ success: false, message: `A positive amount and paymentMethod are required; method must be one of ${LAYAWAY_PAYMENT_METHODS.join(", ")}` });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT * FROM layaways WHERE id=$1 AND company_id=$2 AND store_id=$3 FOR UPDATE",
        [req.params.id, req.user.companyId, req.user.storeId]
      );
      if (!found.rows.length) throw Object.assign(new Error("Layaway not found"), { statusCode: 404 });
      const layaway = found.rows[0];
      if (layaway.status !== "OPEN") throw Object.assign(new Error("Layaway is not open"), { statusCode: 409 });
      const balance = money(layaway.balance);
      if (amount > balance) throw Object.assign(new Error("Payment exceeds outstanding balance"), { statusCode: 400 });
      const payment = await client.query(
        `INSERT INTO layaway_payments
           (layaway_id, company_id, store_id, user_id, payment_method, amount, provider, provider_transaction_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.params.id, req.user.companyId, req.user.storeId, req.user.id, paymentMethod, amount, req.body.provider || null, req.body.providerTransactionId || null]
      );
      const updated = await client.query(
        `UPDATE layaways SET paid_amount = paid_amount + $1, balance = balance - $1,
           updated_at = NOW()
         WHERE id=$2 AND status='OPEN' AND balance >= $1
         RETURNING *`,
        [amount, req.params.id]
      );
      if (!updated.rows.length) {
        throw Object.assign(new Error("Payment exceeds outstanding balance"), { statusCode: 400 });
      }
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: { layaway: updated.rows[0], payment: payment.rows[0] } });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Unable to record payment" });
    } finally { client.release(); }
  });

  router.post("/layaways/:id/cancel", authenticate, authorize("layaway.cancel"), async (req, res) => {
    try {
      const result = await db(
        `UPDATE layaways SET status = 'CANCELLED', updated_at = NOW()
         WHERE id = $1 AND company_id = $2 AND store_id = $3 AND status = 'OPEN'
         RETURNING *`,
        [req.params.id, req.user.companyId, req.user.storeId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Open layaway not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Cancel layaway error:", error);
      res.status(500).json({ success: false, message: "Unable to cancel layaway" });
    }
  });

  router.post("/layaways/:id/complete", authenticate, authorize("layaway.complete"), async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM layaways WHERE id=$1 AND company_id=$2 AND store_id=$3 FOR UPDATE", [req.params.id, req.user.companyId, req.user.storeId]);
      if (!found.rows.length) throw Object.assign(new Error("Layaway not found"), { statusCode: 404 });
      const layaway = found.rows[0];
      if (layaway.status !== "OPEN" || money(layaway.balance) !== 0) throw Object.assign(new Error("Layaway must be fully paid before completion"), { statusCode: 409 });
      const items = await client.query("SELECT * FROM layaway_items WHERE layaway_id=$1 ORDER BY id", [layaway.id]);
      const dateKeyResult = await client.query(
        "SELECT to_char(timezone(COALESCE((SELECT timezone FROM companies WHERE id = $1), 'UTC'), NOW()), 'YYYYMMDD') AS date_key",
        [layaway.company_id]
      );
      const dateKey = dateKeyResult.rows[0].date_key;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${layaway.company_id}:layaway:${dateKey}`]);
      const prefixResult = await client.query(
        "SELECT COALESCE(NULLIF(TRIM(till_invoice_prefix), ''), 'TO') AS prefix FROM company_settings WHERE company_id = $1",
        [layaway.company_id]
      );
      const prefix = prefixResult.rows[0]?.prefix || "TO";
      const sequence = await client.query(
        `SELECT COALESCE(MAX(NULLIF(split_part(receipt_number, '-', 3), '')::int), 0) + 1 AS next_number
         FROM sales WHERE company_id = $1 AND receipt_number LIKE $2`,
        [layaway.company_id, `${prefix}-${dateKey}-%`]
      );
      const receiptNumber = `${prefix}-${dateKey}-${String(sequence.rows[0].next_number).padStart(4, "0")}`;
      const sale = await client.query(
        `INSERT INTO sales (company_id, store_id, user_id, customer_id, receipt_number, subtotal, tax, total, status, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed',NOW()) RETURNING *`,
        [layaway.company_id, layaway.store_id, req.user.id, layaway.customer_id,
          receiptNumber,
          money(Number(layaway.total) - items.rows.reduce((s, i) => s + Number(i.tax), 0)),
          items.rows.reduce((s, i) => s + Number(i.tax), 0), layaway.total]
      );
      const payments = await client.query("SELECT * FROM layaway_payments WHERE layaway_id=$1 AND status='completed'", [layaway.id]);
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, tax, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [sale.rows[0].id, item.product_id, item.product_name, item.quantity, item.unit_price, item.tax, item.total]
        );
        if (item.track_stock !== false) {
          await createInventoryMovement(client, {
            companyId: layaway.company_id, storeId: layaway.store_id, productId: item.product_id,
            movementType: "SALE", quantityChange: -Number(item.quantity), referenceType: "sale",
            referenceId: sale.rows[0].id, createdBy: req.user.id,
          });
        }
      }
      for (const payment of payments.rows) {
        await client.query(
          `INSERT INTO payments (sale_id, payment_method, amount, provider, provider_transaction_id, status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [sale.rows[0].id, payment.payment_method, payment.amount, payment.provider, payment.provider_transaction_id, payment.status]
        );
      }
      await client.query(
        "UPDATE layaways SET status='COMPLETED', completed_sale_id=$1, completed_at=NOW(), completed_by=$2, updated_at=NOW() WHERE id=$3",
        [sale.rows[0].id, req.user.id, layaway.id]
      );
      await client.query("COMMIT");
      res.json({ success: true, data: { sale: sale.rows[0] } });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Unable to complete layaway" });
    } finally { client.release(); }
  });
  return router;
}
