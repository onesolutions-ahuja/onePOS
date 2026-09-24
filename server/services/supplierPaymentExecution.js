import { invoiceStatus } from "./supplierAccounts.js";

export async function executeSupplierPayment({ client, companyId, userId, defaultStoreId = null, input = {} }) {
  if (!client || typeof client.query !== "function") throw new Error("Database transaction is required");
  const amount = Number(input.amount);
  if (!input.supplierId || !Number.isFinite(amount) || amount <= 0) throw new Error("Supplier and positive payment amount are required");
  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 100) : null;
  if (idempotencyKey) {
    const existing = await client.query("SELECT id FROM supplier_payments WHERE company_id=$1 AND idempotency_key=$2", [companyId, idempotencyKey]);
    if (existing.rows.length) { const e = new Error("Payment request has already been processed"); e.code = "DUPLICATE_PAYMENT"; e.paymentId = existing.rows[0].id; throw e; }
  }
  const supplier = await client.query("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND active=true", [input.supplierId, companyId]);
  if (!supplier.rows.length) throw new Error("Supplier not found");
  const storeId = input.storeId || defaultStoreId || null;
  const payment = await client.query(`INSERT INTO supplier_payments
    (company_id,supplier_id,store_id,amount,payment_date,payment_method,reference,notes,idempotency_key,created_by)
    VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10) RETURNING *`,
    [companyId,input.supplierId,storeId,amount,input.paymentDate || null,input.paymentMethod || null,input.reference || null,input.notes || null,idempotencyKey,userId]);
  let remaining = amount;
  for (const allocation of Array.isArray(input.allocations) ? input.allocations : []) {
    const alloc = Number(allocation.amount);
    if (!Number.isFinite(alloc) || alloc <= 0 || alloc > remaining) throw new Error("Invalid payment allocation");
    const invoice = await client.query(`SELECT i.id,i.total,COALESCE(SUM(a.amount),0) AS paid FROM supplier_invoices i
      LEFT JOIN supplier_payment_allocations a ON a.invoice_id=i.id
      WHERE i.id=$1 AND i.company_id=$2 AND i.supplier_id=$3 GROUP BY i.id FOR UPDATE`, [allocation.invoiceId,companyId,input.supplierId]);
    if (!invoice.rows.length || alloc > Number(invoice.rows[0].total) - Number(invoice.rows[0].paid)) throw new Error("Payment allocation exceeds invoice balance");
    await client.query("INSERT INTO supplier_payment_allocations (payment_id,invoice_id,amount) VALUES ($1,$2,$3)", [payment.rows[0].id,allocation.invoiceId,alloc]);
    remaining = Math.round((remaining - alloc + Number.EPSILON) * 100) / 100;
    await client.query("UPDATE supplier_invoices SET status=$1,updated_at=NOW() WHERE id=$2", [invoiceStatus(Number(invoice.rows[0].total), Number(invoice.rows[0].paid) + alloc), allocation.invoiceId]);
  }
  await client.query(`INSERT INTO supplier_ledger_entries
    (company_id,supplier_id,store_id,entry_type,reference_type,reference_id,amount,debit,description,created_by)
    VALUES ($1,$2,$3,'PAYMENT','SUPPLIER_PAYMENT',$4,$5,false,'Supplier payment',$6)`, [companyId,input.supplierId,storeId,payment.rows[0].id,amount,userId]);
  return payment.rows[0];
}
