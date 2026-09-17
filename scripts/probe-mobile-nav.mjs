/** Focused probe of the mobile nav accordion (does it really expand?). */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = spawn(
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=9444`,
   `--user-data-dir=${mkdtempSync(join(tmpdir(), "onepos-probe-"))}`, "about:blank"],
  { stdio: "ignore" }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let url;
for (let i = 0; i < 60 && !url; i++) {
  await sleep(250);
  try {
    const list = await (await fetch("http://127.0.0.1:9444/json/list")).json();
    url = list.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.navigate", { url: "http://127.0.0.1:10000/pos" });
await sleep(3500);

const snap = (label) => evaluate(`(() => {
  const m = document.querySelector('.mobile-nav');
  const t = document.querySelector('.mobile-toggle');
  const labels = m ? [...m.querySelectorAll('.mobile-nav-label')] : [];
  return {
    step: ${JSON.stringify(label)},
    navPresent: !!m,
    navDisplay: m ? getComputedStyle(m).display : null,
    toggleOpen: t ? t.className.includes('is-open') : null,
    labels: labels.length,
    labelTexts: labels.map(b => b.innerText.trim()).slice(0, 8),
    anchors: m ? m.querySelectorAll('a').length : 0,
    tops: m ? [...m.querySelectorAll(':scope > .mobile-nav-item')].length : 0,
  };
})()`);

console.log(JSON.stringify(await snap("initial"), null, 1));

await evaluate(`document.querySelector('.mobile-toggle').click()`);
await sleep(400);
console.log(JSON.stringify(await snap("after toggle click"), null, 1));

await evaluate(`(() => { const l = document.querySelector('.mobile-nav-label'); if (l) l.click(); return !!l; })()`);
await sleep(450);
console.log(JSON.stringify(await snap("after first group click"), null, 1));

await evaluate(`(() => { const l = document.querySelectorAll('.mobile-nav-label')[1]; if (l) l.click(); return !!l; })()`);
await sleep(450);
console.log(JSON.stringify(await snap("after second group click"), null, 1));

ws.close();
chrome.kill();
try { rmSync(join(tmpdir(), "onepos-probe-"), { recursive: true, force: true }); } catch {}
process.exit(0);