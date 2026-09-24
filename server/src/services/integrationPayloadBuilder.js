/*
 * --------------------------------------------------------------------------
 * Generic Integration Payload Builder (T9C)
 * --------------------------------------------------------------------------
 *
 * Builds a partner API payload from a onePOS source object plus a
 * field-mapping definition:
 *
 *   [{ partnerField: "customer_name", sourcePath: "sales.customer.name" }]
 *
 * Source lookups delegate to integrationFieldResolver.js (never duplicated).
 * Partner paths support nesting ("customer.postcode") and one or more []
 * array levels ("items[].sku"). Array fields sharing the same target array
 * stay aligned by index and preserve source ordering.
 *
 * MISSING DATA
 * - Missing scalar source -> null.
 * - Missing array source -> empty array (plus null entries for per-element
 *   misses, as produced by the resolver).
 * - Never throws because an optional relationship is missing.
 * - No entity/field names are hard-coded.
 */

import { resolveField } from './integrationFieldResolver.js';

function parsePath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const segments = trimmed.split('.');
  const parsed = [];
  for (const segment of segments) {
    if (!segment || segment === '[]') return null;
    const isArray = segment.endsWith('[]');
    const field = isArray ? segment.slice(0, -2) : segment;
    if (!field) return null;
    parsed.push({ field, isArray });
  }
  return parsed.length ? parsed : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toArrayValue(resolved) {
  if (resolved === null || resolved === undefined) return [];
  if (Array.isArray(resolved)) return resolved;
  return [resolved];
}

/**
 * Assign a scalar leaf into nested objects, creating them as needed.
 */
function assignScalar(root, segments, value) {
  let node = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const { field } = segments[i];
    // Plain (non-array) writer segments always build plain objects; a []
    // deeper in the path is handled by assignValue recursion instead.
    if (!isRecord(node[field])) node[field] = {};
    node = node[field];
  }
  node[segments[segments.length - 1].field] = value;
}

/**
 * Recursive writer supporting nested [] levels in the partner path.
 * Example: partner "orders[].lines[].sku" builds arrays at both levels and
 * keeps each level aligned by index.
 */
function assignValue(node, segments, resolved) {
  if (!segments.length) return;

  if (!segments[0].isArray) {
    if (segments.length === 1) {
      node[segments[0].field] =
        resolved === undefined || resolved === null ? null : resolved;
      return;
    }
    if (!isRecord(node[segments[0].field])) node[segments[0].field] = {};
    assignValue(node[segments[0].field], segments.slice(1), resolved);
    return;
  }

  // Array segment: fan out over the resolved rows.
  const rows = toArrayValue(resolved);
  const rest = segments.slice(1);
  let list = node[segments[0].field];
  if (!Array.isArray(list)) {
    list = [];
    node[segments[0].field] = list;
  }

  if (!rest.length) {
    // Partner path ends at the array itself: replace wholesale.
    node[segments[0].field] = rows.map((row) =>
      row === undefined ? null : row
    );
    return;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] === undefined ? null : rows[i];
    if (rest.length === 1 && !rest[0].isArray) {
      // Fast path for the common "items[].sku" shape.
      if (!isRecord(list[i])) list[i] = {};
      list[i][rest[0].field] = row === null ? null : row;
    } else {
      if (!isRecord(list[i])) list[i] = {};
      // Nested [] inside the rest: the row itself may be a single value or
      // an array of sub-rows; assignValue handles both via toArrayValue.
      assignValue(list[i], rest, row);
    }
  }
}

/**
 * Build a partner payload from source data + mapping definitions.
 *
 * @param {object} source - onePOS source object.
 * @param {Array<{partnerField: string, sourcePath: string}>} mappings
 * @returns {object} Partner payload (always a fresh plain object).
 */
export function buildPayload(source, mappings) {
  const payload = {};
  if (!Array.isArray(mappings)) return payload;

  for (const mapping of mappings) {
    if (!isRecord(mapping)) continue;
    const partnerSegments = parsePath(mapping.partnerField);
    if (!partnerSegments) continue;
    if (typeof mapping.sourcePath !== 'string' || !mapping.sourcePath.trim()) {
      continue;
    }

    const wantsArray = partnerSegments.some((seg) => seg.isArray);
    let resolved;
    try {
      resolved = resolveField(source ?? null, mapping.sourcePath);
    } catch {
      resolved = wantsArray ? [] : null;
    }

    // Normalise shape mismatches defensively: scalar target <- array source
    // takes the (single) row only when unambiguous, array target <- scalar
    // source wraps the value; missing values already handled by resolver.
    if (wantsArray) {
      assignValue(payload, partnerSegments, toArrayValue(resolved));
    } else {
      const scalar = Array.isArray(resolved)
        ? resolved.length === 1
          ? resolved[0]
          : null
        : resolved;
      assignScalar(payload, partnerSegments, scalar === undefined ? null : scalar);
    }
  }

  return payload;
}

export default buildPayload;
