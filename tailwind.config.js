/** @type {import('tailwindcss').Config} */

/*
 * onePOS application design tokens.
 *
 * The operational app (login, POS/till, admin) is built with Tailwind utility
 * classes; the public marketing site uses its own hand-rolled CSS with ZERO
 * Tailwind utilities. Overriding the blue/gray accent scales below therefore
 * re-themes every blue accent across the whole app (buttons, links, focus
 * rings, active nav, toggles) to the onePOS teal (#176F6A) in one place -
 * without touching the marketing website or any page's className markup.
 *
 * Teal ramp derived from the brand primary:
 *   50 #eef7f6  100 #d7ecea  200 #b0d9d5  300 #82c1bb  400 #4fa69e
 *   500 #2f8a82  600 #176F6A  700 #125a56  800 #104744  900 #0d3b39
 *
 * ADMIN PRESENTATION TOKENS
 * `slate` — the app's dominant neutral scale (surfaces, borders, text) — is
 * generated from CSS custom properties (see src/utils/presets.js /
 * src/index.css) so the Admin shell can swap preset (Modern / Enterprise /
 * Compact) and appearance (Light / Dark / System) by rewriting ~20 variables
 * on <html>. Business pages keep their exact markup: bg-white, bg-slate-50,
 * border-slate-200, text-slate-400… all resolve through the tokens. The POS /
 * till is untouched: it inherits the same default Light values everywhere.
 */

const teal = {
  50: "#eef7f6",
  100: "#d7ecea",
  200: "#b0d9d5",
  300: "#82c1bb",
  400: "#4fa69e",
  500: "#2f8a82",
  600: "#176F6A",
  700: "#125a56",
  800: "#104744",
  900: "#0d3b39",
};

/* Slate 50–900 read from the shared surface tokens (<alpha-value> keeps
   Tailwind's opacity modifiers like bg-slate-50/60 working). */
const slateFromTokens = {
  50: "var(--onepos-surface-muted)",
  100: "var(--onepos-surface-alt)",
  200: "var(--onepos-border)",
  300: "var(--onepos-border-strong)",
  400: "var(--onepos-text-muted)",
  500: "var(--onepos-text-secondary)",
  600: "var(--onepos-text-body)",
  700: "var(--onepos-text-secondary-strong)",
  800: "var(--onepos-text-primary)",
  900: "var(--onepos-text-heading)",
};

export default {
  content: [
    "./index.html",
    "./app/index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // The app was written against the blue accent scale; remap it to the
        // onePOS teal so existing markup inherits the brand automatically.
        blue: teal,
        slate: slateFromTokens,
        gray: {
          0: "#ffffff",
          50: "#f9fafb",
          100: "#f3f4f6",
          200: "#e5e7eb",
          300: "#d8dde3",
          400: "#9aa3ad",
          500: "#6b7480",
          600: "#4b545e",
          700: "#37404a",
          800: "#242b33",
          900: "#181e25",
        },
      },
      borderRadius: {
        DEFAULT: "6px",
      },
      boxShadow: {
        DEFAULT: "0 1px 2px rgba(16, 42, 39, 0.06)",
        md: "0 2px 6px rgba(16, 42, 39, 0.08)",
        lg: "0 10px 24px rgba(16, 42, 39, 0.14)",
      },
    },
  },
  plugins: [],
};
