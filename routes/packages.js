import express from "express";

import { comparePackageVersions, provisionPackageMetadata, removePackageMetadata, resolveFeaturePlan, resolvePackagePlan } from "../services/packageRegistry.js";

import { getCompanyEntitlements, isPackageLicensed } from "../services/licensing.js";

import { packageVersionHasEntitlement, reconcileCompanyPackageEntitlements } from "../services/packageEntitlements.js";



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

      package_type: row.package_type,

      visible: row.visible,

      installable: row.installable,

      system_only: row.system_only,

      publication_state: row.publication_state,

      available_tiers: row.available_tiers || [],

      allowed_bundles: row.allowed_bundles || [],

      allowed_companies: row.allowed_companies || [],

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

    const entries = Array.isArray(packageEntries) ? packageEntries : [packageEntries];

    const root = entries[entries.length - 1];

    return isPackageLicensed(entitlements, root);

  }



  async function isMarketplaceEligible(companyId, entry) {

    const allowedCompanies = Array.isArray(entry.allowed_companies) ? entry.allowed_companies : [];

    const allowedBundles = Array.isArray(entry.allowed_bundles) ? entry.allowed_bundles : [];

    const availableTiers = Array.isArray(entry.available_tiers) ? entry.available_tiers : [];

    if (allowedCompanies.length && !allowedCompanies.includes(companyId)) return false;

    if (!allowedBundles.length && !availableTiers.length) return true;

    const result = await db(

      `SELECT

         ($2::text[]='{}' OR EXISTS (

           SELECT 1 FROM company_bundle_assignments a

           JOIN licence_bundles b ON b.id=a.bundle_id

           WHERE a.company_id=$1 AND a.active=true AND b.active=true AND b.bundle_key=ANY($2::text[])

             AND (a.starts_at IS NULL OR a.starts_at<=NOW())

             AND (a.expires_at IS NULL OR a.expires_at>NOW())

         )) AS bundle_allowed,

         ($3::text[]='{}' OR EXISTS (

           SELECT 1 FROM company_bundle_assignments a

           JOIN licence_bundles b ON b.id=a.bundle_id

           WHERE a.company_id=$1 AND a.active=true AND b.active=true AND b.bundle_key=ANY($3::text[])

             AND (a.starts_at IS NULL OR a.starts_at<=NOW())

             AND (a.expires_at IS NULL OR a.expires_at>NOW())

           UNION ALL

           SELECT 1 FROM company_tier_assignments a

           JOIN licence_tiers t ON t.id=a.tier_id

           WHERE a.company_id=$1 AND a.active=true AND t.active=true AND t.tier_key=ANY($3::text[])

             AND (a.starts_at IS NULL OR a.starts_at<=NOW())

             AND (a.expires_at IS NULL OR a.expires_at>NOW())

         )) AS tier_allowed`,

      [companyId, allowedBundles, availableTiers]

    );

    return result.rows[0]?.bundle_allowed === true && result.rows[0]?.tier_allowed === true;

  }



  function packagePlanCompanyAllowed(companyId, plan) {

    return plan.every((entry) => {

      const allowed = Array.isArray(entry.allowed_companies) ? entry.allowed_companies : [];

      return !allowed.length || allowed.includes(companyId);

    });

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



  router.get("/packages/marketplace", authenticate, authorize("package.manage", "settings.manage"), async (req, res) => {

    const result = await db(

      `SELECT p.*, m.module_key

         FROM package_registry p

         LEFT JOIN platform_modules m ON m.id=p.module_id

        WHERE p.active=true AND p.publication_state='PUBLISHED'

          AND p.visible=true AND p.installable=true AND p.system_only=false

          AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))

          AND (cardinality(p.allowed_bundles)=0 OR EXISTS (

            SELECT 1 FROM company_bundle_assignments a

            JOIN licence_bundles b ON b.id=a.bundle_id

            WHERE a.company_id=$1 AND a.active=true AND b.active=true

              AND b.bundle_key=ANY(p.allowed_bundles)

              AND (a.starts_at IS NULL OR a.starts_at<=NOW())

              AND (a.expires_at IS NULL OR a.expires_at>NOW())

          ))

          AND (

            jsonb_array_length(p.available_tiers)=0

            OR EXISTS (

            SELECT 1 FROM company_bundle_assignments a

            JOIN licence_bundles b ON b.id=a.bundle_id

            WHERE a.company_id=$1 AND a.active=true AND b.active=true

              AND (a.starts_at IS NULL OR a.starts_at<=NOW())

              AND (a.expires_at IS NULL OR a.expires_at>NOW())

              AND p.available_tiers ? b.bundle_key

            )

            OR EXISTS (

              SELECT 1 FROM company_tier_assignments a

              JOIN licence_tiers t ON t.id=a.tier_id

              WHERE a.company_id=$1 AND a.active=true AND t.active=true

                AND (a.starts_at IS NULL OR a.starts_at<=NOW())

                AND (a.expires_at IS NULL OR a.expires_at>NOW())

                AND p.available_tiers ? t.tier_key

            )

          )

        ORDER BY p.display_order,p.name`,

      [req.user.companyId]

    );

    res.json({ success: true, data: await packageState(result.rows, req.user.companyId) });

  });



  router.get(["/bundles/marketplace", "/marketplace/bundles"], authenticate, async (req, res) => {

    const result = await db(

      `SELECT b.*,

              COALESCE(jsonb_agg(jsonb_build_object(

                'packageKey',p.package_key,'name',p.name,'entitlementType',bp.entitlement_type,

                'versionRange',bp.version_range

              ) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS packages

         FROM licence_bundles b

         LEFT JOIN licence_bundle_packages bp ON bp.bundle_id=b.id

         LEFT JOIN package_registry p ON p.id=bp.package_id

        WHERE b.active=true AND b.visible=true AND b.installable=true

          AND (cardinality(b.allowed_companies)=0 OR $1=ANY(b.allowed_companies))

          AND (cardinality(b.available_tiers)=0 OR EXISTS (

            SELECT 1 FROM company_tier_assignments a

            JOIN licence_tiers t ON t.id=a.tier_id

            WHERE a.company_id=$1 AND a.active=true AND t.active=true

              AND t.tier_key=ANY(b.available_tiers)

              AND (a.starts_at IS NULL OR a.starts_at<=NOW())

              AND (a.expires_at IS NULL OR a.expires_at>NOW())

          ))

        GROUP BY b.id ORDER BY b.display_order,b.name`,

      [req.user.companyId]

    );

    res.json({ success: true, data: result.rows });

  });



  router.get(["/tiers/marketplace", "/marketplace/tiers"], authenticate, async (req, res) => {

    const result = await db(

      `SELECT t.*,

              COALESCE(jsonb_agg(jsonb_build_object(

                'packageKey',p.package_key,'name',p.name,'entitlementType',tp.entitlement_type,

                'versionRange',tp.version_range

              ) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL),'[]'::jsonb) AS packages

         FROM licence_tiers t

         LEFT JOIN licence_tier_packages tp ON tp.tier_id=t.id

         LEFT JOIN package_registry p ON p.id=tp.package_id

        WHERE t.active=true AND t.visible=true AND t.installable=true

          AND (cardinality(t.allowed_companies)=0 OR $1=ANY(t.allowed_companies))

        GROUP BY t.id ORDER BY t.display_order,t.name`,

      [req.user.companyId]

    );

    res.json({ success: true, data: result.rows });

  });



  async function sendPlan(req, res, packageKey) {

    if (!packageKey) return res.status(400).json({ success: false, message: "packageKey is required" });

    try {

      const plan = await packagePlan(packageKey);

      const requestedFeatures = Array.isArray(req.body?.features) ? req.body.features : [];

      const root = plan[plan.length - 1];

      if (!packagePlanCompanyAllowed(req.user.companyId, plan)) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "A required package is not available to this company" });

      }

      if (!(await isMarketplaceEligible(req.user.companyId, root))) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "This package is not available to this company" });

      }

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



  router.post(["/packages/:packageKey/upgrade", "/platform/packages/:packageKey/upgrade"], ...manage, async (req, res) => {

    const packageKey = req.params.packageKey;

    let failedUpgrade = null;

    try {

      const plan = await packagePlan(packageKey);

      if (!packagePlanCompanyAllowed(req.user.companyId, plan)) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "A required package is not available to this company" });

      }

      if (!(await ensureLicensed(req, plan))) {

        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This package is not licensed for this company" });

      }

      const results = await withTransaction(async (txDb) => {

        await reconcileCompanyPackageEntitlements(txDb, req.user.companyId);

        const upgraded = [];

        for (const item of plan) {

          const packageResult = await txDb(

            `SELECT p.id,p.version,p.module_id,p.manifest,i.version AS installed_version,i.status

               FROM package_registry p

               LEFT JOIN company_package_installations i ON i.package_id=p.id AND i.company_id=$2

              WHERE p.package_key=$1 AND p.active=true`,

            [item.packageKey, req.user.companyId]

          );

          const entry = packageResult.rows[0];

          if (!entry) throw new Error(`Package dependency is unavailable or not installed: ${item.packageKey}`);

          if (!entry.installed_version || entry.status !== "active") {

            throw new Error(`Install required package dependency before upgrading: ${item.packageKey}`);

          }

          if (!(await packageVersionHasEntitlement(txDb, req.user.companyId, item.packageKey, entry.version))) {

            throw new Error(`Package version is outside the active licence or bundle constraint: ${item.packageKey}`);

          }

          const comparison = comparePackageVersions(entry.version, entry.installed_version);

          if (comparison < 0) throw new Error(`Package version downgrade is not supported: ${item.packageKey}`);

          if (comparison === 0) continue;

          failedUpgrade = {

            packageId: entry.id,

            fromVersion: entry.installed_version,

            toVersion: entry.version,

          };

          const history = await txDb(

            `INSERT INTO package_upgrade_history

             (company_id,package_id,from_version,to_version,status,created_by)

             VALUES ($1,$2,$3,$4,'RUNNING',$5) RETURNING id`,

            [req.user.companyId, entry.id, entry.installed_version, entry.version, req.user.id || null]

          );

          await provisionPackageMetadata(txDb, {

            packageId: entry.id,

            moduleId: entry.module_id,

            companyId: req.user.companyId,

            manifest: item.manifest,

            packageVersion: entry.version,

          });

          for (const migration of Array.isArray(item.manifest?.migrations) ? item.manifest.migrations : []) {

            const migrationKey = typeof migration === "string" ? migration : migration?.key;

            if (!migrationKey || !/^[a-zA-Z0-9\_.:-]{1,200}$/.test(migrationKey)) {

              throw new Error(`Invalid migration key for package: ${item.packageKey}`);

            }

            await txDb(

              `INSERT INTO package_installation_versions (company_id,package_id,version,migration_key,applied_by)

               VALUES ($1,$2,$3,$4,$5) ON CONFLICT (company_id,package_id,version,migration_key) DO NOTHING`,

              [req.user.companyId, entry.id, entry.version, migrationKey, req.user.id || null]

            );

          }

          await txDb(

            `UPDATE company_package_installations

                SET version=$1,available_version=$1,last_upgrade_at=NOW(),last_upgrade_state='COMPLETED',updated_at=NOW()

              WHERE company_id=$2 AND package_id=$3`,

            [entry.version, req.user.companyId, entry.id]

          );

          await txDb(

            "UPDATE package_upgrade_history SET status='COMPLETED',completed_at=NOW() WHERE id=$1",

            [history.rows[0].id]

          );

          upgraded.push({ packageKey: item.packageKey, from: entry.installed_version, to: entry.version });

        }

        await reconcileCompanyPackageEntitlements(txDb, req.user.companyId);

        await txDb(

          `INSERT INTO platform_events(company_id,event_type,payload,actor_user_id,idempotency_key)

           VALUES ($1,'package.upgraded',$2::jsonb,$3,$4) ON CONFLICT(company_id,idempotency_key) DO NOTHING`,

          [req.user.companyId, JSON.stringify({ packageKey, upgraded }), req.user.id || null, `package-upgraded:${packageKey}:${upgraded.map((item) => item.to).join(",") || "current"}`]

        );

        return { success: true, data: { packageKey, upgraded } };

      });

      failedUpgrade = null;

      res.json(results);

    } catch (error) {

      if (failedUpgrade) {

        await db(

          `INSERT INTO package_upgrade_history

           (company_id,package_id,from_version,to_version,status,error_text,completed_at,created_by)

           VALUES ($1,$2,$3,$4,'FAILED',$5,NOW(),$6)`,

          [req.user.companyId, failedUpgrade.packageId, failedUpgrade.fromVersion, failedUpgrade.toVersion, String(error.message || error).slice(0, 2000), req.user.id || null]

        ).catch((historyError) => console.error("Package upgrade failure history write failed:", historyError.message));

      }

      console.error("Package upgrade error:", error);

      res.status(400).json({ success: false, message: error.message || "Package upgrade failed" });

    }

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

      if (!packagePlanCompanyAllowed(req.user.companyId, plan)) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "A required package is not available to this company" });

      }

      if (!(await isMarketplaceEligible(req.user.companyId, root))) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "This package is not available to this company" });

      }

      const selectedFeatures = resolveFeaturePlan(root, requestedFeatures);

      if (!(await ensureLicensed(req, plan))) {

        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This package is not licensed for this company" });

      }

      const response = await withTransaction(async (txDb) => {

        await reconcileCompanyPackageEntitlements(txDb, req.user.companyId);

        const rootPackageResult = await txDb(

          "SELECT id,version FROM package_registry WHERE package_key=$1 AND active=true",

          [root.packageKey]

        );

        if (!rootPackageResult.rows.length) throw new Error(`Package not found: ${root.packageKey}`);

        const rootPackageId = rootPackageResult.rows[0].id;

        for (const item of plan) {

          const moduleResult = await txDb("SELECT id FROM platform_modules WHERE module_key=$1", [item.moduleKey]);

          if (!moduleResult.rows.length) throw new Error(`Package module is not registered: ${item.moduleKey}`);

          const packageResult = await txDb(
            `SELECT id,version,installable FROM package_registry WHERE package_key=$1 AND active=true`,
            [item.packageKey]
          );
          if (!packageResult.rows.length) {
            throw new Error(`Package not found: ${item.packageKey}`);
          }

          if (packageResult.rows[0].installable === false) {
            throw new Error(`Package is not installable: ${item.packageKey}`);
          }

          if (
            item.packageKey === root.packageKey &&
            (
              item.installable === false ||
              item.visible === false ||
              item.system_only === true ||
              (item.publication_state && item.publication_state !== "PUBLISHED")
            )
          ) {
            throw new Error(`Package is not available for direct installation: ${item.packageKey}`);
          }

          if (
            !(await packageVersionHasEntitlement(
              txDb,
              req.user.companyId,
              item.packageKey,
              packageResult.rows[0].version
            ))
          ) {
            throw new Error(
              `Package version is outside the active licence or bundle constraint: ${item.packageKey}`
            );
          }

          await provisionPackageMetadata(txDb, {

            packageId: packageResult.rows[0].id,

            moduleId: moduleResult.rows[0].id,

            companyId: req.user.companyId,

            manifest: item.manifest,

            packageVersion: packageResult.rows[0].version,

          });

          await txDb(

          `INSERT INTO company_package_installations (company_id,package_id,version,status,installed_by,selected_features)

           VALUES ($1,$2,$3,'active',$4,$5::jsonb)

           ON CONFLICT (company_id,package_id) DO UPDATE SET status='active',

             selected_features=CASE WHEN EXCLUDED.version = company_package_installations.version THEN EXCLUDED.selected_features ELSE COALESCE(company_package_installations.selected_features,'[]'::jsonb) END,

             installed_by=COALESCE(EXCLUDED.installed_by,company_package_installations.installed_by),

             installation_type=CASE WHEN $6='DIRECT' THEN 'DIRECT' ELSE company_package_installations.installation_type END,
             available_version=CASE WHEN $6='DIRECT' THEN EXCLUDED.version ELSE company_package_installations.available_version END,
             suspended_by_entitlement=false,
             deactivated_by_user=false,
             updated_at=NOW()`,

          [

            req.user.companyId,

            packageResult.rows[0].id,

            packageResult.rows[0].version,

            req.user.id || null,

            JSON.stringify(item === root ? selectedFeatures.map((feature) => feature.key) : []),

            item === root ? "DIRECT" : "DEPENDENCY",

          ]

          );

          await txDb(

            `INSERT INTO company_package_entitlement_sources

             (company_id,package_id,source_type,source_key,parent_package_id,active,metadata)

             VALUES ($1,$2,$3,$4,$5,true,$6::jsonb)

             ON CONFLICT (company_id,package_id,source_type,source_key)

             DO UPDATE SET active=true,metadata=EXCLUDED.metadata,expires_at=NULL`,

            [

              req.user.companyId,

              packageResult.rows[0].id,

              item.packageKey === root.packageKey

                ? (item.manifest?.licenceMode === "TECHNICAL" || item.manifest?.packageType === "FOUNDATION"

                  ? "DIRECT_INSTALL"

                  : "DIRECT_LICENCE")

                : "REQUIRED_DEPENDENCY",

              String(rootPackageId),

              item.packageKey === root.packageKey ? null : rootPackageId,

              JSON.stringify({ rootPackageKey: root.packageKey }),

            ]

          );

          const migrations = Array.isArray(item.manifest?.migrations) ? item.manifest.migrations : [];

          for (const migration of migrations) {

            const migrationKey = typeof migration === "string" ? migration : migration?.key;

            if (!migrationKey || !/^[a-zA-Z0-9\_.:-]{1,200}$/.test(migrationKey)) {

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

        await reconcileCompanyPackageEntitlements(txDb, req.user.companyId);

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

         WHERE target.package_key=$1 AND i.company_id=$2 AND i.status='active' AND d.optional=false`,

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

        `UPDATE company_package_installations i

            SET status='inactive',deactivated_by_user=true,suspended_by_entitlement=false,updated_at=NOW()

         FROM package_registry p WHERE p.id=i.package_id AND p.package_key=$1 AND i.company_id=$2 RETURNING i.*`,

        [packageKey, req.user.companyId]

      );

      if (!result.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });

      await reconcileCompanyPackageEntitlements(db, req.user.companyId);

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



  router.post(["/packages/:packageKey/reactivate", "/platform/packages/:packageKey/reactivate"], ...manage, async (req, res) => {

    const packageKey = req.params.packageKey;

    try {

      const plan = await packagePlan(packageKey);

      if (!packagePlanCompanyAllowed(req.user.companyId, plan)) {

        return res.status(403).json({ success: false, code: "PACKAGE_NOT_AVAILABLE", message: "A required package is not available to this company" });

      }

      if (!(await ensureLicensed(req, plan))) {

        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This package is not licensed for this company" });

      }

      const result = await db(

        `UPDATE company_package_installations i

            SET status='active',deactivated_by_user=false,suspended_by_entitlement=false,updated_at=NOW()

           FROM package_registry p

          WHERE i.package_id=p.id AND p.package_key=$1 AND i.company_id=$2

          RETURNING i.*`,

        [packageKey, req.user.companyId]

      );

      if (!result.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });

      await reconcileCompanyPackageEntitlements(db, req.user.companyId);

      await db(

        `UPDATE platform_module_access a SET enabled=true,updated_at=NOW()

           FROM package_registry p

          WHERE p.package_key=$1 AND a.module_id=p.module_id

            AND a.company_id=$2 AND a.store_id IS NULL`,

        [packageKey, req.user.companyId]

      );

      res.json({ success: true, data: result.rows[0] });

    } catch (error) {

      console.error("Package reactivation error:", error);

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

      // Data safety comes before metadata cleanup. A package may only be

      // uninstalled when every package-owned object is empty for this tenant.

      // This keeps AppExchange-style uninstall from orphaning business records.

      const packageObjects = await db(

        `SELECT object_key, source_table FROM platform_objects

         WHERE package_id=$1 AND (company_id IS NULL OR company_id=$2)`,

        [packageResult.rows[0].id, req.user.companyId]

      );

      const nonEmptyObjects = [];

      for (const object of packageObjects.rows) {

        const table = String(object.source_table || "").trim();

        if (!/^[a-z\_][a-z0-9\_]*$/i.test(table)) continue;

        const columns = await db(

          `SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1`,

          [table]

        );

        const names = new Set(columns.rows.map((row) => row.column_name));

        const scoped = names.has("company_id");

        const countResult = await db(

          `SELECT COUNT(*)::int AS count FROM "${table}"${scoped ? " WHERE company_id=$1" : ""}`,

          scoped ? [req.user.companyId] : []

        );

        const count = Number(countResult.rows[0]?.count || 0);

        if (count > 0) nonEmptyObjects.push({ objectKey: object.object_key, table, count });

      }

      if (nonEmptyObjects.length) {

        return res.status(409).json({

          success: false,

          code: "PACKAGE_RECORDS_EXIST",

          message: "Package cannot be uninstalled while package-owned records exist. Deactivate it instead or remove/archive the records first.",

          objects: nonEmptyObjects,

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

        `UPDATE company_package_installations i

            SET status='inactive',deactivated_by_user=true,suspended_by_entitlement=false,updated_at=NOW()

           FROM package_registry p

          WHERE i.package_id=p.id AND p.package_key=$1 AND i.company_id=$2

          RETURNING i.*`,

        [packageKey, req.user.companyId]

      );

      if (!result.rows.length) return res.status(404).json({ success: false, message: "Package is not installed for this company" });

      await removePackageMetadata(db, {

        companyId: req.user.companyId,

        packageId: result.rows[0].package_id,

      });

      await db(

        `DELETE FROM company_package_entitlement_sources

          WHERE company_id=$1 AND package_id=$2 AND source_type='DIRECT_INSTALL'`,

        [req.user.companyId, result.rows[0].package_id]

      );

      await reconcileCompanyPackageEntitlements(db, req.user.companyId);

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
