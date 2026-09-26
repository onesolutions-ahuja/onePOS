const RECONCILABLE_SOURCES = [
  "DIRECT_LICENCE",
  "BUNDLE",
  "TIER",
  "REQUIRED_DEPENDENCY",
  "OPTIONAL_DEPENDENCY",
];

export async function reconcileCompanyPackageEntitlements(db, companyId) {
  if (!companyId) throw new Error("A company is required to reconcile package entitlements");
  await db(
    `DELETE FROM company_package_entitlement_sources
      WHERE company_id=$1 AND source_type=ANY($2::text[])`,
    [companyId, RECONCILABLE_SOURCES]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'DIRECT_LICENCE',l.id::text,
            l.active AND lp.enabled
              AND (l.starts_at IS NULL OR l.starts_at<=NOW())
              AND (l.expires_at IS NULL OR l.expires_at>NOW()),
            l.starts_at,l.expires_at,jsonb_build_object('licenceId',l.id)
       FROM companies c JOIN licences l ON l.id=c.licence_id
       JOIN licence_packages lp ON lp.licence_id=l.id
       JOIN package_registry p ON p.id=lp.package_id
      WHERE c.id=$1`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'DIRECT_LICENCE',l.id::text || ':entitlement:' || p.package_key,
            l.active AND le.enabled
              AND (l.starts_at IS NULL OR l.starts_at<=NOW())
              AND (l.expires_at IS NULL OR l.expires_at>NOW()),
            l.starts_at,l.expires_at,jsonb_build_object('licenceId',l.id,'entitlementKey',le.entitlement_key)
       FROM companies c JOIN licences l ON l.id=c.licence_id
       JOIN licence_entitlements le ON le.licence_id=l.id
       JOIN package_registry p ON p.manifest->>'entitlementKey'=le.entitlement_key
      WHERE c.id=$1 AND le.enabled=true`,
    [companyId]
  );

  await db(
    `INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,active,starts_at,expires_at,metadata)
     SELECT $1,p.id,'BUNDLE',b.id::text || ':' || p.id::text,
            a.active AND b.active AND (a.starts_at IS NULL OR a.starts_at<=NOW())
              AND (a.expires_at IS NULL OR a.expires_at>NOW()),
            a.starts_at,a.expires_at,jsonb_build_object('bundleId',b.id,'bundleKey',b.bundle_key)
       FROM company_bundle_assignments a
       JOIN licence_bundles b ON b.id=a.bundle_id
       JOIN licence_bundle_packages bp ON bp.bundle_id=b.id AND bp.entitlement_type='COMMERCIAL'
       JOIN package_registry p ON p.id=bp.package_id
      WHERE a.company_id=$1`,
    [companyId]
  );

  await db(
    `WITH RECURSIVE roots AS (
       SELECT a.bundle_id,bp.package_id AS root_package_id,a.active,a.starts_at,a.expires_at
         FROM company_bundle_assignments a
         JOIN licence_bundles b ON b.id=a.bundle_id
         JOIN licence_bundle_packages bp ON bp.bundle_id=b.id
        WHERE a.company_id=$1 AND b.active=true AND bp.entitlement_type='COMMERCIAL'
     ), deps(root_package_id,package_id,depth) AS (
       SELECT r.root_package_id,d.dependency_id,1
         FROM roots r JOIN package_dependencies d ON d.package_id=r.root_package_id AND d.optional=false
       UNION ALL
       SELECT deps.root_package_id,d.dependency_id,deps.depth+1
         FROM deps JOIN package_dependencies d ON d.package_id=deps.package_id AND d.optional=false
        WHERE deps.depth<32
     )
     INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,parent_package_id,active,starts_at,expires_at,metadata)
     SELECT $1,dep.package_id,'REQUIRED_DEPENDENCY',
            'bundle:' || root.bundle_id::text || ':' || root.root_package_id::text || ':' || dep.package_id::text,
            root.root_package_id,
            root.active AND (root.starts_at IS NULL OR root.starts_at<=NOW())
              AND (root.expires_at IS NULL OR root.expires_at>NOW()),
            root.starts_at,root.expires_at,jsonb_build_object('bundleId',root.bundle_id,'rootPackageId',root.root_package_id)
       FROM roots root JOIN deps dep ON dep.root_package_id=root.root_package_id
      ON CONFLICT (company_id,package_id,source_type,source_key) DO NOTHING`,
    [companyId]
  );

  await db(
    `WITH RECURSIVE roots AS (
       SELECT i.package_id AS root_package_id
         FROM company_package_installations i
        WHERE i.company_id=$1 AND i.status='active'
     ), deps(root_package_id,package_id,depth) AS (
       SELECT r.root_package_id,d.dependency_id,1
         FROM roots r JOIN package_dependencies d ON d.package_id=r.root_package_id AND d.optional=false
       UNION ALL
       SELECT deps.root_package_id,d.dependency_id,deps.depth+1
         FROM deps JOIN package_dependencies d ON d.package_id=deps.package_id AND d.optional=false
        WHERE deps.depth<32
     )
     INSERT INTO company_package_entitlement_sources
       (company_id,package_id,source_type,source_key,parent_package_id,active,metadata)
     SELECT $1,dep.package_id,'REQUIRED_DEPENDENCY',
            'installed:' || dep.root_package_id::text || ':' || dep.package_id::text,
            dep.root_package_id,true,jsonb_build_object('rootPackageId',dep.root_package_id)
       FROM deps dep
      ON CONFLICT (company_id,package_id,source_type,source_key)
      DO UPDATE SET active=true,metadata=EXCLUDED.metadata`,
    [companyId]
  );

  return getCompanyPackageEntitlements(db, companyId);
}

export async function getCompanyPackageEntitlements(db, companyId) {
  const result = await db(
    `SELECT p.package_key,s.source_type,s.source_key,s.parent_package_id,s.active,
            s.starts_at,s.expires_at,s.metadata
       FROM company_package_entitlement_sources s
       JOIN package_registry p ON p.id=s.package_id
      WHERE s.company_id=$1
        AND s.active=true
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
