import { platformLabel } from "../pages/online/onlineOrdersShared.js";
import { fmt } from "./formatters.js";

/*
 * Kitchen-friendly printing for online orders (Uber Eats / Deliveroo).
 *
 * Uses the browser's own print dialog - NO printer hardware integration yet.
 * The ticket is rendered into a hidden iframe and printed from there, which
 * works on till screens where popup windows are blocked, and never navigates
 * the onePOS page itself.
 *
 * printOnlineOrder(order, items)
 *   order: the online_orders row (list or detail shape)
 *   items: online_order_items rows when available (detail endpoint); the
 *          ticket falls back to the list-only item_count when they are not.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTicketHtml(order, items) {
  const received = order.created_at ? new Date(order.created_at) : null;
  const receivedText = received && !Number.isNaN(received.getTime())
    ? received.toLocaleString()
    : "-";

  const itemRows = Array.isArray(items) && items.length
    ? items
        .map((item) => {
          const modifiers =
            (item.platform_data && item.platform_data.modifiers) || [];
          const modifierNames = modifiers
            .map((m) => m.name)
            .filter(Boolean)
            .join(", ");

          return `
            <tr>
              <td class="qty">${escapeHtml(item.quantity)}</td>
              <td>
                ${escapeHtml(item.product_name)}
                ${modifierNames ? `<div class="mod">${escapeHtml(modifierNames)}</div>` : ""}
                ${item.mapping_status === "UNMAPPED" ? '<div class="mod">*** UNMAPPED ITEM ***</div>' : ""}
              </td>
              <td class="price">${escapeHtml(fmt(item.total))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td class="qty">${escapeHtml(order.item_count ?? "-")}</td><td>items (details not loaded)</td><td class="price"></td></tr>`;

  const customerLine = [order.customer_name, order.customer_phone]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" - ");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(platformLabel(order.platform))} ${escapeHtml(order.external_order_id || "")}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: "Courier New", monospace; margin: 0; padding: 12px; color: #000; width: 302px; }
          h1 { font-size: 16px; margin: 0 0 2px; text-transform: uppercase; letter-spacing: 1px; }
          .order-no { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
          .meta { font-size: 11px; margin-bottom: 8px; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          td { padding: 3px 0; vertical-align: top; }
          td.qty { width: 34px; text-align: right; padding-right: 8px; font-weight: bold; white-space: nowrap; }
          td.price { width: 64px; text-align: right; white-space: nowrap; }
          .mod { font-size: 10px; color: #333; }
          .totals { font-size: 12px; margin-top: 6px; }
          .totals .row { display: flex; justify-content: space-between; padding: 1px 0; }
          .totals .grand { font-size: 15px; font-weight: bold; border-top: 1px dashed #000; margin-top: 4px; padding-top: 4px; }
          .notes { font-size: 11px; margin-top: 8px; white-space: pre-wrap; }
          .footer { font-size: 10px; margin-top: 10px; text-align: center; color: #444; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(platformLabel(order.platform))}</h1>
        <div class="order-no">Order ${escapeHtml(order.external_order_id || order.id || "")}</div>
        <div class="meta">
          Received: ${escapeHtml(receivedText)}<br />
          ${escapeHtml(order.fulfilment_type || "")}${customerLine ? `<br />${customerLine}` : ""}
        </div>
        <div class="divider"></div>
        <table>${itemRows}</table>
        <div class="divider"></div>
        <div class="totals">
          <div class="row"><span>Subtotal</span><span>${escapeHtml(fmt(order.subtotal))}</span></div>
          <div class="row"><span>Tax (incl.)</span><span>${escapeHtml(fmt(order.tax))}</span></div>
          ${Number(order.delivery_fee) > 0 ? `<div class="row"><span>Delivery fee</span><span>${escapeHtml(fmt(order.delivery_fee))}</span></div>` : ""}
          <div class="row grand"><span>TOTAL</span><span>${escapeHtml(fmt(order.total))}</span></div>
        </div>
        ${order.notes ? `<div class="notes">Notes: ${escapeHtml(order.notes)}</div>` : ""}
        <div class="footer">onePOS - printed ${escapeHtml(new Date().toLocaleString())}</div>
      </body>
    </html>
  `;
}

export function printOnlineOrder(order, items = []) {
  if (!order) return;

  const existingFrame = document.getElementById("onepos-print-frame");
  if (existingFrame) existingFrame.remove();

  const iframe = document.createElement("iframe");
  iframe.id = "onepos-print-frame";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");

  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(buildTicketHtml(order, items));
  doc.close();

  const cleanup = () => {
    setTimeout(() => iframe.remove(), 1000);
  };

  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  cleanup();
}
