import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("authenticated company DB context is wired into representative business route registration", () => {
  for (const routeFactory of [
    "createProductsRouter",
    "createCustomersRouter",
    "createInventoryRouter",
    "createReportsRouter",
    "createPlatformRouter",
  ]) {
    const start = serverSource.lastIndexOf(`${routeFactory}({`);
    assert.notEqual(start, -1, `${routeFactory} must be registered`);
    const block = serverSource.slice(start, start + 500);
    assert.match(block, /\bdb\b/, `${routeFactory} must receive the shared request-aware db helper`);
  }
});

test("Sales uses the resolved request pool for its transaction client", () => {
  assert.match(serverSource, /createSalesRouter\(\{[\s\S]*requestPool:\s*getRequestPool/);
  const salesSource = readFileSync(new URL("../routes/sales.js", import.meta.url), "utf8");
  assert.match(salesSource, /const transactionPool = .*requestPool\(req\).*req\.tenantPool.*pool/);
  assert.match(salesSource, /const db = \(query, params = \[\]\) => client\.query\(query, params\)/);
});
