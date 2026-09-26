import { Toggle } from "../ui.jsx";
import { parseBooleanValue } from "../../utils/recordDisplay.js";

/*
 * THE global Boolean / True-False field renderer.
 *
 * Everywhere metadata declares a field boolean, this — not a page-specific
 * checkbox, Yes/No dropdown or bespoke switch — renders the control:
 *
 *   edit/create  → interactive shared Toggle (native checkbox, role="switch")
 *   display/view → a STATIC state badge (no switch geometry), so a read-only
 *                  record view never shows a control that looks editable
 *   disabled     → interactive Toggle in a disabled state
 *
 * Badge wording follows the field's semantics: "…Enabled" fields read
 * Enabled/Disabled, "Active"-style fields read Active/Inactive, everything
 * else reads Yes/No. Presentation comes from the shared .onepos-toggle
 * tokens, so Modern / Enterprise / Compact and Light / Dark / Accent apply
 * without branching.
 */
function staticBadgeLabel(label, value) {
  const name = String(label || "").toLowerCase();
  if (name.includes("enabled")) return value ? "Enabled" : "Disabled";
  if (name.includes("active")) return value ? "Active" : "Inactive";
  return value ? "Yes" : "No";
}

export default function BooleanField({
  value = false,
  onChange,
  mode = "edit",
  disabled = false,
  label,
  className = "",
}) {
  const readOnly = mode === "display" || mode === "view";

  if (readOnly) {
    const on = parseBooleanValue(value);
    return (
      <span
        className={`onepos-bool-badge ${on ? "onepos-bool-badge--on" : "onepos-bool-badge--off"} ${className}`}
        data-boolean-state={on ? "on" : "off"}
        aria-label={label ? `${label}: ${staticBadgeLabel(label, on)}` : staticBadgeLabel(label, on)}
      >
        {staticBadgeLabel(label, on)}
      </span>
    );
  }

  return (
    <Toggle
      checked={parseBooleanValue(value)}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className={className}
    />
  );
}
