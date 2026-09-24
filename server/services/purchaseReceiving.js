import { upsertBatchRow } from "./inventory.js";
import { planReceipt } from "./purchasing.js";
import { resolveBatchEntry, normaliseBatchPolicy } from "./batchPolicy.js";

export async function receivePurchase({ client, purchaseId, companyId, userId, storeId, requestedItems = null, receiptMeta = {}, createInventoryMovement }) {
  if (!client || typeof client.query !== "function") throw new Error("Database transaction is required");
  if (typeof createInventoryMovement !== "function") throw new Error("Inventory movement capability is required");
  const purchaseResult = await client.query(`SELECT id, store_id, status FROM purchases WHERE id=$1 AND company_id=$2 FOR UPDATE`, [purchaseId, companyId]);
  if (!purchaseResult.rows.length) throw new Error("Purchase not found");
  const purchase = purchaseResult.rows[0];
  if (purchase.status === "RECEIVED") { const e = new Error("Purchase has already been received"); e.code = "ALREADY_RECEIVED"; throw e; }
  if (purchase.status === "CANCELLED") throw new Error("Cancelled purchases cannot be received");
  const lines = await client.query(`SELECT pi.id AS purchase_item_id, pi.product_id, pi.quantity, pi.received_quantity, pi.unit_cost,
    p.batch_tracking, pi.batch_number, pi.manufacturing_date, pi.expiry_date
    FROM purchase_items pi INNER JOIN products p ON p.id=pi.product_id WHERE pi.purchase_id=$1 ORDER BY pi.id`, [purchaseId]);
  if (!lines.rows.length) throw new Error("Purchase has no product lines");
  const policyResult = await client.query("SELECT batch_inventory_mode, batch_default_mfg_rule, batch_default_expiry_rule, batch_default_expiry_days FROM company_settings WHERE company_id=$1", [companyId]);
  const policy = normaliseBatchPolicy(policyResult.rows[0]);
  const receiptLines = [];
  for (const line of planReceipt(lines.rows, requestedItems)) {
    const batch = resolveBatchEntry(policy, { productBatchTracking: line.batch_tracking, batchNumber: line.batch_number, manufacturingDate: line.manufacturing_date, expiryDate: line.expiry_date });
    await createInventoryMovement(client, { companyId, productId: line.product_id, storeId: purchase.store_id || storeId, movementType: "PURCHASE", quantityChange: line.quantity, referenceType: "PURCHASE", referenceId: purchaseId, createdBy: userId });
    if (line.batch_tracking) await upsertBatchRow(client, { companyId, storeId: purchase.store_id || storeId, productId: line.product_id, batchNumber: batch.batchNumber, manufacturingDate: batch.manufacturingDate, manufacturingDateSource: batch.manufacturingDateSource, expiryDate: batch.expiryDate, expiryDateSource: batch.expiryDateSource, quantity: line.quantity });
    receiptLines.push(line);
  }
  if (!receiptLines.length) throw new Error("No remaining quantity to receive");
  const receipt = await client.query(`INSERT INTO purchase_receipts (company_id,purchase_id,store_id,received_by,reference_number,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,received_at`, [companyId,purchaseId,purchase.store_id || storeId,userId,receiptMeta.referenceNumber || null,receiptMeta.notes || null]);
  for (const line of receiptLines) {
    await client.query(`INSERT INTO purchase_receipt_items (receipt_id,purchase_item_id,product_id,quantity,unit_cost,batch_number,manufacturing_date,expiry_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [receipt.rows[0].id,line.purchase_item_id,line.product_id,line.quantity,line.unit_cost,line.batch_number || null,line.manufacturing_date || null,line.expiry_date || null]);
    await client.query(`UPDATE purchase_items SET received_quantity=received_quantity+$1 WHERE id=$2 AND purchase_id=$3`, [line.quantity,line.purchase_item_id,purchaseId]);
  }
  const remaining = await client.query(`SELECT COUNT(*)::int AS open_lines FROM purchase_items WHERE purchase_id=$1 AND received_quantity < quantity`, [purchaseId]);
  const status = Number(remaining.rows[0].open_lines) === 0 ? "RECEIVED" : "PARTIALLY_RECEIVED";
  const updated = await client.query(`UPDATE purchases SET status=$1,received_by=$2,received_at=CASE WHEN $1='RECEIVED' THEN NOW() ELSE received_at END,updated_at=NOW() WHERE id=$3 AND company_id=$4 AND status IN ('DRAFT','PARTIALLY_RECEIVED')`, [status,userId,purchaseId,companyId]);
  if (updated.rowCount !== 1) { const e = new Error("Purchase has already been received"); e.code = "ALREADY_RECEIVED"; throw e; }
  return { receipt: receipt.rows[0], status, lines: receiptLines };
}
