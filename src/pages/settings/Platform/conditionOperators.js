/*
 * SHARED CONDITION VOCABULARY — the canonical platform operators.
 *
 * One list, consumed by the ActionWorkflowPicker-style builders, the Custom
 * Page Builder's Record Collection conditions editor, and the record-collection
 * runtime endpoint's tests. The endpoint itself validates with the canonical
 * server-side engine (services/platformConditions.js) — this module only keeps
 * the CLIENT surfaces from drifting away from that vocabulary.
 */
export const CONDITION_OPERATORS = Object.freeze([
  ["equals", "Equals"],
  ["not_equals", "Not equal"],
  ["greater_than", "Greater than"],
  ["greater_than_or_equal", "Greater than or equal"],
  ["less_than", "Less than"],
  ["less_than_or_equal", "Less than or equal"],
  ["is_empty", "Is empty"],
  ["is_not_empty", "Is not empty"],
]);

export const CONDITION_OPERATOR_SET = new Set(CONDITION_OPERATORS.map(([value]) => value));

export function operatorLabel(operator) {
  return CONDITION_OPERATORS.find(([value]) => value === operator)?.[1] || operator;
}
