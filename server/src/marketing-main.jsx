import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MarketingRoutes } from "./routes.jsx";
import { isNativeApp } from "./services/serverAddress.js";
import "./marketing/marketing.css";

/*
 * Native Android/Capacitor startup routing.
 *
 * Capacitor's webDir is "dist", so the native WebView opens dist/index.html
 * at "/" — the MARKETING entry. Left unbranched, the Android app would boot
 * into the public marketing homepage instead of the operational onePOS app.
 *
 * Inside the native shell (window.Capacitor injected by Capacitor itself) we
 * therefore render the operational application (Login -> auth -> POS) from
 * the same App component the /app web entry uses. The marketing pages, nav
 * and Login button are never mounted on native. Web browsers keep loading
 * the marketing site exactly as before, and /app on the web is untouched.
 *
 * The App component self-routes from window.location.pathname ("/" inside
 * the shell resolves to the till view) and talks to the backend through the
 * existing relative-/api + saved-server-address mechanism, so no backend URL
 * is hard-coded here and no auth behaviour changes.
 */
if (isNativeApp()) {
  void (async () => {
    /* Lazy: the operational bundle (and its CSS) is only fetched in the
       native shell; the web public-site bundle never downloads it. */
    const [{ default: App }] = await Promise.all([
      import("./App.jsx"),
      import("./index.css"),
    ]);
    ReactDOM.createRoot(document.getElementById("root")).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })();
} else {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter>
        <MarketingRoutes />
      </BrowserRouter>
    </React.StrictMode>
  );
}
