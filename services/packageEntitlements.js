import { provisionPackageMetadata, satisfiesPackageVersion } from "./packageRegistry.js";

const DERIVED_SOURCES = [
  "DIRECT_LICENCE",
  "BUNDLE",
  "TIER",
  "REQUIRED_DEPENDENCY",
  "OPTIONAL_DEPENDENCY",
  "PLATFORM_DEFAULT",
];

function validCompanyId(companyId) {
  if (!companyId) throw new Error("A company is required to reconcile package entitlements");
}

async function deactivateIncompatibleSources(db, companyId) {
  const result = await db(
    `SELECT s.id,p.version,s.metadata
       FROM company_package_entitlement_sources s
       JOIN package_registry p ON p.id=s.package_id
      WHERE s.company_id=$1 AND s.active=true
        AND (s.starts_at IS NULL OR s.starts_at<=NOW())
        AND (s.expires_at IS NULL OR s.expires_at>NOW())`,
    [companyId]
  );
  for (const source of result.rows) {
    const metadata = source.metadata || {};
    const constraints = [
      metadata.minVersion && `>=${metadata.minVersion}`,
      metadata.maxVersion && `<=${metadata.maxVersion}`,
      metadata.versionRange,
    ].filter(Boolean);
    if (constraints.length && !satisfiesPackageVersion(source.version, constraints.join(" "))) {
      await db(
        `UPDATE company_package_entitlement_sources
            SET active=false,metadata=metadata || jsonb_build_object('versionConstraintFailed',true)
          WHERE id=$1`,
        [source.id]
      );
    }
  }
}

async function insertDependencySources(db, companyId) {
  await db(
    `WITH RECURSIVE roots AS (
       SELECT s.package_id AS root_package_id,s.source_type AS root_source_type,
              s.source_key AS root_source_key,s.starts_at,s.expires_at,
              ARRAY[s.package_id]::uuid[] AS path,0 AS depth
         FROM company_package_installations i
         JOIN company_package_entitlement_sources s
           ON s.company_id=i.company_id AND s.package_id=i.package_id
        WHERE i.company_id=$1 AND i.status='active' AND i.deactivated_by_user=false
          AND s.active=true
          AND (s.starts_at IS NULL OR s.starts_at<=NOW())
          AND (s.expires_at IS NULL OR s.expires_at>NOW())
     ), dependency_tree AS (
       SELECT r.root_package_id,r.root_source_type,r.root_source_key,
              r.starts_at,r.expires_at,d.package_id AS parent_package_id,
              d.dependency_id,d.optional,d.version_range,d.min_version,d.max_version,
              r.path || d.dependency_id AS path,r.depth+1 AS depth
         FROM roots r
         JOIN package_dependencies d ON d.package_id=r.root_package_id
        WHERE r.depth<32
          AND (d.optional=false OR EXISTS (
            SELECT 1 FROM company_package_installations oi
             WHERE oi.company_id=$1 AND oi.package_id=d.dependency_id
               AND (oi.status='active' OR oi.suspended_by_entitlement=true)
               AND oi.deactivated_by_user=false
          ))
       UNION ALL
       SELECT tree.root_package_id,tree.root_source_type,tree.root_source_key,
              tree.starts_at,tree.expires_at,d.package_id,d.dependency_id,d.optional,
              d.version_range,d.min_version,d.max_version,
              tree.path || d.dependency_id,tree.depth+1
         FROM dependency_tree tree
         JOIN package_dependencies d ON d.package_id=tree.dependency_id
        WHERE tree.depth<32
          AND NOT d.dependency_id=ANY(tree.path)
          AND (d.optional=false OR EXISTS (
            SELECT 1 FROM company_package_installations oi
             WHERE oi.company_id=$1 AND oi.package_id=d.dependency_id
               AND (oi.status='active' OR oi.suspended_by_entitlement=true)
               AND oi.deactivated_by_user=false
          ))
     )
     INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,parent_package_id,active,starts_at,expires_at,metadata)
     SELECT $1,tree.dependency_id,
            CASE WHEN tree.optional THEN 'OPTIONAL_DEPENDENCY' ELSE 'REQUIRED_DEPENDENCY' END,
            tree.root_source_type || ':' || tree.root_source_key || ':root:' ||
              tree.root_package_id::text || ':dependency:' || tree.dependency_id::text ||
              ':parent:' || tree.parent_package_id::text,
            tree.parent_package_id,true,tree.starts_at,tree.expires_at,
            jsonb_build_object('rootPackageId',tree.root_package_id,
              'rootSourceType',tree.root_source_type,'rootSourceKey',tree.root_source_key,
              'optional',tree.optional,'versionRange',tree.version_range,
              'minVersion',tree.min_version,'maxVersion',tree.max_version)
       FROM dependency_tree tree
      ON CONFLICT(company_id,package_id,source_type,source_key)
      DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
        expires_at=EXCLUDED.expires_at,parent_package_id=EXCLUDED.parent_package_id,
        metadata=EXCLUDED.metadata`,
    [companyId]
  );
}

export async function reconcileCompanyPackageEntitlements(db, companyId) {
  validCompanyId(companyId);

  await db(
    `DELETE FROM company_package_entitlement_sources
      WHERE company_id=$1 AND source_type=ANY($2::text[])`,
    [companyId, DERIVED_SOURCES]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'DIRECT_LICENCE',l.id::text,
            l.active AND lp.enabled AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (l.starts_at IS NULL OR l.starts_at<=NOW())
              AND (l.expires_at IS NULL OR l.expires_at>NOW()),
            l.starts_at,l.expires_at,jsonb_build_object(
              'licenceId',l.id,'optional',lp.optional,'versionRange',lp.version_range
            )
       FROM companies c JOIN licences l ON l.id=c.licence_id
       JOIN licence_packages lp ON lp.licence_id=l.id
       JOIN package_registry p ON p.id=lp.package_id
      WHERE c.id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'DIRECT_LICENCE',l.id::text || ':entitlement:' || le.entitlement_key,
            l.active AND le.enabled AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (l.starts_at IS NULL OR l.starts_at<=NOW())
              AND (l.expires_at IS NULL OR l.expires_at>NOW()),
            l.starts_at,l.expires_at,
            jsonb_build_object('licenceId',l.id,'entitlementKey',le.entitlement_key)
       FROM companies c JOIN licences l ON l.id=c.licence_id
       JOIN licence_entitlements le ON le.licence_id=l.id
       JOIN package_registry p ON p.manifest->>'entitlementKey'=le.entitlement_key
      WHERE c.id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'BUNDLE',b.id::text || ':' || p.id::text,
            a.active AND b.active
              AND (cardinality(b.allowed_companies)=0 OR $1=ANY(b.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,
            jsonb_build_object('bundleId',b.id,'bundleKey',b.bundle_key,
              'entitlementType',bp.entitlement_type,'versionRange',bp.version_range)
       FROM company_bundle_assignments a
       JOIN licence_bundles b ON b.id=a.bundle_id
       JOIN licence_bundle_packages bp ON bp.bundle_id=b.id AND bp.entitlement_type='COMMERCIAL'
       JOIN package_registry p ON p.id=bp.package_id
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'REQUIRED_DEPENDENCY',
            'bundle:' || b.id::text || ':included:' || p.id::text,
            a.active AND b.active
              AND (cardinality(b.allowed_companies)=0 OR $1=ANY(b.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,jsonb_build_object(
              'bundleId',b.id,'includedByBundle',true,'versionRange',bp.version_range
            )
       FROM company_bundle_assignments a
       JOIN licence_bundles b ON b.id=a.bundle_id
       JOIN licence_bundle_packages bp ON bp.bundle_id=b.id
         AND bp.entitlement_type='REQUIRED_DEPENDENCY'
       JOIN package_registry p ON p.id=bp.package_id
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'OPTIONAL_DEPENDENCY',
            'bundle:' || b.id::text || ':optional:' || p.id::text,
            a.active AND b.active
              AND (cardinality(b.allowed_companies)=0 OR $1=ANY(b.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,jsonb_build_object('bundleId',b.id,'optional',true)
       FROM company_bundle_assignments a
       JOIN licence_bundles b ON b.id=a.bundle_id
       JOIN licence_bundle_packages bp ON bp.bundle_id=b.id AND bp.entitlement_type='OPTIONAL'
       JOIN package_registry p ON p.id=bp.package_id
       JOIN company_package_installations i ON i.company_id=a.company_id
         AND i.package_id=p.id AND i.deactivated_by_user=false
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'TIER',t.id::text || ':' || p.id::text,
            a.active AND t.active
              AND (cardinality(t.allowed_companies)=0 OR $1=ANY(t.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,
            jsonb_build_object('tierId',t.id,'tierKey',t.tier_key,
              'entitlementType',tp.entitlement_type,'versionRange',tp.version_range)
       FROM company_tier_assignments a
       JOIN licence_tiers t ON t.id=a.tier_id
       JOIN licence_tier_packages tp ON tp.tier_id=t.id AND tp.entitlement_type='COMMERCIAL'
       JOIN package_registry p ON p.id=tp.package_id
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'REQUIRED_DEPENDENCY','tier:' || t.id::text || ':included:' || p.id::text,
            a.active AND t.active
              AND (cardinality(t.allowed_companies)=0 OR $1=ANY(t.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,jsonb_build_object(
              'tierId',t.id,'includedByTier',true,'versionRange',tp.version_range
            )
       FROM company_tier_assignments a
       JOIN licence_tiers t ON t.id=a.tier_id
       JOIN licence_tier_packages tp ON tp.tier_id=t.id AND tp.entitlement_type='REQUIRED_DEPENDENCY'
       JOIN package_registry p ON p.id=tp.package_id
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'OPTIONAL_DEPENDENCY','tier:' || t.id::text || ':optional:' || p.id::text,
            a.active AND t.active
              AND (cardinality(t.allowed_companies)=0 OR $1=ANY(t.allowed_companies))
              AND (cardinality(p.allowed_companies)=0 OR $1=ANY(p.allowed_companies))
              AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,jsonb_build_object('tierId',t.id,'optional',true)
       FROM company_tier_assignments a
       JOIN licence_tiers t ON t.id=a.tier_id
       JOIN licence_tier_packages tp ON tp.tier_id=t.id AND tp.entitlement_type='OPTIONAL'
       JOIN package_registry p ON p.id=tp.package_id
       JOIN company_package_installations i ON i.company_id=a.company_id
         AND i.package_id=p.id AND i.deactivated_by_user=false
      WHERE a.company_id=$1
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,starts_at=EXCLUDED.starts_at,
       expires_at=EXCLUDED.expires_at,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,metadata)
     SELECT $1,p.id,'PLATFORM_DEFAULT','platform-default:' || i.package_id::text,
            i.status='active',jsonb_build_object('installationType',i.installation_type)
       FROM company_package_installations i
       JOIN package_registry p ON p.id=i.package_id
      WHERE i.company_id=$1 AND i.installation_type='PLATFORM_DEFAULT'
     ON CONFLICT(company_id,package_id,source_type,source_key)
     DO UPDATE SET active=EXCLUDED.active,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  await deactivateIncompatibleSources(db, companyId);
  const entitledPackages = await db(
    `SELECT DISTINCT p.id,p.package_key,p.version,p.module_id,p.manifest
       FROM package_registry p
       JOIN company_package_entitlement_sources s ON s.package_id=p.id
      WHERE s.company_id=$1 AND s.active=true
        AND (s.starts_at IS NULL OR s.starts_at<=NOW())
        AND (s.expires_at IS NULL OR s.expires_at>NOW())
        AND s.source_type<>'OPTIONAL_DEPENDENCY' AND p.active=true
      ORDER BY p.package_key`,
    [companyId]
  );
  for (const pkg of entitledPackages.rows) {
    const installation = await db(
      `SELECT deactivated_by_user FROM company_package_installations
        WHERE company_id=$1 AND package_id=$2`,
      [companyId, pkg.id]
    );
    const manuallyDeactivated = installation.rows[0]?.deactivated_by_user === true;
    if (pkg.module_id && !manuallyDeactivated) {
      await provisionPackageMetadata(db, {
        packageId: pkg.id,
        moduleId: pkg.module_id,
        companyId,
        manifest: pkg.manifest || {},
        packageVersion: pkg.version,
      });
    }
    await db(
      `INSERT INTO company_package_installations
         (company_id,package_id,version,status,installation_type,available_version)
       VALUES($1,$2,$3,'active','ENTITLEMENT',$3)
       ON CONFLICT(company_id,package_id) DO UPDATE SET
         status=CASE WHEN company_package_installations.deactivated_by_user
           THEN company_package_installations.status ELSE 'active' END,
         installation_type=CASE WHEN company_package_installations.installation_type='PLATFORM_DEFAULT'
           THEN company_package_installations.installation_type ELSE 'ENTITLEMENT' END,
         version=CASE WHEN company_package_installations.version IS NULL
           THEN EXCLUDED.version ELSE company_package_installations.version END,
         available_version=EXCLUDED.available_version,suspended_by_entitlement=false,updated_at=NOW()`,
      [companyId, pkg.id, pkg.version]
    );
    if (pkg.module_id && !manuallyDeactivated) {
      await db(
        `INSERT INTO platform_module_access(module_id,company_id,store_id,enabled)
         VALUES($1,$2,NULL,true)
         ON CONFLICT(module_id,company_id,COALESCE(store_id,'00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET enabled=true,updated_at=NOW()`,
        [pkg.module_id, companyId]
      );
    }
  }

  await db(
    `UPDATE company_package_installations i
        SET status='active',suspended_by_entitlement=false,updated_at=NOW()
      WHERE i.company_id=$1 AND i.suspended_by_entitlement=true
        AND i.deactivated_by_user=false
        AND EXISTS (
          SELECT 1 FROM company_package_entitlement_sources s
           WHERE s.company_id=i.company_id AND s.package_id=i.package_id AND s.active=true
             AND (s.starts_at IS NULL OR s.starts_at<=NOW())
             AND (s.expires_at IS NULL OR s.expires_at>NOW())
        )`,
    [companyId]
  );

  await insertDependencySources(db, companyId);
  await deactivateIncompatibleSources(db, companyId);

  const requiredDependencies = await db(
    `SELECT DISTINCT p.id,p.package_key,p.version,p.module_id,p.manifest
       FROM company_package_entitlement_sources s
       JOIN package_registry p ON p.id=s.package_id
      WHERE s.company_id=$1 AND s.source_type='REQUIRED_DEPENDENCY' AND s.active=true
        AND (s.starts_at IS NULL OR s.starts_at<=NOW())
        AND (s.expires_at IS NULL OR s.expires_at>NOW())
        AND p.active=true`,
    [companyId]
  );
  for (const pkg of requiredDependencies.rows) {
    const installation = await db(
      `SELECT deactivated_by_user FROM company_package_installations
        WHERE company_id=$1 AND package_id=$2`,
      [companyId, pkg.id]
    );
    if (installation.rows[0]?.deactivated_by_user === true) continue;
    if (pkg.module_id) {
      await provisionPackageMetadata(db, {
        packageId: pkg.id,
        moduleId: pkg.module_id,
        companyId,
        manifest: pkg.manifest || {},
        packageVersion: pkg.version,
      });
    }
    await db(
      `INSERT INTO company_package_installations
         (company_id,package_id,version,status,installation_type,available_version)
       VALUES($1,$2,$3,'active','DEPENDENCY',$3)
       ON CONFLICT(company_id,package_id) DO UPDATE SET
         status=CASE WHEN company_package_installations.deactivated_by_user
           THEN company_package_installations.status ELSE 'active' END,
         version=CASE WHEN company_package_installations.version IS NULL THEN EXCLUDED.version
           ELSE company_package_installations.version END,
         installation_type=CASE WHEN company_package_installations.installation_type='PLATFORM_DEFAULT'
           THEN company_package_installations.installation_type ELSE 'DEPENDENCY' END,
         available_version=EXCLUDED.available_version,suspended_by_entitlement=false,updated_at=NOW()`,
      [companyId, pkg.id, pkg.version]
    );
    if (pkg.module_id) {
      await db(
        `INSERT INTO platform_module_access(module_id,company_id,store_id,enabled)
         VALUES($1,$2,NULL,true)
         ON CONFLICT(module_id,company_id,COALESCE(store_id,'00000000-0000-0000-0000-000000000000'::uuid))
         DO UPDATE SET enabled=true,updated_at=NOW()`,
        [pkg.module_id, companyId]
      );
    }
  }

  await db(
    `UPDATE company_package_installations i
        SET status='active',suspended_by_entitlement=false,updated_at=NOW()
      WHERE i.company_id=$1 AND i.suspended_by_entitlement=true
        AND i.deactivated_by_user=false
        AND EXISTS (
          SELECT 1 FROM company_package_entitlement_sources s
           WHERE s.company_id=i.company_id AND s.package_id=i.package_id AND s.active=true
             AND (s.starts_at IS NULL OR s.starts_at<=NOW())
             AND (s.expires_at IS NULL OR s.expires_at>NOW())
        )`,
    [companyId]
  );

  await db(
    `UPDATE company_package_installations i
        SET status='inactive',suspended_by_entitlement=true,updated_at=NOW()
      WHERE i.company_id=$1 AND i.status='active' AND i.deactivated_by_user=false
        AND NOT EXISTS (
          SELECT 1 FROM company_package_entitlement_sources s
           WHERE s.company_id=i.company_id AND s.package_id=i.package_id AND s.active=true
             AND (s.starts_at IS NULL OR s.starts_at<=NOW())
             AND (s.expires_at IS NULL OR s.expires_at>NOW())
        )`,
    [companyId]
  );

  return getCompanyPackageEntitlements(db, companyId);
}

export async function getCompanyPackageEntitlements(db, companyId) {
  validCompanyId(companyId);
  const result = await db(
    `SELECT p.package_key,s.source_type,s.source_key,s.parent_package_id,s.active,
            s.starts_at,s.expires_at,s.metadata
       FROM company_package_entitlement_sources s
       JOIN package_registry p ON p.id=s.package_id
      WHERE s.company_id=$1 AND s.active=true
        AND (s.starts_at IS NULL OR s.starts_at<=NOW())
        AND (s.expires_at IS NULL OR s.expires_at>NOW())
      ORDER BY p.package_key,s.source_type,s.source_key`,
    [companyId]
  );
  const byPackage = new Map();
  for (const row of result.rows) {
    if (!byPackage.has(row.package_key)) byPackage.set(row.package_key, []);
    byPackage.get(row.package_key).push({
      type: row.source_type,
      key: row.source_key,
      parentPackageId: row.parent_package_id || null,
      metadata: row.metadata || {},
    });
  }
  return [...byPackage].map(([packageKey, sources]) => ({ packageKey, sources }));
}

export async function packageVersionHasEntitlement(db, companyId, packageKey, version) {
  validCompanyId(companyId);
  const result = await db(
    `SELECT s.metadata->>'versionRange' AS version_range
       FROM company_package_entitlement_sources s
       JOIN package_registry p ON p.id=s.package_id
      WHERE s.company_id=$1 AND p.package_key=$2 AND s.active=true
        AND (s.starts_at IS NULL OR s.starts_at<=NOW())
        AND (s.expires_at IS NULL OR s.expires_at>NOW())`,
    [companyId, packageKey]
  );
  if (!result.rows.length) return true;
  return result.rows.some((source) => (
    !source.version_range || satisfiesPackageVersion(version, source.version_range)
  ));
}
