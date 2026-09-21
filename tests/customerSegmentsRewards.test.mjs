/*
 * Customer Segmentation, Bulk Customer Data, Points/Rewards & Gift Cards —
 * focused regression suite.
 *
 *   node --test tests/customerSegmentsRewards.test.mjs
 *
 * Backend: the REAL routes/customers.js (segments, bulk import/export,
 * loyalty adjustment, gift-card CRUD), the REAL routes/sales.js
 * (gift-card tender + idempotent loyalty earning) and the REAL
 * services/giftCards.js — all over HTTP against stateful fakes that model
 * the new tables' constraints (unique segment membership, unique card code,
 * one earn per sale, one redeem per sale+card, status checks).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";
const CUST_A = "d0000000-0000-4000-8000-000000000001";
const CUST_A2 = "d0000000-0000-4000-8000-000000000002";
const CUST_B = "d0000000-0000-4000-8000-000000000003";

/* ------------------------------------------------------------ giftCards unit */

const giftCards = await import("../services/giftCards.js");

describe("services/giftCards.js — balance derivation and rules", () => {
  const mod = giftCards;

  test("deriveGiftCardBalance signs ledger rows correctly", () => {
    const balance = mod.deriveGiftCardBalance([
      { transaction_type: "issue", amount: "50.00" },
      { transaction_type: "topup", amount: "10.00" },
      { transaction_type: "redeem", amount: "12.50" },
      { transaction_type: "refund", amount: "2.50" },
      { transaction_type: "adjustment", amount: "-5.00" },
    ]);
    assert.equal(balance, 45);
  });

  test("redeemable rules: blocked/expired/depleted/expiry-date rejected", () => {
    const now = new Date("2026-09-20T12:00:00Z");
    assert.equal(mod.isCardRedeemable({ status: "blocked" }, now).ok, false);
    assert.equal(mod.isCardRedeemable({ status: "expired" }, now).ok, false);
    assert.equal(mod.isCardRedeemable({ status: "depleted" }, now).ok, false);
    assert.equal(mod.isCardRedeemable({ status: "active", expires_at: "2026-01-01" }, now).ok, false);
    assert.equal(mod.isCardRedeemable({ status: "active", expires_at: "2027-01-01" }, now).ok, true);
    assert.equal(mod.isCardRedeemable({ status: "active" }, now).ok, true);
  });

  test("redemption cannot exceed balance", () => {
    assert.equal(mod.validateRedemption(10, 10.01).ok, false);
    assert.equal(mod.validateRedemption(10, 10).ok, true);
    assert.equal(mod.validateRedemption(10, 0).ok, false);
    assert.equal(mod.validateRedemption(10, -3).ok, false);
  });

  test("negative adjustment cannot push the balance below zero", () => {
    assert.equal(mod.validateAdjustment(5, -5).ok, true);
    assert.equal(mod.validateAdjustment(5, -5.01).ok, false);
    assert.equal(mod.validateAdjustment(5, 0).ok, false);
  });

  test("generated codes are unique-ish, normalised and dash-grouped", () => {
    const a = mod.generateGiftCardCode();
    const b = mod.generateGiftCardCode();
    assert.match(a, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{5}$/);
    assert.notEqual(a, b);
    assert.equal(mod.normaliseGiftCardCode(" abcd-1234-wxyz "), "ABCD1234WXYZ");
  });
});

/* ------------------------------------------------------------ harness */

function makeCtx({ companyAdmin = true } = {}) {
  const state = {
    segments: [], // { id, company_id, name, description, active, member_count }
    memberships: [], // { segment_id, customer_id, company_id }
    customers: new Map([
      [CUST_A, { id: CUST_A, company_id: COMPANY_A, name: "Amy Wong", active: true, phone: "07700900123", email: "amy@example.com", credit_enabled: false, credit_limit: null }],
      [CUST_A2, { id: CUST_A2, company_id: COMPANY_A, name: "Ben critical", active: true, phone: "07700900456", email: "ben@example.com", credit_enabled: true, credit_limit: 100 }],
      [CUST_B, { id: CUST_B, company_id: COMPANY_B, name: "Other Co Customer", active: true, phone: "07700900777", email: "other@example.com", credit_enabled: false, credit_limit: null }],
    ]),
    giftCards: [], // { id, company_id, code, status, initial_value, expires_at, ... }
    giftCardTx: [], // { gift_card_id, transaction_type, amount, balance_after, reference_type, reference_id }
    loyaltyBalances: new Map(), // customer_id -> balance
    loyaltyTx: [], // { company_id, customer_id, transaction_type, amount, reference_type, reference_id }
    loyaltySettings: { loyalty_enabled: true, loyalty_earning_rate: 0.01, loyalty_min_sale_total: null, loyalty_redeem_value_per_point: null },
    sales: [],
    payments: [],
    imported: [],
    seq: 0,
  };
  const nextId = () => `id-${(state.seq += 1)}`;
  const cardBalance = (cardId) =>
    Math.round(state.giftCardTx.filter((t) => t.gift_card_id === cardId)
      .reduce((sum, t) => sum + (t.transaction_type === "redeem" ? -Number(t.amount) : Number(t.amount)), 0) * 100) / 100;

  /* ONE unified SQL matcher: the real routes call some queries through `db`
     and some through the transaction `client`, and both must see the same
     state — sharing the matcher is also the honest way to model that. */
  const matchSql = async (s0, params) => {
    const s = String(s0).replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();

    /* ---------- shared: till session (sales engine) ---------- */
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    if (/FROM products\s*WHERE id = \$1 AND company_id = \$2 AND active = true\s*FOR UPDATE/.test(s)) {
      return { rows: [{ id: params[0], name: "Test product", price: 5, stock_quantity: 100, track_stock: true, age_restricted: false }] };
    }
    if (/SELECT id, name, price, vat_rate, track_stock FROM products WHERE id = \$1 AND company_id = \$2 AND active = true$/.test(s)) {
      return { rows: [{ id: params[0], name: "Test product", price: 5, vat_rate: null, track_stock: true }] };
    }

    /* ---------- segments ---------- */
    if (/SELECT s\.id, s\.company_id, s\.name/.test(s)) {
      const rows = state.segments.filter((seg) => seg.company_id === params[0])
        .map((seg) => ({ ...seg, member_count: state.memberships.filter((m) => m.segment_id === seg.id).length }));
      return { rows };
    }
    if (/INSERT INTO customer_segments/.test(s)) {
      if (state.segments.some((seg) => seg.company_id === params[0] && seg.name === params[1])) {
        const err = new Error("duplicate key"); err.code = "23505"; throw err;
      }
      const seg = { id: nextId(), company_id: params[0], name: params[1], description: params[2] ?? null, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      state.segments.push(seg);
      return { rows: [seg] };
    }
    if (/UPDATE customer_segments SET/.test(s)) {
      const seg = state.segments.find((seg) => seg.id === params[3] && seg.company_id === params[4]);
      if (!seg) return { rows: [] };
      if (params[0] !== null && state.segments.some((other) => other.company_id === params[4] && other.id !== seg.id && other.name === params[0])) {
        const err = new Error("duplicate key"); err.code = "23505"; throw err;
      }
      if (params[0] !== null) seg.name = params[0];
      if (params[1] !== null && params[1] !== undefined) seg.description = params[1];
      if (params[2] !== null && params[2] !== undefined) seg.active = params[2];
      seg.updated_at = new Date().toISOString();
      return { rows: [{ ...seg }] };
    }
    if (/SELECT id, (name|active)(, active)? FROM customer_segments WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const seg = state.segments.find((seg) => seg.id === params[0] && seg.company_id === params[1]);
      return { rows: seg ? [{ id: seg.id, name: seg.name, active: seg.active }] : [] };
    }
    if (/FROM customer_segment_members m/.test(s) && /INNER JOIN customers/.test(s)) {
      const rows = state.memberships
        .filter((m) => m.segment_id === params[0] && m.company_id === params[1])
        .map((m) => {
          const c = state.customers.get(m.customer_id);
          return { id: c.id, name: c.name, phone: c.phone, email: c.email, active: c.active, member_since: m.created_at };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return { rows };
    }
    if (/INSERT INTO customer_segment_members/.test(s)) {
      const wanted = params[2];
      const inserted = [];
      for (const cid of wanted) {
        const customer = state.customers.get(cid);
        // The SELECT … FROM customers c WHERE c.company_id = $1 guard: only
        // customers of THIS company can be assigned.
        if (!customer || customer.company_id !== params[0]) continue;
        if (state.memberships.some((m) => m.segment_id === params[1] && m.customer_id === cid)) continue;
        const membership = { segment_id: params[1], customer_id: cid, company_id: params[0], created_at: new Date().toISOString() };
        state.memberships.push(membership);
        inserted.push({ customer_id: cid });
      }
      return { rows: inserted };
    }
    if (/DELETE FROM customer_segment_members/.test(s)) {
      const before = state.memberships.length;
      state.memberships = state.memberships.filter((m) => !(m.segment_id === params[0] && m.customer_id === params[1] && m.company_id === params[2]));
      return { rowCount: before - state.memberships.length };
    }

    /* ---------- bulk import ---------- */
    if (/SELECT id, name, phone, email, credit_enabled, credit_limit FROM customers WHERE company_id = \$1 AND active = true/.test(s)) {
      return { rows: [...state.customers.values()].filter((c) => c.company_id === params[0] && c.active) };
    }
    if (/SELECT id FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ id: c.id }] : [] };
    }
    if (/INSERT INTO customers \(company_id, name, phone, email, address, postcode, notes, credit_enabled, credit_limit\)/.test(s)) {
      const customer = {
        id: nextId(), company_id: params[0], name: params[1], phone: params[2], email: params[3],
        address: params[4], postcode: params[5], notes: params[6],
        credit_enabled: params[7], credit_limit: params[8], active: true,
      };
      state.customers.set(customer.id, customer);
      state.imported.push(customer.id);
      return { rows: [{ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }] };
    }
    if (/UPDATE customers SET\s*name = COALESCE/.test(s)) {
      const customer = state.customers.get(params[8]);
      if (!customer || customer.company_id !== params[9]) return { rows: [] };
      const set = (v, key) => { if (v !== null && v !== undefined) customer[key] = v; };
      set(params[0], "name"); set(params[1], "phone"); set(params[2], "email"); set(params[3], "address"); set(params[4], "postcode"); set(params[5], "notes"); set(params[6], "credit_enabled"); set(params[7], "credit_limit");
      return { rows: [{ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }] };
    }
    if (/SELECT c\.name, c\.phone, c\.email, c\.address, c\.postcode, c\.notes,/.test(s)) {
      const rows = [...state.customers.values()].filter((c) => c.company_id === params[0]).map((c) => ({ ...c, loyalty_balance: 0 }));
      return { rows };
    }

    /* ---------- loyalty adjust ---------- */
    if (/SELECT id, name, company_id, credit_enabled, credit_limit, maximum_credit_age_days FROM customers/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ id: c.id, name: c.name, company_id: c.company_id, credit_enabled: c.credit_enabled, credit_limit: c.credit_limit, maximum_credit_age_days: null }] : [] };
    }
    if (/SELECT COALESCE\(balance, 0\) AS balance FROM customer_loyalty_balances/.test(s)) {
      return { rows: [{ balance: state.loyaltyBalances.get(params[1]) ?? 0 }] };
    }
    if (/INSERT INTO customer_loyalty_balances \(company_id, customer_id, balance\)/.test(s) && /DO UPDATE SET balance = \$3/.test(s)) {
      state.loyaltyBalances.set(params[1], Number(params[2]));
      return { rows: [] };
    }
    if (/INSERT INTO customer_loyalty_transactions\s*\(?company_id, customer_id, transaction_type, amount, balance_after, reference_type, description, created_by/.test(s)) {
      // 'ADJUST' is inlined in VALUES; reference_type is $5 ('adjustment').
      const type = /'ADJUST'/.test(s) ? "ADJUST" : "EARN";
      state.loyaltyTx.push({ company_id: params[0], customer_id: params[1], transaction_type: type, amount: params[2], reference_type: params[4], reference_id: null });
      return { rows: [] };
    }
    if (/INSERT INTO customer_loyalty_adjustments/.test(s)) return { rows: [] };

    /* ---------- gift cards (admin routes over db) ---------- */
    if (/SELECT g\.id, g\.code, g\.reference_number, g\.customer_id, c\.name AS customer_name,/.test(s) && /FROM gift_cards g/.test(s) && /WHERE g\.id = \$1/.test(s)) {
      const card = state.giftCards.find((card) => card.id === params[0] && card.company_id === params[1]);
      if (!card) return { rows: [] };
      return { rows: [{ ...card, customer_name: null, balance: cardBalance(card.id) }] };
    }
    if (/SELECT g\.id, g\.code, g\.reference_number, g\.customer_id, c\.name AS customer_name,/.test(s) && /FROM gift_cards g/.test(s)) {
      const rows = state.giftCards.filter((card) => card.company_id === params[0])
        .map((card) => ({ ...card, customer_name: card.customer_id ? state.customers.get(card.customer_id)?.name : null, balance: cardBalance(card.id) }));
      return { rows };
    }
    if (/INSERT INTO gift_cards \(company_id, code, reference_number/.test(s)) {
      if (state.giftCards.some((card) => card.company_id === params[0] && card.code === params[1])) {
        const err = new Error("duplicate key"); err.code = "23505"; throw err;
      }
      const card = { id: nextId(), company_id: params[0], code: params[1], reference_number: params[2], customer_id: params[3], status: "active", initial_value: params[4], expires_at: params[6] ?? null, issued_at: new Date().toISOString() };
      state.giftCards.push(card);
      return { rows: [{ id: card.id, code: card.code }] };
    }
    /* Admin gift-card movements: the type is INLINED in VALUES ('issue' /
       'topup' / 'adjustment' / 'refund'), amount is always $3 and the
       balance_after is computed in-SQL from the ledger. */
    if (/INSERT INTO gift_card_transactions \(company_id, gift_card_id, transaction_type, amount, balance_after, reference_type, description, store_id, created_by\)/.test(s)) {
      const type = /'issue'/.test(s) ? "issue" : /'topup'/.test(s) ? "topup" : /'refund'/.test(s) ? "refund" : "adjustment";
      const amount = Number(params[2]);
      const balanceBefore = cardBalance(params[1]);
      const balanceAfter = Math.round((balanceBefore + (type === "redeem" ? -amount : amount)) * 100) / 100;
      state.giftCardTx.push({ company_id: params[0], gift_card_id: params[1], transaction_type: type, amount, balance_after: balanceAfter, reference_type: type, reference_id: null });
      return { rows: [{ balance_after: balanceAfter }] };
    }
    if (/FROM gift_card_transactions\s*WHERE gift_card_id = \$1 AND company_id = \$2\s*ORDER BY created_at ASC/.test(s)) {
      return { rows: state.giftCardTx.filter((t) => t.gift_card_id === params[0]) };
    }
    if (/SELECT id, code, status, expires_at FROM gift_cards WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const card = state.giftCards.find((card) => card.id === params[0] && card.company_id === params[1]);
      return { rows: card ? [{ id: card.id, code: card.code, status: card.status, expires_at: card.expires_at }] : [] };
    }
    if (/UPDATE gift_cards SET status = CASE WHEN \$1/.test(s)) {
      const card = state.giftCards.find((card) => card.id === params[1] && card.company_id === params[2]);
      if (!card) return { rows: [] };
      card.status = params[0] ? "blocked" : "active";
      return { rows: [{ id: card.id, code: card.code, status: card.status }] };
    }
    if (/SELECT g\.id, g\.code, g\.status,/.test(s) && /FROM gift_cards g WHERE g\.id = \$1/.test(s)) {
      const card = state.giftCards.find((card) => card.id === params[0] && card.company_id === params[1]);
      if (!card) return { rows: [] };
      return { rows: [{ id: card.id, code: card.code, status: card.status, balance: cardBalance(card.id) }] };
    }
    if (/SELECT \* FROM gift_cards WHERE company_id = \$2 AND UPPER\(REPLACE/.test(s)) {
      const card = state.giftCards.find((card) => card.company_id === params[1] && card.code.replace(/[-\s]/g, "") === params[0]);
      return { rows: card ? [card] : [] };
    }

    /* ---------- sales-engine shared queries (fire-and-forget earn) ---------- */
    if (/SELECT loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total FROM company_settings/.test(s)) {
      return { rows: [{ ...state.loyaltySettings }] };
    }
    if (/INSERT INTO customer_loyalty_balances \(company_id, customer_id, balance\)/.test(s) && /DO UPDATE SET balance = customer_loyalty_balances\.balance \+ EXCLUDED\.balance/.test(s)) {
      const current = state.loyaltyBalances.get(params[1]) ?? 0;
      const updated = current + Number(params[2]);
      state.loyaltyBalances.set(params[1], updated);
      return { rows: [{ balance: updated }] };
    }
    if (/UPDATE customer_loyalty_balances SET balance = balance - \$3/.test(s)) {
      const current = state.loyaltyBalances.get(params[1]) ?? 0;
      state.loyaltyBalances.set(params[1], current - Number(params[2]));
      return { rowCount: 1 };
    }
    if (/INSERT INTO customer_loyalty_transactions\s*\(company_id, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by\)/.test(s)) {
      const duplicate = state.loyaltyTx.some((t) => t.company_id === params[0] && t.transaction_type === "EARN" && t.reference_id === params[4]);
      if (duplicate) { const err = new Error("duplicate key"); err.code = "23505"; throw err; }
      state.loyaltyTx.push({ company_id: params[0], customer_id: params[1], transaction_type: "EARN", amount: params[2], reference_type: "sale", reference_id: params[4] });
      return { rows: [] };
    }

    /* T10R: the fire-and-forget earn re-reads the sale's current status
       so cancelled/void sales never award. */
    if (/SELECT status FROM sales WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const sale = state.sales.find((s) => s.id === params[0] && s.company_id === params[1]);
      return { rows: sale ? [{ status: sale.status }] : [] };
    }

    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => matchSql(sql, params);

  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };
      /* Engine-tx queries share the unified matcher. */
      const shared = await matchSql(sql, params);
      if (shared.rows.length || shared.rowCount) return shared;
      if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
        const existing = state.sales.find((sale) => sale.company_id === params[0] && sale.client_request_id === params[1]);
        if (existing) return { rows: [{ id: existing.id, created_at: existing.created_at, total: existing.total, receipt_number: existing.receipt_number }] };
        return { rows: [] };
      }
      if (/FROM till_sessions/.test(s)) return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
      if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) return { rows: [{ next_number: state.sales.length + 1 }] };
      if (/to_char\(timezone/.test(s)) return { rows: [{ date_key: "20260920" }] };
      if (/SELECT credit_enabled, credit_limit, maximum_credit_age_days FROM customers/.test(s)) {
        const c = state.customers.get(params[0]);
        return { rows: c && c.company_id === params[1] ? [{ credit_enabled: c.credit_enabled, credit_limit: c.credit_limit, maximum_credit_age_days: null }] : [] };
      }
      if (/SELECT COALESCE\(SUM\(amount \* CASE WHEN transaction_type/.test(s)) return { rows: [{ outstanding: 0 }] };
      if (/SELECT id,\s*name,\s*price,\s*vat_rate,\s*track_stock\s*FROM products/.test(s)) {
        return { rows: [{ id: params[0], name: "Test product", price: 5, vat_rate: null, track_stock: true }] };
      }
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0], store_id: params[1], customer_id: params[3], client_request_id: params[10] ?? null,
          receipt_number: `T01-20260920-${String(state.sales.length + 1).padStart(4, "0")}`,
          total: Number(params[9]) || 0, status: "completed", offline_created: false, sync_status: "synced",
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
      }
      /* T10R: the fire-and-forget earn re-reads the sale's current status
         so cancelled/void sales never award. */
      if (/SELECT status FROM sales WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const sale = state.sales.find((s) => s.id === params[0] && s.company_id === params[1]);
        return { rows: sale ? [{ status: sale.status }] : [] };
      }
      if (/INSERT INTO payments/.test(s)) {
        state.payments.push({ sale_id: params[0], payment_method: params[1], amount: params[2], status: "completed", provider_transaction_id: null });
        return { rowCount: 1 };
      }
      if (/INSERT INTO sale_items/.test(s)) return { rowCount: 1 };
      if (/INSERT INTO inventory_movements/.test(s)) return { rowCount: 1 };
      /* ---------- gift-card tender (sale engine, inside the tx) ---------- */
      if (/SELECT \* FROM gift_cards WHERE company_id = \$1 AND UPPER\(REPLACE/.test(s)) {
        const card = state.giftCards.find((card) => card.company_id === params[0] && card.code.replace(/[-\s]/g, "") === params[1]);
        return { rows: card ? [{ ...card }] : [] };
      }
      if (/SELECT COALESCE\(SUM\(CASE transaction_type WHEN 'redeem' THEN -amount ELSE amount END\), 0\) AS balance/.test(s)) {
        return { rows: [{ balance: cardBalance(params[0]) }] };
      }
      if (/INSERT INTO gift_card_transactions\s*\(company_id, gift_card_id, transaction_type, amount, balance_after, reference_type, reference_id/.test(s)) {
        // params: company, card, redeemAmount, balanceBefore, saleId, …
        const duplicate = state.giftCardTx.some((t) => t.gift_card_id === params[1] && t.transaction_type === "redeem" && t.reference_id === params[4]);
        if (duplicate) return { rows: [] }; // ON CONFLICT DO NOTHING
        const balanceAfter = Number(params[3]) - Number(params[2]);
        state.giftCardTx.push({ company_id: params[0], gift_card_id: params[1], transaction_type: "redeem", amount: Number(params[2]), balance_after: balanceAfter, reference_type: "sale", reference_id: params[4] });
        return { rows: [{ balance_after: balanceAfter }] };
      }
      if (/SELECT balance_after FROM gift_card_transactions WHERE gift_card_id = \$1 AND transaction_type = 'redeem' AND reference_id = \$2 LIMIT 1/.test(s)) {
        const t = state.giftCardTx.find((t) => t.gift_card_id === params[0] && t.transaction_type === "redeem" && t.reference_id === params[1]);
        return { rows: t ? [{ balance_after: t.balance_after }] : [] };
      }
      if (/UPDATE payments SET provider_transaction_id/.test(s)) {
        const payment = state.payments.find((p) => p.sale_id === params[1] && p.payment_method === params[2]);
        if (payment) payment.provider_transaction_id = params[0];
        return { rowCount: payment ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  return { state, db, pool: { async connect() { return { ...client, release() {} }; } } };
}

async function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE, companyAdmin = true, permissions = null } = {}) {
  const mod = await import("../routes/customers.js");
  const perms = permissions || (companyAdmin ? ["customer.view", "customer.edit"] : []);
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId, role: companyAdmin ? "admin" : "cashier" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    canViewCompanyCustomers: async (user) => user.role === "admin",
    associateCustomerWithStore: async () => ({}),
    _perms: perms,
  }));
  return app;
}

async function buildSalesApp(ctx) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY_A, storeId: STORE };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    associateCustomerWithStore: async () => ({}),
    selfCheckoutMode: () => false,
    /* The loyalty earn block is guarded by writeAudit being provided
       (fire-and-forget policy); the real server always passes it. */
    writeAudit: async () => ({}),
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const get = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const put = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const del = async (port, path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "DELETE" });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const saleBody = (overrides = {}) => ({
  items: [{ productId: "p-1", quantity: 1, unitPrice: 5, tax: 0, discount: 0, total: 5 }],
  customerId: null,
  subtotal: 5, tax: 0, discount: 0, total: 5,
  paymentMethod: "cash",
  ...overrides,
});

/* ----------------------------------------------------------------- tests */

describe("PART A — customer segments", () => {
  test("create, edit and deactivate a segment", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, "/api/customer-segments", { name: "Wholesale", description: "Trade customers" });
      assert.equal(created.status, 201);
      const id = created.body.data.id;

      const renamed = await put(port, `/api/customer-segments/${id}`, { name: "Trade", description: "Updated" });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.data.name, "Trade");

      const deactivated = await put(port, `/api/customer-segments/${id}`, { active: false });
      assert.equal(deactivated.body.data.active, false);
      // Customers unaffected by deactivation: the customer table is untouched.
      assert.equal(ctx.state.customers.get(CUST_A).active, true);
    } finally { server.close(); }
  });

  test("duplicate segment name per company is rejected", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/customer-segments", { name: "VIP" });
      const again = await post(port, "/api/customer-segments", { name: "VIP" });
      assert.equal(again.status, 409);
    } finally { server.close(); }
  });

  test("assign + remove customer; duplicate membership prevented; company isolation enforced", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const seg = await post(port, "/api/customer-segments", { name: "Local" });
      const segId = seg.body.data.id;

      const first = await post(port, `/api/customer-segments/${segId}/members`, { customerId: CUST_A });
      assert.equal(first.status, 200);
      assert.equal(first.body.assigned, 1);

      // Duplicate assignment is idempotent (assigned 0, membership count stays 1)
      const dup = await post(port, `/api/customer-segments/${segId}/members`, { customerId: CUST_A });
      assert.equal(dup.body.assigned, 0);

      // Company B's customer cannot be assigned
      const foreign = await post(port, `/api/customer-segments/${segId}/members`, { customerId: CUST_B });
      assert.equal(foreign.body.assigned, 0);

      let members = await get(port, `/api/customer-segments/${segId}/members`);
      assert.equal(members.body.data.members.length, 1);
      assert.equal(members.body.data.members[0].id, CUST_A);

      const removed = await del(port, `/api/customer-segments/${segId}/members/${CUST_A}`);
      assert.equal(removed.status, 200);
      members = await get(port, `/api/customer-segments/${segId}/members`);
      assert.equal(members.body.data.members.length, 0);
    } finally { server.close(); }
  });

  test("segments are company-scoped: Company B never sees Company A segments", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx, { companyId: COMPANY_A });
    const appB = await buildApp(ctx, { companyId: COMPANY_B });
    const a = await listen(appA);
    const b = await listen(appB);
    try {
      await post(a.port, "/api/customer-segments", { name: "Company A Only" });
      const listB = await get(b.port, "/api/customer-segments");
      assert.equal(listB.body.data.length, 0);
    } finally { a.server.close(); b.server.close(); }
  });
});

describe("PART B — bulk customer data", () => {
  test("preview validates rows and plans create/update against existing customers", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const csv = [
        "name,phone,email,creditEnabled,creditLimit",
        "New Person,07700111222,new@example.com,false,",
        "Amy Updated,07700900123,,false,",
        "Bad Row,12,not-an-email,false,",
      ].join("\n");
      const res = await post(port, "/api/customers/import/preview", { csv });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.total, 3);
      assert.equal(res.body.data.creates, 1);
      assert.equal(res.body.data.updates, 1);
      assert.equal(res.body.data.invalid, 1);
      const badRow = res.body.data.rows.find((r) => r.name === "Bad Row");
      assert.equal(badRow.valid, false);
      assert.ok(badRow.errors.some((e) => /email/i.test(e)));
      const updateRow = res.body.data.rows.find((r) => r.name === "Amy Updated");
      assert.equal(updateRow.action, "update");
      assert.equal(updateRow.matchCustomer.id, CUST_A);
    } finally { server.close(); }
  });

  test("invalid rows are never imported (execute rejects plans containing them)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const plan = {
        mode: "upsert",
        rows: [
          { row: 2, name: "Valid Person", phone: "07700999999", email: null, identifiers: ["07700999999"], action: "create", matchCustomer: null, valid: true, errors: [], creditEnabled: false, creditLimit: null, address: null, postcode: null, notes: null },
          { row: 3, name: "", phone: null, email: null, identifiers: [], action: "create", matchCustomer: null, valid: false, errors: ["Name is required"], creditEnabled: false, creditLimit: null, address: null, postcode: null, notes: null },
        ],
      };
      const res = await post(port, "/api/customers/import", plan);
      assert.equal(res.status, 422);
      assert.equal(ctx.state.imported.length, 0, "nothing imported when the plan contains invalid rows");
    } finally { server.close(); }
  });

  test("valid import creates the customer and updates the matched one (company-scoped)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const plan = {
        mode: "upsert",
        rows: [
          { row: 2, name: "Imported New", phone: "07700888777", email: "imported@example.com", identifiers: ["07700888777"], action: "create", matchCustomer: null, valid: true, errors: [], creditEnabled: true, creditLimit: 150, address: null, postcode: null, notes: null },
          { row: 3, name: "Amy Via Import", phone: null, email: null, identifiers: ["07700900123"], action: "update", matchCustomer: { id: CUST_A, name: "Amy Wong" }, valid: true, errors: [], creditEnabled: null, creditLimit: null, address: null, postcode: null, notes: null },
        ],
      };
      const res = await post(port, "/api/customers/import", plan);
      assert.equal(res.status, 200);
      assert.equal(res.body.data.created, 1);
      assert.equal(res.body.data.updated, 1);
      assert.equal(ctx.state.customers.get(CUST_A).name, "Amy Via Import");
      const created = [...ctx.state.customers.values()].find((c) => c.name === "Imported New");
      assert.equal(created.credit_enabled, true);
      assert.equal(created.credit_limit, 150);
    } finally { server.close(); }
  });

  test("import never updates or creates customers in another company", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, { companyId: COMPANY_B });
    const { server, port } = await listen(app);
    try {
      // Row claims to match Company A's Amy — but the caller is Company B,
      // so the execute endpoint must refuse.
      const plan = {
        mode: "update",
        rows: [
          { row: 2, name: "Hijacked?", phone: null, email: null, identifiers: [], action: "update", matchCustomer: { id: CUST_A, name: "Amy Wong" }, valid: true, errors: [], creditEnabled: null, creditLimit: null, address: null, postcode: null, notes: null },
        ],
      };
      const res = await post(port, "/api/customers/import", plan);
      assert.equal(res.status, 400);
      assert.equal(ctx.state.customers.get(CUST_A).name, "Amy Wong", "Company A customer untouched");
    } finally { server.close(); }
  });

  test("CSV export returns company customers only, as CSV", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/customers/export`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(res.headers.get("content-type"), /text\/csv/);
      assert.match(text, /Amy Wong/);
      assert.ok(!text.includes("Other Co Customer"), "Company B customers are never exported to Company A");
    } finally { server.close(); }
  });
});

describe("PART C — points/rewards", () => {
  test("manual adjustment updates the balance and writes a ledger ADJUST row", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const res = await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: 50, reason: "Goodwill" });
      assert.equal(res.status, 200);
      assert.equal(res.body.data.balance, 50);
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 50);
      const tx = ctx.state.loyaltyTx.find((t) => t.customer_id === CUST_A && t.transaction_type === "ADJUST");
      assert.ok(tx, "ledger keeps the audit trail");

      const negative = await post(port, `/api/customers/${CUST_A}/loyalty/adjust`, { points: -60, reason: "oops" });
      assert.equal(negative.status, 400, "cannot go below zero");
    } finally { server.close(); }
  });

  test("sale earns points per the configured rate; disabled programme earns nothing; minimum sale respected", async () => {
    const ctx = makeCtx();
    ctx.state.loyaltySettings = { loyalty_enabled: true, loyalty_earning_rate: 0.1, loyalty_min_sale_total: 4, loyalty_redeem_value_per_point: null };
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      // £5 sale ≥ £4 minimum → 0.5 points at 10%
      const ok = await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 5, subtotal: 5 }));
      assert.equal(ok.status, 201);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);

      // £3 sale < £4 minimum → no earn
      await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 3, subtotal: 3 }));
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);

      // Disabled programme → no earn
      ctx.state.loyaltySettings.loyalty_enabled = false;
      await post(port, "/api/sales", saleBody({ customerId: CUST_A, total: 10, subtotal: 10 }));
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.5);
    } finally { server.close(); }
  });

  test("a retried sale never awards points twice (idempotent earn)", async () => {
    const ctx = makeCtx();
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const body = saleBody({ customerId: CUST_A, clientRequestId: "9e000000-0000-4000-8000-00000000000a" });
      const first = await post(port, "/api/sales", body);
      assert.equal(first.status, 201);
      await new Promise((r) => setTimeout(r, 30));

      // Simulate the duplicate-earn race: the ledger already holds an EARN
      // for this sale; a second fire-and-forget must be dropped by the
      // unique index and the balance must stay ledger-true.
      const earnCount = () => ctx.state.loyaltyTx.filter((t) => t.transaction_type === "EARN").length;
      assert.equal(earnCount(), 1);
      // The engine's earn block upserts then inserts; force a second pass
      // through the same sale body (idempotent POST returns early, so the
      // balance must remain exactly one earn's worth).
      const retry = await post(port, "/api/sales", body);
      assert.equal(retry.status, 201);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(earnCount(), 1, "no second EARN row for the same sale");
      assert.equal(ctx.state.loyaltyBalances.get(CUST_A), 0.05);
    } finally { server.close(); }
  });
});

describe("PART D — gift cards", () => {
  test("issue with unique code, top-up, ledger records everything", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const issued = await post(port, "/api/gift-cards", { value: 25, code: "GIFT-AAAA-BBBBB" });
      assert.equal(issued.status, 201);
      const cardId = issued.body.data.id;
      assert.equal(issued.body.data.balance, 25);

      const dup = await post(port, "/api/gift-cards", { value: 10, code: "GIFT-AAAA-BBBBB" });
      assert.equal(dup.status, 409, "unique code enforced per company");

      const topup = await post(port, `/api/gift-cards/${cardId}/topup`, { amount: 5 });
      assert.equal(topup.status, 200);
      assert.equal(topup.body.data.balance, 30);

      const detail = await get(port, `/api/gift-cards/${cardId}`);
      assert.equal(detail.body.data.balance, 30);
      const types = detail.body.data.transactions.map((t) => t.transaction_type);
      assert.deepEqual(types, ["issue", "topup"], "immutable ledger holds every movement");
    } finally { server.close(); }
  });

  test("company isolation: Company B cannot look up, redeem or modify Company A cards", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx, { companyId: COMPANY_A });
    const appB = await buildApp(ctx, { companyId: COMPANY_B });
    const a = await listen(appA);
    const b = await listen(appB);
    try {
      const issued = await post(a.port, "/api/gift-cards", { value: 40, code: "AAAABBBBCCCC" });
      const cardId = issued.body.data.id;

      const lookup = await post(b.port, "/api/gift-cards/lookup", { code: "AAAABBBBCCCC" });
      assert.equal(lookup.status, 404, "lookup is company-scoped");

      const block = await post(b.port, `/api/gift-cards/${cardId}/block`, { blocked: true });
      assert.equal(block.status, 404);

      const list = await get(b.port, "/api/gift-cards");
      assert.equal(list.body.data.length, 0);
    } finally { a.server.close(); b.server.close(); }
  });

  test("blocked cards cannot be topped up or redeemed", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const sales = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    const s = await listen(sales);
    try {
      const issued = await post(port, "/api/gift-cards", { value: 30, code: "BLOCK-0001" });
      const cardId = issued.body.data.id;
      await post(port, `/api/gift-cards/${cardId}/block`, { blocked: true });

      const topup = await post(port, `/api/gift-cards/${cardId}/topup`, { amount: 5 });
      assert.equal(topup.status, 409);

      const res = await post(s.port, "/api/sales", saleBody({
        paymentMethod: "gift_card",
        giftCardCode: "BLOCK-0001",
        total: 5, subtotal: 5,
      }));
      assert.equal(res.status, 400);
      assert.match(res.body.message, /blocked/i);
      assert.equal(ctx.state.giftCardTx.filter((t) => t.transaction_type === "redeem").length, 0);
    } finally { server.close(); s.server.close(); }
  });

  test("sale redemption: debits balance, records ledger + sale association; over-balance refused", async () => {
    const ctx = makeCtx();
    const admin = await buildApp(ctx);
    const sales = await buildSalesApp(ctx);
    const a = await listen(admin);
    const s = await listen(sales);
    try {
      await post(a.port, "/api/gift-cards", { value: 10, code: "REDEEM-0001" });

      const res = await post(s.port, "/api/sales", saleBody({
        paymentMethod: "gift_card",
        giftCardCode: "REDEEM-0001",
        total: 4, subtotal: 4,
      }));
      assert.equal(res.status, 201);
      const redeem = ctx.state.giftCardTx.find((t) => t.transaction_type === "redeem");
      assert.ok(redeem, "ledger records the redemption");
      assert.equal(redeem.amount, 4);
      assert.ok(redeem.reference_id, "redemption references the sale");
      const payment = ctx.state.payments.find((p) => p.payment_method === "gift_card");
      assert.match(payment.provider_transaction_id, /^giftcard:/, "payment row links back to the card for refunds");

      const over = await post(s.port, "/api/sales", saleBody({
        paymentMethod: "gift_card",
        giftCardCode: "REDEEM-0001",
        total: 50, subtotal: 50,
      }));
      assert.equal(over.status, 400);
      assert.match(over.body.message, /Insufficient/i);
    } finally { a.server.close(); s.server.close(); }
  });

  test("retried sale POST does not double-redeem the card", async () => {
    const ctx = makeCtx();
    const admin = await buildApp(ctx);
    const sales = await buildSalesApp(ctx);
    const a = await listen(admin);
    const s = await listen(sales);
    try {
      await post(a.port, "/api/gift-cards", { value: 10, code: "RETRY-0001" });
      const body = saleBody({
        paymentMethod: "gift_card",
        giftCardCode: "RETRY-0001",
        total: 6, subtotal: 6,
        clientRequestId: "9e000000-0000-4000-8000-00000000000b",
      });

      const first = await post(s.port, "/api/sales", body);
      assert.equal(first.status, 201);
      // A lost-acknowledgement retry of the SAME sale: the idempotent POST
      // returns the original sale before any tender logic re-runs.
      const retry = await post(s.port, "/api/sales", body);
      assert.equal(retry.status, 201);

      const redeems = ctx.state.giftCardTx.filter((t) => t.transaction_type === "redeem");
      assert.equal(redeems.length, 1, "exactly one redemption ledger row");
      const balance = redeems.reduce((sum, t) => sum - t.amount, 10);
      assert.equal(balance, 4);
    } finally { a.server.close(); s.server.close(); }
  });

  test("POS regression: cash and card sales unaffected by gift-card support", async () => {
    const ctx = makeCtx();
    const sales = await buildSalesApp(ctx);
    const { server, port } = await listen(sales);
    try {
      const cash = await post(port, "/api/sales", saleBody({ paymentMethod: "cash" }));
      assert.equal(cash.status, 201);
      const card = await post(port, "/api/sales", saleBody({ paymentMethod: "card" }));
      assert.equal(card.status, 201);
      assert.equal(ctx.state.giftCardTx.length, 0);
    } finally { server.close(); }
  });
});
