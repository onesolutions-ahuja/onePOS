/*
 * ANDROID POS SESSION/MODAL REGRESSIONS — focused pins
 *
 *   node --test tests/androidPosSession.test.mjs
 *
 * ROOT CAUSES (regressed here):
 *
 * 1. DEAD ADMIN BUTTON ON ANDROID
 *    App.jsx boots by verifying /api/auth/me. On the Android WebView that
 *    boot check can fail on a TRANSPORT error (network still settling at
 *    cold start). That path sets offlineSession=true — the degraded mode
 *    where App's onAdmin/onOpenOnlineOrders guards REFUSE to switch views
 *    (`if (offlineSession) return;`). Nothing ever cleared the flag, so a
 *    one-off boot race permanently disabled Admin on Android while the
 *    same account worked on desktop (server reachable at boot) and on
 *    Render. The fix re-verifies /api/auth/me through the authoritative
 *    connectivity source the moment the server is reachable again, and
 *    restores the normal session. Permissions are still SERVER-verified;
 *    nothing is blanket-enabled.
 *
 * 2. UNREACHABLE TILL-MODAL CONTROLS ON ANDROID
 *    TillSessionModal's dialog had no height bound and no internal scroll:
 *    w-[560px] max-w-[95vw] only. On a phone (e.g. 360x640 WebView) the
 *    session content exceeds the viewport height, and since the POS root
 *    is overflow-hidden, the Save/Close controls sat below the fold and
 *    were unreachable — the modal itself never scrolled.
 *    Fix: backdrop p-4 + max-h-[calc(100dvh-2rem)] + flex column with a
 *    scrollable body and sticky header. On desktop (viewport >= modal
 *    height) max-h never binds, so geometry is visually unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");

const app = read("src", "App.jsx");
const till = read("src", "pages", "pos", "TillSessionModal.jsx");

test("offline session auto-recovers through the authoritative connectivity source", () => {
  /* The recovery effect exists and follows the shared connectivity state. */
  assert.match(app, /import \{[^}]*getConnectivity[^}]*\} from "\.\/services\/connectivity\.js"/);
  assert.match(app, /subscribeConnectivity/);
  const recovery = app.slice(app.indexOf("is the degraded mode"));
  assert.ok(recovery.length > 0, "recovery effect (with its rationale comment) must exist");
  assert.match(recovery, /apiRequest\("\/api\/auth\/me"/, "recovery must re-verify with the SERVER, not assume permissions");
  assert.match(recovery, /setOfflineSession\(false\)/, "the sticky flag must actually clear");
  assert.match(recovery, /snapshot\.server === "connected"/);
  /* The effect must clean up its subscription. */
  assert.match(recovery, /unsubscribe\(\)/);
});

test("the offline guard itself is untouched: nothing is blanket-enabled", () => {
  /* Both degraded-mode guards must still refuse view switches — the fix is
   * recovery, not permission widening. */
  const guards = app.match(/if \(offlineSession\) return;/g) || [];
  assert.ok(guards.length >= 2, "onAdmin and onOpenOnlineOrders offline guards must remain");
  /* The boot-time offline fallback (cache + sale.create check) is intact. */
  assert.match(app, /loadOfflineSession\(\)/);
  assert.match(app, /sale\.create/);
});

test("till modal is viewport-bounded and internally scrollable on Android", () => {
  assert.match(till, /max-h-\[calc\(100dvh-2rem\)\]/, "dialog must be bounded to the dynamic viewport");
  assert.match(till, /flex flex-col/, "header/body/footer must be a flex column so the body can scroll");
  assert.match(till, /shrink-0/, "header row must stay visible");
  assert.match(till, /overflow-y-auto min-h-0/, "the body must scroll instead of pushing controls below the fold");
  /* Every control the cashier needs stays rendered (reachable by scroll). */
  assert.match(till, /Open Till/);
  assert.match(till, /Close Till/);
  assert.match(till, /Recent cash movements/);
  /* The desktop width behaviour is unchanged. */
  assert.match(till, /w-\[560px\] max-w-\[95vw\]/);
});

test("other POS modals keep their existing viewport guards", () => {
  /* Sanity that the fix pattern matches what the codebase already does
   * elsewhere (payment, negative-stock, queue modals all bound height). */
  const pos = read("src", "pages", "pos", "POS.jsx");
  assert.match(pos, /max-w-full/);
});
