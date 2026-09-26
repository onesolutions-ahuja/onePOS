import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockSource = readFileSync(new URL("../src/components/AdminNavDock.jsx", import.meta.url), "utf8");
const dockCss = readFileSync(new URL("../src/components/AdminNavDock.css", import.meta.url), "utf8");
const jarvisSource = readFileSync(new URL("../src/components/jarvis/JarvisStyles.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cornerSource = readFileSync(new URL("../src/components/jarvis/JarvisCorner.jsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/components/jarvis/JarvisPanel.jsx", import.meta.url), "utf8");
const posSource = readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");

test("dock reserves an in-flow JARVIS centre zone so the orb never overlaps icons", () => {
  assert.match(dockSource, /<JarvisCorner embedded \/>/);
  /* Centre-zone width comes from the shared --dock-center-zone variable, so
     CSS and JSX quote the same number. */
  assert.match(dockSource, /w-\[var\(--dock-center-zone\)\] shrink-0/);
  assert.match(dockSource, /inset-x-0 flex justify-center/);
  assert.doesNotMatch(dockSource, /"LEFT"/);
  assert.match(dockSource, /admin-nav-dock-center relative z-10/);
});

test("dock bar is 60px tall with a 65px orb — one shared source", () => {
  assert.match(jarvisSource, /--dock-height: 60px/);
  assert.match(jarvisSource, /--dock-center-zone: 120px/);
  assert.match(jarvisSource, /--jarvis-orb-size: 65px/);
  /* The bar consumes the shared variable instead of its own px value. */
  assert.match(jarvisSource, /\.admin-nav-dock \{[\s\S]*height: var\(--dock-height\);/);
  /* Floating pill: full rounding, and ONE gap under the bar for every surface —
     the admin /app pages and the till render the same dock, so there is no
     per-surface offset any more. Safe-area handling stays in the CSS. */
  assert.match(dockSource, /rounded-\[32px\]/);
  assert.match(dockSource, /admin-nav-dock-root inset-x-0 flex justify-center/);
  assert.doesNotMatch(dockSource, /admin-nav-dock-root[^"]*bottom-/);
  assert.match(dockCss, /--dock-bottom: 12px/);
  assert.match(dockCss, /--dock-offset-bottom: max\(var\(--dock-bottom\), calc\(env\(safe-area-inset-bottom, 0px\) \+ var\(--dock-bottom\)\)\)/);
  assert.match(dockCss, /padding-inline: max\(8px, env\(safe-area-inset-left, 0px\), env\(safe-area-inset-right, 0px\)\)/);
  assert.match(dockCss, /bottom: var\(--dock-offset-bottom\)/);
  assert.doesNotMatch(dockSource, /isTill/);
});

test("JARVIS remains viewport-centered for the standalone POS surface", () => {
  assert.match(jarvisSource, /\.jarvis-corner \{[\s\S]*left: 50%;[\s\S]*transform: translateX\(-50%\)/);
  assert.match(jarvisSource, /safe-area-inset-bottom/);
  assert.match(jarvisSource, /\.jarvis-corner\.jarvis-dock-anchor/);
});

test("JARVIS orb and glass circle use shared proportional sizing and exact centering", () => {
  assert.match(jarvisSource, /--jarvis-orb-size: 65px/);
  assert.match(jarvisSource, /--jarvis-circle-size: calc\(var\(--jarvis-orb-size\) \* 1\.2\)/);
  assert.match(jarvisSource, /\.jarvis-orb-container \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.match(jarvisSource, /\.jarvis-orb-video \{[\s\S]*width: var\(--jarvis-orb-size\);[\s\S]*height: var\(--jarvis-orb-size\);[\s\S]*transform: none;/);
  assert.match(jarvisSource, /@media \(max-width: 640px\) \{[\s\S]*--jarvis-orb-size: 46px/); /* unchanged */
  assert.doesNotMatch(jarvisSource, /\.jarvis-orb-video \{[\s\S]*translate\(2px, 2px\)/);
});

test("JARVIS presentation is not hidden by a licence entitlement", () => {
  assert.doesNotMatch(appSource, /jarvisEnabled|fetchJarvesEnabled|\/api\/settings\/jarves/);
  /* The dock is the single JARVES launcher: App no longer mounts a standalone
     orb next to the till — the till page hosts the dock (which embeds it). */
  assert.doesNotMatch(appSource, /<JarvisCorner/);
});

test("admin mode has one authoritative dock launcher", () => {
  const adminBranch = appSource.slice(appSource.indexOf('if (view === "admin")'), appSource.indexOf('return (', appSource.indexOf('if (view === "admin")') + 1));
  assert.doesNotMatch(adminBranch, /<JarvisCorner|AdminNavDock/, "Admin branch must not mount the standalone orb");
  assert.match(dockSource, /<JarvisCorner embedded \/>/);
  assert.equal((appSource.match(/<JarvisCorner(?:\s+embedded)?\s*\/>/g) || []).length, 0, "App must not add another launcher render");
});

test("ONE canonical dock serves the admin pages and the till", () => {
  /* Both surfaces mount the same component with the same markup — the till
     supplies its own exits, never its own dockbar, copy or variant. */
  assert.match(posSource, /<DockHost/);
  assert.match(posSource, /page="Sales"/);
  assert.match(layoutSource, /<AdminNavDock\s*\n\s*items=\{items\}/);
  assert.match(dockSource, /import "\.\/AdminNavDock\.css";/);
  assert.doesNotMatch(posSource, /variant="till"/);
  assert.doesNotMatch(layoutSource, /variant="admin"/);
  assert.doesNotMatch(dockSource, /variant\s*=|variant ===/, "no per-surface variant survives");
  assert.doesNotMatch(dockSource, /compact=/, "no per-surface orb variant survives");
  /* The leftover till status bar is not mounted by either surface. */
  assert.doesNotMatch(posSource, /BottomStatusBar/);
});

test("the status bar and scrollable shell share exact dock clearance", () => {
  const statusBar = readFileSync(new URL("../src/components/BottomStatusBar.jsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(statusBar, /bottom: "calc\(var\(--dock-offset-bottom,[\s\S]*?var\(--dock-height, 60px\) \+ 6px\)"/);
  assert.match(indexCss, /padding-bottom: calc\(var\(--dock-height, 60px\) \+ var\(--dock-offset-bottom,[\s\S]*?42px \+ 26px\)/);
  assert.match(indexCss, /padding-bottom: calc\(var\(--dock-height, 60px\) \+ var\(--dock-offset-bottom,[\s\S]*?42px \+ 20px\)/);
});

test("responsive dock wings stay single-row, scrollable, and touch-reachable", () => {
  assert.match(dockSource, /TABLET_QUERY = "\(max-width: 900px\)"/);
  assert.match(dockSource, /TABLET_SLOT_LIMIT = 4/);
  assert.match(dockSource, /EXTRA_COMPACT_QUERY = "\(max-width: 360px\)"/);
  assert.match(dockSource, /EXTRA_COMPACT_SLOT_LIMIT = 1/);
  assert.match(dockCss, /@media \(max-width: 900px\)[\s\S]*?--dock-slot-width: clamp\(64px, 8vw, 76px\)/);
  assert.match(dockCss, /@media \(max-width: 640px\)[\s\S]*?--dock-slot-width: clamp\(48px, 12vw, 58px\)/);
  assert.match(dockCss, /@media \(max-width: 480px\)[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;[\s\S]*?touch-action: pan-x/);
  assert.doesNotMatch(dockCss, /@media \(max-width: 480px\)[\s\S]*?overflow: hidden/);
  assert.match(dockCss, /min-width: 48px;[\s\S]*?min-height: 48px/);
  assert.match(dockSource, /aria-label=\{title \|\| label\}/);
  assert.match(dockSource, /title=\{title \|\| label\}/);
  assert.match(dockSource, /<DockSlot[\s\S]*?label="Apps"/);
  assert.match(dockSource, /<DockSlot[\s\S]*?label="Settings"/);
  assert.match(dockSource, /label=\{surface === "till" \? "Admin" : "Till"\}/);
});

test("Jarvis pocket and overlay follow responsive and safe-area dock metrics", () => {
  assert.match(dockCss, /@media \(max-width: 640px\)[\s\S]*?--dock-center-zone: clamp\(64px, 12vw, 82px\)/);
  assert.match(dockCss, /@media \(max-width: 480px\)[\s\S]*?--dock-center-zone: clamp\(56px, 16vw, 76px\)/);
  assert.match(jarvisSource, /@media \(max-width: 640px\)[\s\S]*?--jarvis-orb-size: 46px/);
  assert.match(jarvisSource, /\.jarvis-corner\.jarvis-dock-anchor \.jarvis-mic-status--corner \{[\s\S]*width: 10px;[\s\S]*height: 10px/);
  assert.match(jarvisSource, /\.jarvis-corner\.jarvis-dock-anchor \.jarvis-mic-status--corner > svg \{[\s\S]*display: none/);
  assert.match(jarvisSource, /padding: 0\.75rem 0\.75rem calc\(var\(--dock-height\) \+ var\(--dock-offset-bottom/);
  assert.match(jarvisSource, /bottom: calc\(var\(--dock-height\) \+ var\(--dock-offset-bottom/);
  assert.match(dockSource, /bottom-\[calc\(var\(--dock-height\)\+var\(--dock-offset-bottom\)\+16px\)\]/);
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /viewport-fit=cover/);
  assert.match(appSource, /pb-\[calc\(var\(--dock-height\)\+var\(--dock-offset-bottom\)\+32px\)\]/);
});

test("nothing rises behind JARVIS — the dockbar stays one continuous surface", () => {
  /* The raised/curved rectangular pedestal (a ::before tab above the bar) is
     removed; the centre zone keeps only the soft contact shadow of the orb. */
  assert.doesNotMatch(dockCss, /\.admin-nav-dock-center::before/);
  assert.doesNotMatch(dockCss, /border-radius: 72px 72px 0 0/);
  assert.match(dockCss, /\.admin-nav-dock-center::after/);
  assert.match(dockCss, /\.admin-nav-dock-center \{[\s\S]*flex: 0 0 var\(--dock-center-zone\)/, "JARVIS keeps its reserved centre zone");
});

test("offline state reuses the authoritative connectivity source and only shadows the dock", () => {
  /* Same source POSHeader, POS and App consume — the dock adds no checker and
     never reads navigator.onLine itself. */
  assert.match(dockSource, /from "\.\.\/services\/connectivity\.js"/);
  assert.match(dockSource, /getConnectivity/);
  assert.match(dockSource, /subscribeConnectivity\(setConnectivity\)/);
  assert.match(dockSource, /startConnectivityMonitoring/);
  assert.match(dockSource, /SERVER_STATES\.UNREACHABLE/);
  assert.match(dockSource, /INTERNET_STATES\.DISCONNECTED/);
  assert.doesNotMatch(dockSource, /navigator\.onLine/);
  assert.match(dockSource, /data-connectivity=\{offline \? "offline" : "online"\}/);
  /* CSS: the normal dock shadow plus a subtle red outer glow — no red dock,
     no icon colour change, and the rule only fires while offline. */
  assert.match(dockCss, /--dock-offline-shadow:\s*0 0 0 1px rgba\(248,113,113,\.34\),\s*0 0 20px 3px rgba\(248,113,113,\.26\),\s*0 14px 40px rgba\(4,26,24,\.45\),\s*0 3px 10px rgba\(4,26,24,\.30\),\s*inset 0 1px 0 rgba\(255,255,255,\.10\)/);
  assert.match(dockCss, /\.admin-nav-dock\[data-connectivity="offline"\]\s*\{\s*box-shadow: var\(--dock-offline-shadow\)/);
  assert.match(dockCss, /--dock-shadow:\s*0 14px 40px rgba\(4,26,24,\.45\)/);
});

test("dock JARVIS panel is an above-dock overlay with Escape support", () => {
  assert.match(cornerSource, /<JarvisPanel[\s\S]*embedded=\{embedded\}/);
  assert.match(cornerSource, /createPortal/);
  assert.match(panelSource, /jarvis-panel-overlay--dock/);
  assert.match(panelSource, /event\.key === "Escape"/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay \{[\s\S]*z-index: 960/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock \{[\s\S]*justify-content: center/);
  assert.match(jarvisSource, /calc\(var\(--dock-height\) \+ var\(--dock-offset-bottom,[\s\S]*?\) \+ 16px\)/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay \{[\s\S]*pointer-events: none/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \.jarvis-panel-backdrop \{[\s\S]*bottom: calc\(var\(--dock-height\) \+ var\(--dock-offset-bottom,[\s\S]*?\) \+ 16px\)/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \[data-testid="jarvis-panel"\] \{[\s\S]*pointer-events: auto/);
});

test("dock panel backdrop stops above the dock so dock controls remain reachable", () => {
  assert.match(panelSource, /className="jarvis-panel-backdrop absolute inset-0 bg-black\/40"/);
  assert.doesNotMatch(panelSource, /<JarvisOrb/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \.jarvis-panel-backdrop/);
});
