import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockSource = readFileSync(new URL("../src/components/AdminNavDock.jsx", import.meta.url), "utf8");
const jarvisSource = readFileSync(new URL("../src/components/jarvis/JarvisStyles.jsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const cornerSource = readFileSync(new URL("../src/components/jarvis/JarvisCorner.jsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../src/components/jarvis/JarvisPanel.jsx", import.meta.url), "utf8");

test("dock uses an independent JARVIS center anchor instead of flex-item centering", () => {
  assert.match(dockSource, /<JarvisCorner embedded \/>/);
  assert.match(dockSource, /w-\[66px\] shrink-0/);
  assert.match(dockSource, /inset-x-0 flex justify-center/);
  assert.doesNotMatch(dockSource, /"LEFT"/);
});

test("JARVIS remains viewport-centered for the standalone POS surface", () => {
  assert.match(jarvisSource, /\.jarvis-corner \{[\s\S]*left: 50%;[\s\S]*transform: translateX\(-50%\)/);
  assert.match(jarvisSource, /safe-area-inset-bottom/);
  assert.match(jarvisSource, /\.jarvis-corner\.jarvis-dock-anchor/);
});

test("JARVIS orb and glass circle use shared proportional sizing and exact centering", () => {
  assert.match(jarvisSource, /--jarvis-orb-size: 50px/);
  assert.match(jarvisSource, /--jarvis-circle-size: calc\(var\(--jarvis-orb-size\) \* 1\.2\)/);
  assert.match(jarvisSource, /\.jarvis-orb-container \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.match(jarvisSource, /\.jarvis-orb-video \{[\s\S]*width: var\(--jarvis-orb-size\);[\s\S]*height: var\(--jarvis-orb-size\);[\s\S]*transform: none;/);
  assert.match(jarvisSource, /@media \(max-width: 640px\) \{[\s\S]*--jarvis-orb-size: 40px/);
  assert.doesNotMatch(jarvisSource, /\.jarvis-orb-video \{[\s\S]*translate\(2px, 2px\)/);
});

test("JARVIS presentation is not hidden by a licence entitlement", () => {
  assert.doesNotMatch(appSource, /jarvisEnabled|fetchJarvesEnabled|\/api\/settings\/jarves/);
  assert.match(appSource, /<JarvisCorner \/>/);
});

test("admin mode has one authoritative dock launcher", () => {
  const adminBranch = appSource.slice(appSource.indexOf('if (view === "admin")'), appSource.indexOf('return (', appSource.indexOf('if (view === "admin")') + 1));
  assert.doesNotMatch(adminBranch, /<JarvisCorner \/>/, "Admin must not mount the standalone orb");
  assert.match(dockSource, /<JarvisCorner embedded \/>/);
  assert.equal((appSource.match(/<JarvisCorner(?:\s+embedded)?\s*\/>/g) || []).length, 1, "App must not add another launcher render");
});

test("dock JARVIS panel is an above-dock overlay with Escape support", () => {
  assert.match(cornerSource, /<JarvisPanel[\s\S]*embedded=\{embedded\}/);
  assert.match(panelSource, /jarvis-panel-overlay--dock/);
  assert.match(panelSource, /event\.key === "Escape"/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay \{[\s\S]*z-index: 70/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock \{[\s\S]*justify-content: center/);
  assert.match(jarvisSource, /calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay \{[\s\S]*pointer-events: none/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \.jarvis-panel-backdrop \{[\s\S]*bottom: calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \[data-testid="jarvis-panel"\] \{[\s\S]*pointer-events: auto/);
});

test("dock panel backdrop stops above the dock so dock controls remain reachable", () => {
  assert.match(panelSource, /className="jarvis-panel-backdrop absolute inset-0 bg-black\/40"/);
  assert.doesNotMatch(panelSource, /<JarvisOrb/);
  assert.match(jarvisSource, /\.jarvis-panel-overlay--dock > \.jarvis-panel-backdrop/);
});
