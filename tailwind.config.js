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
