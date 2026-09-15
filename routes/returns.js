import express from "express";

export default function createReturnsRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
}) {
  const router = express.Router();

  async function createReturn(req, res, returnType) {
    const {
      saleId = null,
      purchaseId = null,
      items = [],
      reason = null,
      requestKey = null,
    } = req.body;
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ success: false, message: "At least one return line is required" });
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (requestKey) {
        const duplicate = await client.query("SELECT id FROM stock_returns WHERE company_id=$1 AND request_key=$2", [req.user.companyId, requestKey]);
        if (duplicate.rows.length) { await client.query("ROLLBACK"); return res.status(409).json({ success: false, message: "This return request has already been processed" }); }
      }

      let parent;
      if (returnType === "CUSTOMER") {
        parent = await client.query("SELECT id, store_id, customer_id FROM sales WHERE id=$1 AND company_id=$2 FOR UPDATE", [saleId, req.user.companyId]);
        if (!parent.rows.length || parent.rows[0].store_id !== req.user.storeId) throw new Error("Sale not found for this store");
      } else {
        parent = await client.query("SELECT id, store_id, supplier_id FROM purchases WHERE id=$1 AND company_id=$2 AND status='RECEIVED' FOR UPDATE", [purchaseId, req.user.companyId]);
        if (!parent.rows.length || parent.rows[0].store_id !== req.user.storeId) throw new Error("Purchase not found for this store");
      }

      const created = await client.query(
        `INSERT INTO stock_returns (company_id, store_id, return_type, sale_id, purchase_id, supplier_id, request_key, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [req.user.companyId, req.user.storeId, returnType, saleId, purchaseId, parent.rows[0].supplier_id || null, requestKey, reason || null, req.user.id]
      );
      const returnId = created.rows[0].id;
      let refundAmount = 0;
      let refundPaymentMethod = null;

      for (const item of items) {
        const quantity = Number(item.quantity);
        if (!item.productId || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Invalid return line");
        const sourceId = returnType === "CUSTOMER" ? item.saleItemId : item.purchaseItemId;
        const source = returnType === "CUSTOMER"
          ? await client.query("SELECT id, product_id, quantity, unit_price, discount, tax, total FROM sale_items WHERE id=$1 AND sale_id=$2", [sourceId, saleId])
          : await client.query("SELECT id, product_id, quantity FROM purchase_items WHERE id=$1 AND purchase_id=$2", [sourceId, purchaseId]);
        if (!source.rows.length || source.rows[0].product_id !== item.productId) throw new Error("Return line does not belong to the source transaction");
        const returned = await client.query(
          `SELECT COALESCE(SUM(sri.quantity),0) AS quantity FROM stock_return_items sri INNER JOIN stock_returns sr ON sr.id=sri.return_id WHERE sr.return_type=$1 AND sr.${returnType === "CUSTOMER" ? "sale_id" : "purchase_id"}=$2 AND sri.${returnType === "CUSTOMER" ? "sale_item_id" : "purchase_item_id"}=$3`,
          [returnType, returnType === "CUSTOMER" ? saleId : purchaseId, sourceId]
        );
        const remaining = Number(source.rows[0].quantity) - Number(returned.rows[0].quantity);
        if (quantity > remaining) throw new Error("Return quantity exceeds the remaining returnable quantity");
        await client.query("INSERT INTO stock_return_items (return_id, product_id, sale_item_id, purchase_item_id, quantity, reason) VALUES ($1,$2,$3,$4,$5,$6)", [returnId, item.productId, returnType === "CUSTOMER" ? sourceId : null, returnType === "SUPPLIER" ? sourceId : null, quantity, item.reason || null]);
        await createInventoryMovement(client, { companyId: req.user.companyId, productId: item.productId, storeId: req.user.storeId, movementType: returnType === "CUSTOMER" ? "RETURN_IN" : "RETURN_OUT", quantityChange: returnType === "CUSTOMER" ? quantity : -quantity, referenceType: returnType === "CUSTOMER" ? "SALE_RETURN" : "PURCHASE_RETURN", referenceId: returnId, reason: item.reason || reason, createdBy: req.user.id });
        if (returnType === "CUSTOMER") {
          const lineTotal = Number(source.rows[0].total) || 0;
          const lineQty = Number(source.rows[0].quantity) || 1;
          refundAmount += (lineTotal / lineQty) * quantity;
        }
      }

      if (returnType === "CUSTOMER" && refundAmount > 0) {
        const paymentResult = await client.query(
          "SELECT COALESCE(SUM(amount),0) AS total_paid, STRING_AGG(payment_method, ',') AS payment_methods FROM payments WHERE sale_id=$1 AND status='completed'",
          [saleId]
        );
        const totalPaid = Number(paymentResult.rows[0].total_paid) || 0;
        refundPaymentMethod = paymentResult.rows[0].payment_methods || null;
        const existingRefunds = await client.query(
          "SELECT COALESCE(SUM(amount),0) AS total FROM refunds WHERE sale_id=$1",
          [saleId]
        );
        const alreadyRefunded = Number(existingRefunds.rows[0].total) || 0;
        const remainingRefundable = totalPaid - alreadyRefunded;
        if (refundAmount > remainingRefundable) {
          throw new Error(`Refund amount ${refundAmount} exceeds the remaining refundable amount ${remainingRefundable}`);
        }
        await client.query(
          "INSERT INTO refunds (sale_id, user_id, amount, reason, payment_method) VALUES ($1,$2,$3,$4,$5)",
          [saleId, req.user.id, refundAmount, reason || null, refundPaymentMethod]
        );
      }

      await client.query("COMMIT");
      const responseData = { id: returnId };
      if (refundAmount > 0) responseData.refund = { amount: refundAmount, payment_method: refundPaymentMethod };
      res.status(201).json({ success: true, message: "Return processed", data: responseData });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Return error:", error);
      res.status(error.message.includes("not found") ? 404 : 400).json({ success: false, message: error.message });
    } finally { client.release(); }
  }

  router.get(
    "/returns",
    authenticate,
    authorize("sale.refund"),
    async (req, res) => {
      try { const result = await db("SELECT sr.id, sr.return_type, sr.sale_id, sr.purchase_id, sr.reason, sr.created_at, u.username AS created_by, COALESCE(s.receipt_number, p.reference_number) AS reference_number, p.supplier_name FROM stock_returns sr LEFT JOIN users u ON u.id=sr.created_by LEFT JOIN sales s ON s.id=sr.sale_id LEFT JOIN purchases p ON p.id=sr.purchase_id WHERE sr.company_id=$1 AND sr.store_id=$2 ORDER BY sr.created_at DESC LIMIT 500", [req.user.companyId, req.user.storeId]); res.json({ success: true, data: result.rows }); }
      catch (error) { res.status(500).json({ success: false, message: "Unable to load returns" }); }
    }
  );

  router.post(
    "/returns/customer",
    authenticate,
    authorize("sale.refund"),
    async (req, res) => createReturn(req, res, "CUSTOMER")
  );

  router.post(
    "/returns/supplier",
    authenticate,
    authorize("sale.refund"),
    async (req, res) => createReturn(req, res, "SUPPLIER")
  );

  router.get(
    "/supplier-returns/available",
    authenticate,
    authorize("sale.refund"),
    async (req, res) => {
      try {
        const result = await db(`SELECT p.id AS purchase_id, p.reference_number, p.purchase_date, p.supplier_name, pi.id AS purchase_item_id, pi.product_id, pr.name AS product_name, pi.quantity AS received_quantity, COALESCE((SELECT SUM(ri.quantity) FROM stock_return_items ri INNER JOIN stock_returns r ON r.id=ri.return_id WHERE r.return_type='SUPPLIER' AND r.purchase_id=p.id AND ri.purchase_item_id=pi.id),0) AS returned_quantity FROM purchases p INNER JOIN purchase_items pi ON pi.purchase_id=p.id INNER JOIN products pr ON pr.id=pi.product_id WHERE p.company_id=$1 AND p.store_id=$2 AND p.status='RECEIVED' ORDER BY p.purchase_date DESC, p.created_at DESC`, [req.user.companyId, req.user.storeId]);
        res.json({ success: true, data: result.rows.map((row) => ({ ...row, received_quantity: Number(row.received_quantity), returned_quantity: Number(row.returned_quantity), remaining_quantity: Number(row.received_quantity) - Number(row.returned_quantity) })) });
      } catch (error) { console.error("Load supplier returns error:", error); res.status(500).json({ success: false, message: "Unable to load supplier return options" }); }
    }
  );

  return router;
}
