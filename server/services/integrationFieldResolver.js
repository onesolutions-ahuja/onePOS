/*
 * T9A - generic onePOS field-path resolver and payload builder.
 *
 * Resolves dotted source paths against onePOS data objects, supporting:
 *   - direct fields:            sales.sale_id
 *   - relationship traversal:   sales.customer.name
 *                               sales.customer.address.postcode
 *   - implicit collections:     purchase.items.product.ean
 *                               (a plain segment over an array maps every element)
 *   - explicit collections:     purchase.items[].quantity
 *
 * Provider-agnostic by design: nothing here knows about Xero/Shopify/etc.
 */

/**
 * Resolve a single path against a value.
 * Plain segments traverse objects; a segment over an array fans out across
 * the array elements (implicit collection). `[]` segment fans out explicitly.
 *
 * @returns {Array<{value: *, found: boolean}>} one result per leaf reached
 */
function resolveSegment(value, segment) {
  if (value === null || value === undefined) return [{ value: undefined, found: false }];
  if (Array.isArray(value)) {
    // Implicit collection: map every element through the remaining segment.
    return value.flatMap((element) => resolveSegment(element, segment));
  }
  if (typeof value === "object") {
    if (!(segment in value)) return [{ value: undefined, found: false }];
    return [{ value: value[segment], found: true }];
  }
  return [{ value: undefined, found: false }];
}

/**
 * Resolve a dotted onePOS source path against a data object.
 *
 * @param {string} path e.g. "sales.customer.address.postcode"
 * @param {*} data the onePOS payload object
 * @returns {Array<{value: *, found: boolean}>} leaves reached
 */
export function resolveFieldPath(path, data) {
  if (typeof path !== "string" || !path.trim()) {
    return [{ value: undefined, found: false }];
  }
  const segments = path
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);

  let frontier = [{ value: data, found: true }];
  for (const segment of segments) {
    // "items[]" (or a bare "[]") fans out over the array at that point.
    const arrayKey = segment.endsWith("[]") ? segment.slice(0, -2) : null;
    if (arrayKey !== null) {
      if (arrayKey) {
        frontier = frontier.flatMap((node) => resolveSegment(node.value, arrayKey));
      }
      frontier = frontier.flatMap((node) =>
        Array.isArray(node.value)
          ? node.value.map((element) => ({ value: element, found: true }))
          : [{ value: undefined, found: false }]
      );
      continue;
    }
    frontier = frontier.flatMap((node) => resolveSegment(node.value, segment));
    // A fan-out that produced no found nodes ends resolution.
    if (!frontier.some((node) => node.found)) break;
  }
  return frontier;
}

/** Convenience: first found value or undefined. */
export function resolveFirst(path, data) {
  const results = resolveFieldPath(path, data);
  const found = results.find((r) => r.found);
  return found ? found.value : undefined;
}

/**
 * Resolve every mapping for an endpoint against onePOS data.
 *
 * Each mapping: { partnerFieldPath, oneposSourcePath, mappingType, staticValue }
 * mappingType:
 *   - "direct": resolve oneposSourcePath
 *   - "constant": use staticValue verbatim
 *   - "template": substitute {path} tokens resolved against the data
 *
 * @returns {{ payload: object, missing: string[], arrays: string[] }}
 *   payload  - partner-shaped object
 *   missing  - partner fields whose direct path resolved to nothing
 *   arrays   - partner fields that fanned out into collections
 */
export function buildPayload(mappings, data) {
  const payload = {};
  const missing = [];
  const arrays = [];
  const list = Array.isArray(mappings) ? mappings : [];

  for (const mapping of list) {
    const partnerField = mapping.partnerFieldPath || mapping.partner_field_path;
    if (!partnerField) continue;

    const type = mapping.mappingType || mapping.mapping_type || "direct";

    if (type === "constant") {
      payload[partnerField] = mapping.staticValue ?? mapping.static_value ?? null;
      continue;
    }

    if (type === "template") {
      const template = String(mapping.staticValue ?? mapping.static_value ?? "");
      payload[partnerField] = template.replace(/\{([^}]+)\}/g, (_m, innerPath) => {
        const value = resolveFirst(innerPath.trim(), data);
        return value === undefined || value === null ? "" : String(value);
      });
      continue;
    }

    // direct
    const sourcePath = String(mapping.oneposSourcePath ?? mapping.onepos_source_path ?? "");
    const results = resolveFieldPath(sourcePath, data);
    const foundResults = results.filter((r) => r.found);
    if (foundResults.length === 0) {
      missing.push(partnerField);
      continue;
    }
    // Paths over collections ("[]") are inherently array-valued: a single
    // element still resolves to [value] so partner schemas stay stable.
    const isCollectionPath = sourcePath.includes("[]");
    if (foundResults.length === 1 && !isCollectionPath) {
      payload[partnerField] = foundResults[0].value;
    } else {
      arrays.push(partnerField);
      payload[partnerField] = foundResults.map((r) => r.value);
    }
  }

  return { payload, missing, arrays };
}

/** Parse and validate a mapping row shape coming from the DB. */
export function normaliseMappingRow(row) {
  return {
    partnerFieldPath: row.partner_field_path,
    oneposSourcePath: row.onepos_source_path,
    mappingType: row.mapping_type,
    staticValue: row.static_value,
    displayOrder: row.display_order,
  };
}
