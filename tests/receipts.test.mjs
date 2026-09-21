/*
 * Receipts module tests (printed / digital / offline / self-checkout).
 *
 * The project has no DOM test runner, so the receipt UI is verified with
 * focused static checks (same convention as tests/tillMiscPettyPrint.test.mjs
 * and tests/posCreditPayment.test.mjs). The authoritative numbering,
 * invoice-delivery and secure-link behaviour are covered by the existing
 * tests/invoicePrefixes.test.mjs, tests/invoiceDeliveryOps.test.mjs and
 * tests/secureInvoiceDelivery.test.mjs.
 *
 *   node --test tests/receipts.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(dir, "..", p), "utf8");

const tills = read("src/pages/pos/TillActionsModals.jsx");
const salesRoute = read("routes/sales.js");
const queueModal = read("src/pages/pos/QueueDetailsModal.jsx");
const offlineQueue = read("src/services/offlineQueue.js");
const selfCheckout = read("src/pages/selfCheckout/SelfCheckout.jsx");
const pos = read("src/pages/pos/POS.jsx");

describe("receipt content (PrintReceiptModal)", () => {
  test("renders store/company name and store details from the sale record", () => {
    assert.match(tills, /\{sale\.store_name \|\| "onePOS Receipt"\}/);
    assert.match(tills, /sale\.address_line1/);
    assert.match(tills, /sale\.store_phone/);
  });

  test("shows till/terminal, cashier and date/time", () => {
    assert.match(tills, /sale\.terminal_name/);
    assert.match(tills, /sale\.cashier/);
    assert.match(tills, /new Date\(sale\.created_at\)\.toLocaleString\(\)/);
  });

  test("shows the authoritative receipt number (no second numbering system)", () => {
    assert.match(tills, /data-testid="receipt-number"/);
    assert.match(tills, /Receipt \{sale\.receipt_number\}/);
    // no client-side number generation
    assert.ok(!/receipt_number\s*=/.test(tills), "receipt number is never generated client-side");
  });

  test("shows products, quantity, unit price, subtotal, VAT, discount and total", () => {
    assert.match(tills, /item\.product_name/);
    assert.match(tills, /Number\(item\.quantity\)/);
    assert.match(tills, /@ \$\{money\(item\.unit_price\)\}/);
    assert.match(tills, /<span>Subtotal<\/span>/);
    assert.match(tills, /<span>VAT<\/span>/);
    assert.match(tills, /<span>Discount<\/span>/);
    assert.match(tills, /<span>TOTAL<\/span>/);
  });

  test("shows the payment method", () => {
    assert.match(tills, /\{String\(sale\.payment_method\)\.toUpperCase\(\)\}/);
  });

  test("shows customer details where available", () => {
    assert.match(tills, /data-testid="receipt-customer"/);
    assert.match(tills, /sale\.customer_name/);
    assert.match(tills, /sale\.customer_phone/);
  });

  test("sale detail API supplies store details, terminal and customer for the receipt", () => {
    assert.match(salesRoute, /st\.address_line1, st\.address_line2, st\.city, st\.postcode/);
    assert.match(salesRoute, /st\.phone AS store_phone/);
    assert.match(salesRoute, /t\.name AS terminal_name/);
    assert.match(salesRoute, /LEFT JOIN terminals t ON t\.id = s\.terminal_id/);
    assert.match(salesRoute, /cst\.name AS customer_name/);
  });
});

describe("printed receipt", () => {
  test("print uses the existing browser print mechanism, from a completed POS sale", () => {
    assert.match(tills, /const print = \(\) => \{/);
    assert.match(tills, /window\.print\(\);/);
    assert.match(pos, /PrintReceiptModal/);
    assert.match(pos, /data-testid="print-button"/);
  });

  test("print confirm button keeps its existing test id and disabled handling", () => {
    assert.match(tills, /data-testid="print-confirm"/);
    assert.match(tills, /disabled=\{!sale \|\| loading\}/);
  });
});

describe("offline provisional vs confirmed receipts", () => {
  test("offline sale keeps the provisional receipt and labels it as pending sync", () => {
    assert.match(pos, /id: null,/);
    assert.match(pos, /receiptNumber: queued\.entry\.provisionalReceipt,/);
    assert.match(tills, /sale\.offline &&/);
    assert.match(tills, /offline copy/);
    assert.match(tills, /not yet confirmed by the server/);
  });

  test("sync history records the authoritative receipt + sale id (existing sync logic untouched)", () => {
    assert.match(offlineQueue, /recordSyncedReceipt\(tenant, \{ clientRequestId, provisionalReceipt: entry\.provisionalReceipt, receiptNumber: sale\.receipt_number, saleId: sale\.id \}\)/);
  });

  test("confirmed entries expose the sale id so the confirmed receipt is reachable", () => {
    assert.match(offlineQueue, /saleId: entry\.saleId \|\| null,/);
  });

  test("queue details offers view/print of the CONFIRMED receipt", () => {
    assert.match(queueModal, /data-testid="view-confirmed-receipt"/);
    assert.match(queueModal, /View \/ print confirmed receipt/);
    assert.match(queueModal, /id: entry\.saleId,/);
    assert.match(queueModal, /receiptNumber: entry\.receiptNumber \|\| null,/);
  });

  test("viewing the confirmed receipt reuses the existing PrintReceiptModal", () => {
    assert.match(queueModal, /import \{ PrintReceiptModal \} from "\.\/TillActionsModals\.jsx";/);
    assert.match(queueModal, /<PrintReceiptModal lastSale=\{viewSale\} onClose=\{\(\) => setViewSale\(null\)\} \/>/);
  });
});

describe("self-checkout receipts", () => {
  test("completed self-checkout sale shows the server receipt number (SC- numbering upstream)", () => {
    assert.match(selfCheckout, /setReceipt\(\{ receiptNumber: data\.sale\.receipt_number \|\| null, total \}\)/);
    assert.match(selfCheckout, /Receipt \{receipt\.receiptNumber\}/);
    assert.ok(!/receipt_number\s*=/.test(selfCheckout), "no client-side numbering");
  });
});

describe("digital receipts (existing mechanisms)", () => {
  test("sales admin still offers the WhatsApp invoice resend (existing digital path)", () => {
    const salesAdmin = read("src/pages/sales/SalesAdmin.jsx");
    assert.match(salesAdmin, /Resend invoice via WhatsApp/);
    assert.match(salesAdmin, /\/api\/whatsapp\/resend-invoice/);
  });

  test("email/SMS invoice delivery endpoints remain available for digital receipts", () => {
    const delivery = read("routes/invoiceDelivery.js");
    assert.match(delivery, /\/invoice-delivery\/:channel\/resend/);
    assert.match(delivery, /no_customer_email/);
    assert.match(delivery, /no_customer_phone/);
  });
});
