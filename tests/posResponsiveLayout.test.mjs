/*
 * POS RESPONSIVE LAYOUT — regression pins for the three viewport tiers.
 *
 *   node --test tests/posResponsiveLayout.test.mjs
 *
 * ROOT CAUSE (regressed here):
 *   The till was a rigid 3-pane flex row — CartPanel w-[350px] shrink-0 +
 *   a 150px shrink-0 category rail — inside POS.jsx's h-screen
 *   overflow-hidden root. On a 393px phone viewport the two shrink-0 panes
 *   alone (500px) exceeded the width, so the cart column was clipped past
 *   the right edge (overflow-hidden turns overflow into clipping, not a
 *   scrollbar); on tablets the 8-button action bar and the header's right
 *   cluster clipped the same way.
 *
 * These are static contract pins on the sources (the components need a
 * real browser to render). They fail if any fixed-width assumption
 * returns without a responsive escape:
 *   - POS root sizes itself with 100dvh (Android WebView-safe) and keeps
 *     overflow-hidden.
 *   - The desktop cart column exists only inside a `hidden md:flex`
 *     wrapper; the phone tier renders MobileCartSheet (bottom bar + sheet).
 *   - The category rail is `hidden md:flex` with responsive widths; the
 *     phone tier gets a horizontal scroll chip row (`md:hidden`).
 *   - The till action bar wraps (flex-wrap + min-h) instead of one 58px row.
 *   - The header's right-side controls cannot push past the viewport
 *     (shrink-0 cluster; labels collapse below md; left side truncates).
 *   - The legacy src/style.css (dead `body { min-width: 1100px }` trap)
 *     must stay deleted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

const pos = read("src", "pages", "pos", "POS.jsx");
const grid = read("src", "pages", "pos", "ProductGrid.jsx");
const cart = read("src", "pages", "pos", "CartPanel.jsx");
const header = read("src", "pages", "pos", "POSHeader.jsx");
const sheet = read("src", "pages", "pos", "MobileCartSheet.jsx");

test("POS root uses dynamic viewport height (100dvh) for Android WebView", () => {
  assert.match(
    pos,
    /h-\[100dvh\][^\n]*overflow-hidden/,
    "the till root must size to 100dvh and keep overflow-hidden"
  );
  assert.doesNotMatch(pos, /className="h-screen[^\n]*overflow-hidden/, "legacy 100vh root must be gone");
});

test("wide tier: the 350px cart column exists only inside a md+ wrapper", () => {
  assert.match(cart, /w-\[350px\][^\n]*shrink-0/, "CartPanel keeps its till-tier geometry");
  /* In POS.jsx the CartPanel usage must sit inside the md+ wrapper. */
  const wrapperIdx = pos.indexOf('className="hidden md:flex h-full min-h-0"');
  const cartIdx = pos.indexOf("<CartPanel");
  const wrapperCloseIdx = pos.indexOf("</CartPanel");
  assert.ok(wrapperIdx !== -1, "md+ cart wrapper missing");
  assert.ok(cartIdx > wrapperIdx && pos.indexOf("</div>", wrapperCloseIdx) !== -1);
});

test("phone tier: MobileCartSheet is rendered and is phone-only", () => {
  assert.match(pos, /import MobileCartSheet from "\.\/MobileCartSheet\.jsx"/);
  assert.match(pos, /<MobileCartSheet/);
  /* The sheet component itself only shows below md. */
  assert.match(sheet, /className="md:hidden border-t border-slate-200 bg-white shrink-0"/);
  assert.match(sheet, /className="md:hidden fixed inset-0 z-50 flex items-end"/);
  /* It receives the same cart contract as CartPanel (props appear in the
     component signature and/or the POS usage). */
  for (const prop of ["basket", "miscLines", "onRemoveMiscLine", "selectedCustomer", "onCustomerClick",
    "onCustomerRemove", "saleError", "saleMessage", "onIncrease", "onDecrease", "onUpdateQuantity",
    "onRemoveItem", "subtotal", "vat", "total", "onCheckout"]) {
    const inSignature = new RegExp(`\\b${prop}\\b`).test(sheet);
    const inUsage = new RegExp(`\\b${prop}=`).test(pos);
    assert.ok(inSignature && inUsage, `MobileCartSheet must honour the ${prop} contract`);
  }
  /* Same testids as the desktop cart so behaviour tests stay valid. */
  assert.match(sheet, /data-testid="mobile-payment-button"/);
  assert.match(sheet, /data-testid="cart-qty"/);
  assert.match(sheet, /data-testid="misc-cart-line"/);
});

test("category rail: fixed 150px column only at md+; phones get scroll chips", () => {
  assert.match(
    grid,
    /hidden md:flex md:w-\[120px\] xl:w-\[150px\][^\n]*shrink-0/,
    "the vertical rail must be hidden below md and keep till-tier widths at xl"
  );
  assert.match(grid, /md:hidden[^\n]*overflow-x-auto/, "phone tier needs the horizontal chip row");
  /* Chip row uses the same category contract. */
  const chipRow = grid.slice(grid.indexOf("md:hidden"), grid.indexOf("<div className=\"flex gap-2 mb-3\">"));
  assert.match(chipRow, /onCategoryChange\(item\)/);
  assert.match(chipRow, /Most Selling/);
});

test("product grid adapts between 2 and 5 columns across tiers", () => {
  assert.match(
    grid,
    /grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5/,
    "image view must scale columns with the viewport"
  );
});

test("till action bar wraps instead of clipping on narrow viewports", () => {
  assert.match(
    pos,
    /min-h-\[58px\][^\n]*flex flex-wrap items-center/,
    "the 8-button action bar must wrap (min-h + flex-wrap), not hold one fixed 58px row"
  );
  /* Same handlers remain wired. */
  for (const id of ["misc-item-button", "petty-cash-button", "print-button"]) {
    assert.match(pos, new RegExp(`data-testid="${id}"`));
  }
});

test("POS header right-side controls can never overflow the viewport", () => {
  const rightCluster = header.slice(header.indexOf("RIGHT SIDE"));
  assert.match(rightCluster, /shrink-0/, "the right cluster must be shrink-0");
  assert.match(header, /min-h-\[58px\]|h-\[58px\]/);
  /* Left side truncates instead of pushing right controls out. */
  assert.match(header, /min-w-0 truncate/);
  /* Labels collapse below md so the cluster fits small widths. */
  assert.match(rightCluster, /hidden md:inline">Manage Till/);
  assert.match(rightCluster, /hidden md:inline">Online Orders/);
  assert.match(rightCluster, /hidden sm:inline">Admin/);
});

test("legacy dead stylesheet with the body min-width:1100px trap stays deleted", () => {
  const legacy = path.join(root, "src", "style.css");
  assert.ok(!fs.existsSync(legacy), "src/style.css is dead CSS (imported nowhere) and its body min-width:1100px must not come back");
});
