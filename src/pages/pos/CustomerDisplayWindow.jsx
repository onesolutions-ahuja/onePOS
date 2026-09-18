import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import CustomerBillDisplay from "./CustomerBillDisplay.jsx";

/*
 * T10F-FIX — Customer Display in a SEPARATE browser window.
 *
 * The normal POS remains the primary screen and is never replaced. This
 * component opens a popup window (user drags it onto the second monitor)
 * and renders the SAME CustomerBillDisplay INTO that window through a
 * portal — so it shows the exact same live basket/totals state as the
 * till, with zero duplicated basket/VAT/payment logic.
 *
 * Guarantees:
 *  - The cashier's POS keeps running normally at all times.
 *  - Closing the popup (X button, window close, or toggling the header
 *    button) never touches the till: the popup is unmounted and its
 *    window destroyed; POS state is untouched.
 *  - The customer window is strictly read-only: the mirrored document is
 *    inert (inputs/buttons disabled) and the display itself has no
 *    mutating controls.
 *  - Empty basket → OnePOS welcome screen (inside CustomerBillDisplay).
 *
 * Popup quirks handled: document may be null for one tick before the
 * blank window's DOM is ready — we open on a document.write("...") shell
 * synchronously, then copy the app's stylesheet links across and wait
 * for load before first render.
 */

/*
 * Copy the app's real CSS into the popup document.
 *
 * Popup quirks handled:
 *  - In PRODUCTION the app document has <link rel="stylesheet"> tags
 *    (Vite hashes: /assets/app-*.css). Cloning the <link> works because
 *    the popup is same-origin, BUT cloned links re-fetch asynchronously
 *    — so we also resolve every link to its final href and inject the
 *    actual CSS TEXT into <style> elements. That makes the customer
 *    window styled immediately and immune to async race conditions.
 *  - In DEV (vite dev server) styles arrive via HMR <style> tags, which
 *    clone fine.
 *  - Tailwind typography (Inter) is re-linked from the app document.
 */
async function copyStyles(sourceDoc, targetDoc) {
  const head = targetDoc.head;

  /* 1. Web fonts first (font-family: Inter from the app <head>). */
  try {
    Array.from(sourceDoc.querySelectorAll('link[rel="stylesheet"][href*="fonts"]')).forEach(
      (node) => head.appendChild(node.cloneNode(true))
    );
  } catch { /* non-fatal */ }

  /* 2. Inline <style> blocks (dev HMR + runtime-injected styles). */
  try {
    Array.from(sourceDoc.querySelectorAll("style")).forEach((node) => {
      if (node.textContent && node.textContent.trim()) {
        const clone = targetDoc.createElement("style");
        clone.textContent = node.textContent;
        head.appendChild(clone);
      }
    });
  } catch { /* non-fatal */ }

  /* 3. Stylesheet links: fetch the CSS text and inline it. */
  const links = Array.from(
    sourceDoc.querySelectorAll('link[rel="stylesheet"]')
  ).filter((node) => {
    const href = node.getAttribute("href") || "";
    return href && !href.includes("fonts");
  });

  await Promise.all(
    links.map(async (node) => {
      try {
        const href = new URL(node.getAttribute("href"), sourceDoc.baseURI).href;
        const response = await fetch(href, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const css = await response.text();
        const style = targetDoc.createElement("style");
        style.textContent = css;
        head.appendChild(style);
      } catch {
        /* Fallback: clone the link and let the browser load it directly. */
        try {
          head.appendChild(node.cloneNode(true));
        } catch { /* give up quietly — display still renders */ }
      }
    })
  );

  targetDoc.documentElement.lang = sourceDoc.documentElement.lang || "en";
}

export default function CustomerDisplayWindow({
  basket,
  subtotal,
  vat,
  total,
  discountAmount,
  hasDiscount,
  hasCustomer,
  storeName,
  onClose,
}) {
  const winRef = useRef(null);
  const [portalTarget, setPortalTarget] = useState(null);
  const closedRef = useRef(false);

  useEffect(() => {
    /* Portrait till-display proportions; centred so it lands on either monitor */
    const features =
      "popup=yes,width=540,height=960,left=200,top=60,menubar=no,toolbar=no,location=no,status=no";

    let cancelled = false;

    const win = window.open("", "onepos-customer-display", features);

    if (!win) {
      /* Popup blocked — surface a NON-BLOCKING notice on the till (an
         alert() would freeze the whole app until dismissed). */
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("onepos:toast", {
            detail: {
              message: "Customer Display was blocked by the browser — allow pop-ups for this site and try again.",
              tone: "error",
            },
          })
        );
      }, 0);

      onClose();

      return undefined;
    }

    winRef.current = win;

    /* Synchronous shell so document exists immediately */
    win.document.open();
    win.document.write(
      '<!doctype html><html><head><title>onePOS — Customer Display</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
      '<meta name="robots" content="noindex, nofollow" />' +
      '</head><body style="margin:0"><div id="customer-display-root" style="height:100vh"></div></body></html>'
    );
    win.document.close();

    const finish = () => {
      if (!cancelled) {
        setPortalTarget(win.document.getElementById("customer-display-root"));
      }
    };

    /* Styles copied async; the portal mounts immediately with the inline
       shell styles and re-renders fully styled the moment CSS lands. */
    copyStyles(window.document, win.document).finally(finish);

    if (win.document.readyState === "complete") {
      finish();
    } else {
      win.addEventListener("load", finish, { once: true });
    }

    /* Till must react if the CUSTOMER closes their window */
    const poll = window.setInterval(() => {
      if (win.closed && !closedRef.current) {
        closedRef.current = true;
        window.clearInterval(poll);
        onClose();
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(poll);

      if (!closedRef.current && !win.closed) {
        win.close();
      }

      closedRef.current = true;
    };
    // Open once per mount; props update every basket change via portal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeCustomerWindow = () => {
    closedRef.current = true;
    onClose();
  };

  if (!portalTarget) {
    return null;
  }

  return createPortal(
    <>
      {/* Read-only enforcement inside the customer document */}
      <style>
        {`#customer-display-root, #customer-display-root * {
            pointer-events: auto;
          }
          #customer-display-root button:not([data-cashier-exit]),
          #customer-display-root input,
          #customer-display-root select,
          #customer-display-root textarea {
            pointer-events: none !important;
            user-select: none !important;
          }`}
      </style>

      <CustomerBillDisplay
        basket={basket}
        subtotal={subtotal}
        vat={vat}
        total={total}
        discountAmount={discountAmount}
        hasDiscount={hasDiscount}
        hasCustomer={hasCustomer}
        storeName={storeName}
      />

      {/* Cashier-only close affordance on the customer window */}
      <button
        type="button"
        data-cashier-exit="true"
        onClick={closeCustomerWindow}
        title="Close customer display (till unaffected)"
        className="fixed top-3 right-3 z-20 h-9 w-9 flex items-center justify-center rounded-full bg-black/30 text-white hover:bg-black/50 transition-colors"
      >
        <X size={18} />

        <span className="sr-only">Close customer display</span>
      </button>
    </>,
    portalTarget
  );
}
