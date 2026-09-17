/*
 * --------------------------------------------------------------------------
 * Integration Mapping Contract & Validation (T9D)
 * --------------------------------------------------------------------------
 *
 * Reusable validation/normalisation for Integration field-mapping
 * definitions consumed by the payload builder:
 *
 *   { partnerField: "customer.name", sourcePath: "sales.customer.name" }
 *
 * RULES
 * - partnerField and sourcePath are required, must be strings, and must be
 *   non-empty after trimming.
 * - Outer whitespace is trimmed; inner whitespace makes a path malformed.
 * - [] array notation is preserved (e.g. "items[].sku").
 * - Malformed paths are rejected with UI-friendly error messages.
 * - Exact duplicates (after trimming) are removed; order is preserved.
 * - Generic: no entity/field names are hard-coded.
 */

const SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\[\])?$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a single path value. Returns the trimmed path when valid,
 * otherwise pushes human-readable messages into `errors` and returns null.
 */
function validatePathValue(label, raw, errors) {
  if (raw === undefined || raw === null) {
    errors.push(`${label} is required.`);
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push(`${label} must be a string.`);
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.push(`${label} must not be empty.`);
    return null;
  }
  if (/\s/.test(trimmed)) {
    errors.push(
      `${label} "${trimmed}" is malformed: paths must not contain spaces.`
    );
    return null;
  }
  const segments = trimmed.split('.');
  for (const segment of segments) {
    if (!segment) {
      errors.push(
        `${label} "${trimmed}" is malformed: paths must not contain empty segments.`
      );
      return null;
    }
    if (segment === '[]') {
      errors.push(
        `${label} "${trimmed}" is malformed: "[]" must follow a field name (e.g. "items[]").`
      );
      return null;
    }
    if (!SEGMENT_PATTERN.test(segment)) {
      errors.push(
        `${label} segment "${segment}" is invalid. Use letters, numbers and underscores, with an optional trailing [] for arrays (e.g. "items[]").`
      );
      return null;
    }
  }
  return trimmed;
}

/**
 * Validate a single mapping definition.
 *
 * @param {*} mapping - Expected shape { partnerField, sourcePath }.
 * @returns {{ valid: boolean, errors: string[], normalized: { partnerField: string, sourcePath: string } | null }}
 */
export function validateMapping(mapping) {
  const errors = [];

  if (!isRecord(mapping)) {
    return {
      valid: false,
      errors: ['Mapping must be an object with partnerField and sourcePath.'],
      normalized: null,
    };
  }

  const partnerField = validatePathValue('partnerField', mapping.partnerField, errors);
  const sourcePath = validatePathValue('sourcePath', mapping.sourcePath, errors);

  if (errors.length) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: { partnerField, sourcePath },
  };
}

/**
 * Validate and normalise a list of mapping definitions.
 * Trims whitespace, drops invalid entries (reported in `errors`), removes
 * exact duplicates (after trimming) and preserves first-seen order.
 *
 * @param {*} mappings - Expected array of mapping definitions.
 * @returns {{ mappings: Array<{ partnerField: string, sourcePath: string }>, errors: Array<{ index: number, errors: string[] }> }}
 */
export function normalizeMappings(mappings) {
  if (!Array.isArray(mappings)) {
    return {
      mappings: [],
      errors: [{ index: -1, errors: ['Mappings must be an array.'] }],
    };
  }

  const normalized = [];
  const errors = [];
  const seen = new Set();

  for (let index = 0; index < mappings.length; index += 1) {
    const result = validateMapping(mappings[index]);
    if (!result.valid) {
      errors.push({ index, errors: result.errors });
      continue;
    }
    const key = `${result.normalized.partnerField}\u0000${result.normalized.sourcePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(result.normalized);
  }

  return { mappings: normalized, errors };
}

export default { validateMapping, normalizeMappings };
