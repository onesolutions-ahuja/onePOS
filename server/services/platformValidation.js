// Declarative predicates only: no JavaScript, SQL, or dynamic evaluation.
import { effectiveFieldType } from "./platformFormula.js";
import { isExtensionField } from "./platformSystemObjects.js";
const OPERATORS = new Set(["equals", "not_equals", "contains", "greater_than", "less_than", "is_empty", "is_not_empty"]);
const NUMERIC = new Set(["number", "decimal", "currency"]);
const empty = (value) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const scalar = (value) => value === null || ["string", "boolean", "number"].includes(typeof value);

function typed(value, field) {
  field = { ...field, field_type: effectiveFieldType(field) };
  if (empty(value)) return null;
  if (NUMERIC.has(field.field_type)) {
    if (!["string", "number"].includes(typeof value) || String(value).trim() === "" || !Number.isFinite(Number(value))) throw new Error("Invalid numeric value");
    return Number(value);
  }
  if (field.field_type === "boolean") {
    if (![true, false, 1, 0, "true", "false", "1", "0"].includes(value)) throw new Error("Invalid boolean value");
    return [true, 1, "true", "1"].includes(value);
  }
  if (["date", "datetime"].includes(field.field_type)) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) throw new Error("Invalid date value");
    return time;
  }
  return String(value);
}

export function validationRuleError(rule, fields) {
  if (rule.action?.type !== "validation") return null;
  if (!rule.object_id) return "Validation rules require an object";
  if (!["before_create", "before_update", "before_save"].includes(rule.trigger_key)) return "Validation rules must run before create, update, or both";
  if (typeof rule.action.message !== "string" || !rule.action.message.trim() || rule.action.message.length > 500) return "Enter a validation message (1–500 characters)";
  if (!["all", "any"].includes(rule.action.match || "all")) return "Condition matching must be all or any";
  if (!Array.isArray(rule.conditions) || !rule.conditions.length || rule.conditions.length > 50) return "Configure between 1 and 50 validation conditions";
  const available = new Map(fields.filter(f => f.active && (isExtensionField(f) || f.field_type === "formula" || f.field_type === "rollup" || (f.source_column && /^[a-z_][a-z0-9_]*$/.test(f.source_column)))).map(f => [f.api_name, { ...f, field_type: effectiveFieldType(f) }]));
  for (const condition of rule.conditions) {
    const field = available.get(condition?.field);
    if (!field) return "Validation conditions must reference active mapped fields on this object";
    if (!OPERATORS.has(condition.operator)) return "Unsupported validation operator";
    if (["is_empty", "is_not_empty"].includes(condition.operator)) continue;
    if (!scalar(condition.value) || (typeof condition.value === "string" && condition.value.length > 2000)) return "Validation values must be simple values of at most 2000 characters";
    if (["greater_than", "less_than"].includes(condition.operator) && !NUMERIC.has(field.field_type) && !["date", "datetime"].includes(field.field_type)) return "Ordered comparisons require a numeric or date field";
    if (condition.operator === "contains" && !["text", "email", "phone", "select"].includes(field.field_type)) return "Contains requires a text field";
    try {
      if (typed(condition.value, field) === null) return "Use Is Empty or Is Not Empty for blank values";
    } catch { return "Condition value does not match the field type"; }
  }
  return null;
}

export function evaluateValidationRules(rules, fields, record) {
  const byName = new Map(fields.map(f => [f.api_name, f]));
  const errors = [];
  for (const rule of rules) {
    const configError = validationRuleError(rule, fields);
    // Invalid stored metadata fails closed, including a deleted referenced field.
    if (configError) throw new Error("An active validation rule is invalid. Ask an administrator to review its configuration.");
    const matches = rule.conditions.map(condition => {
      const actual = record[condition.field];
      if (condition.operator === "is_empty") return empty(actual);
      if (condition.operator === "is_not_empty") return !empty(actual);
      if (empty(actual)) return condition.operator === "not_equals";
      const field = byName.get(condition.field);
      const left = typed(actual, field);
      const right = typed(condition.value, field);
      switch (condition.operator) {
        case "equals": return left === right;
        case "not_equals": return left !== right;
        case "contains": return left.includes(right);
        case "greater_than": return left > right;
        case "less_than": return left < right;
        default: throw new Error("Unsupported validation operator");
      }
    });
    if ((rule.action.match || "all") === "any" ? matches.some(Boolean) : matches.every(Boolean)) {
      errors.push({ ruleId: rule.id, message: rule.action.message.trim() });
    }
  }
  return errors;
}
