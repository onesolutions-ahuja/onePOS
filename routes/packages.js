import express from "express";
import { provisionPackageMetadata, resolveFeaturePlan, resolvePackagePlan } from "../services/packageRegistry.js";
import { getCompanyEntitlements, isPackageLicensed } from "../services/licensing.js";

function operationKey(req) {
  const value = req.get("Idempotency-Key") || req.body?.idempotencyKey;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

export default function createPackagesRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();
  const manage = [authenticate, authorize("package.manage", "settings.manage")];

  async function registry(dbCall) {
    const result = await dbCall(
      `SELECT p.*, m.module_key, m.installed AS module_installed
       FROM package_registry p LEFT JOIN platform_modules m ON m.id=p.module_id
       WHERE p.active=true ORDER BY p.name`
    );
    return result.rows;
  }

  async function packagePlan(packageKey) {
    const rows = await registry(db);
    const definitions = rows.map((row) => ({
      packageKey: row.package_key,
      name: row.name,
      version: row.version,
      description: row.description,
      moduleKey: row.module_key,
      dependencies: row.manifest?.dependencies || [],
      manifest: row.manifest || {},
    }));
    return resolvePackagePlan(packageKey, definitions);
  }

  async function packageState(packageRows, companyId) {
    const installed = await db(
      `SELECT i.package_id, i.version, i.status, i.selected_features
       FROM company_package_installations i
       JOIN package_registry p ON p.id=i.package_id
       WHERE i.company_id=$1`,
      [companyId]
    );
    const state = new Map(installed.rows.map((row) => [row.package_id, row]));
    return packageRows.map((row) => ({ ...row, company_installation: state.get(row.id) || null }));
  }

  async function ensureLicensed(req, packageEntries) {
    const entitlements = await getCompanyEntitlements(db, req.user.companyId);
    return (Array.isArray(packageEntries) ? packageEntries : [packageEntries])
      .every((entry) => isPackageLicensed(entitlements, entry));
  }

  async function replay(req, operation, packageKey) {
    const key = operationKey(req);
    if (!key) return null;
    const result = await db(
      "SELECT response FROM package_installation_operations WHERE company_id=$1 AND idempotency_key=$2 AND operation=$3 AND package_key=$4",
      [req.user.companyId, key, operation, packageKey]
    );
    return result.rows[0]?.response || null;
  }

  async function recordOperation(req, operation, packageKey, response) {
    const key = operationKey(req);
    if (!key) return;
    await db(
      `INSERT INTO package_installation_operations
       (company_id,idempotency_key,operation,package_key,status,response)
       VALUES ($1,$2,$3,$4,'completed',$5::jsonb)
       ON CONFLICT (company_id,idempotency_key,operation,package_key) DO NOTHING`,
      [req.user.companyId, key, operation, packageKey, JSON.stringify(response)]
    );
  }

  async function withTransaction(work) {
    if (!pool?.connect) return work(db);
    const client = await pool.connect();
    const txDb = (query, params = []) => client.query(query, params);
    try {
      await txDb("BEGIN");
      const result = await work(txDb);
      await txDb("COMMIT");
      return result;
    } catch (error) {
      try {
        await txDb("ROLLBACK");
      } catch (rollbackError) {
        console.error("Package transaction rollback failed:", rollbackError);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  router.get(["/packages", "/platform/packages"], ...manage, async (req, res) => {
    const rows = await registry(db);
    res.json({ success: true, data: await packageState(rows, req.user.companyId) });
  });

  async function sendPlan(req, res, packageKey) {
    if (!packageKey) return res.status(400).json({ success: false, message: "packageKey is required" });
    try {
      const plan = await packagePlan(packageKey);
      const requestedFeatures = Array.isArray(req.body?.features) ? req.body.features : [];
      const root = plan[plan.length - 1];
      const selectedFeatures = resolveFeaturePlan(root, requestedFeatures);
      if (!(await ensureLicensed(req, plan))) {
        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This package is not licensed for this company" });
      }
      res.json({ success: true, data: { packageKey, packages: plan, features: selectedFeatures.map((feature) => feature.key) } });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  router.post(["/packages/plan", "/platform/packages/plan"], ...manage, async (req, res) => {
    return sendPlan(req, res, String(req.body?.packageKey || req.body?.package_key || "").trim());
  });

  router.get(["/packages/:packageKey/plan", "/platform/packages/:packageKey/plan"], ...manage, async (req, res) => {
    return sendPlan(req, res, req.params.packageKey);
  });

  router.post(["/packages/:packageKey/install", "/platform/packages/:packageKey/install"], ...manage, async (req, res) => {
    const packageKey = req.params.packageKey;
    try {
      const prior = await replay(req, "install", packageKey);
      if (prior) return res.json(prior);
      const plan = await packagePlan(packageKey);
      const requestedFeatures = Array.isArray(req.body?.features) ? req.body.features : [];
      const storeId = req.body?.storeId || req.body?.store_id || null;
      if (storeId) {
        const store = await db(
          "SELECT id FROM stores WHERE id=$1 AND company_id=$2 AND active=true",
          [storeId, req.user.companyId]
        );
        if (!store.rows.length) {
          return res.status(400).json({ success: false, message: "Store is not available to this company" });
        }
      }
      const root = plan[plan.length - 1];
      const selectedFeatures = resolveFeaturePlan(root, requestedFeatures);
      if (!(await ensureLicensed(req, plan))) {
        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This package is not licensed for this company" });
      }
      const response = await withTransaction(async (txDb) => {
        for (const item of plan) {
          const moduleResult = await txDb("SELECT id FROM platform_modules WHERE module_key=$1", [item.moduleKey]);
          if (!moduleResult.rows.length) throw new Error(`Package module is not registered: ${item.moduleKey}`);
          const packageResult = await txDb("SELECT id,version FROM package_registry WHERE package_key=$1 AND active=true", [item.packageKey]);
          if (!packageResult.rows.length) throw new Error(`Package not found: ${item.packageKey}`);
          await provisionPackageMetadata(txDb, {
            packageId: packageResult.rows[0].id,
            moduleId: moduleResult.rows[0].id,
            companyId: req.user.companyId,
            manifest: item.manifest,
          });
          await txDb(
          `INSERT INTO company_package_installations (company_id,package_id,version,status,installed_by,selected_features)
           VALUES ($1,$2,$3,'active',$4,$5::jsonb)
           ON CONFLICT (company_id,package_id) DO UPDATE SET version=EXCLUDED.version,status='active',selected_features=EXCLUDED.selected_features,installed_by=EXCLUDED.installed_by,updated_at=NOW()`,
          [req.user.companyId, packageResult.rows[0].id, packageResult.rows[0].version, req.user.id || null, JSON.stringify(item === root ? selectedFeatures.map((feature) => feature.key) : [])]
          );
          const migrations = Array.isArray(item.manifest?.migrations) ? item.manifest.migrations : [];
          for (const migration of migrations) {
            const migrationKey = typeof migration === "string" ? migration : migration?.key;
            if (!migrationKey || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(migrationKey)) {
              throw new Error(`Invalid migration key for package: ${item.packageKey}`);
            }
            await txDb(
              `INSERT INTO package_installation_versions
               (company_id,package_id,version,migration_key,applied_by)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (company_id,package_id,version,migration_key) DO NOTHING`,
              [req.user.companyId, packageResult.rows[0].id, packageResult.rows[0].version, migrationKey, req.user.id || null]
            );
          }
          await txDb(
          `UPDATE platform_module_access SET enabled=true,updated_at=NOW()
           WHERE module_id=$1 AND company_id=$2 AND store_id IS NOT DISTINCT FROM $3`,
          [moduleResult.rows[0].id, req.user.companyId, storeId]
          );
          const access = await txDb(
          "SELECT id FROM platform_module_access WHERE module_id=$1 AND company_id=$2 AND store_id IS NOT DISTINCT FROM $3",
          [moduleResult.rows[0].id, req.user.companyId, storeId]
          );
          if (!access.rows.length) {
            await txDb(
            `INSERT INTO platform_module_access (module_id,company_id,store_id,enabled)
             VALUES ($1,$2,$3,true)`,
            [moduleResult.rows[0].id, req.user.companyId, storeId]
            );
          }
        }
        return { success: true, data: { packageKey, storeId, installed: plan.map((item) => item.packageKey), features: selectedFeatures.map((feature) => feature.key) } };
      });
      await recordOperation(req, "install", packageKey, response);
      res.json(response);
    } catch (error) {
      console.error("Package install error:", error);
      res.status(400).json({ success: false, message: error.message });
    }
  });

  router.post(["/packages/:packageKey/deactivate", "/platform/packages/:packageKey/deactivate"], ...manage, async (req, res) => {
    const packageKey = req.params.packageKey;
    try {
      const prior = await replay(req, "deactivate", packageKey);
      if (prior) return res.json(prior);
      const dependents = await db(
        `SELECT p.package_key FROM company_package_installations i
         JOIN package_dependencies d ON d.package_id=i.package_id
         JOIN package_registry p ON p.id=i.package_id
         JOIN package_registry target ON target.id=d.dependency_id
         WHERE target.package_key=$1 AND i.company_id=$2 AND i.status='active'`,
        [packageKey, req.user.companyId]
      );
      if (dependents.rows.length) {
        return res.status(409).json({
          success: false,
          message: "Package is required by an installed package",
          dependents: dependents.rows.map((row) => row.package_key),
        });
      }
      const result = await db(
        `UPDATE company_package_installations i SET status='inactive',updated_at=NOW()
         FROM package_registry p WHERE p.id=i.package_id AND p.package_key=$1 AND i.company_id=$2 RETURNING i.*`,
        [packageKey, req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });
      await db(
        `UPDATE platform_module_access a SET enabled=false,updated_at=NOW()
         FROM package_registry p
         WHERE p.package_key=$1 AND a.module_id=p.module_id AND a.company_id=$2 AND a.store_id IS NULL`,
        [packageKey, req.user.companyId]
      );
      const response = { success: true, data: result.rows[0] };
      await recordOperation(req, "deactivate", packageKey, response);
      res.json(response);
    } catch (error) {
      console.error("Package deactivation error:", error);
      res.status(400).json({ success: false, message: error.message });
    }
  });

  router.post(["/packages/:packageKey/uninstall", "/platform/packages/:packageKey/uninstall"], ...manage, async (req, res) => {
    const packageKey = req.params.packageKey;
    try {
      const prior = await replay(req, "uninstall", packageKey);
      if (prior) return res.json(prior);
      const packageResult = await db("SELECT id FROM package_registry WHERE package_key=$1 AND active=true", [packageKey]);
      if (!packageResult.rows.length) return res.status(404).json({ success: false, message: "Package not found" });
      // Uninstall is destructive: callers must explicitly disable a package
      // first, so an accidental uninstall cannot remove an active capability.
      const installation = await db(
        `SELECT status FROM company_package_installations
         WHERE package_id=$1 AND company_id=$2`,
        [packageResult.rows[0].id, req.user.companyId]
      );
      if (!installation.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });
      if (installation.rows[0].status === "active") {
        return res.status(409).json({ success: false, code: "PACKAGE_ACTIVE", message: "Package must be deactivated before uninstalling" });
      }
      const dependents = await db(
        `SELECT p.package_key FROM company_package_installations i
         JOIN package_dependencies d ON d.package_id=i.package_id
         JOIN package_registry p ON p.id=i.package_id
         WHERE d.dependency_id=$1 AND i.company_id=$2 AND i.status='active'`,
        [packageResult.rows[0].id, req.user.companyId]
      );
      if (dependents.rows.length) return res.status(409).json({ success: false, message: "Package is required by an installed package", dependents: dependents.rows.map((row) => row.package_key) });
      const ownedMetadata = await db(
        `SELECT COUNT(*)::int AS count
         FROM platform_objects
         WHERE package_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true`,
        [packageResult.rows[0].id, req.user.companyId]
      );
      if (Number(ownedMetadata.rows[0]?.count || 0) > 0) {
        return res.status(409).json({
          success: false,
          code: "PACKAGE_METADATA_REMAINS",
          message: "Package-owned Platform metadata must be deactivated or removed before uninstalling",
          metadataCount: Number(ownedMetadata.rows[0].count),
        });
      }
      const crossPackageReferences = await db(
        `SELECT DISTINCT sourcePackage.package_key AS source_package_key
         FROM platform_relationships r
         JOIN platform_objects source ON source.id=r.parent_object_id
         JOIN platform_objects target ON target.id=r.child_object_id
         JOIN package_registry sourcePackage ON sourcePackage.id=source.package_id
         WHERE target.package_id=$1
           AND source.package_id IS NOT NULL
           AND source.package_id<>$1
           AND r.active=true
           AND (source.company_id IS NULL OR source.company_id=$2)
           AND (target.company_id IS NULL OR target.company_id=$2)`,
        [packageResult.rows[0].id, req.user.companyId]
      );
      if (crossPackageReferences.rows.length) {
        return res.status(409).json({
          success: false,
          code: "PACKAGE_REFERENCED",
          message: "Package metadata is referenced by another installed package",
          dependents: crossPackageReferences.rows.map((row) => row.source_package_key),
        });
      }
      const enabledAccess = await db(
        `SELECT COUNT(*)::int AS count
         FROM platform_module_access a
         JOIN package_registry p ON p.module_id=a.module_id
         WHERE p.id=$1 AND a.company_id=$2 AND a.enabled=true`,
        [packageResult.rows[0].id, req.user.companyId]
      );
      if (Number(enabledAccess.rows[0]?.count || 0) > 0) {
        return res.status(409).json({
          success: false,
          code: "PACKAGE_ACCESS_REMAINS",
          message: "Package module access must be disabled before uninstalling",
        });
      }
      const result = await db(
        `DELETE FROM company_package_installations i USING package_registry p
         WHERE i.package_id=p.id AND p.package_key=$1 AND i.company_id=$2 RETURNING i.*`,
        [packageKey, req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });
      await db(
        `UPDATE platform_module_access a SET enabled=false,updated_at=NOW()
         FROM package_registry p
         WHERE p.package_key=$1 AND a.module_id=p.module_id AND a.company_id=$2 AND a.store_id IS NULL`,
        [packageKey, req.user.companyId]
      );
      const response = { success: true, data: result.rows[0] };
      await recordOperation(req, "uninstall", packageKey, response);
      res.json(response);
    } catch (error) {
      console.error("Package uninstall error:", error);
      res.status(400).json({ success: false, message: error.message });
    }
  });

  return router;
}
