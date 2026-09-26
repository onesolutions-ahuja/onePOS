// Shared client-side Component Registry support.
//
// The SERVER registry (/api/platform/component-registry, backed by
// services/platformComponentRegistry.js) is authoritative. This module owns
// the ONE shared presentation layer over it — icons, category labels, a
// normalizer that tolerates contract evolution, and one loader hook — so the
// Component Registry screen and every builder palette/picker stay in lockstep
// without importing server code into the browser bundle.

import { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import {
  AlignLeft,
  BarChart3,
  Bot,
  Box,
  Braces,
  Calendar,
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  Gauge,
  Link2,
  List,
  ListFilter,
  Minus,
  MousePointerClick,
  MoveVertical,
  PanelTop,
  PieChart,
  Rows3,
  Sparkles,
  Square,
  Table,
  Tag,
  Text,
  TextCursorInput,
} from "lucide-react";

// Client fallback mirrors the server registry so the builder remains usable
// during transient API failures. The server /platform/component-registry is
// authoritative and is loaded by builders at runtime.
export const FALLBACK_COMPONENT_REGISTRY = [
  { key: "section", label: "Section", category: "layout", kind: "layout" },
  { key: "header", label: "Header", category: "content", kind: "content" },
  { key: "text", label: "Information Text", category: "content", kind: "content" },
  { key: "divider", label: "Divider", category: "layout", kind: "layout" },
  { key: "spacer", label: "Spacer", category: "layout", kind: "layout" },
  { key: "text_input", label: "Text Box", category: "field", kind: "field", bindable: true },
  { key: "long_text", label: "Long Text", category: "field", kind: "field", bindable: true },
  { key: "number", label: "Number", category: "field", kind: "field", bindable: true },
  { key: "currency", label: "Currency / Decimal", category: "field", kind: "field", bindable: true },
  { key: "date", label: "Date", category: "field", kind: "field", bindable: true },
  { key: "datetime", label: "Date & Time", category: "field", kind: "field", bindable: true },
  { key: "checkbox", label: "Checkbox", category: "field", kind: "field", bindable: true },
  { key: "picklist", label: "Picklist / Dropdown", category: "field", kind: "field", bindable: true },
  { key: "lookup", label: "Lookup", category: "field", kind: "field", bindable: true },
  { key: "related_list", label: "Related List / Table", category: "record", kind: "record", bindable: true },
  { key: "field_value", label: "Field Value", category: "record", kind: "record", bindable: true },
  { key: "button", label: "Custom Button", category: "action", kind: "action", reserved: true },
];

/* ---------------------------------------------------------------------------
 * ONE icon + category presentation map.
 * Every palette, picker and the Component Registry screen resolve an entry's
 * icon and category label through these helpers — no component maps its own.
 * ------------------------------------------------------------------------ */

export const COMPONENT_ICONS = {
  section: Square,
  container: Box,
  multi_container: Rows3,
  table: Table,
  header: PanelTop,
  text: AlignLeft,
  dashboard_text: AlignLeft,
  divider: Minus,
  spacer: MoveVertical,
  text_input: TextCursorInput,
  long_text: Text,
  number: Tag,
  text: AlignLeft,
  currency: CircleDollarSign,
  date: Calendar,
  datetime: CalendarClock,
  checkbox: CheckSquare,
  picklist: ListFilter,
  lookup: Link2,
  related_list: List,
  field_value: Braces,
  kpi: Gauge,
  pie_chart: PieChart,
  donut_chart: PieChart,
  bar_chart: BarChart3,
  /* Dashboard runtime keys (platformDashboard.js vocabulary) resolve to the
     same icons as their registry counterparts — one visual language. */
  pie: PieChart,
  donut: PieChart,
  bar: BarChart3,
  button: MousePointerClick,
  jarves: Bot,
  sparkles: Sparkles,
};

export function componentIcon(componentOrKey) {
  const key = typeof componentOrKey === "string" ? componentOrKey : componentOrKey?.key;
  return COMPONENT_ICONS[key] || COMPONENT_ICONS.sparkles;
}

/** Friendly category labels — one vocabulary, snake_case never surfaces. */
export const COMPONENT_CATEGORY_LABELS = {
  layout: "Layout",
  content: "Content",
  field: "Fields",
  record: "Record",
  dashboard: "Dashboard",
  action: "Actions",
};

export function componentCategoryLabel(category) {
  return COMPONENT_CATEGORY_LABELS[category] || "Other";
}

/** Ordered category sequence for filter tabs (unknown categories appended). */
export function componentCategories(registry) {
  const preferred = ["all", "layout", "content", "field", "record", "dashboard", "action"];
  const known = new Set(preferred);
  const extra = [];
  for (const component of registry || []) {
    const category = normalizeComponent(component).category;
    if (category && !known.has(category)) {
      known.add(category);
      extra.push(category);
    }
  }
  return [...preferred.filter((category) => category === "all" || (registry || []).some((c) => normalizeComponent(c).category === category)), ...extra];
}

/* ---------------------------------------------------------------------------
 * Normalization — loosely coupled to the server contract.
 * Accepts any subset of { key, component_key, name, label, title, category,
 * kind, description, ... } so registry additions/renames cannot break the UI.
 * ------------------------------------------------------------------------ */

export function normalizeComponent(component) {
  const source = component && typeof component === "object" ? component : {};
  const key = String(source.key || source.component_key || source.componentKey || source.name || "").trim();
  const label = String(source.label || source.title || source.name || key).trim() || key;
  return {
    ...source,
    key,
    label,
    category: String(source.category || "other").toLowerCase(),
    kind: String(source.kind || source.category || "other").toLowerCase(),
    bindable: source.bindable === true,
    reserved: source.reserved === true,
    recordBound: source.recordBound === true || source.record_bound === true,
    containsChildren: source.containsChildren === true || source.contains_children === true,
    description: typeof source.description === "string" ? source.description : "",
  };
}

export function normalizedRegistry(registry) {
  const seen = new Set();
  return (Array.isArray(registry) ? registry : [])
    .map(normalizeComponent)
    .filter((component) => component.key && !seen.has(component.key) && seen.add(component.key));
}

export function componentByKey(registry, key) {
  return normalizedRegistry(registry).find((component) => component.key === key) || null;
}

/* ---------------------------------------------------------------------------
 * ONE loader hook — the single fetch of /api/platform/component-registry.
 * Every surface starts from the fallback (never blank) and adopts the server
 * payload when it arrives; a failed request is silent by design.
 * ------------------------------------------------------------------------ */

export function useComponentRegistry() {
  const [registry, setRegistry] = useState(FALLBACK_COMPONENT_REGISTRY);

  useEffect(() => {
    let alive = true;
    apiRequest("/api/platform/component-registry")
      .then((response) => {
        if (!alive) return;
        const next = normalizedRegistry(response?.data);
        if (next.length) setRegistry(next);
      })
      .catch(() => { /* fallback stays rendered */ });
    return () => { alive = false; };
  }, []);

  return registry;
}

/* ---------------------------------------------------------------------------
 * Palette helpers (existing contracts, preserved).
 * ------------------------------------------------------------------------ */

export function paletteComponents(registry = FALLBACK_COMPONENT_REGISTRY) {
  return normalizedRegistry(registry).filter((component) => ["layout", "content", "action"].includes(component.category));
}

export function componentKeyForFieldType(fieldType, registry = FALLBACK_COMPONENT_REGISTRY) {
  const type = String(fieldType || "text").toLowerCase();
  const aliases = {
    text: "text_input", email: "text_input", phone: "text_input",
    long_text: "long_text", textarea: "long_text",
    number: "number", decimal: "currency", currency: "currency",
    date: "date", datetime: "datetime", boolean: "checkbox",
    select: "picklist", picklist: "picklist", multi_select: "picklist", lookup: "lookup",
  };
  const key = aliases[type] || "text_input";
  return registry.some((component) => component.key === key) ? key : "text_input";
}
