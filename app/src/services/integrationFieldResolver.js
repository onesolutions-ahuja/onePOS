/*
 * --------------------------------------------------------------------------
 * Generic Integration Field Resolver (T9B)
 * --------------------------------------------------------------------------
 *
 * Small, dependency-free helper for the upcoming Integration module.
 * Resolves canonical onePOS dot-paths (e.g. "sales.customer.address.postcode"
 * or "purchase.items[].product.ean") against a supplied data object.
 *
 * PATH SYNTAX
 * - Segments are separated by ".".
 * - A segment may carry a trailing "[]" to mark array expansion, e.g.
 *   "purchase.items[].quantity" maps "quantity" over every element of
 *   "purchase.items".
 * - Paths without "[]" resolve to a single scalar/object value.
 * - Paths with at least one "[]" resolve to an array of leaf values.
 *
 * MISSING DATA
 * - Never throws on missing/null relationships; scalar paths yield null and
 *   array paths yield [] (or null entries for per-element misses).
 * - No field names are hard-coded; any plain property name is supported.
 */

const ARRAY_SUFFIX = '[]';

/**
 * Split a resolver path into segments, preserving the trailing [] marker.
 * Returns null for any non-string / empty path.
 */
function tokenize(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  for (const part of parts) {
    if (!part) return null;
    if (part === ARRAY_SUFFIX) return null;
  }
  return parts;
}

function isObjectLike(value) {
  return value !== null && typeof value === 'object';
}

/**
 * Resolve a canonical field path against a data object.
 *
 * @param {object} data - Root object, e.g. { sales: {...}, purchase: {...} }.
 * @param {string} path - Dot-path with optional [] array markers.
 * @returns {*} Single value (or null) for scalar paths; array for [] paths.
 */
export function resolveField(data, path) {
  const segments = tokenize(path);
  if (!segments) return null;

  const wantsArray = segments.some((seg) => seg.endsWith(ARRAY_SUFFIX));

  if (data === null || data === undefined) {
    return wantsArray ? [] : null;
  }

  let current = [data];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isArraySegment = segment.endsWith(ARRAY_SUFFIX);
    const field = isArraySegment ? segment.slice(0, -ARRAY_SUFFIX.length) : segment;
    if (!field) return wantsArray ? [] : null;

    const next = [];

    for (const node of current) {
      if (node === null || node === undefined) {
        if (!isArraySegment) next.push(undefined);
        continue;
      }

      // Strict [] semantics: a plain segment never implicitly maps over an
      // array — that branch is treated as missing so misuse surfaces as
      // null instead of a silently reshaped result.
      if (Array.isArray(node)) {
        if (!isArraySegment) next.push(undefined);
        continue;
      }

      if (!isObjectLike(node)) {
        if (!isArraySegment) next.push(undefined);
        continue;
      }

      const value = node[field];

      if (isArraySegment) {
        if (Array.isArray(value)) {
          for (const element of value) next.push(element);
        }
        // Non-array / missing value where an array was expected contributes
        // no branches; a wholly missing base therefore resolves to [].
      } else {
        next.push(value);
      }
    }

    current = next;
    if (!current.length) break;
  }

  if (wantsArray) {
    return current.map((value) => (value === undefined ? null : value));
  }

  if (!current.length) return null;
  const leaf = current[0];
  return leaf === undefined || leaf === null ? null : leaf;
}

export default resolveField;
