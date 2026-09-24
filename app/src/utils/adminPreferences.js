/*
 * onePOS Admin presentation presets — design tokens.
 *
 * ONE shell, ONE component system, ONE stylesheet. The three presentation
 * presets (Modern / Enterprise / Compact) are three genuinely different
 * VISUAL LANGUAGES, expressed as ONE set of semantic tokens applied to <html>
 * as CSS custom properties. No duplicated stylesheets, no per-preset page
 * copies, no separate bundles: switching preset rewrites variables and the
 * whole admin re-renders instantly.
 *
 *   - Layout/design preset : "modern" | "enterprise" | "compact"
 *   - Appearance           : "light" | "dark" | "system" (orthogonal)
 *   - Accent               : the existing onePOS accent ramp, recoloured per
 *                            user (orthogonal to preset AND appearance)
 *
 * DESIGN LANGUAGE SUMMARY
 *   modern     — contemporary SaaS: light/airy surfaces, larger rounded cards,
 *                layered soft shadows, translucent blurred header, accent-tinted
 *                icon chips, pill navigation with tinted active state.
 *   enterprise — conventional business app: structured, flat surfaces, hairline
 *                borders, small radii, no shadows, monochrome icons, square
 *                navigation with a left accent bar and clear section boundaries.
 *   compact    — dense operations/ERP: narrow dark navigation, minimal
 *                decoration, tiny-but-usable spacing, dense tables, small
 *                controls, no shadows, muted icons.
 *
 * The tokens below drive BOTH the shell chrome and the shared component classes
 * (.onepos-card, .onepos-table, .onepos-btn, .onepos-input, …), and the
 * compiled CSS in src/index.css remaps the admin's common Tailwind radius and
 * shadow utilities onto these tokens — so EXISTING pages change with the preset
 * without a single page being rewritten. Every remap is scoped to .onepos-shell,
 * so the Till/POS is never affected.
 */

/** The three Admin presentation presets (user-selectable). */
export const LAYOUT_PRESETS = Object.freeze([
  {
    key: "modern",
    label: "Modern",
    description: "Light, layered and spacious with soft surfaces and accent-tinted icons.",
  },
  {
    key: "enterprise",
    label: "Enterprise",
    description: "Structured, flat and information-first with hairline boundaries.",
  },
  {
    key: "compact",
    label: "Compact",
    description: "Dense operations layout with narrow dark navigation and tight tables.",
  },
]);

/** Light / Dark / System appearance options. */
export const APPEARANCE_OPTIONS = Object.freeze([
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
]);

/**
 * Accent options. The existing onePOS accent mechanism is the teal/blue
 * palette remap in tailwind.config.js, so an accent simply recolours that
 * ramp: one HSL hue for the whole family. No duplicate theme system.
 */
export const ACCENT_OPTIONS = Object.freeze([
  { key: "teal", label: "onePOS Teal", hue: 175 },
  { key: "blue", label: "Blue", hue: 217 },
  { key: "purple", label: "Purple", hue: 262 },
  { key: "green", label: "Green", hue: 152 },
  { key: "orange", label: "Orange", hue: 25 },
  { key: "red", label: "Red", hue: 355 },
]);

export const DEFAULT_PREFERENCES = Object.freeze({
  preset: "modern",
  appearance: "light",
  accent: "teal",
  sidebarCollapsed: false,
});

const PRESET_KEYS = new Set(LAYOUT_PRESETS.map((p) => p.key));
const APPEARANCE_KEYS = new Set(APPEARANCE_OPTIONS.map((p) => p.key));
const ACCENT_KEYS = new Set(ACCENT_OPTIONS.map((p) => p.key));

/** Validate/sanitize a raw preferences object (server or cache). Unknown or missing values fall back to defaults. */
export function normalizePreferences(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const merged = {
    preset: PRESET_KEYS.has(source.preset) ? source.preset : DEFAULT_PREFERENCES.preset,
    appearance: APPEARANCE_KEYS.has(source.appearance) ? source.appearance : DEFAULT_PREFERENCES.appearance,
    accent: ACCENT_KEYS.has(source.accent) ? source.accent : DEFAULT_PREFERENCES.accent,
    sidebarCollapsed: source.sidebarCollapsed === true,
  };
  return merged;
}

/** True when two preference objects differ in any user-visible field. */
export function preferencesDiffer(a, b) {
  return !a || !b
    || a.preset !== b.preset
    || a.appearance !== b.appearance
    || a.accent !== b.accent
    || a.sidebarCollapsed !== b.sidebarCollapsed;
}

/* ------------------------------------------------------------------ */
/* Shared chroma ramps. The DEFAULT (Light) values are written as the  */
/* :root fallbacks in index.css and match the original hard-coded      */
/* slate palette exactly, so the till and every existing page render   */
/* pixel-identically before any preference is applied.                 */
/* ------------------------------------------------------------------ */

const APPEARANCE_LIGHT = {
  "--onepos-surface": "hsl(210 20% 97%)",          // page canvas (was bg #f5f7f6 / slate-100)
  "--onepos-surface-muted": "hsl(210 20% 98%)",    // slate-50
  "--onepos-surface-alt": "hsl(210 14% 93%)",      // slate-100
  "--onepos-surface-raised": "hsl(0 0% 100%)",     // cards / header / sidebar
  "--onepos-surface-hover": "hsl(210 13% 91%)",    // hover wash on raised surfaces
  "--onepos-border": "hsl(210 14% 89%)",           // slate-200
  "--onepos-border-strong": "hsl(210 10% 84%)",    // slate-300
  "--onepos-text-heading": "hsl(215 25% 16%)",     // slate-900
  "--onepos-text-primary": "hsl(215 23% 21%)",     // slate-800
  "--onepos-text-body": "hsl(214 15% 33%)",        // slate-600
  "--onepos-text-secondary": "hsl(212 11% 44%)",   // slate-500
  "--onepos-text-secondary-strong": "hsl(212 16% 38%)", // slate-700
  "--onepos-text-muted": "hsl(210 8% 63%)",        // slate-400
  "--onepos-shadow": "0 1px 2px rgba(16, 42, 39, 0.06), 0 1px 3px rgba(16, 42, 39, 0.04)",
};

const APPEARANCE_DARK = {
  "--onepos-surface": "hsl(215 25% 11%)",
  "--onepos-surface-muted": "hsl(215 22% 14%)",
  "--onepos-surface-alt": "hsl(215 20% 18%)",
  "--onepos-surface-raised": "hsl(215 22% 15%)",
  "--onepos-surface-hover": "hsl(215 18% 22%)",
  "--onepos-border": "hsl(215 14% 26%)",
  "--onepos-border-strong": "hsl(215 12% 33%)",
  "--onepos-text-heading": "hsl(210 20% 96%)",
  "--onepos-text-primary": "hsl(210 16% 90%)",
  "--onepos-text-body": "hsl(212 12% 74%)",
  "--onepos-text-secondary": "hsl(212 10% 62%)",
  "--onepos-text-secondary-strong": "hsl(212 12% 68%)",
  "--onepos-text-muted": "hsl(212 9% 48%)",
  "--onepos-shadow": "0 1px 2px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.28)",
};

const CHROMA_LIGHT = {
  amber: { s: 92, l: [97, 95, 87, 68, 46, 40, 37, 26] },
  red: { s: 85, l: [97, 95, 88, 66, 45, 40, 38, 27] },
  emerald: { s: 62, l: [96, 94, 84, 60, 40, 36, 33, 24] },
  slate: { s: 15, l: [97, 94, 88, 66, 46, 40, 37, 26] },
};

const CHROMA_DARK = {
  amber: { s: 70, l: [18, 21, 29, 42, 66, 76, 82, 88] },
  red: { s: 55, l: [17, 20, 28, 40, 66, 74, 79, 86] },
  emerald: { s: 45, l: [16, 19, 27, 39, 62, 72, 78, 85] },
  slate: { s: 12, l: [17, 20, 28, 41, 65, 74, 80, 88] },
};

function ramp(name, hue, mode) {
  const c = (mode === "dark" ? CHROMA_DARK : CHROMA_LIGHT)[name];
  return c.l.map((l, i) => `hsl(${hue} ${c.s}% ${l}%)`);
}

/**
 * Resolves whether the dark tokens apply: explicit "dark", or "system"
 * when the OS reports dark. Pure given the same inputs.
 */
export function isDarkAppearance(prefs, { systemDark = false } = {}) {
  const appearance = normalizePreferences(prefs).appearance;
  return appearance === "dark" || (appearance === "system" && systemDark === true);
}

/* ------------------------------------------------------------------ */
/* PRESET DESIGN LANGUAGES                                             */
/*                                                                     */
/* Each preset declares its structural primitives (radii, gaps,        */
/* shadows, navigation metrics, icon treatment, header/surface style). */
/* These are the ONLY differences between presets — pages, data,       */
/* routes and permissions are identical.                               */
/* ------------------------------------------------------------------ */

const PRESET_STRUCTURE = {
  modern: {
    /* rhythm — comfortable, airy */
    "--onepos-page-gap": "22px",
    "--onepos-section-gap": "20px",
    "--onepos-card-pad": "18px",
    "--onepos-form-gap": "16px",
    "--onepos-toolbar-height": "52px",
    /* shape — larger rounded surfaces */
    "--onepos-radius": "12px",
    "--onepos-radius-sm": "8px",
    "--onepos-card-radius": "16px",
    "--onepos-modal-radius": "16px",
    /* chrome metrics */
    "--onepos-control-height": "38px",
    "--onepos-sidebar-width": "248px",
    "--onepos-sidebar-width-collapsed": "68px",
    "--onepos-header-height": "58px",
    "--onepos-nav-item-height": "40px",
    "--onepos-nav-item-radius": "10px",
    "--onepos-nav-font-size": "13.5px",
    "--onepos-nav-indent": "10px",
    "--onepos-icon-size": "18px",
    "--onepos-nav-bar-width": "0px",
    /* icon treatment — accent-tinted rounded chips */
    "--onepos-icon-chip-size": "30px",
    "--onepos-icon-chip-radius": "9px",
    "--onepos-icon-chip-color": "var(--onepos-accent-700)",
    "--onepos-icon-chip-bg": "var(--onepos-accent-50)",
    "--onepos-icon-chip-border": "transparent",
    /* depth — layered, soft */
    "--onepos-shadow-card": "0 1px 2px rgba(16, 42, 39, 0.05), 0 6px 20px -8px rgba(16, 42, 39, 0.16)",
    "--onepos-shadow-raised": "0 10px 30px -12px rgba(16, 42, 39, 0.28), 0 2px 8px rgba(16, 42, 39, 0.08)",
    "--onepos-card-border-width": "1px",
    "--onepos-header-shadow": "0 1px 2px rgba(16, 42, 39, 0.05)",
    "--onepos-header-blur": "12px",
    /* tables — comfortable, soft hover */
    "--onepos-table-head-transform": "none",
    "--onepos-table-head-weight": "600",
    "--onepos-table-head-size": "12px",
    "--onepos-table-font-size": "13.5px",
    "--onepos-table-hover": "var(--onepos-accent-50)",
  },
  enterprise: {
    /* rhythm — efficient but not cramped */
    "--onepos-page-gap": "14px",
    "--onepos-section-gap": "12px",
    "--onepos-card-pad": "14px",
    "--onepos-form-gap": "12px",
    "--onepos-toolbar-height": "46px",
    /* shape — restrained, conventional */
    "--onepos-radius": "6px",
    "--onepos-radius-sm": "4px",
    "--onepos-card-radius": "6px",
    "--onepos-modal-radius": "6px",
    /* chrome metrics */
    "--onepos-control-height": "34px",
    "--onepos-sidebar-width": "236px",
    "--onepos-sidebar-width-collapsed": "62px",
    "--onepos-header-height": "50px",
    "--onepos-nav-item-height": "34px",
    "--onepos-nav-item-radius": "4px",
    "--onepos-nav-font-size": "13px",
    "--onepos-nav-indent": "10px",
    "--onepos-icon-size": "17px",
    "--onepos-nav-bar-width": "3px",
    /* icon treatment — monochrome, no decorative container */
    "--onepos-icon-chip-size": "20px",
    "--onepos-icon-chip-radius": "3px",
    "--onepos-icon-chip-color": "var(--onepos-text-secondary-strong)",
    "--onepos-icon-chip-bg": "transparent",
    "--onepos-icon-chip-border": "transparent",
    /* depth — flat, boundaries carried by borders */
    "--onepos-shadow-card": "none",
    "--onepos-shadow-raised": "0 8px 24px -14px rgba(16, 42, 39, 0.30)",
    "--onepos-card-border-width": "1px",
    "--onepos-header-shadow": "none",
    "--onepos-header-blur": "0px",
    /* tables — conventional business grid */
    "--onepos-table-head-transform": "uppercase",
    "--onepos-table-head-weight": "700",
    "--onepos-table-head-size": "11px",
    "--onepos-table-font-size": "13px",
    "--onepos-table-hover": "var(--onepos-surface-muted)",
  },
  compact: {
    /* rhythm — dense operations */
    "--onepos-page-gap": "10px",
    "--onepos-section-gap": "8px",
    "--onepos-card-pad": "10px",
    "--onepos-form-gap": "8px",
    "--onepos-toolbar-height": "40px",
    /* shape — minimal rounding */
    "--onepos-radius": "5px",
    "--onepos-radius-sm": "4px",
    "--onepos-card-radius": "5px",
    "--onepos-modal-radius": "5px",
    /* chrome metrics */
    "--onepos-control-height": "30px",
    "--onepos-sidebar-width": "190px",
    "--onepos-sidebar-width-collapsed": "54px",
    "--onepos-header-height": "46px",
    /* 30px keeps dense rows visibly tighter than Enterprise (34px) while
       staying a comfortable hit target — Compact is dense, never tiny. */
    "--onepos-nav-item-height": "30px",
    "--onepos-nav-item-radius": "3px",
    "--onepos-nav-font-size": "12.5px",
    "--onepos-nav-indent": "8px",
    "--onepos-icon-size": "15px",
    "--onepos-nav-bar-width": "2px",
    /* icon treatment — small and restrained */
    "--onepos-icon-chip-size": "16px",
    "--onepos-icon-chip-radius": "2px",
    "--onepos-icon-chip-color": "inherit",
    "--onepos-icon-chip-bg": "transparent",
    "--onepos-icon-chip-border": "transparent",
    /* depth — none */
    "--onepos-shadow-card": "none",
    "--onepos-shadow-raised": "0 6px 18px -12px rgba(0, 0, 0, 0.35)",
    "--onepos-card-border-width": "1px",
    "--onepos-header-shadow": "none",
    "--onepos-header-blur": "0px",
    /* tables — dense rows, maximum records */
    "--onepos-table-head-transform": "uppercase",
    "--onepos-table-head-weight": "600",
    "--onepos-table-head-size": "10.5px",
    "--onepos-table-font-size": "12.5px",
    "--onepos-table-hover": "var(--onepos-surface-muted)",
  },
};

/**
 * Sidebar palette per preset + appearance. Sidebar foreground colours are
 * tokens too (never hard-coded one-off colours), which is what keeps the
 * navigation readable in every combination:
 *   - Modern keeps an airy LIGHT sidebar in light appearance.
 *   - Enterprise keeps a neutral light-grey sidebar in light appearance.
 *   - Compact uses a dark navigation rail in every appearance (its identity).
 *   - In dark appearance every preset uses a dark surface with light text.
 * Foreground values are chosen to clear WCAG AA contrast against their
 * own background (see tests/adminPresetDesignLanguages.test.mjs).
 */
function sidebarTokens(preset, dark, accent) {
  const a = (alpha) => `hsl(${accent.hue} 70% 45% / ${alpha})`;
  const darkSidebar = dark || preset === "compact";

  if (!darkSidebar) {
    if (preset === "enterprise") {
      return {
        "--onepos-sidebar-bg": "hsl(210 16% 96%)",
        "--onepos-sidebar-fg": "hsl(215 22% 24%)",
        "--onepos-sidebar-fg-muted": "hsl(212 10% 42%)",
        "--onepos-sidebar-hover": "hsl(210 16% 92%)",
        "--onepos-sidebar-active-bg": "hsl(210 16% 89%)",
        "--onepos-sidebar-active-fg": "hsl(215 25% 17%)",
        "--onepos-sidebar-bar": "var(--onepos-accent-600)",
        "--onepos-sidebar-ring": "hsl(215 22% 34% / 0.55)",
        "--onepos-sidebar-brand": "hsl(215 25% 20%)",
      };
    }
    /* modern — airy near-white rail with an accent-tinted active state */
    return {
      "--onepos-sidebar-bg": "hsl(205 30% 99%)",
      "--onepos-sidebar-fg": "hsl(215 26% 26%)",
      "--onepos-sidebar-fg-muted": "hsl(212 12% 42%)",
      "--onepos-sidebar-hover": "hsl(205 26% 95%)",
      "--onepos-sidebar-active-bg": "var(--onepos-accent-50)",
      "--onepos-sidebar-active-fg": "var(--onepos-accent-700)",
      "--onepos-sidebar-bar": "transparent",
      "--onepos-sidebar-ring": a(0.45),
      "--onepos-sidebar-brand": "hsl(215 28% 22%)",
    };
  }

  /* Dark rails: Compact always, and every preset in dark appearance. */
  const compactStyle = preset === "compact";
  return {
    "--onepos-sidebar-bg": compactStyle ? "hsl(215 26% 11%)" : "hsl(215 24% 12%)",
    "--onepos-sidebar-fg": compactStyle ? "hsl(210 16% 90%)" : "hsl(210 18% 92%)",
    "--onepos-sidebar-fg-muted": "hsl(212 10% 62%)",
    "--onepos-sidebar-hover": "hsl(0 0% 100% / 0.07)",
    "--onepos-sidebar-active-bg": compactStyle ? "hsl(0 0% 100% / 0.14)" : a(0.18),
    "--onepos-sidebar-active-fg": "hsl(210 20% 98%)",
    "--onepos-sidebar-bar": "var(--onepos-accent-400)",
    "--onepos-sidebar-ring": "hsl(0 0% 100% / 0.55)",
    "--onepos-sidebar-brand": "hsl(210 20% 96%)",
  };
}

/**
 * Token map for a given preference combination. Pure: given the same
 * preferences it always returns the same object, so tests can assert on it.
 * An "system" appearance resolves to Light unless systemDark is true.
 */
export function tokensForPreferences(prefs, { systemDark = false } = {}) {
  const normalized = normalizePreferences(prefs);
  const dark = isDarkAppearance(normalized, { systemDark });
  const accent = ACCENT_OPTIONS.find((a) => a.key === normalized.accent) || ACCENT_OPTIONS[0];
  const accentRamp = ramp("slate", accent.hue, dark ? "dark" : "light");
  const structure = PRESET_STRUCTURE[normalized.preset] || PRESET_STRUCTURE.modern;

  const tokens = {
    ...(dark ? APPEARANCE_DARK : APPEARANCE_LIGHT),

    /* The preset's whole design language (radii, gaps, shadows, navigation
       metrics, icon treatment, table styling, header depth). */
    ...structure,

    /* Surface treatments that depend on preset + appearance together. */
    "--onepos-header-bg": dark
      ? "hsl(215 24% 13% / 0.86)"
      : normalized.preset === "modern"
        ? "hsl(0 0% 100% / 0.82)"
        : "var(--onepos-surface-raised)",
    "--onepos-card-bg": "var(--onepos-surface-raised)",
    "--onepos-card-border": normalized.preset === "modern" ? "var(--onepos-border)" : "var(--onepos-border-strong)",
    "--onepos-rail-border": normalized.preset === "modern" ? "var(--onepos-border)" : "var(--onepos-border-strong)",

    /* Sidebar palette (readable foregrounds, per preset + appearance). */
    ...sidebarTokens(normalized.preset, dark, accent),

    /* Accent ramp: blue-* utilities recolour to the chosen accent. */
    "--onepos-accent": accentRamp[4],
    "--onepos-accent-strong": accentRamp[5],
    "--onepos-accent-soft": accentRamp[0],
    "--onepos-accent-contrast": dark ? "hsl(215 25% 12%)" : "hsl(0 0% 100%)",
  };

  /* blue-50..900 from the accent ramp: blue-100..900 map straight onto the
     eight ramp steps; blue-50 (the palest tint, used for hover washes) sits
     just below blue-100 — one step lighter in Light, one darker in Dark. */
  const tint = dark ? accentRamp[1] : accentRamp[0];
  ["--onepos-accent-50", "--onepos-accent-100", "--onepos-accent-200", "--onepos-accent-300",
    "--onepos-accent-400", "--onepos-accent-500", "--onepos-accent-600", "--onepos-accent-700",
    "--onepos-accent-800", "--onepos-accent-900"].forEach((name, i) => {
    tokens[name] = i === 0 ? tint : accentRamp[i - 1];
  });

  return tokens;
}

/* Every token name this module can emit — used to clear stale properties. */
const TOKEN_NAMES = (() => {
  const names = new Set([
    ...Object.keys(APPEARANCE_LIGHT),
    ...Object.keys(APPEARANCE_DARK),
    ...Object.keys(PRESET_STRUCTURE.modern),
    ...Object.keys(sidebarTokens("modern", false, ACCENT_OPTIONS[0])),
    "--onepos-header-bg", "--onepos-card-bg", "--onepos-card-border", "--onepos-rail-border",
    "--onepos-accent", "--onepos-accent-strong", "--onepos-accent-soft", "--onepos-accent-contrast",
  ]);
  for (let i = 0; i <= 9; i++) names.add(`--onepos-accent-${i === 0 ? 50 : i * 100}`);
  return [...names];
})();

/**
 * Apply preferences to the document element: data attributes + CSS custom
 * properties. Idempotent; called from the shell effect and the preview.
 */
export function applyPreferences(prefs, { root = typeof document !== "undefined" ? document.documentElement : null, systemDark = false } = {}) {
  if (!root) return;
  const normalized = normalizePreferences(prefs);
  const dark = isDarkAppearance(normalized, { systemDark });
  const tokens = tokensForPreferences(normalized);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  root.dataset.oneposPreset = normalized.preset;
  root.dataset.oneposAppearance = normalized.appearance;
  root.dataset.oneposDark = dark ? "true" : "false";
  root.dataset.oneposAccent = normalized.accent;
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Remove every presentation token/attribute this module applied, restoring the
 * :root Light fallbacks. Called when the admin shell unmounts (e.g. returning
 * to the till) so a user's admin preference can never leak into the POS UI.
 */
export function clearPreferences({ root = typeof document !== "undefined" ? document.documentElement : null } = {}) {
  if (!root) return;
  for (const name of TOKEN_NAMES) root.style.removeProperty(name);
  delete root.dataset.oneposPreset;
  delete root.dataset.oneposAppearance;
  delete root.dataset.oneposDark;
  delete root.dataset.oneposAccent;
  root.style.removeProperty("color-scheme");
}

/** The body of the `[data-onepos-appearance="system"]` dark check, as CSS. Kept here so index.css and tests share one source. */
export const SYSTEM_DARK_CSS = '@media (prefers-color-scheme: dark)';

export default {
  LAYOUT_PRESETS,
  APPEARANCE_OPTIONS,
  ACCENT_OPTIONS,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  preferencesDiffer,
  isDarkAppearance,
  tokensForPreferences,
  applyPreferences,
  clearPreferences,
  SYSTEM_DARK_CSS,
};
