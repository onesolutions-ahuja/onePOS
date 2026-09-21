/*
 * PHASE 2 — Customer Credit modal "Maximum Credit Age (days)" UI tests.
 *
 * The project has no JSX-capable unit test runner (no React testing
 * libraries), so the modal itself is verified with focused static checks
 * (same convention as tests/customerBillDisplay.test.mjs) and the form
 * serialization logic — the part that shapes the PUT payload — is a plain
 * JS helper (src/pages/customers/customerCreditForm.js) unit-tested
 * directly.
 *
 *   node --test tests/customerCreditUi.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { serializeMaximumAgeDays, validateCreditPaymentAmount } from "../src/pages/customers/customerCreditForm.js";

const modalPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "pages",
  "customers",
  "CustomerCreditModal.jsx"
);
const modalSource = readFileSync(modalPath, "utf8");

/* ------------------------------------------------------- helper unit tests */

describe("serializeMaximumAgeDays (PUT payload shaping)", () => {
  test("blank / null / undefined → null (no restriction)", () => {
    assert.deepEqual(serializeMaximumAgeDays(""), { valid: true, value: null });
    assert.deepEqual(serializeMaximumAgeDays("   "), { valid: true, value: null });
    assert.deepEqual(serializeMaximumAgeDays(null), { valid: true, value: null });
    assert.deepEqual(serializeMaximumAgeDays(undefined), { valid: true, value: null });
  });

  test("whole numbers >= 0 send that number", () => {
    assert.deepEqual(serializeMaximumAgeDays("90"), { valid: true, value: 90 });
    assert.deepEqual(serializeMaximumAgeDays("0"), { valid: true, value: 0 });
    assert.deepEqual(serializeMaximumAgeDays(" 60 "), { valid: true, value: 60 });
  });

  test("negative / fractional / non-numeric values are invalid", () => {
    assert.equal(serializeMaximumAgeDays("-1").valid, false);
    assert.equal(serializeMaximumAgeDays("90.5").valid, false);
    assert.equal(serializeMaximumAgeDays("soon").valid, false);
    assert.match(serializeMaximumAgeDays("-1").error, /whole number of days/);
  });
});

/* -------------------------------------------------- modal static checks */

describe("CustomerCreditModal maximum credit age field (static)", () => {
  test("labelled numeric input exists (min 0, whole-day step)", () => {
    assert.match(modalSource, /Maximum Credit Age \(days\)/);
    assert.match(modalSource, /id="cc-max-age"/);
    assert.match(modalSource, /id="cc-max-age"[\s\S]{0,200}min="0"[\s\S]{0,80}step="1"/);
  });

  test("shows the explanatory hint", () => {
    assert.match(
      modalSource,
      /Optional\. Blocks new credit sales when outstanding credit is older than this number of days\./
    );
  });

  test("loads the existing value from credit.maximumAgeDays (null → blank)", () => {
    assert.match(
      modalSource,
      /setMaxAgeInput\(\s*res\.data\.credit\?\.maximumAgeDays != null \? String\(res\.data\.credit\.maximumAgeDays\) : ""\s*\)/
    );
  });

  test("saves through the existing PUT body: blank → null, number → number, limit/enabled preserved", () => {
    assert.match(modalSource, /body\.maximumAgeDays = maxAge\.value;/);
    assert.match(modalSource, /const maxAge = serializeMaximumAgeDays\(maxAgeInput\);/);
    // existing enabled/limit behaviour untouched
    assert.match(modalSource, /const body = \{ enabled: creditEnabled \};/);
    assert.match(modalSource, /if \(limitInput\.trim\(\) !== ""\) body\.limit = Number\(limitInput\);/);
    // still the same endpoint
    assert.match(modalSource, /\/api\/customers\/\$\{customer\.id\}\/credit`,\s*\{\s*method: "PUT"/);
  });

  test("validation error surfaces through the existing error handler", () => {
    assert.match(modalSource, /if \(!maxAge\.valid\) \{[\s\S]{0,120}setError\(maxAge\.error\);/);
  });

  test("does not touch POS/till flow or other customer fields", () => {
    assert.ok(!modalSource.includes("PaymentGrid"), "no till changes");
    assert.ok(!modalSource.includes("customer_credit_ledger"), "no direct ledger writes");
  });
});

/* --------------------------------- management UI: overview / ageing / invoices / payment / ledger -- */

describe("CustomerCreditModal management wiring (static)", () => {
  test("overview renders enabled state, limit, outstanding, available, max age and ageing total", () => {
    assert.match(modalSource, /Credit enabled[\s\S]{0,400}Credit disabled/);
    assert.match(modalSource, /Outstanding balance[\s\S]{0,400}credit\.balance/);
    assert.match(modalSource, /Credit limit[\s\S]{0,400}credit\.limit/);
    assert.match(modalSource, /Available credit[\s\S]{0,400}credit\.available/);
    assert.match(modalSource, /Maximum credit age:/);
    assert.match(modalSource, /Total outstanding:/);
  });

  test("ageing buckets Current / 1–30 / 31–60 / 61–90 / 90+ render from data.ageing.buckets", () => {
    for (const key of ["current", "d1_30", "d31_60", "d61_90", "d90plus"]) {
      assert.ok(
        modalSource.includes(`key: "${key}"`),
        `bucket key ${key} defined`
      );
    }
    assert.match(modalSource, /data\.ageing\.buckets\[bucket\.key\]/);
    assert.match(modalSource, /No ageing information available/);
  });

  test("outstanding invoices show reference, date, days outstanding and remaining", () => {
    assert.match(modalSource, /Outstanding invoices/);
    assert.match(modalSource, /data\.ageing\.invoices\.map/);
    assert.match(modalSource, /invoice\.invoiceDate/);
    assert.match(modalSource, /invoice\.daysOutstanding/);
    assert.match(modalSource, /invoice\.remaining/);
    assert.match(modalSource, /No outstanding invoices/);
  });

  test("invoice drill-down shows available fields and tolerates a missing original amount", () => {
    assert.match(modalSource, /selectedInvoiceId/);
    assert.match(modalSource, /setSelectedInvoiceId/);
    assert.match(modalSource, /Sale\/invoice reference/);
    assert.match(modalSource, /Invoice date/);
    assert.match(modalSource, /Days outstanding/);
    assert.match(modalSource, /Original amount/);
    assert.match(modalSource, /Remaining amount/);
    assert.match(modalSource, /Not supplied/);
  });

  test("statement and allocation rows tolerate missing optional API fields", () => {
    // method label, balances, originals and descriptions all degrade to "-" placeholders.
    assert.match(modalSource, /payment_method\)/);
    assert.match(modalSource, /running_balance != null/);
    assert.match(modalSource, /remainingAfter/);
    assert.match(modalSource, /\? money\(/);
  });

  test("credit config, till flow and ledger rules are untouched", () => {
    assert.match(modalSource, /body\.maximumAgeDays = maxAge\.value;/);
    assert.match(modalSource, /validateCreditPaymentAmount\(paymentAmount/);
    assert.ok(!modalSource.includes("PaymentGrid"), "no till changes");
    assert.ok(!modalSource.includes("customer_credit_ledger"), "no direct ledger writes");
    assert.ok(!modalSource.includes("allocateFifoPayment"), "no frontend FIFO math");
  });

  test("payment posts the validated amount to the existing endpoint and refreshes", () => {
    assert.match(
      modalSource,
      /validateCreditPaymentAmount\(paymentAmount, data\?\.credit\?\.balance\)/
    );
    assert.match(
      modalSource,
      /\/api\/customers\/\$\{customer\.id\}\/credit\/payments`,\s*\{\s*method: "POST"/
    );
    assert.match(modalSource, /await load\(\);/);
  });

  test("payment is blocked without a selected customer", () => {
    assert.match(modalSource, /disabled=\{savingPayment \|\| !credit\?\.enabled \|\| !customer\?\.id\}/);
    assert.match(modalSource, /Select a customer first/);
  });

  test("FIFO allocation result renders invoice lines plus unallocated remainder", () => {
    assert.match(modalSource, /lastPayment/);
    assert.match(modalSource, /lastPayment\.allocations\.map/);
    assert.match(modalSource, /alloc\.invoiceLedgerId/);
    assert.match(modalSource, /alloc\.invoiceRemaining/);
    assert.match(modalSource, /Invoice balance:/);
    assert.match(modalSource, /methodLabel\(lastPayment\.method\)/);
    assert.match(modalSource, /Remaining unallocated: \{money\(lastPayment\.unallocated\)\}/);
  });

  test("ledger/statement rows show date, type, debit/credit, balance, refs and method", () => {
    assert.match(modalSource, /statement\.transactions\.map/);
    assert.match(modalSource, /tx\.transaction_date/);
    assert.match(modalSource, /tx\.running_balance/);
    assert.match(modalSource, /statementRef\(tx\)/);
    assert.match(modalSource, /statementDebitCredit\(tx\)/);
    assert.match(modalSource, /Invoice\/payment ref/);
    assert.match(modalSource, /methodLabel\(tx\.payment_method\)/);
    assert.match(modalSource, /tx\.description \|\| "-"/);
    assert.match(modalSource, /Recent ledger activity/);
    assert.match(modalSource, /data\.ledger\.map/);
  });

  test("backend errors surface through the existing error alert", () => {
    assert.match(modalSource, /throw new Error\(res\.message \|\| "Unable to record payment"\)/);
    assert.match(modalSource, /setError\(err\.message \|\| "Unable to record payment"\)/);
  });
});

/* -------------------------------------- payment validation unit tests --- */

describe("validateCreditPaymentAmount (payment validation)", () => {
  test("rejects zero / negative / non-numeric amounts", () => {
    assert.equal(validateCreditPaymentAmount("", 100).valid, false);
    assert.equal(validateCreditPaymentAmount("0", 100).valid, false);
    assert.equal(validateCreditPaymentAmount("-5", 100).valid, false);
    assert.equal(validateCreditPaymentAmount("soon", 100).valid, false);
    assert.match(
      validateCreditPaymentAmount("", 100).error,
      /greater than zero/
    );
  });

  test("rejects payments above the outstanding balance", () => {
    const over = validateCreditPaymentAmount("150", 100);
    assert.equal(over.valid, false);
    assert.match(over.error, /exceeds the outstanding balance/);
  });

  test("accepts a valid amount at or below the outstanding balance", () => {
    assert.deepEqual(validateCreditPaymentAmount("60", 100), { valid: true, value: 60 });
    assert.deepEqual(validateCreditPaymentAmount("100", 100), { valid: true, value: 100 });
    // unknown outstanding → only the positive-amount check applies
    assert.deepEqual(validateCreditPaymentAmount("25", null), { valid: true, value: 25 });
  });
});

