import express from "express";

const LEDGER_ENTRY_TYPES = new Set(["INVOICE", "PAYMENT", "RETURN_CREDIT", "OPENING"]);
const LEDGER_ENTRY_ALIASES = {
  CREDIT: "RETURN_CREDIT",
  DEBIT: "OPENING",
  SUPPLIER_CREDIT: "RETURN_CREDIT",
  SUPPLIER_DEBIT: "OPENING",
};

function normalizeEntryType(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  const resolved = LEDGER_ENTRY_ALIASES[raw] ?? raw;
  return LEDGER_ENTRY_TYPES.has(resolved) ? resolved : null;
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return null;
}

function parsePage(value, fallback = 1) {
  const page = Number.parseInt(value ?? String(fallback), 10);
  return Number.isFinite(page) && page > 0 ? page : fallback;
}

function parsePageSize(value, fallback = 25, max = 200) {
  const pageSize = Number.parseInt(value ?? String(fallback), 10);
  const safe = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : fallback;
  return Math.min(safe, max);
}

function parseJsonFilter(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === "object") return rawValue;
  try {
    const parsed = JSON.parse(String(rawValue));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function createSupplierAccountsRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();
  const view = ["purchase.view", "inventory.view"];
  const manage = ["purchase.edit", "inventory.adjust"];

  async function ensureSupplierInCompany(supplierId, companyId) {
    const supplier = await db(
      "SELECT id, company_id, active FROM suppliers WHERE id=$1 AND company_id=$2",
      [supplierId, companyId]
    );
    if (!supplier.rows.length) {
      const error = new Error("Supplier not found");
      error.status = 404;
      throw error;
    }
    return supplier.rows[0];
  }

  async function ensureStoreInCompany(storeId, companyId) {
    if (!storeId) return null;
    const store = await db(
      "SELECT id, company_id FROM stores WHERE id=$1 AND company_id=$2",
      [storeId, companyId]
    );
    if (!store.rows.length) {
      const error = new Error("Store not found");
      error.status = 404;
      throw error;
    }
    return store.rows[0];
  }

  function normalizeLedgerRow(row) {
    return {
      ...row,
      amount: Number(row.amount) || 0,
      running_balance: row.running_balance === null || row.running_balance === undefined ? null : Number(row.running_balance),
      balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
      debit: Boolean(row.debit),
      created_at: row.created_at || row.createdAt || null,
    };
  }

  async function createLedgerEntry(req, res) {
    const amount = Number(req.body?.amount);
    const effectiveType = normalizeEntryType(req.body?.entryType ?? req.body?.entry_type ?? req.body?.type);
    const debit = req.body?.debit ?? req.body?.direction;
    const rawDebit = parseBoolean(debit);
    if (typeof debit !== "boolean") {
      if (typeof debit !== "string" || rawDebit === null) {
        return res.status(400).json({
          success: false,
          message: "Supplier, valid ledger entry type, positive amount and debit flag are required",
        });
      }
    }
    if (!req.body?.supplierId || !effectiveType || !Number.isFinite(amount) || amount <= 0 || rawDebit === null) {
      return res.status(400).json({
        success: false,
        message: "Supplier, valid ledger entry type, positive amount and debit flag are required",
      });
    }

    try {
      const supplier = await ensureSupplierInCompany(req.body.supplierId, req.user.companyId);
      if (supplier.active === false) {
        return res.status(400).json({ success: false, message: "Supplier is inactive" });
      }
      if (req.body.storeId) {
        await ensureStoreInCompany(req.body.storeId, req.user.companyId);
      }

      const idempotencyKey = req.body.idempotencyKey != null ? String(req.body.idempotencyKey).slice(0, 100) : null;
      if (idempotencyKey) {
        const existing = await db(
          "SELECT id FROM supplier_ledger_entries WHERE company_id=$1 AND idempotency_key=$2 LIMIT 1",
          [req.user.companyId, idempotencyKey]
        );
        if (existing.rows.length) {
          return res.status(409).json({
            success: false,
            message: "Ledger entry has already been processed",
            data: { id: existing.rows[0].id, duplicate: true },
          });
        }
      }

      const reference = req.body.reference ?? req.body.referenceNumber ?? req.body.ref ?? null;
      const description = req.body.description ?? req.body.notes ?? null;
      const transactionDate = req.body.transactionDate ?? req.body.date ?? req.body.createdAt ?? null;

      const result = await db(
        `INSERT INTO supplier_ledger_entries
          (company_id, supplier_id, store_id, entry_type, reference_type, reference_id, reference, amount, debit, description, idempotency_key, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, NOW()))
         RETURNING *`,
        [
          req.user.companyId,
          req.body.supplierId,
          req.body.storeId || req.user.storeId || null,
          effectiveType,
          req.body.referenceType || "SUPPLIER_ADJUSTMENT",
          req.body.referenceId || null,
          reference ? String(reference).trim() || null : null,
          amount,
          rawDebit,
          description ? String(description).trim() || null : null,
          idempotencyKey,
          req.user.id,
          transactionDate || null,
        ]
      );

      res.status(201).json({ success: true, data: normalizeLedgerRow(result.rows[0]) });
    } catch (error) {
      console.error("Create supplier ledger entry error:", error);
      if (error.status === 404) {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.code === "23503") {
        return res.status(400).json({ success: false, message: "Referenced record not found" });
      }
      if (error.code === "23505") {
        return res.status(409).json({ success: false, message: "Duplicate supplier ledger entry" });
      }
      return res.status(500).json({ success: false, message: "Unable to create supplier ledger entry" });
    }
  }

  async function getSupplierLedgerEntriesHandler(req, res) {
    try {
      const page = parsePage(req.query.page, 1);
      const pageSize = parsePageSize(req.query.pageSize, 25, 200);
      const offset = (page - 1) * pageSize;
      const supplierId = req.query.supplierId || req.query.supplier_id || null;
      const storeId = req.query.storeId || req.query.store_id || null;
      const search = (req.query.search || req.query.q || "").trim();
      const entryType = normalizeEntryType(req.query.entryType ?? req.query.entry_type ?? req.query.type ?? null);
      const debitFilter = parseBoolean(req.query.debit ?? req.query.direction ?? req.query.credit);
      const filterData = parseJsonFilter(req.query.filter);
      const requestedType = normalizeEntryType(filterData.entryType ?? filterData.entry_type ?? filterData.type ?? null) ?? entryType;
      const requestedDebit = parseBoolean(filterData.debit ?? filterData.direction ?? null) ?? debitFilter;
      const requestedStore = filterData.storeId ?? filterData.store_id ?? storeId;
      const requestedSupplier = (filterData.supplierId ?? filterData.supplier_id ?? supplierId ?? req.params.id) || null;
      const startDate = req.query.startDate || req.query.from || filterData.startDate || filterData.from || null;
      const endDate = req.query.endDate || req.query.to || filterData.endDate || filterData.to || null;
      const referenceFilter = req.query.reference || filterData.reference || null;

      if (requestedSupplier) {
        await ensureSupplierInCompany(requestedSupplier, req.user.companyId);
      }
      if (requestedStore) {
        await ensureStoreInCompany(requestedStore, req.user.companyId);
      }

      const clauses = ["company_id = $1"];
      const params = [req.user.companyId];
      let idx = 2;

      if (requestedSupplier) {
        clauses.push(`supplier_id = $${idx}`);
        params.push(requestedSupplier);
        idx += 1;
      }
      if (requestedStore) {
        clauses.push(`store_id = $${idx}`);
        params.push(requestedStore);
        idx += 1;
      }
      if (requestedType) {
        clauses.push(`entry_type = $${idx}`);
        params.push(requestedType);
        idx += 1;
      }
      if (requestedDebit !== null) {
        clauses.push(`debit = $${idx}`);
        params.push(requestedDebit);
        idx += 1;
      }
      if (referenceFilter) {
        clauses.push(`reference = $${idx}`);
        params.push(String(referenceFilter).trim());
        idx += 1;
      }
      if (startDate) {
        clauses.push(`created_at >= $${idx}`);
        params.push(startDate);
        idx += 1;
      }
      if (endDate) {
        clauses.push(`created_at < $${idx}`);
        params.push(endDate);
        idx += 1;
      }
      if (search) {
        clauses.push(`(LOWER(COALESCE(reference, '')) LIKE LOWER($${idx}) OR LOWER(COALESCE(description, '')) LIKE LOWER($${idx}) OR LOWER(COALESCE(entry_type, '')) LIKE LOWER($${idx}))`);
        const pattern = `%${String(search).trim()}%`;
        params.push(pattern, pattern, pattern);
        idx += 3;
      }

      const countQuery = `SELECT COUNT(*)::int AS total FROM supplier_ledger_entries WHERE ${clauses.join(" AND ")}`;
      const listQuery = `SELECT id, company_id, supplier_id, store_id, entry_type, reference_type, reference_id, reference, amount, debit, description, created_by, created_at
        FROM supplier_ledger_entries
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${idx} OFFSET $${idx + 1}`;
      params.push(pageSize, offset);
      const [countResult, rowsResult] = await Promise.all([
        db(countQuery, params.slice(0, params.length - 2)),
        db(listQuery, params),
      ]);
      const total = Number(countResult.rows[0]?.total || 0);
      const data = rowsResult.rows.map(normalizeLedgerRow);
      const pages = total === 0 ? 0 : Math.max(1, Math.ceil(total / pageSize));
      res.json({ success: true, data, records: data, page, pageSize, total, pages });
    } catch (error) {
      console.error("List supplier ledger entries error:", error);
      if (error.status === 404) return res.status(404).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: "Unable to load supplier ledger entries" });
    }
  }

  async function getSupplierSummaryHandler(req, res) {
    try {
      const supplierId = req.params.id || req.query.supplierId || req.query.supplier_id;
      const storeId = req.query.storeId || req.query.store_id || null;
      if (storeId) await ensureStoreInCompany(storeId, req.user.companyId);
      const supplier = await ensureSupplierInCompany(supplierId, req.user.companyId);

      const result = await db(
        `SELECT
          s.id AS supplier_id,
          s.name AS supplier_name,
          s.active,
          COALESCE((SELECT SUM(total) FROM supplier_invoices WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS total_invoice_amount,
          COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS total_paid,
          COALESCE((SELECT SUM(CASE WHEN debit = false THEN amount ELSE 0 END) FROM supplier_ledger_entries WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS total_credits,
          COALESCE((SELECT SUM(CASE WHEN debit = true THEN amount ELSE 0 END) FROM supplier_ledger_entries WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS total_debits,
          COALESCE((SELECT COUNT(*)::int FROM supplier_invoices WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS invoice_count,
          COALESCE((SELECT COUNT(*)::int FROM supplier_payments WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS payment_count,
          COALESCE((SELECT SUM(CASE WHEN debit THEN amount ELSE -amount END) FROM supplier_ledger_entries WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)), 0) AS ledger_balance,
          COALESCE((SELECT MAX(last_tx.created_at) FROM (
            SELECT created_at FROM supplier_invoices WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)
            UNION ALL
            SELECT created_at FROM supplier_payments WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)
            UNION ALL
            SELECT created_at FROM supplier_ledger_entries WHERE company_id=$1 AND supplier_id=$2 AND ($3::uuid IS NULL OR store_id=$3)
          ) AS last_tx), NULL) AS last_transaction_date
         FROM suppliers s
         WHERE s.id=$2 AND s.company_id=$1
         LIMIT 1`,
        [req.user.companyId, supplierId, storeId || null]
      );

      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "Supplier not found" });
      }

      const row = result.rows[0];
      const totalInvoiceAmount = Number(row.total_invoice_amount) || 0;
      const totalPaid = Number(row.total_paid) || 0;
      const totalCredits = Number(row.total_credits) || 0;
      const totalDebits = Number(row.total_debits) || 0;
      const ledgerBalance = Number(row.ledger_balance) || 0;
      const response = {
        supplier: {
          id: row.supplier_id,
          name: row.supplier_name,
          active: row.active,
        },
        total_invoice_amount: totalInvoiceAmount,
        total_paid: totalPaid,
        total_credits: totalCredits,
        total_debits: totalDebits,
        outstanding_balance: Math.max(0, totalInvoiceAmount - totalPaid),
        ledger_balance: ledgerBalance,
        invoice_count: Number(row.invoice_count) || 0,
        payment_count: Number(row.payment_count) || 0,
        last_transaction_date: row.last_transaction_date || null,
      };
      res.json({ success: true, data: response });
    } catch (error) {
      console.error("Supplier summary error:", error);
      if (error.status === 404) return res.status(404).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: "Unable to load supplier summary" });
    }
  }

  router.get("/supplier-invoices", authenticate, authorize(...view), async (req, res) => {
    try {
      const result = await db(
        `SELECT i.*, s.name AS supplier_name,
          COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.invoice_id=i.id),0) AS paid_amount
         FROM supplier_invoices i INNER JOIN suppliers s ON s.id=i.supplier_id
        WHERE i.company_id=$1 AND ($2::uuid IS NULL OR i.supplier_id=$2)
        ORDER BY i.invoice_date DESC, i.created_at DESC`,
        [req.user.companyId, req.query.supplierId || null]
      );
      res.json({ success: true, data: result.rows.map((row) => ({
        ...row,
        total: Number(row.total),
        paid_amount: Number(row.paid_amount),
        outstanding_amount: Math.max(0, Number(row.total) - Number(row.paid_amount)),
      })) });
    } catch (error) {
      console.error("List supplier invoices error:", error);
      res.status(500).json({ success: false, message: "Unable to load supplier invoices" });
    }
  });

  router.post("/supplier-invoices", authenticate, authorize(...manage), async (req, res) => {
    const total = Number(req.body?.total);
    const subtotal = Number(req.body?.subtotal ?? total);
    const tax = Number(req.body?.tax || 0);
    if (!req.body?.supplierId || !req.body?.invoiceNumber || !Number.isFinite(total) || total < 0 ||
        !Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(tax) || tax < 0) {
      return res.status(400).json({ success: false, message: "Supplier, invoice number and valid totals are required" });
    }
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO supplier_invoices
          (company_id,supplier_id,store_id,purchase_id,invoice_number,invoice_date,due_date,subtotal,tax,total,notes,created_by)
         SELECT $1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7,$8,$9,$10,$11,$12
          WHERE EXISTS (SELECT 1 FROM suppliers WHERE id=$2 AND company_id=$1)
         RETURNING *`,
        [req.user.companyId, req.body.supplierId, req.body.storeId || req.user.storeId || null,
          req.body.purchaseId || null, String(req.body.invoiceNumber).trim(), req.body.invoiceDate || null,
          req.body.dueDate || null, subtotal, tax, total, req.body.notes || null, req.user.id]
      );
      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, message: "Supplier not found" });
      }
      await client.query(
        `INSERT INTO supplier_ledger_entries
          (company_id,supplier_id,store_id,entry_type,reference_type,reference_id,amount,debit,description,created_by)
         VALUES ($1,$2,$3,'INVOICE','SUPPLIER_INVOICE',$4,$5,true,$6,$7)`,
        [req.user.companyId, req.body.supplierId, req.body.storeId || req.user.storeId || null,
          result.rows[0].id, total, `Supplier invoice ${String(req.body.invoiceNumber).trim()}`, req.user.id]
      );
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Create supplier invoice error:", error);
      res.status(error.code === "23505" ? 409 : 400).json({ success: false, message: error.code === "23505" ? "Supplier invoice already exists" : error.message });
    } finally { client.release(); }
  });

  router.post("/supplier-payments", authenticate, authorize("payment.manage", ...manage), async (req, res) => {
    const amount = Number(req.body?.amount);
    if (!req.body?.supplierId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Supplier and positive payment amount are required" });
    }
    if (!pool) return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = req.body.idempotencyKey
        ? await client.query("SELECT id FROM supplier_payments WHERE company_id=$1 AND idempotency_key=$2", [req.user.companyId, String(req.body.idempotencyKey).slice(0, 100)])
        : { rows: [] };
      if (existing.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "Payment request has already been processed", data: { id: existing.rows[0].id, duplicate: true } });
      }
      const supplier = await client.query("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2 AND active=true", [req.body.supplierId, req.user.companyId]);
      if (!supplier.rows.length) throw new Error("Supplier not found");
      const payment = await client.query(
        `INSERT INTO supplier_payments
          (company_id,supplier_id,store_id,amount,payment_date,payment_method,reference,notes,idempotency_key,created_by)
         VALUES ($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.companyId, req.body.supplierId, req.body.storeId || req.user.storeId || null, amount,
          req.body.paymentDate || null, req.body.paymentMethod || null, req.body.reference || null,
          req.body.notes || null, req.body.idempotencyKey ? String(req.body.idempotencyKey).slice(0, 100) : null, req.user.id]
      );
      let remaining = amount;
      for (const allocation of Array.isArray(req.body.allocations) ? req.body.allocations : []) {
        const alloc = Number(allocation.amount);
        if (!Number.isFinite(alloc) || alloc <= 0 || alloc > remaining) throw new Error("Invalid payment allocation");
        const invoice = await client.query(
          `SELECT i.id, i.total, COALESCE(SUM(a.amount),0) AS paid
             FROM supplier_invoices i LEFT JOIN supplier_payment_allocations a ON a.invoice_id=i.id
            WHERE i.id=$1 AND i.company_id=$2 AND i.supplier_id=$3 GROUP BY i.id FOR UPDATE`,
          [allocation.invoiceId, req.user.companyId, req.body.supplierId]
        );
        if (!invoice.rows.length || alloc > Number(invoice.rows[0].total) - Number(invoice.rows[0].paid)) throw new Error("Payment allocation exceeds invoice balance");
        await client.query("INSERT INTO supplier_payment_allocations (payment_id,invoice_id,amount) VALUES ($1,$2,$3)", [payment.rows[0].id, allocation.invoiceId, alloc]);
        remaining = Math.round((remaining - alloc + Number.EPSILON) * 100) / 100;
        const balance = Number(invoice.rows[0].total) - Number(invoice.rows[0].paid) - alloc;
        await client.query("UPDATE supplier_invoices SET status=$1,updated_at=NOW() WHERE id=$2", [balance <= 0.005 ? "PAID" : "PARTIALLY_PAID", allocation.invoiceId]);
      }
      await client.query(
        `INSERT INTO supplier_ledger_entries
          (company_id,supplier_id,store_id,entry_type,reference_type,reference_id,amount,debit,description,created_by)
         VALUES ($1,$2,$3,'PAYMENT','SUPPLIER_PAYMENT',$4,$5,false,'Supplier payment',$6)`,
        [req.user.companyId, req.body.supplierId, req.body.storeId || req.user.storeId || null, payment.rows[0].id, amount, req.user.id]
      );
      await client.query("COMMIT");
      res.status(201).json({ success: true, data: payment.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Create supplier payment error:", error);
      res.status(error.message === "Supplier not found" ? 404 : error.code === "23505" ? 409 : 400).json({ success: false, message: error.message });
    } finally { client.release(); }
  });

  router.post("/supplier-ledger-entries", authenticate, authorize(...manage), createLedgerEntry.bind(null));
  router.post("/supplier-credits", authenticate, authorize(...manage), async (req, res) => {
    req.body = { ...req.body, entryType: "RETURN_CREDIT" };
    return createLedgerEntry(req, res);
  });
  router.post("/supplier-debits", authenticate, authorize(...manage), async (req, res) => {
    req.body = { ...req.body, entryType: "OPENING" };
    return createLedgerEntry(req, res);
  });
  router.post("/supplier-credit-notes", authenticate, authorize(...manage), async (req, res) => {
    req.body = { ...req.body, entryType: "RETURN_CREDIT" };
    return createLedgerEntry(req, res);
  });
  router.post("/suppliers/:id/credit-notes", authenticate, authorize(...manage), async (req, res) => {
    req.body = { ...req.body, supplierId: req.params.id, entryType: "RETURN_CREDIT" };
    return createLedgerEntry(req, res);
  });

  router.get("/supplier-ledger-entries", authenticate, authorize(...view), async (req, res) => {
    try {
      const page = parsePage(req.query.page, 1);
      const pageSize = parsePageSize(req.query.pageSize, 25, 200);
      const offset = (page - 1) * pageSize;
      const supplierId = req.query.supplierId || req.query.supplier_id || null;
      const storeId = req.query.storeId || req.query.store_id || null;
      const search = (req.query.search || req.query.q || "").trim();
      const entryType = normalizeEntryType(req.query.entryType ?? req.query.entry_type ?? req.query.type ?? null);
      const debitFilter = parseBoolean(req.query.debit ?? req.query.direction ?? req.query.credit);
      const filterData = parseJsonFilter(req.query.filter);
      const requestedType = normalizeEntryType(filterData.entryType ?? filterData.entry_type ?? filterData.type ?? null) ?? entryType;
      const requestedDebit = parseBoolean(filterData.debit ?? filterData.direction ?? null) ?? debitFilter;
      const requestedStore = filterData.storeId ?? filterData.store_id ?? storeId;
      const requestedSupplier = filterData.supplierId ?? filterData.supplier_id ?? supplierId;
      const startDate = req.query.startDate || req.query.from || filterData.startDate || filterData.from || null;
      const endDate = req.query.endDate || req.query.to || filterData.endDate || filterData.to || null;
      const referenceFilter = req.query.reference || filterData.reference || null;

      if (requestedSupplier) {
        await ensureSupplierInCompany(requestedSupplier, req.user.companyId);
      }
      if (requestedStore) {
        await ensureStoreInCompany(requestedStore, req.user.companyId);
      }

      const clauses = ["company_id = $1"];
      const params = [req.user.companyId];
      let idx = 2;

      if (requestedSupplier) {
        clauses.push(`supplier_id = $${idx}`);
        params.push(requestedSupplier);
        idx += 1;
      }
      if (requestedStore) {
        clauses.push(`store_id = $${idx}`);
        params.push(requestedStore);
        idx += 1;
      }
      if (requestedType) {
        clauses.push(`entry_type = $${idx}`);
        params.push(requestedType);
        idx += 1;
      }
      if (requestedDebit !== null) {
        clauses.push(`debit = $${idx}`);
        params.push(requestedDebit);
        idx += 1;
      }
      if (referenceFilter) {
        clauses.push(`reference = $${idx}`);
        params.push(String(referenceFilter).trim());
        idx += 1;
      }
      if (startDate) {
        clauses.push(`created_at >= $${idx}`);
        params.push(startDate);
        idx += 1;
      }
      if (endDate) {
        clauses.push(`created_at < $${idx}`);
        params.push(endDate);
        idx += 1;
      }
      if (search) {
        clauses.push(`(LOWER(COALESCE(reference, '')) LIKE LOWER($${idx}) OR LOWER(COALESCE(description, '')) LIKE LOWER($${idx}) OR LOWER(COALESCE(entry_type, '')) LIKE LOWER($${idx}))`);
        const pattern = `%${String(search).trim()}%`;
        params.push(pattern, pattern, pattern);
        idx += 3;
      }

      const countQuery = `SELECT COUNT(*)::int AS total FROM supplier_ledger_entries WHERE ${clauses.join(" AND ")}`;
      const listQuery = `SELECT id, company_id, supplier_id, store_id, entry_type, reference_type, reference_id, reference, amount, debit, description, created_by, created_at
        FROM supplier_ledger_entries
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT $${idx} OFFSET $${idx + 1}`;
      params.push(pageSize, offset);
      const [countResult, rowsResult] = await Promise.all([
        db(countQuery, params.slice(0, params.length - 2)),
        db(listQuery, params),
      ]);
      const total = Number(countResult.rows[0]?.total || 0);
      const data = rowsResult.rows.map(normalizeLedgerRow);
      const pages = total === 0 ? 0 : Math.max(1, Math.ceil(total / pageSize));
      res.json({ success: true, data, records: data, page, pageSize, total, pages });
    } catch (error) {
      console.error("List supplier ledger entries error:", error);
      if (error.status === 404) return res.status(404).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: "Unable to load supplier ledger entries" });
    }
  });

  router.get("/suppliers/:id/ledger", authenticate, authorize(...view), getSupplierLedgerEntriesHandler);

  router.get("/suppliers/:id/summary", authenticate, authorize(...view), getSupplierSummaryHandler);

  router.get("/suppliers/:id/account-summary", authenticate, authorize(...view), getSupplierSummaryHandler);

  router.get("/suppliers/:id/statement", authenticate, authorize(...view), async (req, res) => {
    try {
      const storeId = req.query.storeId || req.query.store_id || null;
      if (storeId) await ensureStoreInCompany(storeId, req.user.companyId);
      const clauses = ["company_id=$1", "supplier_id=$2"];
      const params = [req.user.companyId, req.params.id];
      if (storeId) {
        clauses.push("store_id=$3");
        params.push(storeId);
      }
      const result = await db(
        `SELECT id, entry_type, reference_type, reference_id, amount, debit, description, reference, created_at,
          SUM(CASE WHEN debit THEN amount ELSE -amount END) OVER (ORDER BY created_at,id) AS running_balance
         FROM supplier_ledger_entries
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at,id`,
        params
      );
      res.json({ success: true, data: result.rows.map((row) => normalizeLedgerRow({ ...row, running_balance: row.running_balance })) });
    } catch (error) {
      console.error("Supplier statement error:", error);
      if (error.status === 404) return res.status(404).json({ success: false, message: error.message });
      res.status(500).json({ success: false, message: "Unable to load supplier statement" });
    }
  });

  return router;
}
