import React from "react";
import "./index.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import DevErrorBoundary from "./components/dev/DevErrorBoundary";

/* ---------------------------------------------------------
   onePOS DEV RUNTIME ERROR DISPLAY
   Development only.
   Catches errors outside React Error Boundaries, including:
   - window runtime errors
   - unhandled promise rejections
--------------------------------------------------------- */

if (import.meta.env.DEV) {
  const showDevRuntimeError = (title, error) => {
    const existing = document.getElementById("onepos-dev-runtime-error");
    if (existing) existing.remove();

    const message = error?.message || String(error || "Unknown error");
    const stack = error?.stack || "";

    const overlay = document.createElement("div");
    overlay.id = "onepos-dev-runtime-error";
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: rgba(40, 0, 0, 0.55);
      padding: 24px;
      overflow: auto;
      font-family: Arial, sans-serif;
      box-sizing: border-box;
    `;

    const panel = document.createElement("div");
    panel.style.cssText = `
      max-width: 1100px;
      margin: 30px auto;
      background: #fff5f5;
      border: 3px solid #dc2626;
      border-radius: 12px;
      box-shadow: 0 20px 70px rgba(0,0,0,.4);
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      background: #dc2626;
      color: white;
      padding: 14px 18px;
      font-size: 18px;
      font-weight: 700;
    `;
    header.textContent = "🔴 onePOS Development Error";

    const body = document.createElement("div");
    body.style.padding = "18px";

    const errorType = document.createElement("div");
    errorType.style.cssText = `
      font-weight: 700;
      color: #991b1b;
      margin-bottom: 8px;
    `;
    errorType.textContent = title;

    const errorMessage = document.createElement("div");
    errorMessage.style.cssText = `
      background: #fee2e2;
      border-left: 5px solid #dc2626;
      padding: 12px;
      margin-bottom: 14px;
      color: #7f1d1d;
      font-weight: 600;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    errorMessage.textContent = message;

    const route = document.createElement("div");
    route.style.marginBottom = "12px";

    const routeLabel = document.createElement("strong");
    routeLabel.textContent = "Route: ";
    route.appendChild(routeLabel);
    route.appendChild(document.createTextNode(window.location.pathname));

    const stackPre = document.createElement("pre");
    stackPre.style.cssText = `
      background: #111827;
      color: #f9fafb;
      padding: 14px;
      border-radius: 8px;
      overflow: auto;
      max-height: 450px;
      white-space: pre-wrap;
      word-break: break-word;
    `;
    stackPre.textContent = stack || "No stack trace available.";

    const actions = document.createElement("div");
    actions.style.cssText = `
      display: flex;
      gap: 10px;
      margin-top: 16px;
      flex-wrap: wrap;
    `;

    const makeButton = (label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = `
        border: 1px solid #b91c1c;
        background: white;
        color: #991b1b;
        border-radius: 6px;
        padding: 8px 12px;
        cursor: pointer;
        font-weight: 600;
      `;
      return button;
    };

    const copyButton = makeButton("Copy Error");
    const dismissButton = makeButton("Dismiss");
    const reloadButton = makeButton("Reload");

    copyButton.addEventListener("click", async () => {
      const text = [
        title,
        `Route: ${window.location.pathname}`,
        `Error: ${message}`,
        "",
        stack,
      ].join("\n");

      try {
        await navigator.clipboard?.writeText(text);
        copyButton.textContent = "Copied";
        window.setTimeout(() => {
          copyButton.textContent = "Copy Error";
        }, 1200);
      } catch (copyError) {
        console.error("Could not copy onePOS dev error:", copyError);
      }
    });

    dismissButton.addEventListener("click", () => overlay.remove());
    reloadButton.addEventListener("click", () => window.location.reload());

    actions.append(copyButton, dismissButton, reloadButton);
    body.append(errorType, errorMessage, route, stackPre, actions);
    panel.append(header, body);
    overlay.append(panel);
    document.body.appendChild(overlay);
  };

  window.addEventListener("error", (event) => {
    showDevRuntimeError(
      "Runtime Error",
      event.error || new Error(event.message || "Unknown runtime error")
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason ?? "Unknown promise rejection"));

    showDevRuntimeError("Unhandled Promise Rejection", error);
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <DevErrorBoundary>
      <App />
    </DevErrorBoundary>
  </React.StrictMode>
);

// Narrow app scope leaves the marketing website uncontrolled. Production
// assets are cached by the worker; development hot modules are never cached.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/app/offline-sw.js", { scope: "/app/" }).catch(() => {
    // Existing loaded tills still work; offline reload requires HTTPS + worker.
  });
}
