import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordPathCatalog, resolveRecordPathValue } from "../services/platformRecordPaths.js";

test("record path catalog exposes inverse lookup relationships as dotted object paths", () => {
  const metadata = {
    objects: [
      { id: "customer", object_key: "customer", active: true },
      { id: "sale", object_key: "sale", active: true },
    ],
    fields: [
      { id: "sale-customer", object_id: "sale", api_name: "customer_id", label: "Customer", field_type: "lookup", active: true },
      { id: "customer-email", object_id: "customer", api_name: "email", label: "Email", field_type: "email", active: true },
    ],
    relationships: [
      { id: "customer-sales", parent_object_id: "customer", child_object_id: "sale", relationship_key: "transactions", relationship_type: "one_to_many", child_field_id: "sale-customer", active: true },
    ],
  };
  const paths = buildRecordPathCatalog(metadata, "sale", 2).map((item) => item.path);
  assert.ok(paths.includes("sale.customer.email"));
  assert.equal(resolveRecordPathValue({ customer: { email: "a@b.test" } }, "sale.customer.email", "sale"), "a@b.test");
});
