/*
 * T10W - Accounting Integration Foundation (provider-neutral export layer).
 *
 * OnePOS remains the source of truth for sales, sale lines, VAT, payments,
 * refunds/returns, purchases, purchase VAT, suppliers, customers, customer
 * credit/ledger and stock movements. This module only NORMALISES that existing
 * data into a provider-neutral shape suitable for export to an external
 * accounting provider. It does NOT create a second accounting system.
 *
 * Idempotency: every normalized record carries its source OnePOS entity id.
 * No new table is introduced for the foundation - the existing
 * integration_api_logs table (entity_type + entity_id + company_id + store_id)
 * is used to record export attempts when a caller chooses to persist state.
 *
 * VAT/tax: preserves VAT rate, VAT amount, net amount, gross amount and VAT
 * applicability from existing OnePOS data. Compatible with Epos Now migration.
 *
 * Multi-store/company isolation: every loader is company-scoped and, where the
 * session carries a store, store-scoped.
  */

export function vatCategoryLabel(vatRate, vatApplicable) {
  if (vatApplicable === false || vatApplicable === null || vatApplicable === undefined) {
    return "VAT_EXEMPT";
  }
  const r = Number(vatRate);
  if (!Number.isFinite(r)) return "VAT_STANDARD";
  if (r === 0) return "VAT_ZERO";
  if (r <= 5) return "VAT_REDUCED";
  return "VAT_STANDARD";
}




export function normalizeCustomerCreditTransaction(tx, customer = null) {
  if (!tx) return null;
  const amount = money(tx.amount);
  const balanceAfter = money(tx.balance_after);
  const isDebit = amount < 0;
  const isCredit = amount > 0;

  return {
    source_type: "customer_credit",
    source_id: tx.id,
    customer_id: tx.customer_id,
    customer_name: customer ? customer.name : null,
    transaction_type: tx.transaction_type || null,
    is_debit: isDebit,
    is_credit: isCredit,
    amount: Math.abs(amount),
    debit_amount: isDebit ? Math.abs(amount) : 0,
    credit_amount: isCredit ? amount : 0,
    balance_after: balanceAfter,
    reference_type: tx.reference_type || null,
    reference_id: tx.reference_id || null,
    description: tx.description || null,
    transaction_date: tx.created_at || null,
    created_by: tx.created_by || null,
  };
}

export function loyaltyTransactionShape(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    transaction_type: row.transaction_type,
    amount: row.amount,
    balance_after: row.balance_after,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export const ACCOUNTING_ENTITY_TYPES = {
  SALE: "accounting_export:sale",
  PURCHASE: "accounting_export:purchase",
  REFUND: "accounting_export:refund",
  CUSTOMER_CREDIT: "accounting_export:customer_credit",
};

export function sourceIdColumnFor(entityType) {
  switch (entityType) {
    case ACCOUNTING_ENTITY_TYPES.SALE:
      return "sale_id";
    case ACCOUNTING_ENTITY_TYPES.PURCHASE:
      return "purchase_id";
    case ACCOUNTING_ENTITY_TYPES.REFUND:
      return "return_id";
    case ACCOUNTING_ENTITY_TYPES.CUSTOMER_CREDIT:
      return "loyalty_transaction_id";
    default:
      return "entity_id";
  }
}

export function idempotencyLookupParams(entityType, sourceId, companyId, storeId = null) {
  return {
    entity_type: entityType,
    entity_id: sourceId,
    company_id: companyId,
    store_id: storeId || null,
  };
}
export function normalizeRefund(refund, originalSale = null, returnRow = null) {
  const ref = refund || returnRow;
  if (!ref) return null;

  const amount = money(ref.amount || ref.refund_amount || 0);
  const grossRefund = amount;

  let vatRefund = 0;
  let netRefund = amount;

  if (originalSale && amount > 0) {
    const originalTotal = Number(originalSale.total) || 0;
    const originalTax = Number(originalSale.tax) || 0;
    if (originalTotal > 0) {
      vatRefund = money((amount / originalTotal) * originalTax);
      vatRefund = Math.min(vatRefund, originalTax);
    }
    netRefund = money(amount - vatRefund);
  }

  let originalSaleReference = null;
  let originalSaleId = null;
  if (ref.sale_id) {
    originalSaleId = ref.sale_id;
    if (originalSale) {
      originalSaleReference = originalSale.receipt_number || null;
    }
  }

  return {
    source_type: "refund",
    source_id: ref.id,
    original_sale_id: originalSaleId,
    original_sale_reference: originalSaleReference,
    original_sale_store_id: originalSale ? originalSale.store_id : null,
    refund_reference: ref.return_number || null,
    refund_date: ref.created_at || null,
    refund_status: ref.status || "COMPLETED",
    net_refund: netRefund,
    vat_refund: vatRefund,
    gross_refund: grossRefund,
    refund_method: (ref.payment_method || ref.refund_method || null) && String(ref.payment_method || ref.refund_method).trim() || null,
    customer_id: originalSale ? originalSale.customer_id : null,
    customer_name: originalSale ? originalSale.customer_name : null,
    metadata: {
      reason: ref.reason || null,
      sale_id: ref.sale_id || null,
      purchase_id: ref.purchase_id || null,
      supplier_id: ref.supplier_id || null,
    },
  };
}

export function refundShape(row) {
  return {
    id: row.id,
    sale_id: row.sale_id,
    amount: row.amount,
    payment_method: row.payment_method,
    reason: row.reason,
    return_id: row.return_id,
    created_at: row.created_at,
  };
}

export function stockReturnShape(row) {
  return {
    id: row.id,
    return_number: row.return_number,
    sale_id: row.sale_id,
    purchase_id: row.purchase_id,
    supplier_id: row.supplier_id,
    refund_amount: row.refund_amount,
    refund_method: row.refund_method,
    reason: row.reason,
    status: row.status,
    created_at: row.created_at,
  };
}
export function normalizePurchase(purchase, purchaseItems = [], supplier = null) {
  const sub = money(purchase.subtotal);
  const total = money(purchase.total);
  const net = sub;
  const gross = total;
  const inputVat = money(total - sub);

  const lines = (purchaseItems || []).map((item) => {
    const productVatRate = Number(item.vat_rate) || 0;
    const productVatApplicable = item.vat_applicable !== false;
    const lineNet = money(item.line_total - (item.line_tax || 0));
    const lineVat = money(item.line_tax || 0);
    const lineGross = money(item.line_total);
    return {
      product_id: item.product_id,
      product_sku: item.sku || null,
      product_barcode: item.barcode || null,
      product_name: item.product_name || null,
      quantity: money(item.quantity),
      unit_cost: money(item.unit_cost),
      line_net: lineNet,
      line_vat: lineVat,
      line_gross: lineGross,
      vat_rate: productVatRate,
      vat_category: vatCategoryLabel(productVatRate, productVatApplicable),
      vat_applicable: productVatApplicable,
    };
  });

  return {
    source_type: "purchase",
    source_id: purchase.id,
    supplier_id: purchase.supplier_id || null,
    supplier_name: supplier ? supplier.name : purchase.supplier_name || null,
    supplier_reference: purchase.reference_number || null,
    document_date: purchase.purchase_date || purchase.created_at || null,
    document_status: purchase.status || "DRAFT",
    received_at: purchase.received_at || null,
    net_purchase: net,
    input_vat: inputVat,
    gross_purchase: gross,
    lines,
    metadata: {
      notes: purchase.notes || null,
    },
  };
}

export function purchaseShape(row) {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    supplier_name: row.supplier_name,
    reference_number: row.reference_number,
    purchase_date: row.purchase_date,
    subtotal: row.subtotal,
    total: row.total,
    status: row.status,
    received_at: row.received_at,
    notes: row.notes,
  };
}

export function purchaseItemShape(row) {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
    line_total: row.line_total,
    line_tax: row.line_tax || 0,
    sku: row.sku || null,
    barcode: row.barcode || null,
    vat_rate: row.vat_rate || 0,
    vat_applicable: row.vat_applicable !== false,
  };
}

export function supplierShape(row) {
  return row
    ? {
        id: row.id,
        name: row.name,
        contact_name: row.contact_name || null,
        email: row.email || null,
        phone: row.phone || null,
        address: row.address || null,
      }
    : null;
}
export function normalizeSale(sale, saleItems = [], payments = [], customer = null, store = null) {
  const sub = money(sale.subtotal);
  const tax = money(sale.tax);
  const total = money(sale.total);
  const gross = total;
  const net = sub;

  const paymentMethods = payments
    .filter((p) => p.payment_method)
    .reduce((acc, p) => {
      const m = String(p.payment_method).trim();
      if (!m) return acc;
      acc[m] = (acc[m] || 0) + money(p.amount);
      return acc;
    }, {});

  const paymentSummary = Object.keys(paymentMethods).length
    ? Object.entries(paymentMethods).map(([method, amount]) => ({
        payment_method: method,
        amount,
      }))
    : (payments[0] ? [{ payment_method: payments[0].payment_method, amount: money(payments[0].amount) }] : []);

  const lines = (saleItems || []).map((item) => {
    const productVatRate = Number(item.vat_rate) || Number(item.tax_rate) || 0;
    const productVatApplicable = item.vat_applicable !== undefined ? item.vat_applicable : true;
    const lineNet = money(item.total - (item.tax || 0));
    const lineVat = money(item.tax || 0);
    const lineGross = money(item.total);
    return {
      product_id: item.product_id,
      product_sku: item.sku || null,
      product_barcode: item.barcode || null,
      product_name: item.product_name || item.name,
      quantity: money(item.quantity),
      unit_price: money(item.unit_price),
      discount: money(item.discount || 0),
      line_net: lineNet,
      line_vat: lineVat,
      line_gross: lineGross,
      vat_rate: productVatRate,
      vat_category: vatCategoryLabel(productVatRate, productVatApplicable),
      vat_applicable: productVatApplicable === true,
    };
  });

  return {
    source_type: "sale",
    source_id: sale.id,
    document_reference: sale.receipt_number || null,
    document_date: sale.created_at || null,
    document_status: sale.status || "completed",
    store_id: sale.store_id || null,
    store_name: store ? store.name : null,
    store_code: store ? store.code : null,
    customer_id: sale.customer_id || null,
    customer_name: customer ? customer.name : sale.customer_name || null,
    customer_email: customer ? customer.email : sale.customer_email || null,
    customer_phone: customer ? customer.phone : sale.customer_phone || null,
    is_walk_in: !sale.customer_id,
    net_sales: net,
    vat_amount: tax,
    gross_sales: gross,
    payment_summary: paymentSummary,
    payment_total: paymentSummary.reduce((s, p) => s + p.amount, 0),
    lines,
    metadata: {
      completed_at: sale.completed_at || null,
      discount: money(sale.discount || 0),
      online_order_id: sale.online_order_id || null,
    },
  };
}

export function saleHeaderShape(row) {
  return {
    id: row.id,
    receipt_number: row.receipt_number,
    created_at: row.created_at,
    store_id: row.store_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_phone: row.customer_phone,
    subtotal: row.subtotal,
    tax: row.tax,
    discount: row.discount,
    total: row.total,
    status: row.status,
    completed_at: row.completed_at,
    online_order_id: row.online_order_id,
  };
}

export function saleItemShape(row) {
  return {
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: row.quantity,
    unit_price: row.unit_price,
    discount: row.discount || 0,
    tax: row.tax || 0,
    total: row.total,
    sku: row.sku || null,
    barcode: row.barcode || null,
    vat_rate: row.vat_rate || 0,
    vat_applicable: row.vat_applicable !== false,
  };
}

export function paymentShape(row) {
  return {
    payment_method: row.payment_method,
    amount: row.amount,
    provider_transaction_id: row.provider_transaction_id || null,
  };
}

export function customerShape(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
  };
}

export function storeShape(row) {
  return row ? { id: row.id, name: row.name, code: row.code } : null;
}

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumMoney(values) {
  return values.reduce((s, v) => s + money(v), 0);
}

export function trimOrNull(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s || null;
}