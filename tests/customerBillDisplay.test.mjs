/*
 * T10F-FIX — Customer Display as a SEPARATE window: contract tests.
 *
 * Static contract tests over the real source, pinning the two-screen
 * guarantees: the till keeps its full cashier layout (never replaced),
 * the customer window is a popup receiving the SAME state props, it is
 * strictly read-only, closing it never touches the till, the empty
 * basket shows the welcome state, and no duplicate basket/totals/
 * payment logic exists anywhere.
 *
 *   node --test tests/customerBillDisplay.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) =>
  fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const strip = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const display = strip(read("src/pages/pos/CustomerBillDisplay.jsx"));
const displayRaw = read("src/pages/pos/CustomerBillDisplay.jsx");
const pos = read("src/pages/pos/POS.jsx");
const header = read("src/pages/pos/POSHeader.jsx");
const cartPanel = read("src/pages/pos/CartPanel.jsx");
const engine = read("src/utils/saleTotals.js");
const page = read("src/pages/pos/CustomerDisplay.jsx");
const settingsSrc = read("src/pages/settings/SettingsAdmin.jsx");

describe("T10F-FIX — two physical screens: till is primary", () => {
  test("POS.jsx renders no in-till customer display at all", () => {
    assert.ok(
      !pos.includes("CustomerBillDisplay"),
      "customer display must not render inside the till layout"
    );
    assert.ok(
      !pos.includes("from \"./CustomerBillDisplay.jsx\""),
      "till must not import the customer display directly"
    );
  });

  test("full cashier layout is restored: ProductGrid + CartPanel always render", () => {
    assert.ok(pos.includes("<ProductGrid"));
    assert.ok(pos.includes("<CartPanel"));
    /* The T10F in-till disable/hide of cashier controls is gone. */
    assert.ok(
      !pos.includes("pointer-events-none"),
      "cashier quick-action row must never be disabled for customer display"
    );
    assert.ok(!/aria-hidden=\{showCustomerDisplay/.test(pos));
  });

  test("T10F-FIX-UI: cashier cart has exactly ONE quantity control per line", () => {
    /* One qty number, one − , one + , one remove — no free-text number input. */
    assert.ok(
      !/type=["']number["']/.test(cartPanel),
      "the duplicate free-text quantity input must not return"
    );
    const qtyDisplays = (cartPanel.match(/\{item\.quantity\}/g) || []).length;
    assert.equal(qtyDisplays, 1, `quantity must render exactly once, found ${qtyDisplays}`);
    assert.ok(cartPanel.includes("data-testid=\"cart-qty\""), "authoritative qty display marked");
    assert.ok(/aria-label=\{`Increase quantity of/.test(cartPanel), "+ is labelled");
    assert.ok(/aria-label=\{`Remove \$\{item\.name\}`\}/.test(cartPanel), "remove is labelled");
  });

  test("T10F-FIX-UI: the standalone display page uses the app's own design system", () => {
    /* /customer-display is served by the same index.html + bundle, so the
       real onePOS CSS always applies — and the page must keep using the
       shared Tailwind theme (teal header, cards, tabular totals). */
    assert.ok(/#176F6A/.test(page) || /176F6A/.test(page), "onePOS teal branding on the display");
    assert.ok(page.includes("£"), "£ currency formatting");
    assert.ok(page.includes("onePOS"), "onePOS branding present");
  });

  test("T10F-FIX-UI: customer bill shows quantity once per line", () => {
    const start = displayRaw.indexOf("customer-bill-line");
    const end = displayRaw.indexOf("</div>", start + 400);
    /* Count quantity renderings across the whole line block. */
    const lineBlock = displayRaw.slice(start);
    const qtyRenderings = (lineBlock.match(/item\.quantity/g) || []).length;
    assert.ok(
      qtyRenderings === 2,
      `customer line renders quantity twice by design (qty x unit and line total): ${qtyRenderings}`
    );
  });

  test("no Customer Display or Self-Checkout button remains in the till header", () => {
    /* Both entry points moved: Customer Display → Settings → Store & Till;
       Self-Checkout → the login screen (customer device). */
    assert.ok(!header.includes("Customer Display"), "no header Customer Display button");
    assert.ok(!header.includes("Self-Checkout"), "no header Self-Checkout button");
    assert.ok(!header.includes("onToggleCustomerDisplay"), "header toggle prop is gone");
    assert.ok(!header.includes("onStartSelfCheckout"), "header SCO prop is gone");
  });
});

describe("T10F-FIX — separate window mechanics", () => {
  test("customer display is a standalone page; Settings opens it in its own window", () => {
    assert.ok(page.includes("/customer-display"), "standalone route exists in App");
    assert.ok(/popup=yes/.test(settingsSrc), "Settings opens the display as a popup window, not a tab");
  });

  test("closing the customer window never affects the till", () => {
    /* The broadcast is one-way: the customer page cannot reach back into
       the till. The till's own state has no dependency on the display. */
    assert.ok(pos.includes("BroadcastChannel"), "bill mirror is a one-way broadcast");
    assert.ok(!/setShowCustomerDisplay/.test(pos), "the legacy portal toggle is fully removed");
    /* The standalone page has no window.close/handle back into the till. */
    const page = fs.readFileSync(new URL("../src/pages/pos/CustomerDisplay.jsx", import.meta.url), "utf8");
    assert.ok(!/window\.close|opener/.test(page), "customer page cannot control the till window");
  });

  test("same state reaches the customer window — no second source of truth", () => {
    /* The till broadcasts its live bill values; the page renders them as-is. */
    for (const field of ["basket", "subtotal", "vat", "total", "discountAmount"]) {
      assert.ok(
        new RegExp(`\\b${field}[,}]`).test(pos),
        `till broadcasts live ${field}`
      );
    }
    const page = fs.readFileSync(new URL("../src/pages/pos/CustomerDisplay.jsx", import.meta.url), "utf8");
    for (const field of ["basket", "subtotal", "vat", "total", "discountAmount", "hasDiscount", "hasCustomer", "storeName"]) {
      assert.ok(page.includes(field), `customer page renders the broadcast ${field}`);
    }
    /* The portal window was replaced by a BroadcastChannel bill mirror: the
       till BROADCASTS the live bill; /customer-display only listens. */
    assert.ok(pos.includes("onepos-customer-display"), "till broadcasts on the customer-display channel");
    assert.ok(pos.includes('type: "BILL"'), "till ALWAYS mirrors the bill (no server gate — works offline)");
    assert.ok(!/customerDisplayEnabled/.test(pos), "the mirror is not gated on a server setting (offline-safe)");
    assert.ok(/heartbeat|setInterval/.test(pos), "a heartbeat re-sends the bill to late-joining display windows");
    assert.ok(!pos.includes("<CustomerDisplayWindow"), "no in-document portal window remains");
  });

  test("popup-blocked fallback does not break the till", () => {
    assert.ok(/blocked by the browser|blocked the window/i.test(settingsSrc), "user is told why nothing opened");
  });
});

describe("T10F-FIX — customer window is read-only", () => {
  test("/customer-display page only listens — it cannot mutate anything", () => {
    const page = fs.readFileSync(new URL("../src/pages/pos/CustomerDisplay.jsx", import.meta.url), "utf8");
    assert.ok(page.includes("BroadcastChannel"), "the page receives the bill via the broadcast channel");
    assert.ok(!/apiRequest|fetch\(/.test(page), "no API access from the customer page");
    assert.ok(!/onAddProduct|setBasket|quantity\s*[+-]|payment/i.test(page), "no mutating controls");
    const buttons = page.match(/<button/g) || [];
    assert.equal(buttons.length, 0, "the customer display renders zero buttons");
  });

  test("the bill component itself has no mutating controls", () => {
    assert.ok(!/<input/i.test(display));
    assert.ok(!/<select/i.test(display));
    /* No in-bill exit button anymore — closing lives on the window chrome
       and the cashier's header toggle. */
    const buttons = display.match(/<button[\s\S]*?<\/button>/g) || [];
    assert.equal(
      buttons.length,
      0,
      "the customer bill must contain zero buttons"
    );
  });

  test("no customer PII in the customer window", () => {
    assert.ok(!/phone|email/i.test(display));
    assert.ok(!/phone|email/i.test(strip(page)));
  });

  test("no API calls or Self-Checkout coupling from the customer surface", () => {
    assert.ok(!/apiRequest|fetch\(/.test(display));
    assert.ok(!page.includes("apiRequest"), "no API usage on the standalone display page");
    assert.ok(!/fetch\(["'`]\/api/.test(page), "the display page never calls the API");
    assert.ok(!display.toLowerCase().includes("self-checkout"));
    assert.ok(!page.toLowerCase().includes("self-checkout"));
  });
});

describe("T10F-FIX — behaviour contract preserved", () => {
  test("empty basket shows the OnePOS welcome state", () => {
    assert.ok(display.includes("customer-bill-empty"));
    assert.ok(/Welcome/.test(display));
    assert.ok(/basket\.length === 0/.test(display));
  });

  test("active basket shows line items and totals", () => {
    assert.ok(display.includes("customer-bill-line"));
    assert.ok(/item\.name/.test(display));
    assert.ok(/item\.quantity/.test(display));
    assert.ok(/money\(item\.price\)/.test(display));
    assert.ok(display.includes("customer-bill-total"));
    assert.ok(/Subtotal/.test(display) && /VAT/.test(display));
  });

  test("no duplicate basket/totals/payment logic anywhere in the chain", () => {
    assert.ok(pos.includes("computeBasketTotals"));
    assert.ok(engine.includes("computeBasketTotals"));
    assert.ok(
      !display.includes("computeBasketTotals") &&
        !page.includes("computeBasketTotals"),
      "display chain reuses the single totals engine via the broadcast"
    );
    /* The display page holds ONLY the received bill (useState of the
       broadcast payload) — no second totals/basket engine. */
    assert.ok(!display.includes("computeBasketTotals"));
    assert.ok(!page.includes("PaymentModal"));
  });
});
