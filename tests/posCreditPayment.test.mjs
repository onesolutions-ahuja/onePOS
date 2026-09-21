/*
 * PHASE 2B — Till Credit payment flow (UI) tests.
 *
 * The project has no DOM test runner, so the PaymentModal/POS wiring is
 * verified with focused static checks (same convention as
 * tests/customerBillDisplay.test.mjs and tests/customerCreditUi.test.mjs).
 * The credit-sale backend behaviour itself is already covered end-to-end by
 * tests/customerCredit.test.mjs.
 *
 *   node --test tests/posCreditPayment.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const paymentModal = readFileSync(
  path.join(dir, "..", "src", "pages", "pos", "PaymentModal.jsx"),
  "utf8"
);
const pos = readFileSync(
  path.join(dir, "..", "src", "pages", "pos", "POS.jsx"),
  "utf8"
);

describe("PaymentModal credit option (static)", () => {
  test("Credit tile is rendered only when the caller passes enabled credit", () => {
    assert.match(paymentModal, /const creditEnabled = credit\?\.enabled === true;/);
    assert.match(paymentModal, /\{creditEnabled && \(\s*<button/);
    assert.match(paymentModal, /Credit\s*<\/div>/);
  });

  test("Credit click defers to the backend validation via onCredit and surfaces its message", () => {
    assert.match(paymentModal, /onClick=\{payCredit\}/);
    assert.match(paymentModal, /const result = await onCredit\(\);/);
    assert.match(paymentModal, /setCreditError\(result\.message \|\| "Credit sale was rejected"\);/);
    assert.match(paymentModal, /role="alert"[\s\S]{0,80}\{creditError\}/);
  });

  test("Credit is unavailable offline (backend-validated sale, like card)", () => {
    assert.match(paymentModal, /if \(offline \|\| processing \|\| !creditEnabled \|\| !onCredit\) return;/);
    assert.match(paymentModal, /disabled=\{processing \|\| offline\}[\s\S]{0,160}col-span-2/);
  });

  test("shows available credit for the selected customer", () => {
    assert.match(paymentModal, /customerName = ""/);
    assert.match(paymentModal, /Available £\{\(Number\(credit\.available\) \|\| 0\)\.toFixed\(2\)\}/);
  });

  test("existing Cash and Card paths remain unchanged", () => {
    assert.match(paymentModal, /onClick=\{\(\) => setStep\("cash"\)\}/);
    assert.match(paymentModal, /await onComplete\("cash", \{ cashReceived: Number\(cashReceived\) \|\| 0 \}\);/);
    assert.match(paymentModal, /try \{ await onCard\("card"\); \} finally \{ setProcessing\(false\); \}/);
    assert.match(paymentModal, /Split Payment/);
    assert.match(paymentModal, /Other/);
  });
});

describe("POS credit wiring (static)", () => {
  test("passes credit only for a selected customer, with a fresh balance fetch", () => {
    assert.match(pos, /credit=\{\s*selectedCustomer\s*\?\s*liveCredit \|\| selectedCustomer\.credit \|\| null\s*: null\s*\}/);
    assert.match(pos, /apiRequest\(`\/api\/customers\/\$\{customerId\}\/credit`\)/);
    assert.match(pos, /if \(!showPayment \|\| !customerId\) \{\s*setLiveCredit\(null\);/);
  });

  test("confirms credit through completeSale(\"customer_credit\") and returns the outcome", () => {
    assert.match(pos, /const ok = await completeSale\("customer_credit"\);/);
    assert.match(pos, /saleOutcomeRef\.current\.message \|\| "Credit sale was rejected"/);
  });

  test("completeSale reports success/failure outcomes for the credit tile", () => {
    assert.match(pos, /saleOutcomeRef\.current = \{ ok: true, message: "" \};\s*return true;/);
    assert.match(pos, /const reject = \(message\) => \{\s*saleOutcomeRef\.current = \{ ok: false, message \};\s*setSaleError\(message\);/);
    // backend rejection messages flow through the shared catch
    assert.match(pos, /reject\(\s*error\.message \|\|\s*"Sale could not be completed"\s*\);/);
  });

  test("credit sales require an online connection without changing the card message", () => {
    assert.match(pos, /reject\("Credit payment needs an online connection\. Use cash offline\."\);/);
    assert.match(
      pos,
      /setSaleError\(\s*"Card payment needs a confirmed terminal payment and an online connection\. Use cash offline\."\s*\);/
    );
  });

  test("existing customer selection + sale payload keep sending customerId for credit", () => {
    assert.match(pos, /customerId:\s*\n\s*selectedCustomer\?\.id \|\|\s*\n\s*null,/);
  });
});
