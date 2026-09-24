/*
 * T10Z - Combos / Meal Deals: THE pure pricing + matching engine.
 *
 * This module is intentionally dependency-free (no database, no express, no
 * React) so that the SAME engine serves:
 *
 *   - the POS cart (src/pages/pos/POS.jsx, via src/utils/saleTotals.js)
 *   - Self-Checkout / Scan & Go (they already share src/utils/saleTotals.js)
 *   - the authoritative server-side re-check in routes/sales.js
 *   - the permanent test suite (tests/comboDeals.test.mjs)
 *
 * There is deliberately NO second meal-deal implementation anywhere.
 *
 * ---------------------------------------------------------------------------
 * DEAL SHAPE (as returned by services/comboDeals.js and accepted here)
 * ---------------------------------------------------------------------------
 * {
 *   id, company_id, name, description,
 *   deal_type: 'meal_deal' | 'bundle',
 *   deal_price: number,                 // money, 2dp
 *   store_scope: 'all' | 'selected',
 *   store_ids: [uuid],                  // when store_scope = 'selected'
 *   active: boolean,
 *   starts_at: ISO string | null,
 *   ends_at: ISO string | null,
 *   created_at: ISO string | null,
 *   groups: [
 *     { id, name, required_quantity: int, display_order: int,
 *       product_ids: [uuid], category_ids: [uuid] }
 *   ]
 * }
 *
 * ---------------------------------------------------------------------------
 * DETERMINISTIC MATCHING RULES (documented, reproducible, no randomness)
 * ---------------------------------------------------------------------------
 * 1. Deals are eligible when: company matches, active = true, the store scope
 *    allows the current store (or scope = 'all'), and NOW is inside
 *    [starts_at, ends_at] (each bound optional).
 * 2. Eligible deals are evaluated in a STABLE order: created_at ASC, then
 *    id ASC. Earlier-created deals therefore claim qualifying products first.
 *    This is the documented priority rule - no price/value heuristics.
 * 3. A "completion" needs `required_quantity` units in EVERY group. Units are
 *    matched to groups using an exclusive maximum bipartite matching
 *    (Kuhn's augmenting-path algorithm) so a single cart unit can never
 *    satisfy two groups, and the engine finds a completion whenever one
 *    exists (no greedy dead-ends).
 * 4. Completions repeat until no further completion is possible, so
 *    "2 sandwiches + 2 crisps + 2 drinks" yields 2 x the deal and
 *    "2 sandwiches + 1 crisps + 1 drink" yields 1 x the deal with the
 *    unmatched sandwich left at its normal price.
 * 5. A completion is only applied when it is BENEFICIAL:
 *    sum(original unit prices) > deal_price. This makes it impossible for a
 *    deal to create a negative line total, a negative order total or a
 *    negative discount.
 * 6. The deal price is allocated across the participating units
 *    PROPORTIONALLY to each unit's original price, with the rounding
 *    remainder placed on the final unit. Money arithmetic is done in integer
 *    pence so there is no floating-point drift, and each unit keeps its own
 *    product VAT applicability/rate (VAT is never recalculated here).
 */

export const COMBO_DEAL_TYPES = {
  MEAL_DEAL: "meal_deal",
  BUNDLE: "bundle",
};

export const COMBO_STORE_SCOPE = {
  ALL: "all",
  SELECTED: "selected",
};

export const COMBO_DEAL_TYPE_VALUES = Object.values(COMBO_DEAL_TYPES);
export const COMBO_STORE_SCOPE_VALUES = Object.values(COMBO_STORE_SCOPE);

/** Money is handled in integer pence. */
export function toPence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromPence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

export function round2(value) {
  return fromPence(toPence(value));
}

/*
 * ---------------------------------------------------------------------------
 * VALIDATION
 * ---------------------------------------------------------------------------
 * Used by the API (authoritative) and by the admin UI (inline feedback).
 * Returns every problem it finds rather than throwing.
 */
export function validateComboDealInput(deal = {}) {
  const errors = [];

  if (!deal || typeof deal !== "object") {
    return { valid: false, errors: ["Deal payload is required"] };
  }

  const name = typeof deal.name === "string" ? deal.name.trim() : "";
  if (!name) errors.push("Deal name is required");

  const dealType = deal.deal_type || COMBO_DEAL_TYPES.MEAL_DEAL;
  if (!COMBO_DEAL_TYPE_VALUES.includes(dealType)) {
    errors.push(`Deal type must be one of: ${COMBO_DEAL_TYPE_VALUES.join(", ")}`);
  }

  const rawPrice = deal.deal_price;
  const priceNumber = Number(rawPrice);
  if (rawPrice === "" || rawPrice === null || rawPrice === undefined) {
    errors.push("Deal price is required");
  } else if (!Number.isFinite(priceNumber)) {
    errors.push("Deal price must be a number");
  } else if (priceNumber < 0) {
    errors.push("Deal price cannot be negative");
  }

  const storeScope = deal.store_scope || COMBO_STORE_SCOPE.ALL;
  if (!COMBO_STORE_SCOPE_VALUES.includes(storeScope)) {
    errors.push(`Store scope must be one of: ${COMBO_STORE_SCOPE_VALUES.join(", ")}`);
  }

  const storeIds = Array.isArray(deal.store_ids) ? deal.store_ids.filter(Boolean) : [];
  if (storeScope === COMBO_STORE_SCOPE.SELECTED && storeIds.length === 0) {
    errors.push("Select at least one store, or use all stores");
  }

  const hasStart = deal.starts_at !== null && deal.starts_at !== undefined && deal.starts_at !== "";
  const hasEnd = deal.ends_at !== null && deal.ends_at !== undefined && deal.ends_at !== "";
  if (hasStart && Number.isNaN(new Date(deal.starts_at).getTime())) {
    errors.push("Start date/time is not a valid date");
  }
  if (hasEnd && Number.isNaN(new Date(deal.ends_at).getTime())) {
    errors.push("End date/time is not a valid date");
  }
  if (hasStart && hasEnd) {
    const start = new Date(deal.starts_at).getTime();
    const end = new Date(deal.ends_at).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && start >= end) {
      errors.push("End date/time must be after the start date/time");
    }
  }

  const groups = Array.isArray(deal.groups) ? deal.groups : [];
  if (groups.length === 0) {
    errors.push("A deal needs at least one group");
  }

  const seenGroupNames = new Set();
  groups.forEach((group, index) => {
    const label = `Group ${index + 1}`;
    const groupName = typeof group?.name === "string" ? group.name.trim() : "";
    if (!groupName) {
      errors.push(`${label}: name is required`);
    } else {
      const key = groupName.toLowerCase();
      if (seenGroupNames.has(key)) errors.push(`${label}: duplicate group name "${groupName}"`);
      seenGroupNames.add(key);
    }

    const qty = Number(group?.required_quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      errors.push(`${label}: required quantity must be a whole number greater than zero`);
    }

    const productIds = Array.isArray(group?.product_ids) ? group.product_ids.filter(Boolean) : [];
    const categoryIds = Array.isArray(group?.category_ids) ? group.category_ids.filter(Boolean) : [];
    if (productIds.length === 0 && categoryIds.length === 0) {
      errors.push(`${label}: add at least one product or category`);
    }

    const duplicates = productIds.filter((id, i) => productIds.indexOf(id) !== i);
    if (duplicates.length) {
      errors.push(`${label}: the same product is listed more than once`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/*
 * ---------------------------------------------------------------------------
 * ELIGIBILITY
 * ---------------------------------------------------------------------------
 */

/** True when `at` (Date/ISO/ms) falls inside the deal's [starts_at, ends_at). */
export function isDealActiveAt(deal, at = new Date()) {
  const when = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(when)) return false;

  if (deal?.starts_at) {
    const start = new Date(deal.starts_at).getTime();
    if (!Number.isNaN(start) && when < start) return false;
  }
  if (deal?.ends_at) {
    const end = new Date(deal.ends_at).getTime();
    if (!Number.isNaN(end) && when >= end) return false;
  }
  return true;
}

/** True when the deal may be applied at `storeId`. */
export function dealAppliesToStore(deal, storeId = null) {
  const scope = deal?.store_scope || COMBO_STORE_SCOPE.ALL;
  if (scope === COMBO_STORE_SCOPE.ALL) return true;
  if (!storeId) return false;
  const ids = Array.isArray(deal?.store_ids) ? deal.store_ids.map(String) : [];
  return ids.includes(String(storeId));
}

/**
 * Deterministic evaluation order: created_at ASC, then id ASC.
 * Ids are compared as strings so the order is stable across runtimes.
 */
export function orderDealsForMatching(deals = []) {
  return [...deals].sort((a, b) => {
    const aTime = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b?.created_at ? new Date(b.created_at).getTime() : 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
}

/**
 * Filter + order the deals that may apply for this company/store at this time.
 * Company is authoritative: a deal whose company_id differs from `companyId`
 * is never returned (server-side isolation, mirrored client-side).
 */
export function filterApplicableDeals(deals = [], options = {}) {
  const { companyId = null, storeId = null, at = new Date(), includeInactive = false } = options;

  const eligible = (Array.isArray(deals) ? deals : []).filter((deal) => {
    if (!deal) return false;
    if (!includeInactive && deal.active !== true) return false;
    if (companyId && deal.company_id && String(deal.company_id) !== String(companyId)) return false;
    if (!dealAppliesToStore(deal, storeId)) return false;
    if (!includeInactive && !isDealActiveAt(deal, at)) return false;
    const groups = Array.isArray(deal.groups) ? deal.groups : [];
    if (groups.length === 0) return false;
    return groups.every((g) => Number(g?.required_quantity) > 0);
  });

  return orderDealsForMatching(eligible);
}

/*
 * ---------------------------------------------------------------------------
 * UNIT / GROUP MATCHING
 * ---------------------------------------------------------------------------
 */

/** Does a single cart unit qualify for a group (by product id or category id)? */
export function unitQualifiesForGroup(unit, group) {
  if (!unit || !group) return false;
  const productId = unit.productId ?? unit.id ?? null;
  const categoryId = unit.categoryId ?? unit.category_id ?? null;

  const productIds = Array.isArray(group.product_ids) ? group.product_ids.map(String) : [];
  if (productId && productIds.includes(String(productId))) return true;

  const categoryIds = Array.isArray(group.category_ids) ? group.category_ids.map(String) : [];
  if (categoryId && categoryIds.includes(String(categoryId))) return true;

  return false;
}

/**
 * Expand basket lines into individual matchable units.
 * A line with quantity 3 becomes 3 units sharing the line index, so one unit
 * can never satisfy two groups while the remaining units stay available.
 */
export function buildUnitsFromBasket(basket = []) {
  const units = [];
  (Array.isArray(basket) ? basket : []).forEach((item, lineIndex) => {
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    for (let unitIndex = 0; unitIndex < quantity; unitIndex += 1) {
      units.push({
        key: `${lineIndex}:${unitIndex}`,
        lineIndex,
        unitIndex,
        productId: item?.id ?? null,
        categoryId: item?.categoryId ?? item?.category_id ?? null,
        name: item?.name ?? "",
        price: Number(item?.price) || 0,
        vatApplicable: item?.vatApplicable !== false,
        vatRate: Number(item?.vatRate ?? item?.vat_rate) || 0,
      });
    }
  });
  return units;
}

/** Kuhn's augmenting-path helper - one unit is never reused inside a completion. */
function tryAssign(slotIndex, adjacency, unitToSlot, visitedUnits) {
  for (const unitIndex of adjacency[slotIndex]) {
    if (visitedUnits.has(unitIndex)) continue;
    visitedUnits.add(unitIndex);

    const currentSlot = unitToSlot[unitIndex];
    if (currentSlot === undefined || tryAssign(currentSlot, adjacency, unitToSlot, visitedUnits)) {
      unitToSlot[unitIndex] = slotIndex;
      return true;
    }
  }
  return false;
}

/**
 * Find ONE completion of `groups` using currently unused units.
 *
 * Uses exclusive maximum bipartite matching (Kuhn) between group "slots"
 * (one slot per required unit) and available cart units. This guarantees:
 *   - a unit satisfies at most one slot/group,
 *   - a completion is found whenever one exists (no greedy dead-ends),
 *   - the result is deterministic for a given unit order.
 *
 * Returns [{ unit, groupIndex }] or null.
 */
export function findCompletion(units, groups, usedKeys = new Set()) {
  const slots = [];
  groups.forEach((group, groupIndex) => {
    const quantity = Math.max(0, Math.floor(Number(group?.required_quantity) || 0));
    for (let k = 0; k < quantity; k += 1) slots.push(groupIndex);
  });
  if (slots.length === 0) return null;

  const adjacency = slots.map((groupIndex) =>
    units
      .map((unit, unitIndex) => ({ unit, unitIndex }))
      .filter(({ unit }) => !usedKeys.has(unit.key) && unitQualifiesForGroup(unit, groups[groupIndex]))
      .map(({ unitIndex }) => unitIndex)
  );

  const unitToSlot = {};
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const visited = new Set();
    if (!tryAssign(slotIndex, adjacency, unitToSlot, visited)) return null;
  }

  const slotToUnit = new Array(slots.length).fill(null);
  Object.entries(unitToSlot).forEach(([unitIndex, slotIndex]) => {
    slotToUnit[Number(slotIndex)] = Number(unitIndex);
  });
  if (slotToUnit.some((value) => value === null)) return null;

  return slotToUnit
    .map((unitIndex, slotIndex) => ({ unit: units[unitIndex], groupIndex: slots[slotIndex] }))
    .filter((entry) => entry.unit);
}

/*
 * ---------------------------------------------------------------------------
 * PRICE ALLOCATION + APPLICATION
 * ---------------------------------------------------------------------------
 */

/**
 * Allocate a deal's price across its participating units, proportionally to
 * each unit's original price, with the rounding remainder on the final unit.
 * Integer pence only - no floating-point drift.
 */
export function allocateDealPrice(units = [], dealPricePence = 0) {
  const allocations = new Array(units.length).fill(0);
  if (units.length === 0) return allocations;

  const totalOriginal = units.reduce((sum, unit) => sum + toPence(unit.price), 0);

  if (totalOriginal <= 0) {
    /* All free lines: split equally, remainder on the last unit. */
    const each = Math.floor(dealPricePence / units.length);
    allocations.fill(each);
    allocations[units.length - 1] = dealPricePence - each * (units.length - 1);
    return allocations;
  }

  let allocated = 0;
  units.forEach((unit, index) => {
    if (index === units.length - 1) {
      allocations[index] = dealPricePence - allocated;
      return;
    }
    const share = Math.floor((toPence(unit.price) * dealPricePence) / totalOriginal);
    allocations[index] = share;
    allocated += share;
  });

  return allocations;
}

/**
 * THE combo/meal-deal application engine.
 *
 * Reads the basket and the candidate deals and returns a complete, explicit
 * representation of every deal applied. It never mutates the basket, never
 * mutates the deals and never changes a product's selling price.
 *
 * Guarantees:
 *   - only active, in-date, store- and company-eligible deals are considered;
 *   - a completion is applied only when it is beneficial
 *     (original value > deal price), so totals/discounts can never go negative;
 *   - each cart unit participates in at most one deal and one group;
 *   - completions repeat, so 2+2+2 gives 2 deals and 2+1+1 gives 1 deal with
 *     the unmatched unit left at its normal price;
 *   - deterministic: deals are evaluated created_at ASC then id ASC.
 */
export function applyComboDeals(basket = [], deals = [], options = {}) {
  const { companyId = null, storeId = null, at = new Date() } = options;

  const units = buildUnitsFromBasket(basket);
  const applicable = filterApplicableDeals(deals, { companyId, storeId, at });

  const usedKeys = new Set();
  const applications = [];
  const lineComboValuePence = new Array(Array.isArray(basket) ? basket.length : 0).fill(0);

  for (const deal of applicable) {
    const groups = Array.isArray(deal.groups) ? deal.groups : [];
    if (groups.length === 0) continue;
    const dealPricePence = toPence(deal.deal_price);

    /* Repeat completions until this deal can no longer complete. */
    for (;;) {
      const completion = findCompletion(units, groups, usedKeys);
      if (!completion || completion.length === 0) break;

      const originalPence = completion.reduce((sum, entry) => sum + toPence(entry.unit.price), 0);
      /*
       * Only apply when it genuinely benefits the customer. This is what makes
       * negative line totals / negative order totals / negative VAT impossible.
       */
      if (originalPence <= dealPricePence) break;

      /* Order participants deterministically for reporting. */
      const ordered = [...completion].sort(
        (a, b) => a.unit.lineIndex - b.unit.lineIndex || a.unit.unitIndex - b.unit.unitIndex
      );
      ordered.forEach((entry) => usedKeys.add(entry.unit.key));

      const allocations = allocateDealPrice(
        ordered.map((entry) => entry.unit),
        dealPricePence
      );

      const participants = ordered.map((entry, index) => {
        const allocatedPence = allocations[index];
        lineComboValuePence[entry.unit.lineIndex] += allocatedPence;
        return {
          lineIndex: entry.unit.lineIndex,
          unitIndex: entry.unit.unitIndex,
          productId: entry.unit.productId,
          productName: entry.unit.name,
          groupIndex: entry.groupIndex,
          groupName: groups[entry.groupIndex]?.name ?? `Group ${entry.groupIndex + 1}`,
          originalUnitPrice: round2(entry.unit.price),
          dealUnitPrice: fromPence(allocatedPence),
          vatApplicable: entry.unit.vatApplicable,
          vatRate: entry.unit.vatRate,
        };
      });

      applications.push({
        dealId: deal.id ?? null,
        dealName: deal.name ?? "",
        dealType: deal.deal_type ?? COMBO_DEAL_TYPES.MEAL_DEAL,
        dealPrice: round2(deal.deal_price),
        groupCount: groups.length,
        unitCount: participants.length,
        originalValue: fromPence(originalPence),
        dealValue: fromPence(dealPricePence),
        discount: fromPence(originalPence - dealPricePence),
        participants,
      });
    }
  }

  /* Per-line roll-up so the UI/receipt can show exactly which lines were dealt. */
  const lines = (Array.isArray(basket) ? basket : []).map((item, lineIndex) => {
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    const originalValuePence = toPence(Number(item?.price) || 0) * quantity;
    const comboValuePence = lineComboValuePence[lineIndex] || 0;
    const dealtUnitCount = applications.reduce(
      (count, application) =>
        count + application.participants.filter((p) => p.lineIndex === lineIndex).length,
      0
    );
    return {
      lineIndex,
      productId: item?.id ?? null,
      productName: item?.name ?? "",
      quantity,
      dealtUnitCount,
      originalUnitPrice: round2(item?.price),
      originalValue: fromPence(originalValuePence),
      comboValue: fromPence(comboValuePence),
      comboDiscount: fromPence(originalValuePence - comboValuePence),
      inDeal: dealtUnitCount > 0,
    };
  });

  const totalOriginalPence = applications.reduce((sum, a) => sum + toPence(a.originalValue), 0);
  const totalDealPence = applications.reduce((sum, a) => sum + toPence(a.dealValue), 0);

  return {
    applications,
    /**
     * Receipt/order audit: exactly which deals were applied, how many
     * completions, which lines participated, original value, deal price and
     * the discount generated. No fake products are created.
     */
    receiptLines: applications.map((application) => ({
      dealId: application.dealId,
      dealName: application.dealName,
      dealType: application.dealType,
      dealPrice: application.dealPrice,
      originalValue: application.originalValue,
      discount: application.discount,
      lineIndexes: [...new Set(application.participants.map((p) => p.lineIndex))].sort((a, b) => a - b),
    })),
    /** One aggregated entry per applied deal (for the POS cart + receipt). */
    summary: applicable
      .map((deal) => {
        const completions = applications.filter((a) => a.dealId === deal.id);
        if (completions.length === 0) return null;
        return {
          dealId: deal.id ?? null,
          dealName: deal.name ?? "",
          dealType: deal.deal_type ?? COMBO_DEAL_TYPES.MEAL_DEAL,
          dealPrice: round2(deal.deal_price),
          completions: completions.length,
          groupCount: Array.isArray(deal.groups) ? deal.groups.length : 0,
          originalValue: fromPence(completions.reduce((sum, a) => sum + toPence(a.originalValue), 0)),
          dealValue: fromPence(completions.reduce((sum, a) => sum + toPence(a.dealValue), 0)),
          discount: fromPence(completions.reduce((sum, a) => sum + toPence(a.discount), 0)),
        };
      })
      .filter(Boolean),
    lines,
    comboDiscount: fromPence(totalOriginalPence - totalDealPence),
    totalOriginalValue: fromPence(totalOriginalPence),
    totalDealValue: fromPence(totalDealPence),
    hasDeals: applications.length > 0,
  };
}
