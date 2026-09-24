import test from "node:test";
import assert from "node:assert/strict";
import { BUTTON_VARIANTS, normalizeButtonDefinition, validateButtonDefinition } from "../services/platformButtonRegistry.js";

test("custom button exposes the six canonical visual variants", () => {
  assert.deepEqual(BUTTON_VARIANTS.map((item) => item.key), ["primary", "secondary", "outline", "destructive", "icon", "icon_label"]);
});

test("custom button binds to a registered action with record-path inputs", () => {
  const button = validateButtonDefinition({
    buttonKey: "refund_sale",
    label: "Refund",
    variant: "destructive",
    targetType: "action",
    targetKey: "payment.refund.allocate",
    requiredPermission: "sale.refund",
    inputMappings: { customerId: { path: "sale.customer.id" }, email: { path: "sale.customer.email" } },
    visibilityRule: { path: "sale.status", operator: "equals", value: "COMPLETED" },
  });
  assert.equal(button.targetType, "action");
  assert.equal(button.inputMappings.email.path, "sale.customer.email");
  assert.equal(button.requiredPermission, "sale.refund");
});

test("custom button can target a workflow and rejects arbitrary target types", () => {
  assert.equal(normalizeButtonDefinition({ buttonKey: "approve", label: "Approve", targetType: "workflow", targetKey: "abc" }).targetType, "workflow");
  assert.throws(() => validateButtonDefinition({ buttonKey: "bad", label: "Bad", targetType: "javascript", targetKey: "alert(1)" }), /action or workflow/);
});
