export const BUTTON_VARIANTS = Object.freeze([
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "outline", label: "Outline" },
  { key: "destructive", label: "Destructive" },
  { key: "icon", label: "Icon" },
  { key: "icon_label", label: "Icon + Label" },
]);

const VARIANT_KEYS = new Set(BUTTON_VARIANTS.map((item) => item.key));
const TARGET_TYPES = new Set(["action", "workflow"]);

export function normalizeButtonDefinition(input = {}) {
  const targetType = String(input.targetType || input.target_type || "action").trim().toLowerCase();
  const targetKey = String(input.targetKey || input.target_key || input.actionKey || input.action_key || "").trim();
  return {
    buttonKey: String(input.buttonKey || input.button_key || "").trim(),
    label: String(input.label || "").trim(),
    icon: input.icon ? String(input.icon).trim() : null,
    variant: String(input.variant || "primary").trim().toLowerCase(),
    targetType,
    targetKey,
    placement: String(input.placement || "record").trim(),
    requiredPermission: input.requiredPermission || input.required_permission || null,
    visibilityRule: input.visibilityRule || input.visibility_rule || {},
    inputMappings: input.inputMappings || input.input_mappings || {},
    config: input.config || {},
  };
}

export function validateButtonDefinition(input = {}) {
  const button = normalizeButtonDefinition(input);
  if (!button.buttonKey || !button.label || !button.targetKey) throw new Error("buttonKey, label and targetKey are required");
  if (!TARGET_TYPES.has(button.targetType)) throw new Error("Button targetType must be action or workflow");
  if (!VARIANT_KEYS.has(button.variant)) throw new Error(`Unsupported button variant: ${button.variant}`);
  if (!button.visibilityRule || typeof button.visibilityRule !== "object" || Array.isArray(button.visibilityRule)) throw new Error("visibilityRule must be an object");
  if (!button.inputMappings || typeof button.inputMappings !== "object" || Array.isArray(button.inputMappings)) throw new Error("inputMappings must be an object");
  return button;
}
