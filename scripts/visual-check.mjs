/**
 * Renders the marketing site in headless Chrome over the DevTools protocol and
 * asserts: no console errors, CSS actually applied, no horizontal overflow,
 * the Log in CTA points at /login, and the mobile nav behaves.
 *
 * Usage: node scripts/visual-check.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const BASE = "http://127.0.0.1:10000";

const PAGES = [
  { path: "/", expect: [".site-header", ".hero-title"], text: ["The till. The stockroom.", "Log in to onePOS"] },
  { path: "/pos", expect: [".pos-shell", ".page-hero"], text: ["Fast checkout"] },
  { path: "/inventory", expect: [".app-shell", ".w-table"], text: ["movement"] },
  { path: "/purchasing", expect: [".app-shell"], text: ["Purchase"] },
  { path: "/multi-store", expect: [".app-shell", ".w-store-grid"], text: ["store"] },
  { path: "/online-orders", expect: [".w-order-list"], text: ["Uber Eats"] },
  { path: "/whatsapp", expect: [".wa-grid", ".phone"], text: ["WhatsApp"] },
  { path: "/integrations", expect: [".channel-grid", ".feature-card"], text: ["Integration"] },
  { path: "/platforms", expect: [".device-grid", ".section--dark"], text: ["offline"] },
  { path: "/hardware", expect: [".hw-strip"], text: ["scanner"] },
  { path: "/reports", expect: [".app-shell"], text: ["report"] },
  { path: "/security", expect: [".matrix", ".matrix-row"], text: ["permission"] },
  { path: "/ecosystem", expect: [".eco-grid", ".eco-card"], text: ["ecosystem"] },
  { path: "/faq", expect: [".faq-item", ".faq-q"], text: ["onePOS"] },
  { path: "/industry/grocery", expect: [".challenge-list"], text: ["Grocery"] },
  { path: "/customers", expect: [".feature-card", ".pillar-grid"], text: ["Customer"] },
  { path: "/suppliers", expect: [".feature-card"], text: ["Supplier"] },
  { path: "/employees", expect: [".feature-card"], text: ["permission"] },
];

const userDataDir = mkdtempSync(join(tmpdir(), "onepos-visual-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint never came up");
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

let msgId = 0;
const pending = new Map();
const problems = [];

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown") {
    problems.push(`EXCEPTION: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
  }
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
    problems.push(`CONSOLE: ${msg.params.entry.text} (${msg.params.entry.url || ""})`);
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    problems.push(`CONSOLE: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  }
});

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result.value;
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

const report = [];

async function load(path) {
  await send("Page.navigate", { url: BASE + path });
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const ready = await evaluate(`(() => {
      const root = document.getElementById('root');
      return document.readyState === 'complete' && root && root.children.length > 0;
    })()`).catch(() => false);
    if (ready) break;
  }
  await sleep(400);
}

const OVERFLOW_CHECK = `(() => {
  const de = document.documentElement;
  const wide = [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().width > window.innerWidth + 2)
    .slice(0, 4)
    .map(el => el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName);
  return { scrollW: de.scrollWidth, innerW: window.innerWidth, wide };
})()`;

const BASE_CHECK = `(() => {
  const btn = document.querySelector("a.btn-primary[href='/login'], a[href='/login']");
  const primary = document.querySelector('.btn-primary');
  const h1 = document.querySelector('h1, .hero-title');
  const header = document.querySelector('.site-header');
  const footer = document.querySelector('.site-footer');
  const h1cs = h1 ? getComputedStyle(h1) : null;
  const pcs = primary ? getComputedStyle(primary) : null;
  return {
    title: document.title,
    textLen: document.body.innerText.length,
    loginHref: btn ? btn.getAttribute('href') : null,
    h1size: h1cs ? h1cs.fontSize : null,
    h1color: h1cs ? h1cs.color : null,
    btnBg: pcs ? pcs.backgroundColor : null,
    headerBg: header ? getComputedStyle(header).backgroundColor : null,
    footerExists: !!footer,
    linkCount: document.querySelectorAll('a').length,
    unrendered: document.body.innerText.includes('NaN') || document.body.innerText.includes('undefined'),
    cssLoaded: !!h1cs && h1cs.fontSize !== '16px' && h1cs.fontFamily.toLowerCase().includes('inter'),
  };
})()`;

// ---------- desktop pass ----------
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

for (const page of PAGES) {
  await load(page.path);
  const base = await evaluate(BASE_CHECK);
  const of = await evaluate(OVERFLOW_CHECK);
  const missing = await evaluate(
    `(${JSON.stringify(page.expect)}).filter(sel => !document.querySelector(sel))`
  );
  const missingText = await evaluate(
    `(${JSON.stringify(page.text || [])}).filter(t => !document.body.innerText.includes(t))`
  );
  const bad = [];
  if (!base.cssLoaded) bad.push("CSS not applied");
  if (base.loginHref !== "/login") bad.push(`login CTA href=${base.loginHref}`);
  if (base.unrendered) bad.push("body contains NaN/undefined");
  if (of.scrollW > of.innerW + 2) bad.push(`h-overflow ${of.scrollW}>${of.innerW} [${of.wide.join(", ")}]`);
  if (missing.length) bad.push(`missing ${missing.join(", ")}`);
  if (missingText.length) bad.push(`missing text: ${missingText.join(" | ")}`);

  report.push({
    path: page.path,
    ok: bad.length === 0,
    title: base.title,
    text: base.textLen,
    h1: base.h1size,
    btnBg: base.btnBg,
    links: base.linkCount,
    problems: bad,
  });
}

// ---------- mobile pass ----------
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const mobile = [];
for (const path of ["/", "/pos", "/whatsapp", "/integrations", "/faq"]) {
  await load(path);
  const of = await evaluate(OVERFLOW_CHECK);
  const before = await evaluate(`(() => {
    const t = document.querySelector('.mobile-toggle');
    const d = document.querySelector('.desktop-nav');
    return {
      toggleVisible: t ? getComputedStyle(t).display !== 'none' : false,
      desktopHidden: d ? getComputedStyle(d).display === 'none' : true,
    };
  })()`);
  // click, then wait for React to flush before measuring the opened menu
  await evaluate(`(() => { const t = document.querySelector('.mobile-toggle'); if (t) t.click(); return true; })()`);
  await sleep(300);
  const after = await evaluate(`(() => {
    const m = document.querySelector('.mobile-nav');
    const t = document.querySelector('.mobile-toggle');
    return {
      opened: m ? getComputedStyle(m).display !== 'none' : false,
      collapsedLinks: m ? m.querySelectorAll('a').length : 0,
      isOpenClass: t ? t.className.includes('is-open') : false,
      loginInMenu: m ? !!m.querySelector("a[href='/login']") : false,
      groups: m ? m.querySelectorAll('.mobile-nav-label').length : 0,
    };
  })()`);
  // expand every accordion group, then count the full link set
  await evaluate(`(() => {
    document.querySelectorAll('.mobile-nav-label').forEach(b => b.click());
    return true;
  })()`);
  await sleep(400);
  const expanded = await evaluate(`(() => {
    const m = document.querySelector('.mobile-nav');
    return { links: m ? m.querySelectorAll('a').length : 0 };
  })()`);
  const bad = [];
  if (of.scrollW > of.innerW + 2) bad.push(`h-overflow ${of.scrollW}>${of.innerW} [${of.wide.join(", ")}]`);
  if (!before.toggleVisible) bad.push("mobile toggle not visible");
  if (!before.desktopHidden) bad.push("desktop nav still visible");
  if (!after.opened) bad.push("mobile menu did not open");
  if (!after.loginInMenu) bad.push("no login link in mobile menu");
  if (after.groups < 3) bad.push(`only ${after.groups} accordion groups`);
  if (expanded.links < 15) bad.push(`expanded menu only ${expanded.links} links`);
  mobile.push({ path, ok: bad.length === 0, menuLinks: expanded.links, groups: after.groups, problems: bad });
}

console.log("=== DESKTOP 1440px ===");
for (const r of report) {
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.path.padEnd(22)} text=${String(r.text).padStart(5)} h1=${r.h1} btn=${r.btnBg} links=${r.links}  ${r.title}`);
  r.problems.forEach((p) => console.log(`      -> ${p}`));
}

console.log("\n=== MOBILE 390px ===");
for (const m of mobile) {
  console.log(`${m.ok ? "OK  " : "FAIL"} ${m.path.padEnd(22)} menuLinks=${m.menuLinks}`);
  m.problems.forEach((p) => console.log(`      -> ${p}`));
}

console.log("\n=== CONSOLE / EXCEPTIONS ===");
if (problems.length === 0) console.log("none");
else [...new Set(problems)].slice(0, 25).forEach((p) => console.log(p));

const failed = report.filter((r) => !r.ok).length + mobile.filter((m) => !m.ok).length;
console.log(`\n${failed} page checks failed; ${new Set(problems).size} unique console errors`);

ws.close();
chrome.kill();
try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
process.exit(failed || problems.length ? 1 : 0);