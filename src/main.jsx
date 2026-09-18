import React from "react";
import "./index.css";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Narrow app scope leaves the marketing website uncontrolled. Production
// assets are cached by the worker; development hot modules are never cached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/app/offline-sw.js", { scope: "/app/" }).catch(() => {
    // Existing loaded tills still work; offline reload requires HTTPS + worker.
  });
}

