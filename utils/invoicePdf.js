/*
 * T9Q-NEXT - dependency-free PDF builder for WhatsApp invoice attachments.
 *
 * Produces a minimal PDF 1.4 (single A4 page, Helvetica core fonts) using
 * only Node buffers - no PDF library. Text is Latin-1; characters outside
 * the Latin-1 range are replaced so the stream is always byte-safe. The
 * pound sign (0xA3) renders correctly.
 *
 * The xref offsets are byte-exact, so the output opens in standard PDF
 * viewers and passes WhatsApp media validation.
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 40;

function pdfEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function money(value, currency) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(
      Number(value) || 0
    );
  } catch {
    return `£${(Number(value) || 0).toFixed(2)}`;
  }
}

function fmtDateTime(value, timezone) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone || "Europe/London",
    }).format(new Date(value));
  } catch {
    return String(value ?? "");
  }
}

/**
 * Build the invoice PDF.
 *
 * @param {object} args
 * @param {object} args.sale - already normalised by the delivery service:
 *   { receiptNumber, createdAt, completedAt, subtotal, tax, discount, total,
 *     companyCurrency, companyTimezone,
 *     items:[{name, quantity, unitPrice, tax, total}], payments:[{method, amount}] }
 * @param {object|null} [args.company] - { name, email, phone }
 * @param {object|null} [args.store]   - { name, phone, addressLine1, city, postcode }
 * @returns {Uint8Array} PDF bytes
 */
export function buildInvoicePdf({ sale, company, store }) {
  const currency = sale.companyCurrency || "GBP";

  const at = (x, y, size, font, value) =>
    `BT /${font} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;
  const ruleAt = (y) => `${MARGIN} ${y} m ${PAGE_WIDTH - MARGIN} ${y} l S`;

  const ops = [];

  // Header.
  ops.push(at(MARGIN, PAGE_HEIGHT - MARGIN, 18, "F2", (company && company.name) || "Invoice"));
  const subLine = [store && store.name, company && company.email, company && company.phone]
    .filter(Boolean)
    .join(" | ");
  if (subLine) {
    ops.push(at(MARGIN, PAGE_HEIGHT - MARGIN - 18, 8, "F1", subLine));
  }
  ops.push(ruleAt(PAGE_HEIGHT - MARGIN - 30));

  // Receipt meta (right-aligned block).
  const metaX = PAGE_WIDTH - MARGIN - 170;
  ops.push(at(metaX, PAGE_HEIGHT - MARGIN - 8, 11, "F2", `Receipt ${sale.receiptNumber || "-"}`));
  ops.push(
    at(metaX, PAGE_HEIGHT - MARGIN - 24, 8, "F1", fmtDateTime(sale.completedAt || sale.createdAt, sale.companyTimezone))
  );

  // Column headings.
  let y = PAGE_HEIGHT - MARGIN - 54;
  ops.push(at(MARGIN, y, 8, "F2", "ITEM"));
  ops.push(at(330, y, 8, "F2", "QTY"));
  ops.push(at(375, y, 8, "F2", "UNIT"));
  ops.push(at(430, y, 8, "F2", "VAT"));
  ops.push(at(PAGE_WIDTH - MARGIN - 60, y, 8, "F2", "TOTAL"));
  ops.push(ruleAt(y - 5));

  // Line items.
  y -= 22;
  const items = Array.isArray(sale.items) ? sale.items : [];
  for (const item of items) {
    if (y < 190) {
      break; // keep the single page intact before the totals block
    }
    const rawName = String(item.name || "-");
    const name = rawName.length > 32 ? `${rawName.slice(0, 31)}~` : rawName;
    const qty = String(item.quantity ?? "");
    const unit = money(item.unitPrice, currency);
    const lineDiscount = Number(item.discount) || 0;
    ops.push(at(MARGIN, y, 9, "F1", name));
    ops.push(at(334, y, 9, "F1", qty));
    ops.push(at(375, y, 9, "F1", unit));
    if (lineDiscount > 0) {
      ops.push(at(405, y, 9, "F1", `-${money(lineDiscount, currency)}`));
      ops.push(at(430, y, 9, "F1", money(item.tax, currency)));
    } else {
      ops.push(at(430, y, 9, "F1", money(item.tax, currency)));
    }
    ops.push(at(PAGE_WIDTH - MARGIN - 60, y, 9, "F1", money(item.total, currency)));
    y -= 15;
  }
  if (!items.length) {
    ops.push(at(MARGIN, y, 9, "F1", "No line items"));
    y -= 15;
  }

  // Totals.
  if (y > 170) {
    y = 170;
  }
  ops.push(ruleAt(y + 12));
  const row = (label, value, font, size) => {
    ops.push(at(PAGE_WIDTH - MARGIN - 150, y, size, font, label));
    ops.push(at(PAGE_WIDTH - MARGIN - 60, y, size, font, value));
    y -= 14;
  };
  row("Subtotal", money(sale.subtotal, currency), "F1", 9);
  row("Discount", `-${money(sale.discount, currency)}`, "F1", 9);
  row("VAT", money(sale.tax, currency), "F1", 9);
  y -= 2;
  row("TOTAL", money(sale.total, currency), "F2", 12);

  // Payments + footer.
  const payments = (Array.isArray(sale.payments) ? sale.payments : [])
    .map((p) => `${p.method} ${money(p.amount, currency)}`)
    .join(" | ");
  if (payments) {
    ops.push(at(MARGIN, y - 4, 8, "F1", `Payment: ${payments}`));
  }
  ops.push(
    at(MARGIN, 46, 7, "F1", "Delivered via a secure WhatsApp message. If you were not expecting it, contact the store.")
  );

  const stream = ops.join("\n");

  // Object assembly (1 catalog, 2 pages, 3 page, 4-5 fonts, 6 content).
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
    "/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  objects[6] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>`;

  const latin1 = (s) => Buffer.from(s, "latin1");
  let out = Buffer.concat([latin1("%PDF-1.4\n"), latin1("%\xE2\xE3\xCF\xD3\n")]);
  const offsets = [];
  for (let i = 1; i <= 6; i += 1) {
    offsets[i] = out.length;
    if (i === 6) {
      out = Buffer.concat([out, latin1(`6 0 obj\n${objects[i]}\nstream\n${stream}\nendstream\nendobj\n`)]);
    } else {
      out = Buffer.concat([out, latin1(`${i} 0 obj\n${objects[i]}\nendobj\n`)]);
    }
  }

  const xrefStart = out.length;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  out = Buffer.concat([out, latin1(xref)]);

  return new Uint8Array(out);
}

/** Latin-1 view of the PDF bytes - lets tests assert on rendered text. */
export function extractPdfText(pdfBytes) {
  return Buffer.from(pdfBytes).toString("latin1");
}
