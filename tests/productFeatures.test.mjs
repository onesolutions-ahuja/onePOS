import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateModifierTotal,
  expandBundleComponents,
  normaliseVariantAttributes,
  validateBundleComponents,
  variantIdentity,
} from "../services/productFeatures.js";

test("variants use flexible, stable attribute identity", () => {
  const attributes = normaliseVariantAttributes({ Colour: "Red", Size: "Small" });
  assert.deepEqual(attributes, { Colour: "Red", Size: "Small" });
  assert.equal(
    variantIdentity({ Size: "Small", Colour: "Red" }),
    variantIdentity({ Colour: "Red", Size: "Small" })
  );
});

test("variant attributes support size, colour and additional attributes", () => {
  assert.equal(
    variantIdentity({ Size: "Medium", Colour: "Blue", Material: "Cotton" }),
    '{"Colour":"Blue","Material":"Cotton","Size":"Medium"}'
  );
});

test("ordinary products remain valid without variant attributes", () => {
  assert.deepEqual(normaliseVariantAttributes(null), {});
  assert.equal(variantIdentity(undefined), "{}");
});

test("modifier pricing includes free, fixed and quantity-based options", () => {
  assert.equal(calculateModifierTotal([
    { price: 0, quantity: 1 },
    { price: 1, quantity: 1 },
    { price: 2, quantity: 2 },
  ]), 5);
});

test("bundle expansion respects component quantities and bundle quantity", () => {
  assert.deepEqual(expandBundleComponents(2, [
    { productId: "a", quantity: 1 },
    { productId: "b", quantity: 2 },
  ]), [
    { productId: "a", quantity: 2 },
    { productId: "b", quantity: 4 },
  ]);
});

test("bundle definitions reject self references, duplicates and invalid quantities", () => {
  assert.equal(validateBundleComponents("bundle", [
    { productId: "bundle", quantity: 1 },
  ]).valid, false);
  assert.equal(validateBundleComponents("bundle", [
    { productId: "a", quantity: 1 },
    { productId: "a", quantity: 1 },
  ]).valid, false);
  assert.equal(validateBundleComponents("bundle", [
    { productId: "a", quantity: 0 },
  ]).valid, false);
});
