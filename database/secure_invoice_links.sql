-- ============================================================
-- SECURE INVOICE LINKS (T9P)
-- ============================================================
--
-- Non-guessable, hash-only download links for sale receipts/invoices.
-- The plaintext token is the customer's credential: it is shown once at
-- creation and is NEVER stored - only a SHA-256 hash is persisted. Lookup
-- is by hash so a database leak cannot expose live links. Tokens are
-- company-scoped through the referenced sale (tenant isolation is the
-- token relationship, exactly as required).
--
-- No receipt/sale data is duplicated here: the table only associates a
-- token with an existing sale.
--
-- Safe to run repeatedly (idempotent).

CREATE TABLE IF NOT EXISTS secure_invoice_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    token_hash VARCHAR(64) NOT NULL UNIQUE,

    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id),
    sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_secure_invoice_links_sale
ON secure_invoice_links(sale_id);

CREATE INDEX IF NOT EXISTS idx_secure_invoice_links_company_created
ON secure_invoice_links(company_id, created_at DESC);
