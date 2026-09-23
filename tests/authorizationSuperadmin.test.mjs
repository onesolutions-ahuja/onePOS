import test from "node:test";
import assert from "node:assert/strict";
import {
  companyAdministrativeAccess,
  isPlatformSuperadmin,
  permissionAllows,
  PLATFORM_DEVELOPER_SUPERADMIN,
} from "../services/authorization.js";

test("Platform Developer Superadmin is the full CRUD platform role", () => {
  assert.equal(PLATFORM_DEVELOPER_SUPERADMIN, "Platform Developer Superadmin");
  assert.equal(isPlatformSuperadmin({ is_superadmin: true }), true);
  assert.equal(permissionAllows({ isSuperadmin: true, requiredPermissions: ["missing.permission"] }), true);
  assert.equal(companyAdministrativeAccess({ isSuperadmin: true }), true);
});

test("ordinary Company Admin does not receive platform superadmin bypass", () => {
  assert.equal(isPlatformSuperadmin({ isSuperadmin: false }), false);
  assert.equal(permissionAllows({ isSuperadmin: false, permissions: [], requiredPermissions: ["platform.database.manage"] }), false);
  assert.equal(companyAdministrativeAccess({ isCompanyAdminRole: true, isSuperadmin: false }), true);
});
