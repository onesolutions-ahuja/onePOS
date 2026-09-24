const TRANSACTION_TYPES = new Set(["SALE", "RETURN", "EXCHANGE"]);

function numeric(value) {
  return Number(value || 0);
}

function assertTransactionType(type) {
  const normalized = String(type || "").toUpperCase();
  if (!TRANSACTION_TYPES.has(normalized)) {
    throw new Error(`Unsupported canonical transaction type: ${normalized}`);
  }
  return normalized;
}

export async function syncCanonicalSaleTransaction(client, {
  saleId,
  companyId,
  storeId,
  transactionType = "SALE",
  originalTransactionId = null,
}) {
  const type = assertTransactionType(transactionType);
  const saleResult = await client.query(
    `SELECT id, company_id, store_id, customer_id, receipt_number, subtotal, tax, total
       FROM sales WHERE id=$1 AND company_id=$2 FOR UPDATE`,
    [saleId, companyId]
  );
  const sale = saleResult.rows[0];
  if (!sale || (storeId && sale.store_id !== storeId)) {
    throw new Error("Canonical transaction does not belong to this company/store");
  }
  if (originalTransactionId) {
    const original = await client.query(
      "SELECT id FROM sales WHERE id=$1 AND company_id=$2 AND store_id=$3 LIMIT 1",
      [originalTransactionId, companyId, sale.store_id]
    );
    if (!original.rows.length) throw new Error("Original transaction is outside the company/store scope");
  }
  await client.query(
    `UPDATE sales SET transaction_type=$1, original_transaction_id=$2, net_amount=$3
      WHERE id=$4 AND company_id=$5`,
    [type, originalTransactionId, numeric(sale.subtotal), saleId, companyId]
  );
  const payments = await client.query(
    "SELECT id, amount FROM payments WHERE sale_id=$1 OR transaction_id=$1 ORDER BY created_at,id",
    [saleId]
  );
  for (const payment of payments.rows) {
    await client.query(
      `UPDATE payments
          SET company_id=$1, store_id=$2, customer_id=$3, transaction_id=$4,
              direction=$5, reference=COALESCE(reference,$6)
        WHERE id=$7`,
      [companyId, sale.store_id, sale.customer_id, saleId, type === "RETURN" ? "OUT" : "IN", sale.receipt_number, payment.id]
    );
    await client.query(
      `INSERT INTO financial_ledger_entries
        (company_id,store_id,transaction_id,payment_id,customer_id,transaction_type,
         debit,credit,amount,net_amount,vat_amount,reference,status,description,idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'POSTED',$13,$14)
       ON CONFLICT (company_id,idempotency_key) DO NOTHING`,
      [companyId, sale.store_id, saleId, payment.id, sale.customer_id, type,
        type === "RETURN" ? numeric(payment.amount) : 0,
        type === "RETURN" ? 0 : numeric(payment.amount), numeric(payment.amount),
        numeric(sale.subtotal), numeric(sale.tax), sale.receipt_number,
        `${type} payment`, `payment:${payment.id}:${type}`]
    );
  }
  await client.query(
    `INSERT INTO financial_ledger_entries
      (company_id,store_id,transaction_id,customer_id,transaction_type,
       debit,credit,amount,net_amount,vat_amount,reference,status,description,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'POSTED',$12,$13)
     ON CONFLICT (company_id,idempotency_key) DO NOTHING`,
    [companyId, sale.store_id, saleId, sale.customer_id, type, Math.abs(numeric(sale.total)),
    type === "RETURN" ? 0 : Math.abs(numeric(sale.total)), Math.abs(numeric(sale.total)),
    Math.abs(numeric(sale.subtotal)), Math.abs(numeric(sale.tax)), sale.receipt_number,
      `${type} transaction`, `transaction:${saleId}:${type}`]
  );
  return { saleId, transactionType: type, paymentCount: payments.rows.length };
}

export async function createCanonicalRelatedTransaction(client, {
  companyId, storeId, userId, transactionType, originalTransactionId,
  referenceNumber, customerId = null, subtotal = 0, tax = 0, discount = 0,
  total = 0, lines = [], paymentSourceSaleId = null,
  relatedReferenceIds = [],
}) {
  const type = assertTransactionType(transactionType);
  const original = await client.query(
    "SELECT id, store_id FROM sales WHERE id=$1 AND company_id=$2 LIMIT 1",
    [originalTransactionId, companyId]
  );
  if (!original.rows.length || original.rows[0].store_id !== storeId) {
    throw new Error("Original transaction is outside the company/store scope");
  }
  const inserted = await client.query(
    `INSERT INTO sales
      (company_id,store_id,user_id,customer_id,receipt_number,transaction_type,
       original_transaction_id,subtotal,tax,discount,total,net_amount,status,completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$8,'completed',NOW())
     RETURNING id`,
    [companyId, storeId, userId, customerId, referenceNumber, type, originalTransactionId,
      numeric(subtotal), numeric(tax), numeric(discount), numeric(total)]
  );
  const transactionId = inserted.rows[0].id;
  const referenceIds = [...new Set([...(relatedReferenceIds || []), paymentSourceSaleId].filter(Boolean))];
  if (referenceIds.length) {
    await client.query(
      `UPDATE inventory_movements
          SET transaction_id=$1
        WHERE company_id=$2 AND reference_id = ANY($3::uuid[])`,
      [transactionId, companyId, referenceIds]
    );
  }
  for (const line of lines) {
    await client.query(
      `INSERT INTO sale_items
        (sale_id,product_id,product_name,quantity,unit_price,discount,tax,total,item_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PRODUCT')`,
      [transactionId, line.productId, line.productName || "Product", numeric(line.quantity),
        numeric(line.unitPrice), numeric(line.discount), numeric(line.tax), numeric(line.total)]
    );
  }
  if (paymentSourceSaleId) {
    await client.query(
      `UPDATE payments SET transaction_id=$1, company_id=$2, store_id=$3
        WHERE sale_id=$4 AND company_id IS NULL`,
      [transactionId, companyId, storeId, paymentSourceSaleId]
    );
  }
  await syncCanonicalSaleTransaction(client, {
    saleId: transactionId, companyId, storeId, transactionType: type, originalTransactionId,
  });
  return transactionId;
}
