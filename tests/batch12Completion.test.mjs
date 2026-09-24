import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPayment, generateStatement } from '../server/services/customerCredit.js';
import { calculateLoyaltyEarn, calculateLoyaltyReversal } from '../server/services/loyaltyRules.js';
import { invoiceStatus, allocateSupplierPayment } from '../server/services/supplierAccounts.js';
import { buildProfitReport } from '../server/services/profitMargin.js';

test('customer credit rejects zero, negative and non-numeric repayments', () => {
  assert.equal(checkPayment(1000, 0).allowed, false);
  assert.equal(checkPayment(1000, -100).allowed, false);
  assert.equal(checkPayment(1000, 'bad').allowed, false);
  assert.deepEqual(checkPayment(1000, 1200), { allowed: false, overpayment: 200 });
  assert.equal(checkPayment(1000, 1000).allowed, true);
});

test('customer statement date-only toDate includes the whole selected day', () => {
  const statement = generateStatement({
    transactions: [
      { transaction_type: 'credit_sale', amount: 10, created_at: '2026-09-24T00:00:00Z' },
      { transaction_type: 'credit_sale', amount: 20, created_at: '2026-09-24T23:59:59Z' },
      { transaction_type: 'credit_sale', amount: 30, created_at: '2026-09-25T00:00:00Z' },
    ],
    toDate: '2026-09-24',
  });
  assert.equal(statement.transactions.length, 2);
  assert.equal(statement.closingBalance, 30);
});

test('invalid optional statement boundaries do not silently erase the ledger', () => {
  const statement = generateStatement({
    transactions: [{ transaction_type: 'credit_sale', amount: 12, created_at: '2026-09-24T12:00:00Z' }],
    fromDate: 'not-a-date', toDate: 'also-not-a-date',
  });
  assert.equal(statement.transactions.length, 1);
  assert.equal(statement.closingBalance, 12);
});

test('loyalty rules keep earning and refund reversal bounded', () => {
  assert.equal(calculateLoyaltyEarn(100, { loyalty_enabled: true, loyalty_earning_rate: 0.01 }).points, 1);
  assert.equal(calculateLoyaltyReversal(100, 0.5, { loyalty_enabled: true, loyalty_earning_rate: 0.01 }).points, 0.5);
});

test('supplier finance helpers preserve invoice/payment invariants', () => {
  assert.equal(invoiceStatus(100, 0), 'OPEN');
  assert.equal(invoiceStatus(100, 25), 'PARTIALLY_PAID');
  assert.equal(invoiceStatus(100, 100), 'PAID');
  assert.deepEqual(allocateSupplierPayment(70, [{ id:'a', total:50, paid:0 }, { id:'b', total:50, paid:0 }]), [
    { invoiceId:'a', amount:50 }, { invoiceId:'b', amount:20 }
  ]);
});

test('profit/margin service remains available as canonical finance reporting logic', () => {
  assert.equal(typeof buildProfitReport, 'function');
});
