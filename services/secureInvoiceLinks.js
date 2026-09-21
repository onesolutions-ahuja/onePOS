/*
 * T9P - Secure invoice link service (backend foundation).
 *
 * Non-guessable download links for sale receipts/invoices. The plaintext
 * token IS the credential:
 *
 *   - generated with crypto.randomBytes (256 bits of entropy) and encoded
 *     URL/base64url-safe (43 chars, no padding, no URL-ambiguous chars)
 *   - stored ONLY as a SHA-256 hash (lookup key); the plaintext is never
 *     persisted and never returned after creation
 *   - expires (default 30 days, configurable per link) and can be revoked
 *     individually or per sale
 *   - company/store scoping rides on the token -> sale relationship, so
 *     tenant isolation cannot drift from the sale's own tenancy
 *
 * No provider logic (WhatsApp/SMS/email) and no frontend live here - this
 * module is the reusable foundation for any future delivery channel.
 */
import crypto from "crypto";

export const SECURE_LINK_DEFAULT_EXPIRY_DAYS = 30;

/** URL-safe base64 without padding: safe in URLs, QR codes and message bodies. */
function encodeToken(buf) {
  return buf.toString("base64url");
}

/** SHA-256 hex digest of the plaintext token - the only stored form. */
export function hashSecureInvoiceToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

/**
 * Generate a fresh opaque token pair. The plaintext is returned exactly
 * once by createSecureInvoiceLink; only the hash ever reaches storage.
 */
export function generateSecureInvoiceToken() {
  const plaintext = encodeToken(crypto.randomBytes(32));
  return { plaintext, tokenHash: hashSecureInvoiceToken(plaintext) };
}

function normaliseExpiry(expiresAt, { expiryDays }) {
  if (expiresAt) return new Date(expiresAt);
  const days = Number.isFinite(expiryDays) && expiryDays > 0 ? expiryDays : SECURE_LINK_DEFAULT_EXPIRY_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Create a secure link for an existing sale.
 *
 * @param {object} args
 * @param {Function} args.db           - tenant-aware query helper used across the app
 * @param {string} args.companyId      - owning company (must own the sale)
 * @param {string|null} [args.storeId] - owning store where applicable
 * @param {string} args.saleId         - the sale to expose
 * @param {string|null} [args.customerId] - recorded for auditing/future checks
 * @param {string|null} [args.createdBy]  - acting user
 * @param {Date|string|null} [args.expiresAt] - absolute expiry (wins over expiryDays)
 * @param {number} [args.expiryDays]   - relative expiry when expiresAt not given
 * @returns {Promise<{ok: true, linkId: string, token: string, expiresAt: Date}
 *                  |{ok: false, status: number, message: string}>}
 *   `token` is the ONLY time the plaintext is available.
 */
export async function createSecureInvoiceLink({
  db,
  companyId,
  storeId = null,
  saleId,
  customerId = null,
  createdBy = null,
  expiresAt = null,
  expiryDays,
}) {
  if (!db || !companyId || !saleId) {
    return { ok: false, status: 400, message: "db, companyId and saleId are required" };
  }

  // The link may only ever be created by/for a sale the caller's tenant owns.
  const saleCheck = await db(
    `SELECT s.id, s.company_id, s.store_id, s.customer_id
     FROM sales s
     WHERE s.id = $1 AND s.company_id = $2
     ${storeId ? "AND s.store_id = $3" : ""}
     LIMIT 1`,
    storeId ? [saleId, companyId, storeId] : [saleId, companyId]
  );
  if (!saleCheck.rows.length) {
    return { ok: false, status: 404, message: "Sale not found" };
  }

  const { plaintext, tokenHash } = generateSecureInvoiceToken();
  const expiry = normaliseExpiry(expiresAt, { expiryDays });

  const result = await db(
    `INSERT INTO secure_invoice_links
       (token_hash, company_id, store_id, sale_id, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, expires_at`,
    [tokenHash, companyId, saleCheck.rows[0].store_id ?? storeId, saleId, createdBy, expiry]
  );

  const row = result.rows[0];
  return {
    ok: true,
    linkId: row.id,
    token: plaintext,
    expiresAt: row.expires_at,
    // Convenience audit context for the caller; never includes the plaintext.
    customerId: customerId ?? saleCheck.rows[0].customer_id ?? null,
  };
}

/**
 * Validate an opaque token and load the sale it belongs to.
 *
 * Every failure returns the same generic shape so callers cannot
 * distinguish invalid / expired / revoked tokens (enumeration protection).
 *
 * @returns {Promise<{ok: false, status: 404, message: string}
 *                  |{ok: true, link: object, sale: object}>}
 */
export async function validateSecureInvoiceToken({ db, token, includeSale = true }) {
  const generic = { ok: false, status: 404, message: "This link is invalid, has expired, or has been revoked." };
  if (!db || !token || typeof token !== "string") return generic;

  try {
    const tokenHash = hashSecureInvoiceToken(token);
    const result = await db(
      `SELECT l.id, l.token_hash, l.company_id, l.store_id, l.sale_id,
              l.created_at, l.expires_at, l.revoked_at,
              l.last_accessed_at, l.access_count
       FROM secure_invoice_links l
       WHERE l.token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );
    const link = result.rows[0];
    if (!link) return generic;
    if (link.revoked_at) return generic;
    if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return generic;

    // Company/store ownership comes from the token relationship itself.
    const saleResult = await db(
      `SELECT s.id, s.company_id, s.store_id, s.receipt_number, s.subtotal,
              s.tax, s.discount, s.total, s.status, s.created_at, s.completed_at,
              c.timezone AS company_timezone, c.currency AS company_currency
       FROM sales s
       INNER JOIN companies c ON c.id = s.company_id
       WHERE s.id = $1 AND s.company_id = $2
       ${link.store_id ? "AND s.store_id = $3" : ""}
       LIMIT 1`,
      link.store_id ? [link.sale_id, link.company_id, link.store_id] : [link.sale_id, link.company_id]
    );
    const sale = saleResult.rows[0];
    if (!sale) return generic;

    if (includeSale !== false) {
      const itemResult = await db(
        `SELECT product_name, quantity, unit_price, discount, discount_type, discount_value,
           original_unit_price, tax, total
         FROM sale_items WHERE sale_id = $1 ORDER BY id ASC`,
        [sale.id]
      );
      sale.items = itemResult.rows.map((item) => ({
        name: item.product_name,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unit_price),
        discount: Number(item.discount),
        discountType: item.discount_type || null,
        discountValue: Number(item.discount_value) || 0,
        originalUnitPrice: Number(item.original_unit_price) || null,
        tax: Number(item.tax),
        total: Number(item.total),
      }));
      const payResult = await db(
        `SELECT payment_method, amount, status FROM payments WHERE sale_id = $1 ORDER BY created_at ASC`,
        [sale.id]
      );
      sale.payments = payResult.rows.map((pay) => ({
        method: pay.payment_method,
        amount: Number(pay.amount),
        status: pay.status,
      }));
    }

    return { ok: true, link, sale };
  } catch {
    // Absolute rule: never leak storage errors to the public surface.
    return generic;
  }
}

/** Record a successful public access (async, best-effort, never throws). */
export async function recordSecureInvoiceAccess({ db, linkId }) {
  if (!db || !linkId) return;
  try {
    await db(
      `UPDATE secure_invoice_links
       SET access_count = access_count + 1,
           last_accessed_at = NOW()
       WHERE id = $1`,
      [linkId]
    );
  } catch {
    /* stats are never allowed to break a download */
  }
}

/**
 * Revoke a single link by id. Idempotent: revoking an already-revoked or
 * unknown link reports success to the caller without leaking existence.
 *
 * @returns {Promise<{ok: boolean}>}
 */
export async function revokeSecureInvoiceLink({ db, companyId, linkId }) {
  if (!db || !companyId || !linkId) return { ok: false };
  try {
    const result = await db(
      `UPDATE secure_invoice_links
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE id = $1 AND company_id = $2`,
      [linkId, companyId]
    );
    return { ok: true, revoked: result.rowCount > 0 };
  } catch {
    return { ok: false };
  }
}

/**
 * Revoke every active link for a sale (e.g. after a refund/cancellation).
 *
 * @returns {Promise<{ok: boolean, revoked: number}>}
 */
export async function revokeSecureInvoiceLinksForSale({ db, companyId, saleId }) {
  if (!db || !companyId || !saleId) return { ok: false, revoked: 0 };
  try {
    const result = await db(
      `UPDATE secure_invoice_links
       SET revoked_at = NOW()
       WHERE sale_id = $1 AND company_id = $2 AND revoked_at IS NULL`,
      [saleId, companyId]
    );
    return { ok: true, revoked: result.rowCount || 0 };
  } catch {
    return { ok: false, revoked: 0 };
  }
}

/*
 * T9P-SMALL - delivery-safe contract for future WhatsApp/SMS/email channels.
 *
 * createInvoiceDeliveryLink is the ONLY entry point a delivery channel needs:
 * it reuses createSecureInvoiceLink unchanged (same 256-bit crypto token, same
 * hash-only storage, same tenant validation) and strips the result down to the
 * two fields a message requires - the public URL and the expiry. The plaintext
 * token is never handed back as a separate field, no hashes, no internal IDs
 * and no customer data cross this boundary. The URL always targets the
 * existing /i/:token route and never carries query parameters.
 */

/** Only absolute http(s) base URLs are honoured; anything else falls back to the relative path. */
function normaliseDeliveryBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string") return null;
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Create a secure invoice link and return ONLY delivery-safe information.
 *
 * Thin wrapper over createSecureInvoiceLink - no token generation or hashing
 * happens here. Failure responses keep the existing generic {ok,status,message}
 * shape; the success response exposes exactly { ok, url, expiresAt }.
 *
 * @param {object} args
 * @param {Function} args.db        - tenant-aware query helper used across the app
 * @param {string} args.saleId      - sale to expose (must belong to companyId)
 * @param {string} args.companyId   - owning company (tenant validation is enforced downstream)
 * @param {string|null} [args.storeId]
 * @param {string|null} [args.createdBy]
 * @param {number} [args.expiryDays]
 * @param {Date|string|null} [args.expiresAt]
 * @param {string|null} [args.baseUrl] - optional https origin to prefix; default is the relative /i/<token>
 * @returns {Promise<{ok: true, url: string, expiresAt: Date}
 *                  |{ok: false, status: number, message: string}>}
 */
export async function createInvoiceDeliveryLink({
  db,
  saleId,
  companyId,
  storeId = null,
  createdBy = null,
  expiryDays,
  expiresAt = null,
  baseUrl = null,
}) {
  const created = await createSecureInvoiceLink({
    db,
    companyId,
    storeId,
    saleId,
    createdBy,
    expiresAt,
    expiryDays,
  });
  if (!created.ok) {
    return {
      ok: false,
      status: created.status || 500,
      message: created.message || "Unable to create secure invoice link",
    };
  }
  const prefix = normaliseDeliveryBaseUrl(baseUrl);
  return {
    ok: true,
    url: `${prefix ? `${prefix}/` : "/"}i/${created.token}`,
    expiresAt: created.expiresAt,
  };
}

/**
 * Plain-text delivery message for a secure invoice link (SMS/WhatsApp/email
 * body). Accepts only presentation fields, so internal IDs cannot leak through
 * it. Returns null when there is no URL to deliver; an unparseable expiry is
 * silently omitted rather than throwing.
 */
export function buildInvoiceDeliveryMessage({ url, invoiceNumber, expiresAt }) {
  if (!url || typeof url !== "string") return null;
  const lines = [
    "Thank you for your purchase.",
    `Your invoice${invoiceNumber ? ` ${invoiceNumber}` : ""}: ${url}`,
  ];
  if (expiresAt) {
    const expiry = new Date(expiresAt);
    if (!Number.isNaN(expiry.getTime())) {
      lines.push(
        `This link is valid until ${new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(expiry)}.`
      );
    }
  }
  lines.push("If you were not expecting this message, please ignore it.");
  return lines.join("\n");
}
