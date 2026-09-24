/*
 * onePOS — shared RecordModal foundation (Phase 3C).
 *
 *   node --test tests/recordModal.test.mjs
 *
 * Two kinds of check:
 *   1. Real unit tests for the unsaved-change guard (pure module, no DOM).
 *   2. Source contracts for the JSX chrome and the shared stylesheet, matching
 *      the convention used by the other UI tests in this repo. The modal's
 *      interactive behaviour (Escape, overlay, focus trap) is wired through
 *      React effects, which this repo has no DOM test runner for, so those are
 *      pinned by contract rather than simulated.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolveCloseIntent, DISCARD_MESSAGE } from "../src/utils/recordModal.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

const MODAL = read("../src/components/RecordModal.jsx");
const LOGIC = read("../src/utils/recordModal.js");
const INDEX_CSS = read("../src/index.css");
const CHANGE_PW = read("../src/pages/settings/ChangePasswordModal.jsx");
const USER_FORM = read("../src/pages/settings/UserFormModal.jsx");
const SETTINGS_ADMIN = read("../src/pages/settings/SettingsAdmin.jsx");
const MSG_TEMPLATES = read("../src/pages/settings/MessageTemplatesAdmin.jsx");
const INVOICE_DELIVERY = read("../src/pages/settings/invoiceDeliverySettings.jsx");
const WHATSAPP = read("../src/pages/settings/whatsapp/WhatsAppSettings.jsx");
const SERVER_API = read("../src/pages/settings/ServerApiSettings.jsx");
const LICENSING = read("../src/pages/superadmin/LicensingAdmin.jsx");

/* The modal's own CSS section. */
const MODAL_CSS = INDEX_CSS.slice(
  INDEX_CSS.indexOf(".onepos-modal-overlay {"),
  INDEX_CSS.indexOf("/* Hide the desktop sidebar below the lg breakpoint"),
);

/* ------------------------------------------------------- 1. discard guard */

describe("1. unsaved-change guard", () => {
  test("a clean form closes without ever prompting", () => {
    let asked = 0;
    const closes = resolveCloseIntent({ dirty: false, confirmDiscard: () => { asked += 1; return true; } });
    assert.equal(closes, true);
    assert.equal(asked, 0, "must not prompt when nothing changed");
  });

  test("a dirty form prompts and closes only when the user confirms", () => {
    const seen = [];
    const closes = resolveCloseIntent({
      dirty: true,
      confirmDiscard: (message) => { seen.push(message); return true; },
    });
    assert.equal(closes, true);
    assert.deepEqual(seen, [DISCARD_MESSAGE]);
    assert.equal(DISCARD_MESSAGE, "Discard unsaved changes?");
  });

  test("a dirty form stays open when the user declines (data preserved)", () => {
    const closes = resolveCloseIntent({ dirty: true, confirmDiscard: () => false });
    assert.equal(closes, false);
  });

  test("only an explicit true confirms — a truthy return is not enough", () => {
    assert.equal(resolveCloseIntent({ dirty: true, confirmDiscard: () => "yes" }), false);
    assert.equal(resolveCloseIntent({ dirty: true, confirmDiscard: () => undefined }), false);
  });

  test("outside a browser the guard fails safe by allowing the close", () => {
    // No window in Node — the default must not throw.
    assert.equal(resolveCloseIntent({ dirty: true }), true);
  });

  test("the guard lives in a plain module so it stays testable", () => {
    assert.match(LOGIC, /export function resolveCloseIntent/);
    assert.doesNotMatch(LOGIC, /<[A-Za-z]/, "no JSX in the logic module");
  });
});

/* --------------------------------------------- 2. modal foundation contract */

describe("2. RecordModal foundation", () => {
  test("renders nothing at all while closed (lazy mount)", () => {
    assert.match(MODAL, /open = false/);
    assert.match(MODAL, /if \(!open\) return null;/);
  });

  test("supports create, edit and view modes with sensible footer labels", () => {
    assert.match(MODAL, /mode = "create"/);
    assert.match(MODAL, /const DEFAULT_SAVE_LABEL = \{ create: "Create", edit: "Save", view: "Close" \}/);
    assert.match(MODAL, /saveLabel \|\| DEFAULT_SAVE_LABEL\[mode\]/);
    assert.match(MODAL, /mode === "view" \?/, "view mode shows no submit button");
  });

  test("one structure for overlay, header, body and footer", () => {
    for (const cls of [
      "onepos-modal-overlay",
      "onepos-modal",
      "onepos-modal-header",
      "onepos-modal-title",
      "onepos-modal-subtitle",
      "onepos-modal-close",
      "onepos-modal-body",
      "onepos-modal-footer",
    ]) {
      assert.match(MODAL, new RegExp(cls), `${cls} missing from the modal`);
    }
    assert.match(MODAL, /SIZES\[size\]/, "the modal owns its own width");
  });

  test("the footer Save submits the caller's form by id (native validation)", () => {
    assert.match(MODAL, /type="submit"/);
    assert.match(MODAL, /form=\{formId\}/);
    assert.match(MODAL, /formId,/);
  });

  test("dialog semantics, accessible title and close control", () => {
    assert.match(MODAL, /role="dialog"/);
    assert.match(MODAL, /aria-modal="true"/);
    assert.match(MODAL, /aria-labelledby=\{titleId\}/);
    assert.match(MODAL, /const titleId = useId\(\)/);
    assert.match(MODAL, /id=\{titleId\}/);
    assert.match(MODAL, /aria-label="Close"/);
    assert.match(MODAL, /tabIndex=\{-1\}/, "the panel is focusable");
  });

  test("Escape, overlay click and close all route through the discard guard", () => {
    assert.match(MODAL, /if \(event\.key === "Escape"\)/);
    assert.match(MODAL, /event\.target === event\.currentTarget/, "overlay click only");
    assert.match(MODAL, /if \(!resolveCloseIntent\(\{ dirty, confirmDiscard \}\)\) return;/);
    assert.equal((MODAL.match(/onClose\?\.\(\)/g) || []).length, 1, "one guarded close path");
  });

  test("focus is trapped while open and returned to the trigger on close", () => {
    assert.match(MODAL, /const FOCUSABLE =/);
    assert.match(MODAL, /panel\.querySelectorAll\(FOCUSABLE\)/);
    assert.match(MODAL, /event\.shiftKey && document\.activeElement === first/);
    assert.match(MODAL, /restoreRef\.current = document\.activeElement/);
    assert.match(MODAL, /restore\.focus\(\)/);
  });

  test("the page behind the dialog cannot scroll", () => {
    assert.match(MODAL, /document\.body\.style\.overflow = "hidden"/);
    assert.match(MODAL, /document\.body\.style\.overflow = previousOverflow/);
  });

  test("saving blocks duplicate submissions and never closes on failure", () => {
    assert.match(MODAL, /disabled=\{saving \|\| saveDisabled\}/);
    assert.match(MODAL, /saving \? "Saving…"/);
    assert.doesNotMatch(MODAL, /onSave\?\.\(\);\s*\n\s*onClose/, "save must not auto-close");
  });

  test("is a record dialog only — it declares no module knowledge", () => {
    for (const word of ["user", "product", "customer", "supplier", "template"]) {
      assert.doesNotMatch(
        MODAL,
        new RegExp(`\\b${word}s?\\b`, "i"),
        `the foundation must not know about ${word}s`,
      );
    }
  });
});

/* --------------------------------------------------- 3. modal presentation */

describe("3. modal presentation comes from shared tokens", () => {
  test("surface, border, radius and shadow are tokens, not literals", () => {
    assert.match(MODAL_CSS, /background-color: var\(--onepos-card-bg/);
    assert.match(MODAL_CSS, /var\(--onepos-card-border/);
    assert.match(MODAL_CSS, /border-radius: var\(--onepos-modal-radius/);
    assert.match(MODAL_CSS, /box-shadow: var\(--onepos-shadow-raised\)/);
    assert.match(MODAL_CSS, /padding: var\(--onepos-card-pad/);
  });

  test("no hard-coded hex anywhere in the modal styles", () => {
    assert.doesNotMatch(MODAL_CSS, /#[0-9a-fA-F]{3,6}/);
    assert.doesNotMatch(MODAL, /#[0-9a-fA-F]{3,6}/);
  });

  test("the modal contains no preset branching", () => {
    assert.doesNotMatch(MODAL, /data-onepos-preset/);
    assert.doesNotMatch(MODAL_CSS, /data-onepos-preset/);
    assert.doesNotMatch(MODAL, /["'`](modern|enterprise|compact)["'`]/i);
  });

  test("Compact densifies through the shared tokens, not bespoke markup", () => {
    // The panel's own padding must be derived; the overlay's outer gutter is
    // page-level layout, not component density.
    const panel = MODAL_CSS.slice(MODAL_CSS.indexOf(".onepos-modal {"), MODAL_CSS.indexOf(".onepos-modal-header {"));
    assert.doesNotMatch(panel, /padding: \d+px/, "panel padding must come from --onepos-card-pad");
    assert.match(panel, /env\(safe-area-inset-top\)/, "panel padding is safe-area derived");
  });

  test("desktop is a centred dialog with an internal scroller", () => {
    assert.match(MODAL_CSS, /@media \(min-width: 640px\)/);
    assert.match(MODAL_CSS, /align-items: center/);
    assert.match(MODAL_CSS, /max-height: min\(85vh, 900px\)/);
    assert.match(MODAL_CSS, /\.onepos-modal-body \{[^}]*overflow-y: auto/);
    for (const [cls, width] of [
      ["sm", 400],
      ["md", 560],
      ["lg", 760],
      ["xl", 920],
    ]) {
      assert.match(MODAL_CSS, new RegExp(`\\.onepos-modal-${cls} \\{ width: ${width}px; \\}`));
    }
  });

  test("small screens become a full-screen sheet, not a second implementation", () => {
    // Same element: full height by default, radius only from sm up.
    assert.match(MODAL_CSS, /height: 100dvh; max-height: 100dvh/);
    assert.match(MODAL_CSS, /border-radius: 0/);
    assert.equal((MODAL.match(/role="dialog"/g) || []).length, 1, "one dialog only");
  });

  test("the sheet respects safe areas", () => {
    for (const edge of ["top", "bottom", "left", "right"]) {
      assert.match(MODAL_CSS, new RegExp(`env\\(safe-area-inset-${edge}\\)`));
    }
  });

  test("the overlay sits above the dock, status bar and mobile drawer", () => {
    const overlay = MODAL_CSS.slice(0, MODAL_CSS.indexOf(".onepos-modal {"));
    assert.match(overlay, /z-index: 80/);
  });

  test("a shared touch floor keeps Compact usable without per-component branching", () => {
    const floor = INDEX_CSS.slice(
      INDEX_CSS.indexOf("/* Touch safety floor."),
      INDEX_CSS.indexOf("/* Hide the desktop sidebar below the lg breakpoint"),
    );
    assert.match(floor, /@media \(pointer: coarse\), \(max-width: 639px\)/);
    assert.match(floor, /min-height: max\(var\(--onepos-control-height, 38px\), 40px\)/);
    for (const target of [".onepos-shell .onepos-btn", ".onepos-shell .onepos-input", ".onepos-modal .onepos-btn", ".onepos-modal .onepos-input"]) {
      assert.ok(floor.includes(target), `${target} should be floored on touch`);
    }
    /* The floor must not reach the deliberately different Till/POS touch design,
       so every selector has to be Admin-scoped — never a bare shared control
       that the Till also renders, and never a Till-specific class. */
    const rules = floor.replace(/\/\*[\s\S]*?\*\//g, "");
    /* Skip the @media prelude, then read the rule's own selector list. */
    const inner = rules.slice(rules.indexOf("{") + 1);
    const selectorList = inner.slice(0, inner.indexOf("{"));
    const selectors = selectorList.split(",").map((s) => s.trim()).filter(Boolean);
    assert.ok(selectors.length >= 4, "the floor should cover the shared controls");
    for (const sel of selectors) {
      assert.match(sel, /^\.onepos-(shell|modal) \.onepos-/, `${sel} is not Admin-scoped`);
    }
    /* No preset names — the floor is about the input device, not the preset. */
    assert.doesNotMatch(rules, /modern|enterprise|compact/i);
  });
});

/* ----------------------------------------------------- 4. Settings adoption */

describe("4. Settings Create/Edit flows adopt the foundation", () => {
  test("ChangePasswordModal renders through RecordModal", () => {
    assert.match(CHANGE_PW, /import RecordModal from "\.\.\/\.\.\/components\/RecordModal\.jsx"/);
    assert.match(CHANGE_PW, /<RecordModal/);
    assert.doesNotMatch(CHANGE_PW, /fixed inset-0/, "no hand-rolled overlay");
    assert.doesNotMatch(CHANGE_PW, /bg-white/, "no hand-rolled surface");
    assert.doesNotMatch(CHANGE_PW, /bg-blue-600/, "no hand-rolled accent button");
    assert.match(CHANGE_PW, /formId="onepos-change-password-form"/);
  });

  test("ChangePasswordModal keeps its endpoint and validation rules", () => {
    assert.match(CHANGE_PW, /apiRequest\("\/api\/auth\/change-password"/);
    assert.match(CHANGE_PW, /"New password and confirmation do not match"/);
    assert.match(CHANGE_PW, /"New password must be at least 8 characters"/);
  });

  test("UserFormModal is a metadata Object form, not a second user CRUD implementation", () => {
    assert.match(USER_FORM, /StandardObjectFormModal/);
    assert.match(USER_FORM, /objectKey="employee"/);
    assert.doesNotMatch(USER_FORM, /RecordModal|PlatformExtensionFields|\/api\/admin\/users|business-divisions/);
    assert.doesNotMatch(USER_FORM, /type="password"|saveStoreAccess|saveDivisionAccess/);
  });

  test("UserFormModal exposes only the canonical metadata host contract", () => {
    assert.match(USER_FORM, /export default function UserFormModal\(\{ form: record = \{\}, onClose, onSaved \}\)/);
    assert.match(USER_FORM, /mode=\{record\?\.id \? "edit" : "create"\}/);
    assert.match(USER_FORM, /onSaved=\{onSaved\}/);
  });

  test("user passwords and access are not fields owned by the CRUD modal", () => {
    assert.doesNotMatch(USER_FORM, /Password is required|Password must be at least|Save Access/);
    assert.doesNotMatch(USER_FORM, /roles|stores|divisions/i);
  });

  test("metadata form runtime owns save state rather than page-specific dirty/save logic", () => {
    assert.doesNotMatch(USER_FORM, /JSON\.stringify\(form\)|dirty=|onSave=/);
    assert.match(CHANGE_PW, /const dirty = Boolean\(/);
    assert.match(CHANGE_PW, /dirty=\{dirty\}/);
  });

  test("SettingsAdmin uses the canonical user metadata wrapper", () => {
    assert.match(SETTINGS_ADMIN, /import UserFormModal from "\.\/UserFormModal\.jsx"/);
    assert.doesNotMatch(SETTINGS_ADMIN, /canViewDivisions=|canManageDivisions=/);
  });

  test("no Settings file hand-rolls a record dialog any more", () => {
    // PlatformStudio's full-screen app studio is a complex builder, not a
    // record Create/Edit, so it is intentionally allowed to stay a page.
    for (const file of ["ChangePasswordModal.jsx", "UserFormModal.jsx", "MessageTemplatesAdmin.jsx"]) {
      assert.doesNotMatch(
        read(`../src/pages/settings/${file}`),
        /fixed inset-0/,
        `${file} should not hand-roll an overlay`,
      );
    }
  });
});

/* --------------------------------------------------------- 5. boundaries */

describe("5. boundaries", () => {
  test("the foundation is not imported by the Till/POS runtime", () => {
    for (const file of [
      "src/pages/pos/POS.jsx",
      "src/pages/pos/POSHeader.jsx",
      "src/pages/pos/CartPanel.jsx",
      "src/pages/pos/ProductGrid.jsx",
    ]) {
      assert.doesNotMatch(read(`../${file}`), /RecordModal/, file);
    }
  });

  test("the modal uses no second icon library and no ! overrides", () => {
    assert.match(MODAL, /from "lucide-react"/);
    assert.doesNotMatch(MODAL, /\s![a-z]+-[a-z0-9]+\b/);
  });
});

/* ------------------------------- 6. Settings presentation + modal adoption */

/** Migrated Settings surfaces: shared primitives in, hand-rolled chrome out. */
const MIGRATED_SETTINGS = {
  SettingsAdmin: SETTINGS_ADMIN,
  MessageTemplatesAdmin: MSG_TEMPLATES,
  invoiceDeliverySettings: INVOICE_DELIVERY,
  WhatsAppSettings: WHATSAPP,
  ServerApiSettings: SERVER_API,
  LicensingAdmin: LICENSING,
};

describe("6. Settings presentation migration", () => {
  test("every migrated surface drops its hand-rolled card chrome", () => {
    for (const [name, src] of Object.entries(MIGRATED_SETTINGS)) {
      assert.doesNotMatch(src, /bg-white/, `${name} still hand-rolls a white surface`);
      assert.doesNotMatch(src, /border rounded-xl|border border-slate-200 rounded-xl/, `${name} still hand-rolls a card`);
      assert.doesNotMatch(src, /text-center text-slate-400/, `${name} still hand-rolls an empty state`);
    }
  });

  test("every migrated surface drops its hard-coded accent controls", () => {
    for (const [name, src] of Object.entries(MIGRATED_SETTINGS)) {
      assert.doesNotMatch(src, /bg-blue-600/, `${name} still hard-codes the primary accent`);
      assert.doesNotMatch(src, /bg-emerald-600/, `${name} still hard-codes a success accent`);
      assert.doesNotMatch(src, /bg-teal-700/, `${name} still hard-codes the brand accent`);
    }
  });

  test("migrated surfaces carry no hex literals at all", () => {
    for (const [name, src] of Object.entries(MIGRATED_SETTINGS)) {
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}/, `${name} carries a hex literal`);
    }
  });

  test("the shared primitives actually replaced them (not just deleted)", () => {
    assert.match(MSG_TEMPLATES, /onepos-card onepos-card-body/);
    assert.match(MSG_TEMPLATES, /onepos-empty/);
    assert.match(MSG_TEMPLATES, /onepos-btn onepos-btn-primary/);

    assert.match(INVOICE_DELIVERY, /onepos-card onepos-card-body/);
    assert.match(INVOICE_DELIVERY, /onepos-btn onepos-btn-primary/);
    assert.match(INVOICE_DELIVERY, /onepos-btn onepos-btn-secondary/);
    assert.match(INVOICE_DELIVERY, /onepos-input/);
    assert.match(INVOICE_DELIVERY, /onepos-badge \$\{enabled \? "onepos-badge-success"/);
    assert.match(INVOICE_DELIVERY, /onepos-alert \$\{testResult\.success \? "onepos-alert-success"/);
    assert.match(INVOICE_DELIVERY, /onepos-empty/);
    assert.match(INVOICE_DELIVERY, /onepos-section-title/);

    assert.match(WHATSAPP, /onepos-card onepos-card-body/);
    assert.match(WHATSAPP, /onepos-empty/);

    assert.match(SERVER_API, /onepos-card onepos-card-body/);
    assert.match(SERVER_API, /onepos-page-title/);
    assert.match(SERVER_API, /onepos-input/);
    assert.match(SERVER_API, /onepos-btn onepos-btn-primary/);
    assert.match(SERVER_API, /onepos-alert/);

    assert.match(LICENSING, /onepos-page-header/);
    assert.match(LICENSING, /onepos-page-title/);
    assert.match(LICENSING, /onepos-card onepos-card-body/);
    assert.match(LICENSING, /onepos-table/);
    assert.match(LICENSING, /onepos-badge onepos-badge-success">Active</);
    assert.match(LICENSING, /onepos-alert onepos-alert-success/);
  });

  test("SettingsAdmin's section rail is a shared primitive, not a blue button", () => {
    assert.match(SETTINGS_ADMIN, /onepos-settings-tab/);
    assert.match(SETTINGS_ADMIN, /onepos-settings-tab-active/);
    assert.match(SETTINGS_ADMIN, /aria-current={tab === item \? "true" : undefined}/);
  });

  test("the section rail's selected state comes from the accent tokens", () => {
    const base = INDEX_CSS.match(/\.onepos-settings-tab \{[\s\S]*?\n  \}/)[0];
    assert.match(base, /height: calc\(var\(--onepos-nav-item-height/, "height follows preset density");
    assert.match(base, /color: var\(--onepos-sidebar-fg-muted/, "unselected uses the nav token");

    const active = INDEX_CSS.match(/\.onepos-settings-tab-active,[\s\S]*?\n  \}/)[0];
    assert.match(active, /background-color: var\(--onepos-accent-600\)/);
    assert.match(active, /color: var\(--onepos-accent-contrast, #fff\)/);
    assert.doesNotMatch(active.replace("#fff", ""), /#[0-9a-fA-F]{3,6}/, "no stray hex beyond the token fallback");
  });

  test("the shared modal exposes a slot for permitted secondary actions", () => {
    assert.match(MODAL, /footerStart/);
    assert.match(MODAL, /onepos-modal-footer-start/);
  });
});

/* ---------------- 7. MessageTemplatesAdmin adopts the shared record modal */

describe("7. MessageTemplatesAdmin uses the shared modal", () => {
  test("its Create/Edit dialog is the shared foundation", () => {
    assert.match(MSG_TEMPLATES, /import RecordModal from "\.\.\/\.\.\/components\/RecordModal\.jsx"/);
    assert.match(MSG_TEMPLATES, /<RecordModal/);
    assert.match(MSG_TEMPLATES, /const FORM_ID = "onepos-message-template-form"/);
    assert.match(MSG_TEMPLATES, /formId={FORM_ID}/);
    assert.match(MSG_TEMPLATES, /<form id={FORM_ID}/);
    assert.doesNotMatch(MSG_TEMPLATES, /fixed inset-0/);
  });

  test("the base form is a plain inline form, not an in-page dialog", () => {
    // The editor used to render as an inline <form> below the list.
    assert.doesNotMatch(MSG_TEMPLATES, /className="bg-white[^"]*"[^>]*onSubmit/);
    assert.match(MSG_TEMPLATES, /mode={editing \? "edit" : "create"}/);
  });

  test("dirty state is measured against the opened template", () => {
    assert.match(MSG_TEMPLATES, /setBaseline\(JSON\.stringify\(next\)\)/);
    assert.match(MSG_TEMPLATES, /const templateDirty = showEditor && JSON\.stringify\(form\) !== baseline/);
    assert.match(MSG_TEMPLATES, /dirty={templateDirty}/);
  });

  test("Deactivate stays a permitted secondary action inside the same dialog", () => {
    assert.match(MSG_TEMPLATES, /footerStart={editing \?/);
    assert.match(MSG_TEMPLATES, /deactivate\(editing\)/);
  });

  test("the template endpoint, payload and merge-token behaviour are unchanged", () => {
    assert.match(MSG_TEMPLATES, /\/api\/platform\/message-templates/);
    assert.match(MSG_TEMPLATES, /method: editing \? "PUT" : "POST"/);
    assert.match(MSG_TEMPLATES, /JSON\.stringify\(form\)/);
    assert.match(MSG_TEMPLATES, /function insertToken\(token, targetRef, field\)/);
    assert.match(MSG_TEMPLATES, /setSelectionRange\(cursor, cursor\)/);
    assert.match(MSG_TEMPLATES, /PlatformFieldPicker/);
    /* channel-conditional subject stays: only EMAIL has a subject row */
    assert.match(MSG_TEMPLATES, /form\.channel === "EMAIL" \?/);
  });

  test("a failed save keeps the dialog open (save state is finally-cleared)", () => {
    assert.match(MSG_TEMPLATES, /const \[savingTemplate, setSavingTemplate\] = useState\(false\)/);
    assert.match(MSG_TEMPLATES, /finally \{ setSavingTemplate\(false\); \}/);
    assert.match(MSG_TEMPLATES, /saving={savingTemplate}/);
    assert.match(MSG_TEMPLATES, /catch \(error\) \{ onError\(error\.message\); \}/);
  });

  test("the two call sites share one open path, so the baseline cannot be skipped", () => {
    assert.match(MSG_TEMPLATES, /function openTemplate\(template\)/);
    /* Split rather than regex — `{` inside a regex literal is a quantifier. */
    const calls = MSG_TEMPLATES.split("onClick={() => openTemplate(template)}").length - 1;
    assert.equal(calls, 2, "name and Edit both open through openTemplate");
    assert.doesNotMatch(MSG_TEMPLATES, /onClick={[^}]*setShowEditor/, "no call site opens the editor directly");
  });

  test("the dialog content stays lazily mounted", () => {
    assert.match(MSG_TEMPLATES, /{showEditor \? <RecordModal/);
    assert.match(MSG_TEMPLATES, /<\/RecordModal> : null}/);
    assert.match(MODAL, /if \(!open\) return null;/);
  });
});

/* ----------------------- 8. migrated surfaces keep their functionality ---- */

describe("8. migrated Settings surfaces keep their behaviour", () => {
  test("invoice delivery keeps its endpoints, gating and secret handling", () => {
    assert.match(INVOICE_DELIVERY, /\/api\/invoice-delivery\/\$\{channel\}\/settings/);
    assert.match(INVOICE_DELIVERY, /test-connection/);
    assert.match(INVOICE_DELIVERY, /test-send/);
    assert.match(INVOICE_DELIVERY, /const activationReady = testResult\?\.success === true && !credentialsChanged/);
    assert.match(INVOICE_DELIVERY, /if \(activate && \(!testResult\?\.success \|\| credentialsChanged\)\) return;/);
    assert.match(INVOICE_DELIVERY, /auto_send_enabled/);
    assert.match(INVOICE_DELIVERY, /Leave blank to keep the stored value/);
    assert.match(INVOICE_DELIVERY, /toggleAutoSend/);
  });

  test("WhatsApp keeps its masked-credential and activation contract", () => {
    assert.match(WHATSAPP, /masked/i);
    assert.match(WHATSAPP, /test-connection/);
  });

  test("ServerApiSettings keeps its testids and Superadmin-only copy", () => {
    for (const id of ["server-api-settings", "server-address-input", "test-connection-button", "save-server-button"]) {
      assert.match(SERVER_API, new RegExp(`data-testid="${id}"`), `${id} testid lost`);
    }
    assert.match(SERVER_API, /Only Superadmins can change this/);
    assert.match(SERVER_API, /apiRequest\("\/api\/health"/);
    assert.match(SERVER_API, /AbortSignal\.timeout\(8000\)/);
  });

  test("LicensingAdmin keeps its entitlement and assignment flow", () => {
    assert.match(LICENSING, /DEFAULT_KEYS\.map/);
    assert.match(LICENSING, /checked={entitlements\[key\] === true}/);
    assert.match(LICENSING, /createLicence/);
    assert.match(LICENSING, /assignLicence/);
    assert.match(LICENSING, /disabled={!name\.trim\(\)}/);
    assert.match(LICENSING, /disabled={!selectedCompany}/);
  });

  test("no migrated surface grows a preset branch", () => {
    for (const [name, src] of Object.entries(MIGRATED_SETTINGS)) {
      assert.doesNotMatch(src, /data-onepos-preset/, `${name} branches on the preset`);
    }
  });

  test("the Settings migration never reaches the Till/POS bundle", () => {
    for (const [name, src] of Object.entries(MIGRATED_SETTINGS)) {
      assert.doesNotMatch(src, /pages\/pos\//, `${name} pulls in POS code`);
      if (name !== "MessageTemplatesAdmin") {
        assert.doesNotMatch(src, /RecordModal/, `${name} should not adopt the record modal yet`);
      }
    }
  });

  test("the modal reuses shared primitives rather than new ones", () => {
    assert.match(MODAL, /onepos-btn onepos-btn-secondary/);
    assert.match(MODAL, /onepos-btn onepos-btn-primary/);
    assert.match(MODAL, /import \{ cx \} from "\.\/ui\.jsx"/);
  });
});
