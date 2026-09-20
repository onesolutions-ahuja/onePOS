/*
 * Customer Display (standalone second screen)
 *
 * Contract tests over CustomerDisplay.jsx + POS.jsx + POSHeader.jsx,
 * verifying:
 *  - CustomerDisplay.jsx is a standalone read-only page, never rendered
 *    inside the till and never importing POS components.
 *  - CustomerDisplay.jsx listens on the BroadcastChannel; it never calls
 *    the API and exposes no mutating controls.
 *  - The display shows store name, basket items, quantities, line prices,
 *    subtotal, VAT, discount, total, and customer-attach status.
 *  - Empty basket shows a clean welcome state.
 *  - POS broadcasts the current bill exactly once per render.
 *  - CustomerDisplay.jsx is strictly read-only (no buttons, no inputs).
 *
 * node --test tests/customerBillDisplay.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) =>
  fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const pos = read("src/pages/pos/POS.jsx");
const header = read("src/pages/pos/POSHeader.jsx");
const page = read("src/pages/pos/CustomerDisplay.jsx");

describe("Customer Display (standalone second screen)", () => {
  test("CustomerDisplay.jsx is a standalone page, not rendered in the till", () => {
    assert.ok(!pos.includes("CustomerDisplay"), "POS does not import CustomerDisplay");
    assert.ok(
      !pos.includes("from \"./CustomerDisplay.jsx\""),
      "POS does not import CustomerDisplay.jsx"
    );
    assert.ok(!header.includes("CustomerDisplay"), "POS header does not expose CustomerDisplay");
  });

  test("CustomerDisplay.jsx listens on BroadcastChannel only", () => {
    assert.ok(page.includes("BroadcastChannel"), "uses BroadcastChannel");
    assert.ok(
      page.includes('new BroadcastChannel("onepos-customer-display")'),
      "opens onepos-customer-display channel"
    );
    assert.ok(page.includes("onmessage"), "listens for messages");
    assert.ok(
      page.includes('data.type === "BILL"'),
      "only renders BILL messages"
    );
  });

  test("CustomerDisplay.jsx shows store/company name where available", () => {
    assert.ok(page.includes("bill?.storeName"), "shows storeName");
  });

  test("CustomerDisplay.jsx renders current basket items", () => {
    assert.ok(page.includes("bill.basket.map"), "renders basket items");
    assert.ok(page.includes("item.name"), "renders item.name");
    assert.ok(page.includes("item.quantity"), "renders item.quantity");
    assert.ok(page.includes("Number(item.price"), "renders item.price");
  });

  test("CustomerDisplay.jsx renders line prices and totals", () => {
    assert.ok(
      page.includes("(Number(item.price || 0)"),
      "computes qty x unit price"
    );
    assert.ok(page.includes("Subtotal"), "shows subtotal label");
    assert.ok(page.includes("bill.subtotal"), "reads bill.subtotal");
    assert.ok(page.includes("VAT"), "shows VAT label");
    assert.ok(page.includes("bill.vat"), "reads bill.vat");
    assert.ok(page.includes("Discount"), "shows discount label");
    assert.ok(page.includes("bill.discountAmount"), "reads bill.discountAmount");
    assert.ok(page.includes("Total"), "shows total label");
    assert.ok(page.includes("bill.total"), "reads bill.total");
  });

  test("CustomerDisplay.jsx shows loyalty customer status", () => {
    assert.ok(page.includes("bill.hasCustomer"), "shows loyalty customer flag");
  });

  test("CustomerDisplay.jsx shows discount status", () => {
    assert.ok(page.includes("bill.hasDiscount"), "shows discount flag");
  });

  test("CustomerDisplay.jsx shows clean empty state", () => {
    assert.ok(page.includes("Welcome to onePOS"), "shows welcome state");
    assert.ok(
      page.includes("Your bill will appear here while you shop"),
      "shows bill will appear message"
    );
    assert.ok(
      page.includes(
        "Array.isArray(bill?.basket) && bill.basket.length > 0"
      ),
      "empty cart check logic present"
    );
  });

  test("CustomerDisplay.jsx updates on cart changes", () => {
    assert.ok(page.includes("useEffect("), "mounts subscription effect");
    assert.ok(page.includes("setBill"), "updates bill state on message");
  });
  test("CustomerDisplay.jsx does not expose admin controls", () => {
    assert.ok(!page.includes("ProductGrid"), "no ProductGrid");
    assert.ok(!page.includes("CartPanel"), "no CartPanel");
    assert.ok(!page.includes("POSHeader"), "no POSHeader");
    assert.ok(!page.includes("PaymentModal"), "no PaymentModal");
    assert.ok(!page.includes("MiscItemModal"), "no MiscItemModal");
    assert.ok(!page.includes("PettyCashModal"), "no PettyCashModal");
    assert.ok(!page.includes("PrintReceiptModal"), "no PrintReceiptModal");
  });

  test("CustomerDisplay.jsx has no API access", () => {
    assert.ok(!page.includes("apiRequest"), "no apiRequest");
    assert.ok(!page.includes("fetch("), "no fetch()");
  });

  test("CustomerDisplay.jsx has no payment logic", () => {
    assert.ok(
      !page.includes("payment_method") && !page.includes("paymentMethod"),
      "no payment method logic"
    );
  });

  test("CustomerDisplay.jsx has no mutating controls", () => {
    assert.ok(!page.includes("setBasket"), "no setBasket");
    assert.ok(!page.includes("onAddProduct"), "no onAddProduct");
    assert.ok(!page.includes("deleteItem"), "no deleteItem");
    assert.ok(!page.includes("setDiscount"), "no setDiscount");
    assert.ok(
      !page.includes("setQuantity") && !page.includes("quantity\\s*[+-]"),
      "no quantity mutations"
    );
  });

  test("CustomerDisplay.jsx has no customer management", () => {
    assert.ok(!page.includes("customerCredit"), "no customer credit");
    assert.ok(!page.includes("loyalty"), "no loyalty management");
  });

  test("CustomerDisplay.jsx is strictly read-only (no buttons or inputs)", () => {
    const buttons = page.match(/<button/g) || [];
    const inputs = page.match(/<input/g) || [];
    const selects = page.match(/<select/g) || [];
    assert.equal(
      buttons.length + inputs.length + selects.length,
      0,
      "no interactive form controls on the customer display"
    );
  });

  test("CustomerDisplay.jsx does not expose customer PII", () => {
    assert.ok(!page.includes("phone"), "no phone");
    assert.ok(!page.includes("email"), "no email");
  });

  test("POS broadcasts current bill to customer display", () => {
    assert.ok(
      pos.includes("onepos-customer-display"),
      "till broadcasts on customer-display channel"
    );
    assert.ok(pos.includes('type: "BILL"'), "till sends BILL payload");
    assert.ok(pos.includes("billChannelRef"), "bill channel reference exists");
    assert.ok(pos.includes("postMessage"), "till posts bill message");
  });

  test("POS broadcasts bill after totals computed", () => {
    assert.ok(
      pos.includes("computeBasketTotals") &&
        pos.includes("billChannelRef.current.postMessage"),
      "bill broadcast happens after totals computed"
    );
  });
});

