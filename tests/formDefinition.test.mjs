import test from "node:test";
import assert from "node:assert/strict";
import { componentsForSection, diagnoseFormDefinition, normalizeFormDefinition, sanitizeFormDefinition } from "../src/pages/settings/Platform/formDefinition.js";
import { resolvePageLayout } from "../services/platformLayoutResolver.js";

test("normalizes sections, ordering, widths, and stale field references", () => {
  const definition = normalizeFormDefinition({
    sections: [{ id: "details", label: "Details", columns: 2 }],
    components: [
      { id: "name", type: "field", field_key: "name", section_id: "details", width: "1/2", order: 1 },
      { id: "bad", type: "field", field_key: "removed", section_id: "missing", width: "invalid" },
    ],
  });
  assert.equal(definition.components[1].section_id, "details");
  assert.equal(definition.components[1].width, "full");
  assert.equal(definition.sections[0].columns, 2);
  assert.equal(sanitizeFormDefinition(definition, [{ api_name: "name" }]).components.length, 1);
});

test("supplies a safe default section for malformed definitions", () => {
  const definition = normalizeFormDefinition({ components: [{ type: "text", text: "Help" }] });
  assert.equal(definition.sections.length, 1);
  assert.equal(definition.components[0].section_id, "section-details");
});

test("reports duplicate ids, stale fields, unsupported metadata, and bad conditions", () => {
  const issues = diagnoseFormDefinition({
    sections: [{ id: "details" }, { id: "details" }],
    components: [
      { id: "same", type: "field", field_key: "deleted", section_id: "missing", width: "quarter", visibilityCondition: {} },
      { id: "same", type: "widget", field_key: "name" },
    ],
  }, [{ api_name: "name" }]);
  assert.ok(issues.some((issue) => issue.message.includes("Duplicate section")));
  assert.ok(issues.some((issue) => issue.message.includes("Duplicate component")));
  assert.ok(issues.some((issue) => issue.message.includes("stale")));
  assert.ok(issues.some((issue) => issue.message.includes("unsupported")));
  assert.ok(issues.some((issue) => issue.message.includes("invalid visibilityCondition")));
});

test("resolves active role, default, company, then global forms deterministically", () => {
  const rows = [
    { id: "global", active: true, updated_at: "2026-01-01" },
    { id: "company", company_id: "company-1", active: true, updated_at: "2026-01-01" },
    { id: "default", company_id: "company-1", is_default: true, active: true, updated_at: "2025-01-01" },
    { id: "role", company_id: "company-1", role_id: "role-1", active: true, updated_at: "2024-01-01" },
  ];
  assert.equal(resolvePageLayout(rows).id, "role");
  assert.equal(resolvePageLayout(rows.filter((row) => row.id !== "role")).id, "default");
  assert.equal(resolvePageLayout(rows.filter((row) => !["role", "default"].includes(row.id))).id, "company");
});

test("preserves runtime mode definitions, ordering, section moves, widths, and field properties", () => {
  const definition = normalizeFormDefinition({
    purpose: "quick_create",
    sections: [{ id: "a", order: 1 }, { id: "b", order: 0 }],
    components: [
      { id: "email", type: "field", field_key: "email", section_id: "a", order: 2, width: "1/2", label: "Email address", required: true, readOnly: true },
      { id: "name", type: "field", field_key: "name", section_id: "b", order: 0, width: "2/3" },
    ],
  });
  assert.equal(definition.purpose, "quick_create");
  assert.deepEqual(componentsForSection(definition, "a").map((component) => component.field_key), ["email"]);
  assert.equal(definition.components[0].width, "1/2");
  assert.equal(definition.components[0].required, true);
  assert.equal(definition.components[0].readOnly, true);
});
