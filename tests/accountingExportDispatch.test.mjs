/*
 * T10X tests - Accounting Export Dispatcher (provider-neutral).
 * Pure service tests: no database, no HTTP, no provider.
 *
 *   node --test tests/accountingExportDispatch.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountingDispatcher, idempotencyKey as genIdempotencyKey } from '../services/accountingExportDispatch.js';
import {
  ACCOUNTING_ENTITY_TYPES,
  normalizeSale,
  normalizePurchase,
  normalizeRefund,
  normalizeCustomerCreditTransaction,
  money,
} from '../services/accountingExport.js';
import { CREDIT_TX_TYPES } from '../services/customerCredit.js';

// — Fixture builders (call normalizers with correct signatures) —

function makeSaleRecord() {
  return normalizeSale(
    { id: 101, receipt_number: 'RCPT-101', sale_date: '2025-01-15T10:00:00Z', store_id: 3, customer_id: 50, subtotal: '50.00', tax: '10.00', total: '60.00', status: 'completed' },
    [{ product_id: 2001, sku: 'SKU-001', name: 'Widget', quantity: 2, unit_price: '25.00', total: '50.00', tax: '10.00', vat_rate: 20, vat_applicable: true }],
    [{ payment_method: 'credit', amount: '60.00' }],
    { id: 50, name: 'Acme Corp', email: 'a@acme.com' },
    { id: 3, name: 'Downtown', code: 'DT' }
  );
}

function makePurchaseRecord() {
  return normalizePurchase(
    { id: 201, supplier_id: 42, reference_number: 'INV-PUR-201', purchase_date: '2025-01-10T08:00:00Z', subtotal: '100.00', total: '120.00', status: 'completed', received_at: null, notes: null },
    [{ product_id: 901, sku: 'SKU-P01', name: 'Raw Material', quantity: 10, unit_cost: '10.00', line_total: '100.00', line_tax: '20.00', vat_rate: 20, vat_applicable: true }],
    { id: 42, name: 'Supplier Inc', email: 's@supplier.com' }
  );
}

function makeRefundRecord() {
  return normalizeRefund(
    { id: 301, sale_id: 101, amount: '60.00', payment_method: 'credit', created_at: '2025-01-20T10:00:00Z', status: 'completed', return_number: 'RET-301', reason: 'defective' },
    { id: 101, receipt_number: 'RCPT-101', store_id: 3, subtotal: '50.00', tax: '10.00', total: '60.00', customer_id: 50, customer_name: 'Acme Corp' },
    {}
  );
}

function makeCreditRecord() {
  return normalizeCustomerCreditTransaction(
    { id: 5001, company_id: 1, customer_id: 50, store_id: 3, transaction_type: CREDIT_TX_TYPES.SALE, amount: 5000, balance_after: 5000, reference_type: 'sale', reference_id: 101, vat_rate: 20, net_amount: 4167, vat_amount: 833, gross_amount: 5000, payment_method: null, description: 'Credit sale for RCPT-101', created_by: 7, created_at: '2025-01-15T10:00:00Z' },
      { id: 50, name: 'Acme Corp' }
  );
}

// — Dispatch payload tests —

test('Sale dispatch payload', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchSale(makeSaleRecord(), 'company-1', 'store-3');
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.dispatched, false);
  assert.equal(result.payload.company_id, 'company-1');
  assert.equal(result.payload.store_id, 'store-3');
  assert.equal(result.payload.source_type, 'sale');
  assert.equal(result.payload.source_id, 101);
  assert.equal(result.originalUnchanged, true);
  assert.equal(result.payload.vat_amount, money('10.00'));
  assert.equal(result.payload.net_sales, money('50.00'));
  assert.equal(result.payload.gross_sales, money('60.00'));
  assert.equal(result.payload.lines[0].vat_rate, 20);
});

test('Purchase dispatch payload', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchPurchase(makePurchaseRecord(), 'company-1', null);
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.payload.source_type, 'purchase');
  assert.equal(result.payload.source_id, 201);
  assert.equal(result.payload.supplier_id, 42);
  assert.equal(result.payload.supplier_name, 'Supplier Inc');
  assert.equal(result.payload.net_purchase, money('100.00'));
  assert.equal(result.payload.input_vat, money('20.00'));
  assert.equal(result.payload.gross_purchase, money('120.00'));
  assert.equal(result.payload.company_id, 'company-1');
});

test('Refund dispatch payload', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchRefund(makeRefundRecord(), 'company-1', 'store-3');
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.payload.source_type, 'refund');
  assert.equal(result.payload.source_id, 301);
  assert.equal(result.payload.original_sale_id, 101);
  assert.equal(result.payload.original_sale_reference, 'RCPT-101');
  assert.equal(result.payload.net_refund, money('50'));
  assert.equal(result.payload.gross_refund, money('60.00'));
  assert.equal(result.payload.company_id, 'company-1');
  assert.equal(result.payload.store_id, 'store-3');
});

test('Customer-credit dispatch payload', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchCustomerCredit(makeCreditRecord(), 'company-1', 'store-3');
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.payload.source_type, 'customer_credit');
  assert.equal(result.payload.source_id, 5001);
  assert.equal(result.payload.customer_id, 50);
  assert.equal(result.payload.customer_name, 'Acme Corp');
  assert.equal(result.payload.is_credit, true);
  assert.equal(result.payload.company_id, 'company-1');
});

// — Idempotency & isolation tests —

test('Idempotency key is deterministic and company-scoped', () => {
  const key1 = genIdempotencyKey('c1', 's1', 'sale', 101, 'myProvider');
  const key2 = genIdempotencyKey('c1', 's1', 'sale', 101, 'myProvider');
  assert.equal(key1, key2);
  assert.notEqual(key1, genIdempotencyKey('c2', 's1', 'sale', 101, 'myProvider'));
  assert.notEqual(key1, genIdempotencyKey('c1', 's2', 'sale', 101, 'myProvider'));
  assert.notEqual(key1, genIdempotencyKey('c1', 's1', 'sale', 101, 'otherProvider'));
});

test('Idempotency keys differ by company — no cross-tenant leakage', () => {
  const k1 = genIdempotencyKey('company-A', null, 'sale', 999);
  const k2 = genIdempotencyKey('company-B', null, 'sale', 999);
  assert.notEqual(k1, k2);
});

test('Duplicate retry returns duplicate status', () => {
  let seen = false;
  const tracker = () => { seen = true; return seen; };
  const dispatcher = createAccountingDispatcher(null, null, { idempotencyTracker: tracker });
  dispatcher.dispatchSale(makeSaleRecord(), 'c1', 's1');
  const second = dispatcher.dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.dispatched, false);
  assert.equal(second.originalUnchanged, true);
});

test('Store preservation in dispatch', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const sale = makeSaleRecord();
  const r1 = dispatcher.dispatchSale(sale, 'c1', null);
  assert.equal(r1.payload.store_id, sale.store_id);
  const r2 = dispatcher.dispatchSale(sale, 'c1', 'store-override');
    assert.equal(r2.payload.store_id, 'store-override');
});

// — Provider behaviour tests —

test('Provider acceptance dispatch', () => {
  let received = null;
  const adapter = {
    validateConfig: () => true,
    exportSale: (p) => { received = p; return { ok: true, externalReference: 'ext-123' }; },
  };
  const dispatcher = createAccountingDispatcher(adapter, { apiKey: 't' }, {});
  const result = dispatcher.dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.status, 'dispatched');
  assert.equal(result.externalReference, 'ext-123');
  assert.equal(received.company_id, 'c1');
  assert.equal(received.source_id, 101);
});

test('Provider rejection returns provider_rejected', () => {
  const adapter = {
    validateConfig: () => true,
    exportSale: () => ({ ok: false, error: 'Invalid customer reference' }),
  };
  const result = createAccountingDispatcher(adapter, {}, {}).dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.status, 'provider_rejected');
  assert.equal(result.error, 'Invalid customer reference');
  assert.equal(result.originalUnchanged, true);
});

test('Provider error returns provider_error', () => {
  const adapter = {
    validateConfig: () => true,
    exportSale: () => { throw new Error('Network timeout'); },
  };
  const result = createAccountingDispatcher(adapter, {}, {}).dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.status, 'provider_error');
  assert.equal(result.error, 'Network timeout');
  assert.equal(result.originalUnchanged, true);
});

test('Provider not configured — no adapter', () => {
  const result = createAccountingDispatcher(null, null, {}).dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.status, 'provider_not_configured');
  assert.equal(result.payload.company_id, 'c1');
});

test('Provider not configured — invalid config', () => {
  const adapter = { validateConfig: () => false };
  const result = createAccountingDispatcher(adapter, { bad: true }, {}).dispatchSale(makeSaleRecord(), 'c2', 's2');
  assert.equal(result.status, 'provider_not_configured');
});

test('Original transaction unaffected by export failure', () => {
  const adapter = {
    validateConfig: () => true,
    exportSale: () => { throw new Error('Provider down'); },
  };
  const sale = makeSaleRecord();
  const result = createAccountingDispatcher(adapter, {}, {}).dispatchSale(sale, 'c1', 's1');
  assert.equal(result.status, 'provider_error');
  assert.equal(sale.source_id, 101);
  assert.equal(sale.net_sales, money('50.00'));
  assert.equal(result.originalUnchanged, true);
});

test('Invalid record rejected — missing source_type', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchSale({ source_id: 999, amount: '10.00' }, 'c1', null);
  assert.equal(result.status, 'invalid_record');
  assert.equal(result.originalUnchanged, true);
});

test('No duplicate export on retry with idempotency tracker', () => {
  const key = genIdempotencyKey('c1', 's1', 'sale', 101);
  const dispatcher = createAccountingDispatcher({
    validateConfig: () => true,
    exportSale: () => ({ ok: true, externalReference: 'ext-once' }),
  }, {}, { idempotencyTracker: (k) => k === key });
  const result = dispatcher.dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.status, 'duplicate');
  assert.equal(result.dispatched, false);
  assert.equal(result.originalUnchanged, true);
});

test('VAT rate & category preserved through dispatch', () => {
  const dispatcher = createAccountingDispatcher(null, null, {});
  const result = dispatcher.dispatchSale(makeSaleRecord(), 'c1', 's1');
  assert.equal(result.payload.lines[0].vat_rate, 20);
  assert.ok(typeof result.payload.lines[0].vat_category === 'string');
  assert.equal(result.payload.lines[0].vat_applicable, true);
});
