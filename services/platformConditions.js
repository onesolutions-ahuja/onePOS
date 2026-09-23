const OPERATORS = new Set([
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "is_empty",
  "is_not_empty",
  "changed",
  "changed_from",
  "changed_to",
  "changed_from_to",
]);

const NUMERIC_TYPES = new Set(["number", "decimal", "currency"]);
const empty = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

export class ConditionError extends Error {
  constructor(message) {
    super(message);
    this.code = "INVALID_CONDITION";
  }
}

function fail(message) {
  throw new ConditionError(message);
}

function fieldType(field) {
  return field?.field_type === "formula" || field?.field_type === "rollup"
    ? field?.config?.resultType || field?.config?.result_type || "text"
    : field?.field_type;
}

function normalize(value, field) {
  if (empty(value)) return null;
  const type = fieldType(field);
  if (NUMERIC_TYPES.has(type)) {
    if (!Number.isFinite(Number(value))) fail(`Condition value for ${field.api_name} must be numeric`);
    return Number(value);
  }
  if (type === "boolean") {
    if (![true, false, 0, 1, "true", "false", "0", "1"].includes(value)) {
      fail(`Condition value for ${field.api_name} must be boolean`);
    }
    return [true, 1, "true", "1"].includes(value);
  }
  return String(value);
}

function validateCondition(condition, fields, context) {
  if (!condition || typeof condition !== "object" || Array.isArray(condition)) {
    fail(`${context} must be an object`);
  }
  if (typeof condition.field !== "string" || !condition.field) {
    fail(`${context} must specify a field`);
  }
  const field = fields.find((candidate) => candidate.active !== false && candidate.api_name === condition.field);
  if (!field) fail(`${context} references an unavailable field: ${condition.field}`);
  if ((field.field_type === "formula" || field.field_type === "rollup") && field.readable === false) {
    fail(`${context} references an unreadable field: ${condition.field}`);
  }
  if (!OPERATORS.has(condition.operator)) {
    fail(`${context} uses an unsupported operator`);
  }
  if (condition.operator === "changed") return field;
  if (condition.operator === "changed_from_to") {
    if (!condition.value || typeof condition.value !== "object" || Array.isArray(condition.value)) {
      fail(`${context} changed_from_to requires from and to values`);
    }
    normalize(condition.value.from, field);
    normalize(condition.value.to, field);
    return field;
  }
  if (!["is_empty", "is_not_empty"].includes(condition.operator)) {
    if (condition.value === undefined || Array.isArray(condition.value) || typeof condition.value === "object") {
      fail(`${context} must use a simple comparison value`);
    }
    normalize(condition.value, field);
  }
  return field;
}

export function validateConditionConfig(config, fields, name) {
  if (config === undefined || config === null) return;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    fail(`${name} must be an object`);
  }
  const match = config.match || "all";
  if (!["all", "any"].includes(match)) fail(`${name}.match must be all or any`);
  if (!Array.isArray(config.conditions) || config.conditions.length < 1 || config.conditions.length > 20) {
    fail(`${name}.conditions must contain between 1 and 20 conditions`);
  }
  config.conditions.forEach((condition) => validateCondition(condition, fields, name));
}

function matches(condition, fields, record, previousRecord) {
  const field = fields.find((candidate) => candidate.api_name === condition.field);
  const actual = record?.[condition.field];
  const previous = previousRecord?.[condition.field];
  if (condition.operator === "changed") return actual !== previous;
  if (condition.operator === "changed_from") return actual !== previous && normalize(previous, field) === normalize(condition.value, field);
  if (condition.operator === "changed_to") return actual !== previous && normalize(actual, field) === normalize(condition.value, field);
  if (condition.operator === "changed_from_to") {
    return actual !== previous
      && normalize(previous, field) === normalize(condition.value.from, field)
      && normalize(actual, field) === normalize(condition.value.to, field);
  }
  if (condition.operator === "is_empty") return empty(actual);
  if (condition.operator === "is_not_empty") return !empty(actual);
  if (empty(actual)) return condition.operator === "not_equals";
  const left = normalize(actual, field);
  const right = normalize(condition.value, field);
  switch (condition.operator) {
    case "equals": return left === right;
    case "not_equals": return left !== right;
    case "greater_than": return left > right;
    case "greater_than_or_equal": return left >= right;
    case "less_than": return left < right;
    case "less_than_or_equal": return left <= right;
    default: throw new ConditionError("Unsupported condition operator");
  }
}

export function evaluateCondition(config, fields, record, previousRecord = null) {
  if (!config) return true;
  validateConditionConfig(config, fields, "Condition");
  const results = config.conditions.map((condition) => matches(condition, fields, record, previousRecord));
  return (config.match || "all") === "any"
    ? results.some(Boolean)
    : results.every(Boolean);
}

export function evaluateFieldCondition(field, key, fields, record) {
  return evaluateCondition(field?.config?.[key], fields, record);
}

export function validateConditionalRequired(fields, record) {
  for (const field of fields.filter((candidate) => candidate.active !== false && candidate.field_type !== "formula" && candidate.field_type !== "rollup")) {
    const condition = field.config?.requiredCondition;
    if (condition && evaluateCondition(condition, fields, record) && empty(record?.[field.api_name])) {
      return `${field.label} is required`;
    }
  }
  return null;
}

export { OPERATORS };
