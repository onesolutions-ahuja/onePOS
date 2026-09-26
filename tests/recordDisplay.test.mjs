import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRecordDisplayValue,
  getRecordDisplayTitle,
  isTechnicalRecordField,
  isUuid,
  parseBooleanValue,
} from "../src/utils/recordDisplay.js";
import fs from "node:fs";

const read = (relativePath) => fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("technical IDs are hidden while human business identifiers remain available", () => {
  const uuid = "8d0cc9b4-7861-4a8c-96f8-a35c5fe7b122";
  assert.equal(isUuid(uuid), true);
  assert.equal(isTechnicalRecordField({ api_name: "record_uuid" }), true);
  assert.equal(isTechnicalRecordField({ api_name: "reference_number" }), false);
  assert.equal(getRecordDisplayTitle({ id: uuid, name: uuid, reference_number: "INV-0042" }), "INV-0042");
  assert.equal(getRecordDisplayTitle({ id: uuid }), "Record");
  assert.equal(formatRecordDisplayValue(uuid, { type: "text" }), "—");
});

test("boolean and metadata-backed record values are formatted safely", () => {
  assert.equal(parseBooleanValue("false"), false);
  assert.equal(parseBooleanValue("0"), false);
  assert.equal(parseBooleanValue("yes"), true);
  assert.equal(formatRecordDisplayValue("false", { type: "boolean", label: "Active" }), "Inactive");
  assert.equal(formatRecordDisplayValue("true", { type: "boolean", label: "Credit Enabled" }), "Enabled");
  assert.equal(formatRecordDisplayValue({ id: "8d0cc9b4-7861-4a8c-96f8-a35c5fe7b122" }, { type: "lookup" }), "—");
  assert.equal(formatRecordDisplayValue({ id: "8d0cc9b4-7861-4a8c-96f8-a35c5fe7b122", name: "North Store" }, { type: "lookup" }), "North Store");
  assert.equal(
    formatRecordDisplayValue(12.5, { type: "currency", currency_code: "GBP" }),
    new Intl.NumberFormat(undefined, { style: "currency", currency: "GBP" }).format(12.5),
  );
});

test("canonical record screens keep View static and separate from Create/Edit", () => {
  const detail = read("../src/pages/settings/Platform/ObjectRecordDetail.jsx");
  const renderer = read("../src/pages/settings/Platform/FormRenderer.jsx");
  const form = read("../src/pages/settings/Platform/ObjectForm.jsx");
  const modal = read("../src/components/RecordModal.jsx");
  const sharedViewModal = read("../src/components/platform/StandardObjectViewModal.jsx");

  assert.match(detail, /getRecordDisplayTitle\(record\)/);
  assert.doesNotMatch(detail, /ID:\s*\{String\(recordIdentifier\)\}/);
  assert.match(detail, /isTechnicalRecordField\(field\)/);
  assert.match(renderer, /mode === "create" \|\| mode === "edit" \|\| mode === "quick_create"/);
  assert.match(renderer, /mode="display"/);
  assert.match(form, /readOnly \|\| field\.writable === false/);
  assert.match(form, /parseBooleanValue\(value\)/);
  assert.match(modal, /isUuid\(title\) \? "Record" : title/);
  assert.match(sharedViewModal, /footerStart=\{onEdit/);
  assert.match(sharedViewModal, /showHeader=\{false\}/);
});
