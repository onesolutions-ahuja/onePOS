const NUMERIC_TYPES = new Set(["number", "decimal", "currency"]);

function isEmpty(value) {
  return value === null
    || value === undefined
    || value === ""
    || (Array.isArray(value) && value.length === 0);
}

function fieldKey(field) {
  return field?.api_name || field?.apiName || field?.field_key || field?.fieldKey || field?.name;
}

function fieldType(field) {
  return field?.field_type || field?.fieldType || field?.type || "text";
}

function normalize(value, field) {
  if (isEmpty(value)) return null;
  const type = fieldType(field);
  if (NUMERIC_TYPES.has(type)) return Number(value);
  if (type === "boolean") return value === true || value === 1 || value === "true" || value === "1";
  return String(value);
}

function matches(condition, fields, record) {
  const field = fields.find((candidate) => fieldKey(candidate) === condition.field);
  const actual = record?.[condition.field];
  if (condition.operator === "is_empty") return isEmpty(actual);
  if (condition.operator === "is_not_empty") return !isEmpty(actual);
  if (condition.operator === "changed") return actual !== undefined;
  if (condition.operator === "changed_to") return actual !== undefined && normalize(actual, field) === normalize(condition.value, field);
  if (condition.operator === "changed_from" || condition.operator === "changed_from_to") return false;
  if (isEmpty(actual)) return condition.operator === "not_equals";
  const left = normalize(actual, field);
  const right = normalize(condition.value, field);
  switch (condition.operator) {
    case "equals": return left === right;
    case "not_equals": return left !== right;
    case "greater_than": return left > right;
    case "greater_than_or_equal": return left >= right;
    case "less_than": return left < right;
    case "less_than_or_equal": return left <= right;
    default: return false;
  }
}

export function evaluateFieldCondition(field, key, fields, record) {
  const config = field?.config?.[key];
  if (!config) return true;
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  const results = conditions.map((condition) => matches(condition, fields || [], record || {}));
  return (config.match || "all") === "any" ? results.some(Boolean) : results.every(Boolean);
}
