import React from "react";
import { claimChunkRecovery, isChunkLoadError } from "../../utils/chunkRecovery.js";

/*
 * CHUNK-LOAD RECOVERY
 *
 * A stale cached index.html can reference Vite hashed chunks that no longer
 * exist after a deploy ("Failed to fetch dynamically imported module"), which
 * previously fell into an unrecoverable full-screen dead end. Recovery:
 *
 *   1. Detect dynamic-import/chunk-load errors.
 *   2. Reload ONCE per deployed build — sessionStorage stores the build id
 *      (the current asset base), so a reload loop can never start.
 *   3. If the retry also fails, show a useful production fallback with
 *      Retry (fresh reload) and Go home actions instead of bare text.
 */
function buildSignature() {
  /* import.meta.url of THIS module changes with every build hash set, and
     document scripts carry the current hashed entry — either identifies the
     deployed build a reload is worth retrying against. */
  const script = document.querySelector('script[type="module"][src]');
  return script?.src || import.meta.env.BASE_URL;
}

function attemptChunkRecovery() {
  const signature = buildSignature();
  const url = new URL(window.location.href);
  const fallback = {
    __oneposChunkRecovered: url.searchParams.get("__chunk_recovery") === signature,
  };
  let storage = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* claimChunkRecovery uses the per-tab fallback when storage is unavailable. */
  }
  if (!claimChunkRecovery(storage, signature, fallback)) return false;
  /* Revalidate index.html (bypassing caches) so the new module graph loads. */
  try {
    url.searchParams.set("__chunk_recovery", signature);
    url.searchParams.set("__reload", Date.now().toString(36));
    window.location.replace(url.toString());
  } catch {
    window.location.reload();
  }
  return true;
}

function retryChunkLoad() {
  const url = new URL(window.location.href);
  url.searchParams.delete("__chunk_recovery");
  url.searchParams.set("__retry", Date.now().toString(36));
  window.location.replace(url.toString());
}

export default class DevErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
      info: null,
    };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });

    console.error("onePOS render error:", error, info);

    /* Stale-deploy recovery: one silent reload per build, before any error
       UI is allowed to render. */
    if (isChunkLoadError(error)) {
      attemptChunkRecovery();
    }
  }

  handleCopy = async () => {
    const { error, info } = this.state;

    const text = [
      `Route: ${window.location.pathname}`,
      `Error: ${error?.message || error}`,
      "",
      "Stack:",
      error?.stack || "",
      "",
      "Component Stack:",
      info?.componentStack || "",
    ].join("\n");

    await navigator.clipboard?.writeText(text);
  };

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    // Never expose development details in production.
    if (!import.meta.env.DEV) {
      return (
        <div className="onepos-safe-error" role="alert">
          <p>Something went wrong loading this page.</p>
          <div className="onepos-safe-error-actions">
            <button type="button" onClick={retryChunkLoad}>Retry</button>
            <button
              type="button"
              onClick={() => { window.location.href = "/app/dashboard"; }}
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }

    const { error, info } = this.state;

    return (
      <div className="onepos-dev-error-screen">
        <div className="onepos-dev-error-panel">
          <div className="onepos-dev-error-title">
            onePOS Development Error
          </div>

          <div className="onepos-dev-error-message">
            {error?.message || String(error)}
          </div>

          <div className="onepos-dev-error-meta">
            <strong>Route:</strong> {window.location.pathname}
          </div>

          <details open>
            <summary>Error stack</summary>
            <pre>{error?.stack}</pre>
          </details>

          {info?.componentStack && (
            <details>
              <summary>React component stack</summary>
              <pre>{info.componentStack}</pre>
            </details>
          )}

          <div className="onepos-dev-error-actions">
            <button onClick={this.handleCopy}>Copy Error</button>

            <button onClick={retryChunkLoad}>
              Retry
            </button>
            <button onClick={() => { window.location.href = "/app/dashboard"; }}>Go Home</button>
          </div>
        </div>
      </div>
    );
  }
}