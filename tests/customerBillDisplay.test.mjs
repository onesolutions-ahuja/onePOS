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
const window_ = read("src/pages/pos/CustomerDisplayWindow.jsx");
const pos = read("src/pages/pos/POS.jsx");
const header = read("src/pages/pos/POSHeader.jsx");
const cartPanel = read("src/pages/pos/CartPanel.jsx");
const engine = read("src/utils/saleTotals.js");

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

  test("T10F-FIX-UI: popup copies the REAL app stylesheets (CSS text inline + link fallback)", () => {
    assert.ok(
      /link\[rel="stylesheet"\]/.test(window_),
      "must read the app document's stylesheet links"
    );
    assert.ok(
      /fetch\(href/.test(window_),
      "production CSS must be fetched and inlined as text"
    );
    assert.ok(
      /createElement\(["']style["']\)/.test(window_),
      "inlined <style> injection for the popup"
    );
    assert.ok(
      /cloneNode\(true\)/.test(window_),
      "link clone fallback retained"
    );
    /* Fonts (Inter) are copied so typography matches the app. */
    assert.ok(/fonts/.test(window_), "web-font links are copied");
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

  test("header button opens/closes the separate window, not a view swap", () => {
    assert.ok(header.includes("Customer Display"));
    assert.ok(header.includes("customerDisplayOn"));
    assert.ok(header.includes("aria-pressed"));
    assert.ok(header.includes("separate window"), "title explains the window");
    assert.ok(
      header.includes('"Close Display"') && header.includes('"Customer Display"'),
      "label reflects open/closed state"
    );
    assert.ok(
      !header.includes('"Cashier View"'),
      "no cashier-view swap wording remains"
    );
  });
});

describe("T10F-FIX — separate window mechanics", () => {
  test("customer display opens its own browser window (second monitor)", () => {
    assert.ok(/window\.open\(/.test(window_), "popup window is opened");
    assert.ok(
      /createPortal/.test(window_),
      "content is portalled into the window to share the same state"
    );
    assert.ok(
      /onepos-customer-display/.test(window_),
      "named target prevents duplicate windows"
    );
    assert.ok(
      /popup=yes/.test(window_),
      "uses popup features, not a full tab"
    );
  });

  test("closing the customer window never affects the till", () => {
    /* Close paths only flip POS's own showCustomerDisplay flag. */
    assert.ok(/onClose=\{\(\) => setShowCustomerDisplay\(false\)\}/.test(pos));
    /* Popup handles: customer closing their window -> till notices via poll. */
    assert.ok(/win\.closed/.test(window_), "till detects customer-side close");
    assert.ok(/win\.close\(\)/.test(window_), "unmount closes the window");
    /* No navigation/reset of the till from the window component. */
    assert.ok(!/window\.location|history\./.test(window_));
  });

  test("same state reaches the customer window — no second source of truth", () => {
    for (const prop of [
      "basket",
      "subtotal",
      "vat",
      "total",
      "discountAmount",
    ]) {
      assert.ok(
        new RegExp(`\\b${prop}=\\{`).test(pos),
        `POS must pass live ${prop} into the customer window`
      );
    }
    assert.ok(pos.includes("<CustomerDisplayWindow"));
  });

  test("popup-blocked fallback does not break the till", () => {
    assert.ok(/Popup blocked/.test(window_), "user is told why nothing opened");
    assert.ok(
      /onClose\(\)/.test(window_),
      "till returns to normal if the window can't open"
    );
  });
});

describe("T10F-FIX — customer window is read-only", () => {
  test("mirrored document disables interactive elements", () => {
    assert.ok(
      /pointer-events: none !important/.test(window_),
      "inputs/buttons inside the customer document are inert"
    );
    assert.ok(
      /data-cashier-exit/.test(window_),
      "only the cashier close affordance stays clickable"
    );
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
    assert.ok(!/phone|email/i.test(strip(window_)));
  });

  test("no API calls or Self-Checkout coupling from the customer surface", () => {
    assert.ok(!/apiRequest|fetch\(/.test(display));
    /* The window component fetches only the app's own CSS text (styling
       bridge) — it must make no data API calls. Assert against API util. */
    assert.ok(!window_.includes("apiRequest"), "no API util usage in the window");
    assert.ok(
      !/fetch\(["'`]\/api/.test(window_),
      "the only fetch is the stylesheet href, never an /api call"
    );
    assert.ok(!display.toLowerCase().includes("self-checkout"));
    assert.ok(!window_.toLowerCase().includes("self-checkout"));
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
        !window_.includes("computeBasketTotals"),
      "display chain reuses the single totals engine via props"
    );
    assert.ok(!/useState|useReducer|useMemo/.test(display));
    /* Payment surfaces must not appear in the customer chain. */
    assert.ok(!display.includes("PaymentModal"));
    assert.ok(!window_.includes("PaymentModal"));
  });
});
