/*
 * T10Z — Combos / Meal Deals: database access layer.
 *
 * This module ONLY reads/writes the combo_deal* tables and returns deals in
 * the exact shape consumed by services/comboPricing.js (the single pricing
 * engine). It contains no pricing logic of its own and no product copies:
 * groups reference EXISTING product ids / category ids.
 *
 * Company isolation is enforced in every query: a deal is only ever loaded
 * for the company that owns it, and referenced products/categories/stores are
 * validated to belong to that same company before a deal is written.
 */

/** Maps a combo_deals row to the engine's deal shape (groups attached later). */
function baseDeal(row) {
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    description: row.description,
    deal_type: row.deal_type,
    deal_price: Number(row.deal_price),
    store_scope: row.store_scope,
    active: row.active === true,
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    ends_at: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    group_count: Number(row.group_count || 0),
    store_ids: [],
    groups: [],
  };
}

/**
 * Load combo deals (with groups, allowed products/categories and store scope)
 * in the shape services/comboPricing.js consumes.
 *
 * @param {function} db - (sql, params) => Promise<{rows}>
 * @param {object} options - { companyId, storeId?, activeOnly? }
 */
export async function loadComboDeals(db, { companyId, storeId = null, activeOnly = false } = {}) {
  if (!companyId) return [];

  const params = [companyId];
  const filters = ["d.company_id = $1"];
  if (activeOnly) filters.push("d.active = true");

  const dealRows = await db(
    `
    SELECT
      d.id, d.company_id, d.name, d.description, d.deal_type, d.deal_price,
      d.store_scope, d.active, d.starts_at, d.ends_at, d.created_at, d.updated_at,
      COUNT(g.id)::int AS group_count
    FROM combo_deals d
    LEFT JOIN combo_deal_groups g ON g.deal_id = d.id
    WHERE ${filters.join(" AND ")}
    GROUP BY d.id
    ORDER BY d.created_at ASC, d.id ASC
    `,
    params
  );

  const deals = dealRows.rows.map(baseDeal);
  if (deals.length === 0) return [];

  const dealIds = deals.map((d) => d.id);

  const groupRows = await db(
    `
    SELECT id, deal_id, name, required_quantity, display_order
    FROM combo_deal_groups
    WHERE deal_id = ANY($1::uuid[])
    ORDER BY display_order ASC, created_at ASC, id ASC
    `,
    [dealIds]
  );

  const groupIds = groupRows.rows.map((g) => g.id);
  const productsByGroup = new Map();
  const categoriesByGroup = new Map();

  if (groupIds.length > 0) {
    const productRows = await db(
      `
      SELECT gp.group_id, gp.product_id
      FROM combo_deal_group_products gp
      INNER JOIN products p ON p.id = gp.product_id AND p.company_id = $2
      WHERE gp.group_id = ANY($1::uuid[])
      `,
      [groupIds, companyId]
    );
    for (const r of productRows.rows) {
      if (!productsByGroup.has(r.group_id)) productsByGroup.set(r.group_id, []);
      productsByGroup.get(r.group_id).push(r.product_id);
    }

    const categoryRows = await db(
      `
      SELECT gc.group_id, gc.category_id
      FROM combo_deal_group_categories gc
      INNER JOIN categories c ON c.id = gc.category_id AND c.company_id = $2
      WHERE gc.group_id = ANY($1::uuid[])
      `,
      [groupIds, companyId]
    );
    for (const r of categoryRows.rows) {
      if (!categoriesByGroup.has(r.group_id)) categoriesByGroup.set(r.group_id, []);
      categoriesByGroup.get(r.group_id).push(r.category_id);
    }
  }

  const storeRows = await db(
    `
    SELECT ds.deal_id, ds.store_id
    FROM combo_deal_stores ds
    INNER JOIN stores s ON s.id = ds.store_id AND s.company_id = $2
    WHERE ds.deal_id = ANY($1::uuid[])
    `,
    [dealIds, companyId]
  );
  const storesByDeal = new Map();
  for (const r of storeRows.rows) {
    if (!storesByDeal.has(r.deal_id)) storesByDeal.set(r.deal_id, []);
    storesByDeal.get(r.deal_id).push(r.store_id);
  }

  const groupsByDeal = new Map();
  for (const g of groupRows.rows) {
    if (!groupsByDeal.has(g.deal_id)) groupsByDeal.set(g.deal_id, []);
    groupsByDeal.get(g.deal_id).push({
      id: g.id,
      name: g.name,
      required_quantity: Number(g.required_quantity),
      display_order: Number(g.display_order),
      product_ids: productsByGroup.get(g.id) || [],
      category_ids: categoriesByGroup.get(g.id) || [],
    });
  }

  const result = deals.map((deal) => ({
    ...deal,
    store_ids: storesByDeal.get(deal.id) || [],
    groups: groupsByDeal.get(deal.id) || [],
  }));

  /*
   * Store scoping for the caller's store: an "all" deal always applies; a
   * "selected" deal only when this store is listed. When no storeId is
   * supplied (admin list view) every deal is returned.
   */
  if (!storeId) return result;
  return result.filter(
    (deal) =>
      deal.store_scope === "all" ||
      (deal.store_ids || []).map(String).includes(String(storeId))
  );
}

/** Load a single deal (admin edit view). Company-scoped. */
export async function loadComboDealById(db, { id, companyId } = {}) {
  if (!id || !companyId) return null;
  const all = await loadComboDeals(db, { companyId });
  return all.find((deal) => String(deal.id) === String(id)) || null;
}

/**
 * Verify every referenced product/category/store belongs to `companyId`.
 * This is the server-side company-isolation gate for writes: a client can
 * never attach another company's product to a deal.
 *
 * @returns {{valid: boolean, errors: string[]}}
 */
export async function validateComboReferences(db, { companyId, groups = [], storeIds = [] } = {}) {
  const errors = [];

  const productIds = [...new Set(groups.flatMap((g) => (Array.isArray(g?.product_ids) ? g.product_ids : [])).filter(Boolean))];
  const categoryIds = [...new Set(groups.flatMap((g) => (Array.isArray(g?.category_ids) ? g.category_ids : [])).filter(Boolean))];
  const storeIds_ = [...new Set((Array.isArray(storeIds) ? storeIds : []).filter(Boolean))];

  if (productIds.length) {
    const found = await db(
      `SELECT id FROM products WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, productIds]
    );
    const foundIds = new Set(found.rows.map((r) => String(r.id)));
    const missing = productIds.filter((id) => !foundIds.has(String(id)));
    if (missing.length) errors.push(`${missing.length} product(s) do not belong to this company`);
  }

  if (categoryIds.length) {
    const found = await db(
      `SELECT id FROM categories WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, categoryIds]
    );
    const foundIds = new Set(found.rows.map((r) => String(r.id)));
    const missing = categoryIds.filter((id) => !foundIds.has(String(id)));
    if (missing.length) errors.push(`${missing.length} category(ies) do not belong to this company`);
  }

  if (storeIds_.length) {
    const found = await db(
      `SELECT id FROM stores WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, storeIds_]
    );
    const foundIds = new Set(found.rows.map((r) => String(r.id)));
    const missing = storeIds_.filter((id) => !foundIds.has(String(id)));
    if (missing.length) errors.push(`${missing.length} store(s) do not belong to this company`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Replace a deal's groups + allowed products/categories (delete + insert).
 * Must run inside a transaction (`client` is a pool client).
 */
export async function replaceComboGroups(client, { dealId, groups = [] } = {}) {
  await client.query(`DELETE FROM combo_deal_groups WHERE deal_id = $1`, [dealId]);

  let order = 0;
  for (const group of groups) {
    const inserted = await client.query(
      `
      INSERT INTO combo_deal_groups (deal_id, name, required_quantity, display_order)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [dealId, String(group.name).trim(), Number(group.required_quantity) || 1, order]
    );
    const groupId = inserted.rows[0].id;
    order += 1;

    const productIds = [...new Set((Array.isArray(group.product_ids) ? group.product_ids : []).filter(Boolean))];
    for (const productId of productIds) {
      await client.query(
        `INSERT INTO combo_deal_group_products (group_id, product_id) VALUES ($1, $2)
         ON CONFLICT (group_id, product_id) DO NOTHING`,
        [groupId, productId]
      );
    }

    const categoryIds = [...new Set((Array.isArray(group.category_ids) ? group.category_ids : []).filter(Boolean))];
    for (const categoryId of categoryIds) {
      await client.query(
        `INSERT INTO combo_deal_group_categories (group_id, category_id) VALUES ($1, $2)
         ON CONFLICT (group_id, category_id) DO NOTHING`,
        [groupId, categoryId]
      );
    }
  }
}

/** Replace a deal's selected-store scope (delete + insert). */
export async function setComboDealStores(client, { dealId, storeIds = [] } = {}) {
  await client.query(`DELETE FROM combo_deal_stores WHERE deal_id = $1`, [dealId]);
  const unique = [...new Set((Array.isArray(storeIds) ? storeIds : []).filter(Boolean))];
  for (const storeId of unique) {
    await client.query(
      `INSERT INTO combo_deal_stores (deal_id, store_id) VALUES ($1, $2)
       ON CONFLICT (deal_id, store_id) DO NOTHING`,
      [dealId, storeId]
    );
  }
}

/**
 * Persist the per-sale deal audit (sale_combo_applications).
 * Called inside the sale transaction so it can never diverge from the sale.
 */
export async function persistSaleComboApplications(client, { saleId, companyId, storeId, pricingResult } = {}) {
  const applications = pricingResult?.applications || [];
  if (!applications.length) return 0;

  let written = 0;
  for (const application of applications) {
    await client.query(
      `
      INSERT INTO sale_combo_applications (
        sale_id, company_id, store_id, deal_id, deal_name, deal_type,
        deal_price, original_value, deal_value, discount, lines
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      `,
      [
        saleId,
        companyId,
        storeId,
        application.dealId || null,
        application.dealName || "Deal",
        application.dealType || "meal_deal",
        Number(application.dealPrice) || 0,
        Number(application.originalValue) || 0,
        Number(application.dealValue) || 0,
        Number(application.discount) || 0,
        JSON.stringify(application.participants || []),
      ]
    );
    written += 1;
  }
  return written;
}
