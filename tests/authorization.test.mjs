import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { permissionAllows } from "../services/authorization.js";

test("Superadmin bypasses a normal permission-protected feature", () => {
  assert.equal(
    permissionAllows({ isSuperadmin: true, permissions: [], requiredPermissions: ["inventory.view"] }),
    true
  );
});

test("normal users require the relevant permission", () => {
  assert.equal(
    permissionAllows({ permissions: ["inventory.view"], requiredPermissions: ["inventory.view"] }),
    true
  );
  assert.equal(
    permissionAllows({ permissions: [], requiredPermissions: ["inventory.view"] }),
    false
  );
});

test("a genuinely Superadmin-only route remains explicitly guarded", () => {
  const source = fs.readFileSync(new URL("../routes/superadmin.js", import.meta.url), "utf8");
  assert.match(source, /Superadmin access required/);
  assert.match(source, /is_superadmin/);
  assert.match(source, /router\.use\("\/superadmin", authenticate, requireSuperadmin\)/);
});

test("the device server/API settings remain Superadmin-only in the frontend", () => {
  const source = fs.readFileSync(new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url), "utf8");
  assert.ok(source.includes('section !== "Server / API Configuration" || isSuperadmin'));
  assert.ok(source.includes('tab === "Server / API Configuration" && isSuperadmin'));
});

test("Business Division routes use normal view/manage permissions", () => {
  const source = fs.readFileSync(new URL("../routes/businessDivisions.js", import.meta.url), "utf8");
  assert.match(source, /authorize\("business_division\.view"\)/);
  assert.match(source, /authorize\("business_division\.manage"\)/);
  assert.doesNotMatch(source, /Superadmin access required/);
});

test("Business Division view and manage permissions are independently evaluated", () => {
  assert.equal(
    permissionAllows({ permissions: ["business_division.view"], requiredPermissions: ["business_division.view"] }),
    true
  );
  assert.equal(
    permissionAllows({ permissions: ["business_division.view"], requiredPermissions: ["business_division.manage"] }),
    false
  );
  assert.equal(
    permissionAllows({ permissions: ["business_division.manage"], requiredPermissions: ["business_division.manage"] }),
    true
  );
});
