/*
 * T10Y - Customer Credit Management & Customer Ledger (provider-neutral service layer).
 *
 * OnePOS remains the source of truth for sales, payments, refunds and customer data.
 * This service provides pure functions for customer credit limit enforcement, ledger
 * transaction recording, balance calculation and statement generation.
 *
 * Key principles:
 *  - Ledger entries are immutable/auditable (transactions, not mutable balances)
 *  - Balance is derived/reproducible from ledger transactions, not independently editable
 *  - All money is integer-cents internally to avoid floating-point issues
 *  - Credit limits are enforced server-side inside transactions
 *  - Company/store isolation is enforced by every function taking companyId
  *  - VAT/net/gross values pass through from existing OnePOS calculations unchanged
 */

/** Money helpers: integer-cents to avoid floating-point issues */

export function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return Math.round(cents) / 100;
}

/** Customer credit transaction types */
export const CREDIT_TX_TYPES = {
  CREDIT_SALE: 'credit_sale',
  PAYMENT: 'payment',
  CREDIT_NOTE: 'credit_note',
  DEBIT_NOTE: 'debit_note',
  OPENING: 'opening',
};

/** Sign of each transaction type: +1 = increases balance, -1 = decreases */
export function txSign(txType) {
  switch (txType) {
    case CREDIT_TX_TYPES.CREDIT_SALE:
    case CREDIT_TX_TYPES.CREDIT_NOTE:
    case CREDIT_TX_TYPES.OPENING:
      return 1;
    case CREDIT_TX_TYPES.PAYMENT:
    case CREDIT_TX_TYPES.DEBIT_NOTE:
      return -1;
        default:
      return 1;
  }
}

/** Calculate outstanding balance from ledger transactions (cents) */
export function calculateBalance(transactions = []) {
  let balance = 0;
  for (const tx of transactions) {
    const amountCents = toCents(tx.amount);
    balance += amountCents * txSign(tx.transaction_type);
  }
    return balance;
}

/** Check if a new credit sale would exceed the customer's credit limit.
 *  All arguments are integer CENTS (the callers — routes/sales.js,
 *  routes/customers.js — convert major units before calling). */
export function checkCreditLimit(currentBalanceCents, newSaleAmountCents, creditLimitCents) {
  const balance = Math.round(Number(currentBalanceCents) || 0);
  const newBalance = balance + Math.round(Number(newSaleAmountCents) || 0);
  if (creditLimitCents === null || creditLimitCents === undefined) {
    return { allowed: true, availableCredit: Infinity, wouldExceed: false, newBalance };
  }
  const limit = Math.round(Number(creditLimitCents) || 0);
  const availableCredit = limit - balance;
  const wouldExceed = newBalance > limit;
  return { allowed: !wouldExceed, availableCredit, wouldExceed, newBalance };
}

/** Check if a payment amount is valid (does not exceed outstanding balance).
 *  Arguments are integer CENTS. */
export function checkPayment(currentBalanceCents, paymentAmountCents) {
  const rawPayment = Number(paymentAmountCents);
  const paymentCents = Number.isFinite(rawPayment) ? Math.round(rawPayment) : 0;
  const balanceCents = Math.max(0, Math.round(Number(currentBalanceCents) || 0));
  const validAmount = paymentCents > 0;
  const overpayment = validAmount && paymentCents > balanceCents ? paymentCents - balanceCents : 0;
  return { allowed: validAmount && paymentCents <= balanceCents, overpayment };
}

/** Build a ledger transaction record for a credit sale.
 *  Amounts are MAJOR units (pounds, 2dp) — matching the ledger table's
 *  NUMERIC(12,2) columns; direction is derived from transaction_type. */
export function buildCreditSaleTransaction(params) {
  const { saleId, customerId, companyId, storeId, amount, totalTax = 0, netAmount = 0, grossAmount = 0, vatRate = 0, paymentMethod = null, userId, receiptNumber, description = null } = params;
  const round2 = (v) => Math.round(Number(v) * 100) / 100;
  return {
    company_id: companyId,
    customer_id: customerId,
    store_id: storeId,
    transaction_type: CREDIT_TX_TYPES.CREDIT_SALE,
    amount: round2(amount),
    balance_after: null,
    reference_type: 'sale',
    reference_id: saleId,
    description: description || `Credit sale ${receiptNumber || saleId}`,
    vat_amount: round2(totalTax),
    net_amount: round2(netAmount),
    gross_amount: round2(grossAmount),
    vat_rate: Number(vatRate) || 0,
    payment_method: paymentMethod,
    created_by: userId,
  };
}

/** Build a ledger transaction record for a customer payment */
export function buildPaymentTransaction(params) {
  const { customerId, companyId, storeId, amount, paymentMethod, userId, referenceId = null, referenceType = 'payment', notes = null } = params;
  return {
    company_id: companyId,
    customer_id: customerId,
    store_id: storeId,
    transaction_type: CREDIT_TX_TYPES.PAYMENT,
    /*
     * T10Y sign convention: `amount` is stored UNSIGNED (magnitude only), in
     * MAJOR units matching the ledger table; direction is derived from
     * `transaction_type` via txSign() wherever a signed value is needed
     * (calculateBalance/generateStatement). Storing a negative here would
     * double-flip and INCREASE the balance.
     */
    amount: Math.round(Number(amount) * 100) / 100,
    balance_after: null,
    reference_type: referenceType,
    reference_id: referenceId,
    description: notes || `Payment received (${paymentMethod || 'N/A'})`,
    payment_method: paymentMethod,
    created_by: userId,
  };
}

/** Build a ledger transaction for an adjustment (credit note or debit note) */
export function buildAdjustmentTransaction(params) {
  const { customerId, companyId, storeId, amount, adjustmentType, userId, reason = null, referenceId = null, referenceType = 'adjustment' } = params;
  const amountCents = toCents(amount);
  const isCreditNote = adjustmentType === 'credit_note' || adjustmentType === CREDIT_TX_TYPES.CREDIT_NOTE;
  return {
    company_id: companyId,
    customer_id: customerId,
    store_id: storeId,
    transaction_type: isCreditNote ? CREDIT_TX_TYPES.CREDIT_NOTE : CREDIT_TX_TYPES.DEBIT_NOTE,
    /* Unsigned magnitude in major units; txSign() applies the direction. */
    amount: Math.round(amountCents) / 100,
    balance_after: null,
    reference_type: referenceType,
    reference_id: referenceId,
    description: reason || (isCreditNote ? 'Credit adjustment' : 'Debit adjustment'),
    created_by: userId,
  };
}

/** Build an opening balance transaction */
export function buildOpeningBalanceTransaction(params) {
  const { customerId, companyId, storeId, amount, userId, referenceId = null, notes = null } = params;
  const amountCents = toCents(amount);
  return {
    company_id: companyId,
    customer_id: customerId,
    store_id: storeId,
    transaction_type: CREDIT_TX_TYPES.OPENING,
    amount: Math.round(amountCents) / 100,
    balance_after: Math.round(amountCents) / 100,
    reference_type: 'opening_balance',
    reference_id: referenceId,
    description: notes || 'Opening balance',
    created_by: userId,
  };
}

/** Generate a customer statement from ledger transactions */
export function generateStatement(params) {
  const { transactions = [], fromDate = null, toDate = null, storeId = null, customerId = null, companyId = null } = params;
  const parseBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const text = String(value).trim();
    // Date-only statement filters are user-facing calendar days. Treat the
    // upper bound as inclusive through 23:59:59.999 instead of midnight.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const date = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
    if (Number.isNaN(date.getTime())) return null;
    if (dateOnly && endOfDay) date.setUTCHours(23, 59, 59, 999);
    return date;
  };
  const fromBoundary = parseBoundary(fromDate, false);
  const toBoundary = parseBoundary(toDate, true);
  let filtered = transactions;
  if (fromBoundary) {
    filtered = filtered.filter((tx) => new Date(tx.created_at || tx.transaction_date) >= fromBoundary);
  }
  if (toBoundary) {
    filtered = filtered.filter((tx) => new Date(tx.created_at || tx.transaction_date) <= toBoundary);
  }
  filtered = [...filtered].sort((a, b) => new Date(a.created_at || a.transaction_date) - new Date(b.created_at || b.transaction_date));
  let openingBalance = 0;
  if (fromBoundary && transactions.length) {
    const prior = transactions.filter((tx) => new Date(tx.created_at || tx.transaction_date) < fromBoundary);
    openingBalance = calculateBalance(prior);
  }
  let runningBalance = openingBalance;
  const txList = filtered.map((tx) => {
    const signedAmount = toCents(tx.amount) * txSign(tx.transaction_type);
    runningBalance += signedAmount;
    return {
      ...tx,
      amount_display: fromCents(signedAmount),
      running_balance: fromCents(runningBalance),
      transaction_date: tx.created_at || tx.transaction_date,
    };
  });
  return {
    openingBalance: fromCents(openingBalance),
    transactions: txList,
    closingBalance: fromCents(runningBalance),
    storeId,
    customerId,
    companyId,
  };
}

/** Normalize a customer credit ledger transaction for T10W accounting export */
export function normalizeCreditLedgerTransaction(tx, customer = null) {
  if (!tx) return null;
  const amountCents = toCents(tx.amount);
  return {
    source_type: 'customer_credit',
    source_id: tx.id,
    company_id: tx.company_id,
    customer_id: tx.customer_id,
    customer_name: customer ? customer.name : null,
    store_id: tx.store_id,
    transaction_type: tx.transaction_type,
    /* Direction derives from the type, not the stored (unsigned) amount. */
    is_credit_incurred: txSign(tx.transaction_type) > 0,
    is_credit_repaid: txSign(tx.transaction_type) < 0,
    amount: fromCents(amountCents),
    balance_after: tx.balance_after != null ? fromCents(toCents(tx.balance_after)) : null,
    reference_type: tx.reference_type || null,
    reference_id: tx.reference_id || null,
    vat_rate: tx.vat_rate || 0,
    net_amount: tx.net_amount != null ? fromCents(toCents(tx.net_amount)) : null,
    vat_amount: tx.vat_amount != null ? fromCents(toCents(tx.vat_amount)) : null,
    gross_amount: tx.gross_amount != null ? fromCents(toCents(tx.gross_amount)) : null,
    payment_method: tx.payment_method || null,
    description: tx.description || null,
    transaction_date: tx.created_at || null,
    created_by: tx.created_by || null,
  };
}

/** Format a balance for display */
export function formatBalance(balanceCents) {
  return `£${fromCents(balanceCents).toFixed(2)}`;
}

/** Determine if a customer is a walk-in (should not receive credit) */
export function isWalkInCustomer(customerId) {
  return !customerId || customerId === '' || customerId === null;
}

/** Validate credit limit data before insert/update */
export function validateCreditLimit(limit) {
  if (limit === null || limit === undefined) return { valid: true };
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 0) {
    return { valid: false, error: 'Credit limit must be a non-negative number or null for unlimited' };
  }
  return { valid: true };
}