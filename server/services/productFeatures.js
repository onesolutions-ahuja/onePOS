export function normaliseVariantAttributes(attributes) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [String(key).trim(), String(value).trim()])
      .filter(([key, value]) => key && value)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export function variantIdentity(attributes) {
  return JSON.stringify(normaliseVariantAttributes(attributes));
}

export function calculateModifierTotal(modifiers = []) {
  return Math.round(
    modifiers.reduce((sum, modifier) => {
      const quantity = Number(modifier.quantity ?? 1);
      const price = Number(modifier.price ?? 0);
      return sum + (Number.isFinite(quantity) && quantity > 0 ? quantity : 0) *
        (Number.isFinite(price) && price >= 0 ? price : 0);
    }, 0) * 100
  ) / 100;
}

export function expandBundleComponents(bundleQuantity, components) {
  const quantity = Number(bundleQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Bundle quantity must be greater than zero");
  }
  return components.map((component) => {
    const componentQuantity = Number(component.quantity);
    if (!component.productId || !Number.isFinite(componentQuantity) || componentQuantity <= 0) {
      throw new Error("Bundle component quantity must be greater than zero");
    }
    return {
      productId: component.productId,
      quantity: componentQuantity * quantity,
    };
  });
}

export function validateBundleComponents(bundleProductId, components) {
  if (!bundleProductId) return { valid: false, errors: ["Bundle product is required"] };
  const seen = new Set();
  const errors = [];
  for (const component of Array.isArray(components) ? components : []) {
    if (!component?.productId) errors.push("Bundle component product is required");
    if (String(component?.productId) === String(bundleProductId)) errors.push("A bundle cannot contain itself");
    if (seen.has(String(component?.productId))) errors.push("Bundle components must be unique");
    seen.add(String(component?.productId));
    if (!Number.isFinite(Number(component?.quantity)) || Number(component.quantity) <= 0) {
      errors.push("Bundle component quantity must be greater than zero");
    }

  }
  if (!Array.isArray(components) || components.length === 0) errors.push("A bundle needs at least one component");
  return { valid: errors.length === 0, errors };
}

export async function loadSaleLineFeatures(client, companyId, items) {
  const features = new Map();
  for (const item of items) {
    const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
    const selected = [];
    const groupsResult = await client.query(
      `SELECT id, required, max_selections
         FROM product_modifier_groups
        WHERE company_id=$1 AND product_id=$2 AND active=true`,
      [companyId, item.productId]
    );
    const groupsById = new Map(groupsResult.rows.map((row) => [String(row.id), row]));
    const groupSelections = new Map();
    if (modifiers.length) {
      const optionIds = modifiers.map((modifier) => modifier.optionId).filter(Boolean);
      const result = await client.query(
        `SELECT o.id, o.name, o.price, o.track_stock, o.inventory_product_id,
                g.id AS group_id, g.required, g.max_selections
           FROM product_modifier_options o
           INNER JOIN product_modifier_groups g ON g.id=o.group_id
          WHERE o.id=ANY($1::uuid[]) AND o.active=true AND g.company_id=$2
            AND g.product_id=$3 AND g.active=true`,
        [optionIds, companyId, item.productId]
      );
      const byId = new Map(result.rows.map((row) => [String(row.id), row]));
      for (const modifier of modifiers) {
        const option = byId.get(String(modifier.optionId));
        if (!option) throw new Error("Invalid modifier option");
        const quantity = Number(modifier.quantity ?? 1);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Modifier quantity must be greater than zero");
        const count = (groupSelections.get(String(option.group_id)) || 0) + 1;
        if (count > Number(groupsById.get(String(option.group_id))?.max_selections || option.max_selections)) {
          throw new Error("Too many options selected for a modifier group");
        }
        groupSelections.set(String(option.group_id), count);
        selected.push({
          optionId: option.id,
          name: option.name,
          price: Number(option.price) || 0,
          quantity,
          trackStock: option.track_stock === true,
          inventoryProductId: option.inventory_product_id,
        });
      }
    }
    for (const group of groupsById.values()) {
      if (group.required && !groupSelections.has(String(group.id))) {
        throw new Error("A required modifier group has no selection");
      }
    }
    const bundle = await client.query(
      `SELECT c.component_product_id AS "productId", c.quantity
         FROM product_bundle_components c
         INNER JOIN products p ON p.id=c.bundle_product_id
        WHERE c.bundle_product_id=$1 AND p.company_id=$2`,
      [item.productId, companyId]
    );
    features.set(String(item.productId), {
      modifiers: selected,
      bundleComponents: bundle.rows.map((row) => ({
        productId: row.productId,
        quantity: Number(row.quantity),
      })),
    });
  }
  return features;
}
