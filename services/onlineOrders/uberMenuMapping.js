const TARGETS = new Map([
  ["title", "name"],
  ["description", "description"],
  ["price", "price"],
  ["category", "category_name"],
  ["category_name", "category_name"],
  ["is_available", "available_on_uber"],
  ["available", "available_on_uber"],
]);

const SOURCES = new Map([
  ["id", "id"],
  ["product.id", "id"],
  ["products.id", "id"],
  ["name", "name"],
  ["product.name", "name"],
  ["products.name", "name"],
  ["title", "name"],
  ["description", "description"],
  ["product.description", "description"],
  ["products.description", "description"],
  ["price", "price"],
  ["product.price", "price"],
  ["products.price", "price"],
  ["vat_rate", "vat_rate"],
  ["product.vat_rate", "vat_rate"],
  ["active", "active"],
  ["product.active", "active"],
  ["available_on_uber", "available_on_uber"],
  ["product.available_on_uber", "available_on_uber"],
  ["uber_item_id", "uber_item_id"],
  ["product.uber_item_id", "uber_item_id"],
  ["category_name", "category_name"],
  ["product.category_name", "category_name"],
  ["category.name", "category_name"],
  ["product.category.name", "category_name"],
  ["category.id", "category_id"],
  ["product.category.id", "category_id"],
]);

const CUSTOM_PATH = /^(?:(?:product|products)\.)?custom_values\.([a-z_][a-z0-9_]*)$/i;

export const UBER_MENU_MAPPING_SCHEMA = [
  {
    target: "title",
    label: "Menu item name",
    sourcePath: "product.name",
    sourceOptions: ["product.name", "product.description", "product.price", "product.category.name"],
  },
  {
    target: "description",
    label: "Description",
    sourcePath: "product.description",
    sourceOptions: ["product.description", "product.name", "product.category.name"],
  },
  {
    target: "price",
    label: "Price",
    sourcePath: "product.price",
    sourceOptions: ["product.price", "product.vat_rate"],
  },
  {
    target: "category",
    label: "Category",
    sourcePath: "product.category.name",
    sourceOptions: ["product.category.name", "product.name", "product.description"],
  },
  {
    target: "is_available",
    label: "Availability",
    sourcePath: "product.available_on_uber",
    sourceOptions: ["product.available_on_uber", "product.active"],
  },
];

export class UberMenuMappingError extends Error {
  constructor(message, code = "INVALID_MENU_MAPPING", details = {}) {
    super(message);
    this.name = "UberMenuMappingError";
    this.code = code;
    this.details = details;
  }
}

function failInvalid(message, details) {
  throw new UberMenuMappingError(message, "INVALID_MENU_MAPPING", details);
}

function normalizeTarget(target) {
  const normalized = String(target || "").trim().replace(/^menus\.categories\.items\./, "");
  return TARGETS.get(normalized);
}

function mappingList(configuration) {
  if (!configuration) return [];
  const fields = configuration.fields || configuration.field_mappings || configuration.mappings || configuration;
  if (Array.isArray(fields)) {
    return fields.map((mapping) => [
      mapping?.target || mapping?.partnerFieldPath || mapping?.partner_field_path,
      mapping,
    ]);
  }
  if (!fields || typeof fields !== "object") {
    failInvalid("Uber menu mappings must be an object or array");
  }
  return Object.entries(fields);
}

function mappingType(mapping) {
  return String(mapping?.type || mapping?.mappingType || mapping?.mapping_type || "source").toLowerCase();
}

function sourcePath(mapping) {
  return String(
    mapping?.path ??
    mapping?.source ??
    mapping?.sourcePath ??
    mapping?.source_path ??
    mapping?.oneposSourcePath ??
    mapping?.onepos_source_path ??
    ""
  ).trim();
}

function normalizeMapping(configuration, customFields) {
  const allowedCustomFields = customFields == null ? null : new Set(customFields);
  const mappings = mappingList(configuration).map(([targetName, mapping]) => {
    const target = normalizeTarget(targetName);
    if (!target) failInvalid(`Unsupported Uber menu target field: ${targetName}`, { target: targetName });
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
      failInvalid(`Invalid mapping for Uber menu field ${targetName}`, { target: targetName });
    }

    const sameAsSource = mapping.same_as_source ?? mapping.sameAsSource ?? true;
    if (sameAsSource !== true && sameAsSource !== false) {
      failInvalid(`same_as_source must be a boolean for ${targetName}`, { target: targetName });
    }

    if (sameAsSource === false) {
      const overrideField = mapping.override_field || mapping.overrideField || mapping.custom_field || mapping.customField || null;
      if (!/^[a-z_][a-z0-9_]*$/i.test(String(overrideField || ""))) {
        failInvalid(`A Platform custom override field is required for ${targetName}`, { target: targetName });
      }
      return {
        target,
        targetName,
        sameAsSource,
        overrideField,
      };
    }

    const type = mappingType(mapping);
    if (type === "constant") {
      return { target, targetName, type, value: mapping.value ?? mapping.staticValue ?? mapping.static_value ?? null };
    }
    if (type === "custom" || type === "custom_value" || type === "custom-value") {
      const field = mapping.field || mapping.custom_field || mapping.customField || sourcePath(mapping).replace(/^(?:(?:product|products)\.)?custom_values\./, "");
      if (!/^[a-z_][a-z0-9_]*$/i.test(String(field || ""))) {
        failInvalid(`Invalid custom-value field for ${targetName}`, { target: targetName });
      }
      return { target, targetName, type: "custom", field };
    }
    if (!["source", "direct"].includes(type)) {
      failInvalid(`Unsupported mapping type for ${targetName}: ${type}`, { target: targetName, type });
    }

    const path = sourcePath(mapping);
    const customMatch = CUSTOM_PATH.exec(path);
    if (!customMatch && !SOURCES.has(path)) {
      failInvalid(`Invalid Uber menu source field: ${path || "(empty)"}`, { target: targetName, path });
    }
    return {
      target,
      targetName,
      type: "source",
      source: customMatch ? { customField: customMatch[1] } : { productField: SOURCES.get(path) },
    };
  });

  if (allowedCustomFields) {
    for (const mapping of mappings) {
      const field = mapping.source?.customField || (mapping.type === "custom" ? mapping.field : null);
      if (field && !allowedCustomFields.has(field)) {
        failInvalid(`Unknown Platform custom field: ${field}`, { field, target: mapping.targetName });
      }
      if (mapping.sameAsSource === false) {
        const overrideField = mapping.overrideField || `uber_menu_${({
          name: "title",
          description: "description",
          price: "price",
          category_name: "category",
          available_on_uber: "is_available",
        })[mapping.target]}`;
        if (!allowedCustomFields.has(overrideField) && !allowedCustomFields.has("provider_overrides")) {
          failInvalid(`Unknown Platform custom override field: ${overrideField}`, {
            field: overrideField,
            target: mapping.targetName,
          });
        }
      }
    }
  }
  return mappings;
}

export function sanitizeUberMenuMapping(configuration) {
  if (configuration == null) return null;
  if (typeof configuration !== "object" || Array.isArray(configuration)) {
    failInvalid("Uber menu mappings must be an object");
  }
  const sourceEntries = mappingList(configuration);
  const normalized = normalizeMapping(configuration, null);
  const fields = {};
  for (let index = 0; index < normalized.length; index += 1) {
    const mapping = normalized[index];
    const [sourceTarget] = sourceEntries[index] || [];
    const target = ({
      name: "title",
      category_name: "category",
      available_on_uber: "is_available",
    })[mapping.target] || mapping.target;
    if (mapping.sameAsSource === false) {
      fields[target] = { same_as_source: false, override_field: mapping.overrideField };
    } else if (mapping.type === "constant") {
      const value = mapping.value;
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        failInvalid(`Constant mapping for ${sourceTarget} must be a scalar value`, { target: sourceTarget });
      }
      fields[target] = { same_as_source: true, type: "constant", value };
    } else if (mapping.type === "custom") {
      fields[target] = { same_as_source: true, type: "custom", field: mapping.field };
    } else if (mapping.source.customField) {
      fields[target] = {
        same_as_source: true,
        type: "source",
        path: `product.custom_values.${mapping.source.customField}`,
      };
    } else {
      const sourcePathByField = {
        id: "product.id",
        name: "product.name",
        description: "product.description",
        price: "product.price",
        vat_rate: "product.vat_rate",
        active: "product.active",
        available_on_uber: "product.available_on_uber",
        uber_item_id: "product.uber_item_id",
        category_name: "product.category.name",
        category_id: "product.category.id",
      };
      fields[target] = {
        same_as_source: true,
        type: "source",
        path: sourcePathByField[mapping.source.productField],
      };
    }
  }
  return { fields };
}

function hasValue(value) {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function overrideValue(product, mapping) {
  const customValues = product.custom_values || {};
  const providerMenuOverrides = customValues.provider_overrides?.uber?.menu;
  const providerOverrides = customValues.provider_overrides?.uber;
  const menuField = ({
    name: "title",
    description: "description",
    price: "price",
    category_name: "category",
    available_on_uber: "is_available",
  })[mapping.target];
  const configuredTarget = String(mapping.targetName || "")
    .trim()
    .replace(/^menus\.categories\.items\./, "");
  const key = mapping.overrideField || `uber_menu_${menuField}`;
  const candidates = [
    providerMenuOverrides?.[configuredTarget],
    providerMenuOverrides?.[menuField],
    providerOverrides?.[configuredTarget],
    providerOverrides?.[menuField],
    customValues[key],
  ];
  return candidates.find(hasValue);
}

function mappedSourceValue(product, mapping) {
  if (mapping.type === "constant") return mapping.value;
  if (mapping.type === "custom") return product.custom_values?.[mapping.field];
  if (mapping.source.customField) return product.custom_values?.[mapping.source.customField];
  return product[mapping.source.productField];
}

/**
 * Apply an integration's generic menu field mappings to product snapshots.
 * Identity-bearing fields are deliberately not configurable; Uber item ids
 * and external_data remain tied to the stable onePOS product identity.
 *
 * Mappings are stored in the integration configuration under `menu_mapping`,
 * keyed by menu field. Entries accept source paths, constants, or generic
 * Platform custom-value names. For example:
 * { fields: { title: { type: "source", path: "product.name" },
 *   description: { type: "custom", field: "delivery_description" },
 *   price: { type: "constant", value: 4.5 } } }
 * A `same_as_source: false` entry instead requires its `override_field` value
 * in the product's generic Platform custom_values record (or a provider
 * override under provider_overrides.uber.menu).
 */
export function resolveUberMenuProducts(products, configuration, { customFields } = {}) {
  const mappings = normalizeMapping(configuration, customFields);
  if (!mappings.length) return { products: products || [], mapped: false };

  const resolved = (products || []).map((product) => ({ ...product }));
  const missingOverrides = [];

  for (const mapping of mappings) {
    for (let index = 0; index < resolved.length; index += 1) {
      const product = resolved[index];
      if (mapping.sameAsSource === false) {
        const value = overrideValue(product, mapping);
        if (!hasValue(value)) {
          missingOverrides.push({ productId: product.id, field: mapping.targetName });
          continue;
        }
        product[mapping.target] = value;
      } else {
        product[mapping.target] = mappedSourceValue(product, mapping);
      }
    }
  }

  if (missingOverrides.length) {
    throw new UberMenuMappingError(
      "Required Uber menu custom overrides are missing for one or more products",
      "MISSING_REQUIRED_OVERRIDE",
      { missingOverrides }
    );
  }

  return { products: resolved, mapped: true };
}
