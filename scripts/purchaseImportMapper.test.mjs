/*
 * Unit-style Node checks for src/services/purchaseImportMapper.js (T9K).
 * Run: node scripts/purchaseImportMapper.test.mjs
 */
import assert from 'node:assert/strict';
import { parsePurchaseImport } from '../src/services/purchaseImport.js';
import { mapPurchaseImport } from '../src/services/purchaseImportMapper.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

const C1 = 'c1';
const products = [
  { id: 'p-cola', company_id: C1, name: 'Cola 330ml', barcode: '0501234567890', sku: 'COLA-330' },
  { id: 'p-crisps', company_id: C1, name: 'Crisps', barcode: '5012345678901', sku: 'CRISP-1' },
];
const suppliers = [{ id: 's-acme', company_id: C1, name: 'Acme Foods' }];

// 1. Successful mapping from parser output + grouping.
const parsed = parsePurchaseImport([
  { EAN: '0501234567890', Qty: 2, Cost: 1.5, Supplier: 'Acme Foods', Reference: 'INV-1', Date: '2026-09-01' },
  { EAN: '5012345678901', Qty: 5, Cost: 0.8, Supplier: 'Acme Foods', Reference: 'INV-1', Date: '2026-09-01' },
]);
const mapped = mapPurchaseImport(parsed.validRows, { products, suppliers, companyId: C1 });
check('one grouped purchase', mapped.purchases.length, 1);
check('group payload', mapped.purchases[0].items, [
  { productId: 'p-cola', quantity: 2, unitCost: 1.5 },
  { productId: 'p-crisps', quantity: 5, unitCost: 0.8 },
]);
check('supplier resolved', mapped.purchases[0].supplierId, 's-acme');
check('totals', [mapped.purchases[0].subtotal, mapped.purchases[0].total], [7, 7]);
check('no errors', mapped.errors, []);

// 2. SKU fallback + EAN priority + leading zeros preserved.
const skuOnly = mapPurchaseImport(
  [{ referenceNumber: null, purchaseDate: null, supplier: 'Acme Foods', items: [{ ean: null, sku: 'crisp-1', productName: null, quantity: 1, unitCost: 2 }] }],
  { products, suppliers, companyId: C1 }
);
check('sku fallback', skuOnly.purchases[0].items[0].productId, 'p-crisps');
const both = mapPurchaseImport(
  [{ referenceNumber: null, purchaseDate: null, supplier: 'Acme Foods', items: [{ ean: '0501234567890', sku: 'CRISP-1', productName: null, quantity: 1, unitCost: 1 }] }],
  { products, suppliers, companyId: C1 }
);
check('ean wins over sku', both.purchases[0].items[0].productId, 'p-cola');
const zeroRows = parsePurchaseImport([{ EAN: '0001230004567', Qty: 1, Cost: 1 }]);
check('leading zero ean string', zeroRows.validRows[0].items[0].ean, '0001230004567');
