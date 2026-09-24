import { WORKFLOW_ACTION_REGISTRY } from "./platformWorkflow.js";

// Canonical executable capability registry. UI buttons, workflows and event
// bindings reference keys here; they do not embed business implementations.
const CORE_ACTIONS = Object.freeze([
  { key: "RECORD_SAVE", displayName: "Save Record", description: "Run the canonical create/update record save pipeline." },
  { key: "RECORD_DELETE", displayName: "Delete Record", description: "Run the canonical record delete pipeline." },
]);

const definitions = [...CORE_ACTIONS, ...WORKFLOW_ACTION_REGISTRY];
const duplicateKeys = definitions.map((item) => item.key).filter((key, index, all) => all.indexOf(key) !== index);
if (duplicateKeys.length) throw new Error(`Duplicate registered action keys: ${[...new Set(duplicateKeys)].join(", ")}`);

export const PLATFORM_ACTION_REGISTRY = Object.freeze(definitions);
export const PLATFORM_ACTION_MAP = new Map(PLATFORM_ACTION_REGISTRY.map((item) => [item.key, item]));
export function listRegisteredPlatformActions() { return PLATFORM_ACTION_REGISTRY.slice(); }
export function getRegisteredPlatformAction(key) { return PLATFORM_ACTION_MAP.get(String(key || "").trim()) || null; }
