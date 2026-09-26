const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
import { internalAppCatalogSchema, seedInternalAppCatalog } from "./internalAppCatalog.js";
import { packageRegistrySchema, seedPackageRegistry } from "./packageRegistry.js";
import { PLATFORM_FIELD_TYPE_SQL } from "./platformFieldTypes.js";

export function toSafeApiName(label, fallback = "field") {
  const normalized = String(label || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 100)
    .replace(/_+$/g, "");
  return normalized || fallback;
}

export const RELATIONSHIP_LINK_OWNERS = Object.freeze({ CHILD: "child", PARENT: "parent" });

/**
 * Resolve the foreign-key field that stores a Platform relationship link.
 *
 * The relationship seed declares a link column, not the side that owns it: an
 * `one_to_many`/`many_to_many` child stores the reference to its parent, while a
 * `lookup` keeps the FK on the parent pointing at the single related record.
 * Resolution therefore follows the column through the object metadata instead of
 * assuming the child owns it, and returns `mapped: false` rather than inventing
 * metadata for a column that neither object maps.
 *
 * `platform_relationships.child_field_id` is consumed by the related-records
 * reader, the rollup evaluator and the Relationship Editor as a field of the
 * CHILD object, so only a child-owned link column can be stored there. A
 * parent-owned lookup is reported with `owner: "parent"` and a null
 * `childFieldId` so callers can still register (or act on) the relationship
 * without generating SQL against a column the child table does not have.
 */
export async function resolveRelationshipLink({ query, relationshipType, column, parent, child }) {
  if (!column) return { owner: null, field: null, childFieldId: null, column: null, mapped: true, objectKey: null };
  const childOwned = relationshipType !== "lookup";
  const candidates = childOwned
    ? [[child, RELATIONSHIP_LINK_OWNERS.CHILD], [parent, RELATIONSHIP_LINK_OWNERS.PARENT]]
    : [[parent, RELATIONSHIP_LINK_OWNERS.PARENT], [child, RELATIONSHIP_LINK_OWNERS.CHILD]];
  for (const [object, owner] of candidates) {
    if (!object?.id) continue;
    const result = await query(
      `SELECT id, api_name, source_column FROM platform_fields
        WHERE object_id=$1 AND (api_name=$2 OR source_column=$2) AND company_id IS NULL
        ORDER BY (api_name=$2) DESC
        LIMIT 1`,
      [object.id, column]
    );
    const field = result.rows[0];
    if (!field) continue;
    return {
      owner,
      field,
      childFieldId: owner === RELATIONSHIP_LINK_OWNERS.CHILD ? field.id : null,
      column,
      mapped: true,
      objectKey: object.object_key || null,
    };
  }
  return { owner: null, field: null, childFieldId: null, column, mapped: false, objectKey: null };
}

/** True when the authoritative source table really has the declared link column. */
export async function sourceColumnExists({ query, table, column }) {
  if (!isSafeIdentifier(table) || !isSafeIdentifier(column)) return false;
  const result = await query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1",
    [table, column]
  );
  return result.rows.length > 0;
}

export const platformSchema = `
  CREATE TABLE IF NOT EXISTS platform_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    version VARCHAR(40) NOT NULL DEFAULT '1.0.0',
    description TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    installed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ${internalAppCatalogSchema}
  ${packageRegistrySchema}
  CREATE TABLE IF NOT EXISTS platform_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID REFERENCES platform_modules(id) ON DELETE SET NULL,
    package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
    object_key VARCHAR(100) NOT NULL UNIQUE,
    api_name VARCHAR(100),
    label VARCHAR(200) NOT NULL,
    plural_label VARCHAR(200),
    description TEXT,
    source_table VARCHAR(100),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    company_scoped BOOLEAN NOT NULL DEFAULT TRUE,
    store_scoped BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (source_table IS NULL OR source_table ~ '^[a-z_][a-z0-9_]*$')
  );
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS api_name VARCHAR(100);
  UPDATE platform_objects SET api_name=object_key WHERE api_name IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_objects_company_api_name ON platform_objects(company_id, api_name) WHERE company_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS platform_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    api_name VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    field_type VARCHAR(30) NOT NULL CHECK (field_type IN (${PLATFORM_FIELD_TYPE_SQL})),
    source_column VARCHAR(100),
    required BOOLEAN NOT NULL DEFAULT FALSE,
    readable BOOLEAN NOT NULL DEFAULT TRUE,
    writable BOOLEAN NOT NULL DEFAULT FALSE,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, api_name)
  );
  CREATE TABLE IF NOT EXISTS platform_field_security (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    field_id UUID NOT NULL REFERENCES platform_fields(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    readable BOOLEAN NOT NULL DEFAULT TRUE,
    writable BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (field_id, role_id, company_id)
  );
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_field_security_id ON platform_field_security(id);
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_field_security ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS platform_registered_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
    action_key VARCHAR(140) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    handler_key VARCHAR(140) NOT NULL,
    required_permission VARCHAR(140),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE platform_registered_actions ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_registered_actions ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_registered_actions ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_registered_actions ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_registered_actions ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_registered_actions_global ON platform_registered_actions(action_key) WHERE company_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_registered_actions_company ON platform_registered_actions(company_id, action_key) WHERE company_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS platform_buttons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
    button_key VARCHAR(140) NOT NULL,
    label VARCHAR(200) NOT NULL,
    icon VARCHAR(100),
    action_key VARCHAR(140) NOT NULL,
    placement VARCHAR(80) NOT NULL DEFAULT 'record',
    visibility_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_buttons ALTER COLUMN action_key DROP NOT NULL;
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS target_type VARCHAR(20) NOT NULL DEFAULT 'action' CHECK (target_type IN ('action','workflow'));
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS target_key VARCHAR(140);
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS variant VARCHAR(30) NOT NULL DEFAULT 'primary';
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS required_permission VARCHAR(140);
  ALTER TABLE platform_buttons ADD COLUMN IF NOT EXISTS input_mappings JSONB NOT NULL DEFAULT '{}'::jsonb;
  UPDATE platform_buttons SET target_key=action_key WHERE target_key IS NULL AND action_key IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_buttons_global ON platform_buttons(button_key) WHERE company_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_buttons_company ON platform_buttons(company_id, button_key) WHERE company_id IS NOT NULL;
  CREATE TABLE IF NOT EXISTS platform_action_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
    event_key VARCHAR(140) NOT NULL,
    action_key VARCHAR(140) NOT NULL,
    condition_rule_id UUID,
    validation_rule_id UUID,
    execution_order INTEGER NOT NULL DEFAULT 100,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_platform_action_bindings_event ON platform_action_bindings(company_id, object_id, event_key, active, execution_order);
  CREATE TABLE IF NOT EXISTS platform_object_permissions (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    can_view BOOLEAN NOT NULL DEFAULT TRUE,
    can_create BOOLEAN NOT NULL DEFAULT FALSE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (object_id, role_id, company_id)
  );
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_object_permissions_id ON platform_object_permissions(id);
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_object_permissions ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS platform_record_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    object_key VARCHAR(100) NOT NULL,
    record_id UUID NOT NULL,
    field_api_name VARCHAR(100),
    old_value JSONB,
    new_value JSONB,
    action VARCHAR(20) NOT NULL CHECK (action IN ('create','update','delete')),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS platform_approval_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, name)
  );
  CREATE TABLE IF NOT EXISTS platform_approval_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL REFERENCES platform_approval_processes(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL CHECK (step_order > 0),
    label VARCHAR(200) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    UNIQUE (process_id, step_order)
  );
  CREATE TABLE IF NOT EXISTS platform_approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL REFERENCES platform_approval_processes(id) ON DELETE CASCADE,
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_id UUID NOT NULL,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    current_step INTEGER NOT NULL DEFAULT 1,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
  );
  CREATE TABLE IF NOT EXISTS platform_approval_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL REFERENCES platform_approval_requests(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('approve','reject')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS platform_value_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_set_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, value_set_key)
  );
  CREATE TABLE IF NOT EXISTS platform_value_set_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    value_set_id UUID NOT NULL REFERENCES platform_value_sets(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (value_set_id, value)
  );
  CREATE TABLE IF NOT EXISTS platform_record_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_type_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    default_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, record_type_key)
  );
  CREATE TABLE IF NOT EXISTS platform_record_type_picklist_values (
    record_type_id UUID NOT NULL REFERENCES platform_record_types(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES platform_fields(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (record_type_id, field_id, value)
  );
  CREATE TABLE IF NOT EXISTS platform_record_associations (
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    record_id UUID NOT NULL,
    record_type_id UUID REFERENCES platform_record_types(id) ON DELETE SET NULL,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (object_id, record_id)
  );
  CREATE TABLE IF NOT EXISTS platform_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    child_object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    relationship_key VARCHAR(100) NOT NULL,
    relationship_type VARCHAR(30) NOT NULL CHECK (relationship_type IN ('lookup','one_to_many','many_to_many')),
    child_field_id UUID REFERENCES platform_fields(id) ON DELETE RESTRICT,
    on_delete VARCHAR(20) NOT NULL DEFAULT 'restrict' CHECK (on_delete IN ('restrict','cascade','set_null')),
    on_update VARCHAR(20) NOT NULL DEFAULT 'restrict' CHECK (on_update IN ('restrict','cascade','set_null')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (parent_object_id, relationship_key)
  );
  /* Self-referencing relationships are valid Platform metadata (for example
     sale -> original_transactions, where a return references the sale it came
     from). An earlier revision of this schema forbade a relationship whose
     parent and child are the same object, so that constraint is dropped from
     databases that were created with it. */
  DO $$ BEGIN
    IF to_regclass('platform_relationships') IS NOT NULL THEN
      ALTER TABLE platform_relationships DROP CONSTRAINT IF EXISTS platform_relationships_check;
    END IF;
  END $$;
  CREATE TABLE IF NOT EXISTS platform_list_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    view_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    columns JSONB NOT NULL DEFAULT '[]'::jsonb,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    sort JSONB NOT NULL DEFAULT '{"field":null,"direction":"asc"}'::jsonb,
    page_size INTEGER NOT NULL DEFAULT 50,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, view_key)
  );
  ALTER TABLE platform_list_views ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_list_views ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_list_views ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_list_views ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_list_views ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS platform_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    report_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{"groupBy":null,"metrics":[{"type":"count"}]}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, company_id, report_key)
  );
  CREATE TABLE IF NOT EXISTS platform_layouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID NOT NULL REFERENCES platform_objects(id) ON DELETE CASCADE,
    page_type VARCHAR(30) NOT NULL CHECK (page_type IN ('list','detail','view','create','edit','quick_create')),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    layout_key VARCHAR(100) NOT NULL DEFAULT '',
    definition JSONB NOT NULL DEFAULT '{"components":[]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (object_id, page_type, role_id, company_id)
  );
  CREATE TABLE IF NOT EXISTS platform_apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    app_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    description TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{"defaultPage":null,"theme":{"primary":"#0f172a"}}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, app_key)
  );
  ALTER TABLE platform_apps ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_apps ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_apps ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_apps ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_apps ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS platform_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES platform_apps(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    page_key VARCHAR(100) NOT NULL,
    label VARCHAR(200) NOT NULL,
    route_path VARCHAR(200) NOT NULL DEFAULT '/',
    page_type VARCHAR(30) NOT NULL DEFAULT 'page' CHECK (page_type IN ('page','dashboard','modal')),
    definition JSONB NOT NULL DEFAULT '{"components":[]}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (app_id, company_id, page_key)
  );
  ALTER TABLE platform_pages ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  ALTER TABLE platform_pages ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40);
  ALTER TABLE platform_pages ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_pages ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE platform_pages ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
  CREATE TABLE IF NOT EXISTS platform_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    trigger_key VARCHAR(100) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    action JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS landing_flow JSONB NOT NULL DEFAULT '{"rules":[],"defaultDestination":"/app/dashboard"}'::jsonb;
  ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS jarves_behaviour_media JSONB NOT NULL DEFAULT '{"behaviour_1":"/jarves.mp4","behaviour_2":"/jarves.mp4","behaviour_3":"/jarves.mp4"}'::jsonb;
  ALTER TABLE platform_rules ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
  ALTER TABLE platform_rules ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','ACTIVE','INACTIVE'));
  UPDATE platform_rules SET lifecycle_status=CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END WHERE lifecycle_status='DRAFT' AND created_at < NOW();
  ALTER TABLE platform_approval_processes ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','ACTIVE','INACTIVE'));
  UPDATE platform_approval_processes SET lifecycle_status=CASE WHEN active THEN 'ACTIVE' ELSE 'INACTIVE' END WHERE lifecycle_status='DRAFT' AND created_at < NOW();
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS idx_platform_objects_package ON platform_objects(package_id);
  CREATE TABLE IF NOT EXISTS platform_automation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES platform_rules(id) ON DELETE SET NULL,
    object_id UUID REFERENCES platform_objects(id) ON DELETE SET NULL,
    record_id UUID,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    trigger VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_platform_fields_object ON platform_fields(object_id, display_order);
  CREATE INDEX IF NOT EXISTS idx_platform_field_security_role ON platform_field_security(role_id, company_id);
  CREATE INDEX IF NOT EXISTS idx_platform_record_history_record ON platform_record_history(object_id, record_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_approval_requests_company ON platform_approval_requests(company_id, status, submitted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_platform_value_sets_company ON platform_value_sets(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_value_set_values_set ON platform_value_set_values(value_set_id, display_order);
  CREATE INDEX IF NOT EXISTS idx_platform_layouts_object ON platform_layouts(object_id, page_type);
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_objects ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE platform_fields ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_fields DROP CONSTRAINT IF EXISTS platform_fields_object_id_api_name_key;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_global_name ON platform_fields(object_id, api_name) WHERE company_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fields_tenant_name ON platform_fields(object_id, company_id, api_name) WHERE company_id IS NOT NULL;
  ALTER TABLE platform_record_associations ADD COLUMN IF NOT EXISTS custom_values JSONB NOT NULL DEFAULT '{}'::jsonb;
  DO $$ BEGIN
    IF to_regclass('platform_fields') IS NOT NULL THEN
      ALTER TABLE platform_fields DROP CONSTRAINT IF EXISTS platform_fields_field_type_check;
      UPDATE platform_fields SET field_type = CASE lower(trim(field_type))
        WHEN 'string' THEN 'text'
        WHEN 'integer' THEN 'number'
        WHEN 'float' THEN 'decimal'
        WHEN 'timestamp' THEN 'datetime'
        ELSE lower(trim(field_type)) END;
      ALTER TABLE platform_fields ADD CONSTRAINT platform_fields_field_type_check
        CHECK (field_type IN (${PLATFORM_FIELD_TYPE_SQL}));
    END IF;
  END $$;
  ALTER TABLE platform_relationships ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
  ALTER TABLE platform_rules ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;
  ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS layout_key VARCHAR(100) NOT NULL DEFAULT '';
  ALTER TABLE platform_layouts ADD COLUMN IF NOT EXISTS record_type_id UUID REFERENCES platform_record_types(id) ON DELETE CASCADE;
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='platform_layouts'::regclass AND conname='platform_layouts_page_type_check') THEN
      ALTER TABLE platform_layouts DROP CONSTRAINT platform_layouts_page_type_check;
    END IF;
    ALTER TABLE platform_layouts ADD CONSTRAINT platform_layouts_page_type_check
      CHECK (page_type IN ('list','detail','view','create','edit','quick_create'));
  END $$;
  ALTER TABLE platform_record_types ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
  /* platform_record_types.company_id is nullable and PostgreSQL treats NULLs as
     distinct in UNIQUE(object_id, company_id, record_type_key), so every
     bootstrap inserted another copy of each global record type. Collapse the
     duplicates onto one canonical row (preferring the default/active copy),
     repoint every reference, then enforce uniqueness with partial indexes for
     the global (company_id IS NULL) and tenant (company_id IS NOT NULL) cases. */
  WITH duplicate_record_types AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY object_id, record_type_key
             ORDER BY is_default DESC, active DESC, created_at, id
           ) AS canonical_id
      FROM platform_record_types
     WHERE company_id IS NULL
  )
  UPDATE platform_layouts l SET record_type_id = d.canonical_id
    FROM duplicate_record_types d
   WHERE l.record_type_id = d.id AND d.id <> d.canonical_id;
  WITH duplicate_record_types AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY object_id, record_type_key
             ORDER BY is_default DESC, active DESC, created_at, id
           ) AS canonical_id
      FROM platform_record_types
     WHERE company_id IS NULL
  )
  UPDATE platform_record_associations a SET record_type_id = d.canonical_id
    FROM duplicate_record_types d
   WHERE a.record_type_id = d.id AND d.id <> d.canonical_id;
  WITH duplicate_record_types AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY object_id, record_type_key
             ORDER BY is_default DESC, active DESC, created_at, id
           ) AS canonical_id
      FROM platform_record_types
     WHERE company_id IS NULL
  )
  DELETE FROM platform_record_type_picklist_values v
   USING duplicate_record_types d
   WHERE v.record_type_id = d.id AND d.id <> d.canonical_id
     AND EXISTS (
       SELECT 1 FROM platform_record_type_picklist_values keep
        WHERE keep.record_type_id = d.canonical_id AND keep.field_id = v.field_id AND keep.value = v.value
     );
  WITH duplicate_record_types AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY object_id, record_type_key
             ORDER BY is_default DESC, active DESC, created_at, id
           ) AS canonical_id
      FROM platform_record_types
     WHERE company_id IS NULL
  )
  UPDATE platform_record_type_picklist_values v SET record_type_id = d.canonical_id
    FROM duplicate_record_types d
   WHERE v.record_type_id = d.id AND d.id <> d.canonical_id;
  WITH duplicate_record_types AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
             PARTITION BY object_id, record_type_key
             ORDER BY is_default DESC, active DESC, created_at, id
           ) AS canonical_id
      FROM platform_record_types
     WHERE company_id IS NULL
  )
  DELETE FROM platform_record_types t
   USING duplicate_record_types d
   WHERE t.id = d.id AND d.id <> d.canonical_id;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_record_types_global
    ON platform_record_types(object_id, record_type_key) WHERE company_id IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_record_types_tenant
    ON platform_record_types(object_id, company_id, record_type_key) WHERE company_id IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_layouts_object_page_key
    ON platform_layouts(object_id, page_type, layout_key) WHERE layout_key <> '';
  CREATE INDEX IF NOT EXISTS idx_platform_objects_company ON platform_objects(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_rules_company ON platform_rules(company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_record_types_object ON platform_record_types(object_id, company_id, active);
  CREATE INDEX IF NOT EXISTS idx_platform_record_associations_type ON platform_record_associations(object_id, record_type_id);
`;

const retailObjects = [
  {
    key: "customer", label: "Customer", plural: "Customers", table: "customers",
    fields: [
      ["name", "Name", "text", "name", true], ["phone", "Phone", "phone", "phone", false],
      ["email", "Email", "email", "email", false], ["credit_limit", "Credit Limit", "currency", "credit_limit", false],
      ["credit_enabled", "Credit Enabled", "boolean", "credit_enabled", false],
      ["price_list_id", "Price List", "lookup", "price_list_id", false],
      ["address", "Address", "text", "address", false], ["postcode", "Postcode", "text", "postcode", false],
      ["notes", "Notes", "text", "notes", false], ["active", "Active", "boolean", "active", false],
    ],
  },
  {
    key: "product", label: "Product", plural: "Products", table: "products",
    fields: [
      ["name", "Name", "text", "name", true], ["sku", "SKU", "text", "sku", false],
      ["barcode", "Barcode", "text", "barcode", false], ["price", "Price", "currency", "price", false],
      ["active", "Active", "boolean", "active", false],
      ["cost_price", "Cost Price", "currency", "cost_price", false],
      ["vat_rate", "VAT Rate", "decimal", "vat_rate", false],
      ["vat_applicable", "VAT Applicable", "boolean", "vat_applicable", false],
      ["age_restricted", "Age Restricted", "boolean", "age_restricted", false],
      ["track_stock", "Track Stock", "boolean", "track_stock", false],
      ["batch_tracking", "Batch Tracking Enabled", "boolean", "batch_tracking", false],
      ["stock_quantity", "Stock Quantity", "decimal", "stock_quantity", false],
      ["low_stock_level", "Low Stock Level", "decimal", "low_stock_level", false],
      ["category_id", "Category", "lookup", "category_id", false],
      ["image_url", "Image", "text", "image_url", false],
      ["available_on_uber", "Available on Uber", "boolean", "available_on_uber", false],
      ["available_on_deliveroo", "Available on Deliveroo", "boolean", "available_on_deliveroo", false],
    ],
  },
  {
    key: "sale", label: "Sale", plural: "Sales", table: "sales",
    fields: [
      ["invoice_number", "Receipt Number", "text", "receipt_number", false],
      ["transaction_type", "Transaction Type", "picklist", "transaction_type", true],
      ["original_transaction_id", "Original Transaction", "lookup", "original_transaction_id", false],
      ["customer_id", "Customer", "lookup", "customer_id", false],
      ["store_id", "Store", "lookup", "store_id", true],
      ["user_id", "Operator", "lookup", "user_id", true],
      ["status", "Status", "select", "status", false],
      ["subtotal", "Net", "currency", "subtotal", false],
      ["tax", "VAT / Tax", "currency", "tax", false],
      ["discount", "Discount", "currency", "discount", false],
      ["total", "Gross / Total", "currency", "total", false],
      ["created_at", "Created", "datetime", "created_at", false],
      ["completed_at", "Completed", "datetime", "completed_at", false],
    ],
  },
  {
    key: "supplier", label: "Supplier", plural: "Suppliers", table: "suppliers",
    fields: [
      ["name", "Name", "text", "name", true], ["contact_name", "Contact Name", "text", "contact_name", false],
      ["email", "Email", "email", "email", false], ["phone", "Phone", "phone", "phone", false],
      ["address", "Address", "text", "address", false], ["notes", "Notes", "text", "notes", false],
    ],
  },
  {
    key: "store", label: "Store", plural: "Stores", table: "stores",
    fields: [
      ["name", "Name", "text", "name", true],
      ["code", "Code", "text", "code", false],
      ["active", "Active", "boolean", "active", false],
    ],
  },
  {
    key: "employee", label: "Employee", plural: "Employees", table: "users",
    fields: [["full_name", "Full Name", "text", "full_name", true], ["username", "Username", "text", "username", true], ["email", "Email", "email", "email", false], ["active", "Active", "boolean", "active", false]],
  },
];

const operationalObjects = [
  { key: "payment_method", label: "Payment Method", plural: "Payment Methods", table: "payment_methods", fields: [
    ["code", "API Code", "text", "code", true], ["label", "Label", "text", "label", true],
    ["kind", "Kind", "picklist", "kind", true], ["active", "Active", "boolean", "active", false],
    ["allow_offline", "Allow Offline", "boolean", "allow_offline", false], ["sort_order", "Sort Order", "number", "sort_order", false],
    ["config", "Configuration", "json", "config", false],
  ] },
  { key: "sale_line", label: "Sale Line", plural: "Sale Lines", table: "sale_items", fields: [
    ["sale_id", "Sale / Transaction", "lookup", "sale_id", true], ["product_id", "Product", "lookup", "product_id", true],
    ["quantity", "Quantity", "decimal", "quantity", true], ["unit_price", "Unit Price", "currency", "unit_price", true],
    ["discount", "Discount", "currency", "discount", false], ["tax", "VAT / Tax", "currency", "tax", false],
    ["total", "Gross / Total", "currency", "total", true],
  ] },
  { key: "payment", label: "Payment", plural: "Payments", table: "payments", fields: [
    ["transaction_id", "Sale / Transaction", "lookup", "transaction_id", false], ["company_id", "Company", "lookup", "company_id", true],
    ["store_id", "Store", "lookup", "store_id", false], ["customer_id", "Customer", "lookup", "customer_id", false],
    ["supplier_id", "Supplier", "lookup", "supplier_id", false], ["amount", "Amount", "currency", "amount", true],
    ["payment_method", "Payment Method", "text", "payment_method", true], ["direction", "Direction", "picklist", "direction", true],
    ["status", "Status", "select", "status", false], ["reference", "Reference", "text", "reference", false],
    ["provider", "Provider", "text", "provider", false], ["provider_transaction_id", "Provider Reference", "text", "provider_transaction_id", false],
    ["created_at", "Created", "datetime", "created_at", false],
  ] },
  { key: "financial_ledger", label: "Financial Ledger Entry", plural: "Financial Ledger", table: "financial_ledger_entries", fields: [
    ["transaction_id", "Sale / Transaction", "lookup", "transaction_id", false], ["payment_id", "Payment", "lookup", "payment_id", false],
    ["customer_id", "Customer", "lookup", "customer_id", false], ["supplier_id", "Supplier", "lookup", "supplier_id", false],
    ["store_id", "Store", "lookup", "store_id", false], ["transaction_type", "Transaction Type", "text", "transaction_type", true],
    ["debit", "Debit", "currency", "debit", false], ["credit", "Credit", "currency", "credit", false],
    ["amount", "Amount", "currency", "amount", true], ["net_amount", "Net", "currency", "net_amount", false],
    ["vat_amount", "VAT / Tax", "currency", "vat_amount", false], ["reference", "Reference", "text", "reference", false],
    ["status", "Status", "select", "status", false], ["description", "Description", "text", "description", false],
    ["created_at", "Created", "datetime", "created_at", false],
  ] },
  { key: "inventory", label: "Inventory", plural: "Inventory", table: "product_store_stock", fields: [
    ["company_id", "Company", "lookup", "company_id", true], ["product_id", "Product", "lookup", "product_id", true], ["store_id", "Store", "lookup", "store_id", true], ["quantity", "Current Quantity", "decimal", "quantity", false], ["updated_at", "Updated", "datetime", "updated_at", false],
  ] },
  { key: "inventory_movement", label: "Inventory Movement", plural: "Inventory Movements", table: "inventory_movements", fields: [
    ["company_id", "Company", "lookup", "company_id", true], ["product_id", "Product", "lookup", "product_id", true], ["store_id", "Store", "lookup", "store_id", false], ["movement_type", "Movement Type", "picklist", "movement_type", true], ["quantity_change", "Quantity Change", "decimal", "quantity_change", true], ["balance_after", "Balance After", "decimal", "balance_after", false], ["batch_id", "Batch", "lookup", "batch_id", false], ["transaction_id", "Sale / Transaction", "lookup", "transaction_id", false], ["reference_type", "Reference Type", "text", "reference_type", false], ["reference_id", "Reference", "lookup", "reference_id", false], ["reason", "Reason", "text", "reason", false], ["notes", "Notes", "text", "notes", false], ["created_by", "Operator", "lookup", "created_by", false], ["created_at", "Created", "datetime", "created_at", false],
  ] },
  { key: "inventory_batch", label: "Inventory Batch", plural: "Inventory Batches", table: "inventory_batches", moduleKey: "batch_expiry", storeScoped: true, fields: [
    ["company_id", "Company", "lookup", "company_id", true],
    ["batch_number", "Batch Number", "text", "batch_number", false],
    ["product_id", "Product", "lookup", "product_id", true],
    ["store_id", "Store", "lookup", "store_id", true],
    ["quantity", "Available Quantity", "decimal", "quantity", false],
    ["manufacturing_date", "Manufacturing Date", "date", "manufacturing_date", false],
    ["expiry_date", "Expiry Date", "date", "expiry_date", false],
    ["expiry_status", "Expiry Status", "formula", null, false],
    ["created_at", "Created", "datetime", "created_at", false],
    ["updated_at", "Updated", "datetime", "updated_at", false],
  ] },
  { key: "purchase", label: "Purchase", plural: "Purchases", table: "purchases", fields: [
    ["reference_number", "Reference", "text", "reference_number", false], ["supplier_id", "Supplier", "lookup", "supplier_id", false], ["store_id", "Store", "lookup", "store_id", false], ["purchase_date", "Purchase Date", "date", "purchase_date", false], ["notes", "Notes", "text", "notes", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false],
  ] },
  { key: "purchase_receipt", label: "Purchase Receipt", plural: "Purchase Receipts", table: "purchase_receipts", fields: [
    ["purchase_id", "Purchase", "lookup", "purchase_id", false], ["reference_number", "Reference", "text", "reference_number", false], ["received_at", "Received", "datetime", "received_at", false], ["notes", "Notes", "text", "notes", false],
  ] },
  { key: "supplier_invoice", label: "Supplier Invoice", plural: "Supplier Invoices", table: "supplier_invoices", fields: [
    ["invoice_number", "Invoice Number", "text", "invoice_number", false], ["supplier_id", "Supplier", "lookup", "supplier_id", false], ["purchase_id", "Purchase", "lookup", "purchase_id", false], ["invoice_date", "Invoice Date", "date", "invoice_date", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false],
  ] },
  { key: "online_order", label: "Online Order", plural: "Online Orders", table: "online_orders", fields: [
    ["external_order_id", "Order Reference", "text", "external_order_id", false], ["platform", "Channel", "text", "platform", false], ["fulfilment_type", "Fulfilment", "text", "fulfilment_type", false], ["customer_name", "Customer", "text", "customer_name", false], ["store_id", "Store", "lookup", "store_id", false], ["status", "Status", "text", "status", false], ["total", "Total", "currency", "total", false], ["created_at", "Created", "datetime", "created_at", false],
  ] },  { key: "purchase_line", label: "Purchase Line", plural: "Purchase Lines", table: "purchase_items", fields: [
    ["purchase_id","Purchase","lookup","purchase_id",true],["product_id","Product","lookup","product_id",true],["quantity","Quantity","decimal","quantity",true],["received_quantity","Received Quantity","decimal","received_quantity",false],["unit_cost","Unit Cost","currency","unit_cost",true],["line_total","Line Total","currency","line_total",false],["batch_number","Batch Number","text","batch_number",false],["manufacturing_date","Manufacturing Date","date","manufacturing_date",false],["expiry_date","Expiry Date","date","expiry_date",false],
  ] },
  { key: "purchase_receipt_line", label: "Purchase Receipt Line", plural: "Purchase Receipt Lines", table: "purchase_receipt_items", fields: [
    ["receipt_id","Receipt","lookup","receipt_id",true],["purchase_item_id","Purchase Line","lookup","purchase_item_id",true],["product_id","Product","lookup","product_id",true],["quantity","Quantity","decimal","quantity",true],["unit_cost","Unit Cost","currency","unit_cost",true],["batch_number","Batch Number","text","batch_number",false],["manufacturing_date","Manufacturing Date","date","manufacturing_date",false],["expiry_date","Expiry Date","date","expiry_date",false],
  ] },
  { key: "supplier_payment", label: "Supplier Payment", plural: "Supplier Payments", table: "supplier_payments", fields: [
    ["company_id","Company","lookup","company_id",true],["supplier_id","Supplier","lookup","supplier_id",true],["store_id","Store","lookup","store_id",false],["amount","Amount","currency","amount",true],["payment_date","Payment Date","date","payment_date",true],["payment_method","Payment Method","text","payment_method",false],["reference","Reference","text","reference",false],["status","Status","picklist","status",true],["notes","Notes","text","notes",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "supplier_ledger", label: "Supplier Ledger Entry", plural: "Supplier Ledger", table: "supplier_ledger_entries", fields: [
    ["company_id","Company","lookup","company_id",true],["supplier_id","Supplier","lookup","supplier_id",true],["store_id","Store","lookup","store_id",false],["entry_type","Entry Type","picklist","entry_type",true],["reference_type","Reference Type","text","reference_type",false],["reference_id","Reference","lookup","reference_id",false],["amount","Amount","currency","amount",true],["debit","Debit","boolean","debit",true],["description","Description","text","description",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "layaway", label: "Layaway", plural: "Layaways", table: "layaways", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["customer_id","Customer","lookup","customer_id",false],["total","Total","currency","total",true],["paid_amount","Paid Amount","currency","paid_amount",false],["balance","Balance","currency","balance",false],["status","Status","picklist","status",true],["due_date","Due Date","date","due_date",false],["notes","Notes","text","notes",false],["completed_sale_id","Completed Sale","lookup","completed_sale_id",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "layaway_line", label: "Layaway Line", plural: "Layaway Lines", table: "layaway_items", fields: [
    ["layaway_id","Layaway","lookup","layaway_id",true],["product_id","Product","lookup","product_id",true],["product_name","Product Name","text","product_name",true],["quantity","Quantity","decimal","quantity",true],["unit_price","Unit Price","currency","unit_price",true],["tax","VAT / Tax","currency","tax",false],["total","Total","currency","total",true],
  ] },
  { key: "layaway_payment", label: "Layaway Payment", plural: "Layaway Payments", table: "layaway_payments", fields: [
    ["layaway_id","Layaway","lookup","layaway_id",true],["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["user_id","Operator","lookup","user_id",true],["payment_method","Payment Method","text","payment_method",true],["amount","Amount","currency","amount",true],["status","Status","picklist","status",true],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "promotion", label: "Promotion", plural: "Promotions", table: "promotions", fields: [
    ["company_id","Company","lookup","company_id",true],["name","Name","text","name",true],["discount_type","Discount Type","picklist","discount_type",true],["discount_value","Discount Value","decimal","discount_value",true],["starts_at","Starts","datetime","starts_at",false],["ends_at","Ends","datetime","ends_at",false],["active","Active","boolean","active",false],["product_id","Product","lookup","product_id",false],["category_id","Category","lookup","category_id",false],["buy_quantity","Buy Quantity","number","buy_quantity",false],["get_quantity","Get Quantity","number","get_quantity",false],["offer_type","Offer Type","picklist","offer_type",false],["set_price","Set Price","currency","set_price",false],["discount_percent","Discount Percent","decimal","discount_percent",false],
  ] },
  { key: "discount", label: "Discount", plural: "Discounts", table: "discounts", fields: [
    ["company_id","Company","lookup","company_id",true],["name","Name","text","name",true],["type","Type","picklist","type",true],["value","Value","decimal","value",true],["active","Active","boolean","active",false],["requires_permission","Requires Permission","boolean","requires_permission",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "loyalty_account", label: "Loyalty Account", plural: "Loyalty Accounts", table: "customer_loyalty_balances", fields: [
    ["company_id","Company","lookup","company_id",true],["customer_id","Customer","lookup","customer_id",true],["balance","Balance","decimal","balance",false],["updated_at","Updated","datetime","updated_at",false],
  ] },
  { key: "loyalty_transaction", label: "Loyalty Transaction", plural: "Loyalty Transactions", table: "customer_loyalty_transactions", fields: [
    ["company_id","Company","lookup","company_id",true],["customer_id","Customer","lookup","customer_id",true],["transaction_type","Transaction Type","picklist","transaction_type",true],["amount","Amount","decimal","amount",true],["balance_after","Balance After","decimal","balance_after",false],["reference_type","Reference Type","text","reference_type",false],["reference_id","Reference","lookup","reference_id",false],["description","Description","text","description",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "stock_transfer", label: "Stock Transfer", plural: "Stock Transfers", table: "stock_transfers", fields: [
    ["company_id","Company","lookup","company_id",true],["transfer_number","Transfer Number","text","transfer_number",false],["from_store_id","From Store","lookup","from_store_id",true],["to_store_id","To Store","lookup","to_store_id",true],["status","Status","picklist","status",true],["notes","Notes","text","notes",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "stock_transfer_line", label: "Stock Transfer Line", plural: "Stock Transfer Lines", table: "stock_transfer_items", fields: [
    ["transfer_id","Transfer","lookup","transfer_id",true],["product_id","Product","lookup","product_id",true],["quantity","Quantity","decimal","quantity",true],
  ] },
  { key: "stock_return", label: "Stock Return", plural: "Stock Returns", table: "stock_returns", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["return_type","Return Type","picklist","return_type",true],["return_number","Return Number","text","return_number",false],["sale_id","Sale","lookup","sale_id",false],["purchase_id","Purchase","lookup","purchase_id",false],["supplier_id","Supplier","lookup","supplier_id",false],["status","Status","picklist","status",true],["refund_amount","Refund Amount","currency","refund_amount",false],["refund_method","Refund Method","text","refund_method",false],["reason","Reason","text","reason",false],["created_at","Created","datetime","created_at",false],
  ] },
  { key: "stock_return_line", label: "Stock Return Line", plural: "Stock Return Lines", table: "stock_return_items", fields: [
    ["return_id","Return","lookup","return_id",true],["product_id","Product","lookup","product_id",true],["sale_item_id","Sale Line","lookup","sale_item_id",false],["purchase_item_id","Purchase Line","lookup","purchase_item_id",false],["quantity","Quantity","decimal","quantity",true],["reason","Reason","text","reason",false],
  ] },
  { key: "hospitality_floor", label: "Floor", plural: "Floors", table: "hospitality_floors", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["name","Name","text","name",true],["display_order","Display Order","number","display_order",false],["active","Active","boolean","active",false],
  ] },
  { key: "hospitality_table", label: "Table", plural: "Tables", table: "hospitality_tables", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["floor_id","Floor","lookup","floor_id",true],["table_number","Table Number","text","table_number",true],["name","Name","text","name",false],["capacity","Capacity","number","capacity",true],["shape","Shape","picklist","shape",true],["position_x","X Position","decimal","position_x",false],["position_y","Y Position","decimal","position_y",false],["status","Status","picklist","status",true],["active","Active","boolean","active",false],
  ] },
  { key: "reservation", label: "Reservation", plural: "Reservations", table: "hospitality_reservations", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["table_id","Table","lookup","table_id",false],["customer_id","Customer","lookup","customer_id",false],["customer_name","Customer Name","text","customer_name",true],["reservation_date","Reservation Date","date","reservation_date",true],["reservation_time","Reservation Time","text","reservation_time",true],["guests","Guests","number","guests",true],["status","Status","picklist","status",true],["notes","Notes","text","notes",false],
  ] },
  { key: "kds_ticket", label: "KDS Ticket", plural: "KDS Tickets", table: "hospitality_kds_tickets", fields: [
    ["company_id","Company","lookup","company_id",true],["store_id","Store","lookup","store_id",true],["sale_id","Sale","lookup","sale_id",false],["table_id","Table","lookup","table_id",false],["order_number","Order Number","text","order_number",false],["notes","Notes","text","notes",false],["station","Station","text","station",false],["status","Status","picklist","status",true],["created_at","Created","datetime","created_at",false],
  ] },
];

export async function initializePlatformMetadata(pool, { includeOperationalObjects = false } = {}) {
  await pool.query(platformSchema);
  await seedInternalAppCatalog(pool);
  await seedPackageRegistry(pool);
  const moduleResult = await pool.query(
    `INSERT INTO platform_modules (module_key, name, version, description, installed)
     VALUES ('retail_pos', 'Retail POS', '1.0.0', 'Core onePOS retail application', TRUE)
     ON CONFLICT (module_key) DO UPDATE SET name=EXCLUDED.name, version=EXCLUDED.version
     RETURNING id`
  );
  const moduleId = moduleResult.rows[0].id;
  for (const object of [...retailObjects, ...(includeOperationalObjects ? operationalObjects : [])]) {
    const objectModuleResult = object.moduleKey
      ? await pool.query("SELECT id FROM platform_modules WHERE module_key=$1 LIMIT 1", [object.moduleKey])
      : null;
    const objectModuleId = objectModuleResult?.rows[0]?.id || moduleId;
    const objectResult = await pool.query(
      `INSERT INTO platform_objects (module_id, package_id, object_key, label, plural_label, source_table, store_scoped)
       VALUES ($1,(SELECT id FROM package_registry WHERE module_id=$1),$2,$3,$4,$5,$6)
       ON CONFLICT (object_key) DO UPDATE SET label=EXCLUDED.label, plural_label=EXCLUDED.plural_label, source_table=EXCLUDED.source_table, store_scoped=EXCLUDED.store_scoped, active=TRUE
       WHERE platform_objects.company_id IS NULL AND platform_objects.module_id=EXCLUDED.module_id
       RETURNING id`,
      [objectModuleId, object.key, object.label, object.plural, object.table, object.storeScoped === true]
    );
    // Core Retail POS mappings must remain available after startup. The conflict
    // guard prevents a reserved key owned by a tenant/another module from being
    // reactivated, repurposed, or having its fields overwritten by this seed.
    if (!objectResult.rows.length) continue;
    const objectId = objectResult.rows[0].id;
    for (let index = 0; index < object.fields.length; index += 1) {
      const [apiName, label, fieldType, sourceColumn, required] = object.fields[index];
      await pool.query(
        `INSERT INTO platform_fields (object_id, api_name, label, field_type, source_column, required, writable, display_order)
         VALUES ($1,$2,$3,$4,$5,$6,$8,$7)
         ON CONFLICT (object_id, api_name) WHERE company_id IS NULL DO UPDATE SET label=EXCLUDED.label, field_type=EXCLUDED.field_type, source_column=EXCLUDED.source_column, required=EXCLUDED.required, writable=EXCLUDED.writable, display_order=EXCLUDED.display_order`,
        [objectId, apiName, label, fieldType, sourceColumn, required, index, Boolean(sourceColumn)]
      );
    }
  }
}

  const STANDARD_RELATIONSHIPS = [
    ["category", "product", "products", "one_to_many", "category_id"],
    ["customer", "price_list", "price_list", "lookup", "price_list_id"],
    ["supplier", "product", "products", "many_to_many", null],
    ["product", "inventory_batch", "batches", "one_to_many", "product_id"],
    ["store", "inventory_batch", "batches", "one_to_many", "store_id"],
    ["sale", "sale_line", "lines", "one_to_many", "sale_id"],
    ["sale_line", "product", "product", "lookup", "product_id"],
    ["sale", "payment", "payments", "one_to_many", "transaction_id"],
    ["sale", "financial_ledger", "ledger_entries", "one_to_many", "transaction_id"],
    ["payment", "financial_ledger", "ledger_entries", "one_to_many", "payment_id"],
    ["customer", "sale", "transactions", "one_to_many", "customer_id"],
    ["supplier", "payment", "payments", "one_to_many", "supplier_id"],
    ["customer", "payment", "payments", "one_to_many", "customer_id"],
    ["sale", "sale", "original_transactions", "one_to_many", "original_transaction_id"],
    ["product", "inventory", "stock_positions", "one_to_many", "product_id"],
    ["store", "inventory", "stock_positions", "one_to_many", "store_id"],
    ["product", "inventory_movement", "inventory_movements", "one_to_many", "product_id"],
    ["store", "inventory_movement", "inventory_movements", "one_to_many", "store_id"],
    ["inventory_batch", "inventory_movement", "movements", "one_to_many", "batch_id"],
    ["sale", "inventory_movement", "inventory_movements", "one_to_many", "transaction_id"],
    ["purchase", "purchase_line", "lines", "one_to_many", "purchase_id"],
    ["purchase_line", "product", "product", "lookup", "product_id"],
    ["purchase", "purchase_receipt", "receipts", "one_to_many", "purchase_id"],
    ["purchase_receipt", "purchase_receipt_line", "lines", "one_to_many", "receipt_id"],
    ["supplier", "supplier_payment", "payments", "one_to_many", "supplier_id"],
    ["supplier", "supplier_ledger", "ledger_entries", "one_to_many", "supplier_id"],
    ["customer", "layaway", "layaways", "one_to_many", "customer_id"],
    ["layaway", "layaway_line", "lines", "one_to_many", "layaway_id"],
    ["layaway", "layaway_payment", "payments", "one_to_many", "layaway_id"],
    ["layaway_line", "product", "product", "lookup", "product_id"],
    ["customer", "loyalty_account", "loyalty_account", "one_to_many", "customer_id"],
    ["customer", "loyalty_transaction", "loyalty_transactions", "one_to_many", "customer_id"],
    ["product", "promotion", "promotions", "one_to_many", "product_id"],
    ["stock_transfer", "stock_transfer_line", "lines", "one_to_many", "transfer_id"],
    ["stock_transfer_line", "product", "product", "lookup", "product_id"],
    ["stock_return", "stock_return_line", "lines", "one_to_many", "return_id"],
    ["stock_return_line", "product", "product", "lookup", "product_id"],
    ["hospitality_floor", "hospitality_table", "tables", "one_to_many", "floor_id"],
    ["hospitality_table", "reservation", "reservations", "one_to_many", "table_id"],
    ["customer", "reservation", "reservations", "one_to_many", "customer_id"],
    ["hospitality_table", "kds_ticket", "kds_tickets", "one_to_many", "table_id"],
    ["sale", "kds_ticket", "kds_tickets", "one_to_many", "sale_id"],
  ];

  const additionalStandardObjects = [
    {
      key: "category", label: "Category", plural: "Categories", table: "categories",
      fields: [["name", "Name", "text", "name", true], ["active", "Active", "boolean", "active", false]],
    },
    {
      key: "price_list", label: "Price List", plural: "Price Lists", table: "price_lists",
      fields: [["name", "Name", "text", "name", true], ["active", "Active", "boolean", "active", false]],
    },
  ];

  function standardDefinition(fields) {
    return {
      sections: [{ id: "section-details", label: "Details", order: 0, columns: 2, visible: true }],
      components: fields
        .filter((field) => field.active !== false && field.source_column)
        .map((field, index) => ({
          id: `field-${field.api_name}`,
          type: "field",
          field_key: field.api_name,
          section_id: "section-details",
          order: index,
          width: "1/2",
          visible: true,
          required: field.required === true,
          readOnly: field.writable !== true,
        })),
    };
  }

  export async function initializeStandardObjectEcosystem(pool) {
    const moduleResult = await pool.query("SELECT id FROM platform_modules WHERE module_key='retail_pos' LIMIT 1");
    const moduleId = moduleResult.rows[0]?.id;
    if (!moduleId) return;
    for (const object of additionalStandardObjects) {
      const result = await pool.query(
        `INSERT INTO platform_objects (module_id,object_key,label,plural_label,source_table)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (object_key) DO UPDATE SET label=EXCLUDED.label,plural_label=EXCLUDED.plural_label,source_table=EXCLUDED.source_table,active=true
         WHERE platform_objects.company_id IS NULL AND platform_objects.module_id=EXCLUDED.module_id
         RETURNING id`,
        [moduleId, object.key, object.label, object.plural, object.table]
      );
      if (!result.rows.length) continue;
      for (let index = 0; index < object.fields.length; index += 1) {
        const [apiName, label, fieldType, sourceColumn, required] = object.fields[index];
        await pool.query(
          `INSERT INTO platform_fields (object_id,api_name,label,field_type,source_column,required,writable,display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$8,$7)
           ON CONFLICT (object_id,api_name) WHERE company_id IS NULL DO UPDATE
             SET label=EXCLUDED.label,field_type=EXCLUDED.field_type,source_column=EXCLUDED.source_column,
                 required=EXCLUDED.required,writable=EXCLUDED.writable,display_order=EXCLUDED.display_order`,
          [result.rows[0].id, apiName, label, fieldType, sourceColumn, required, index, Boolean(sourceColumn)]
        );
      }
    }
    const objects = await pool.query(
      `SELECT id, object_key, source_table FROM platform_objects
        WHERE company_id IS NULL AND active=true AND object_key = ANY($1::text[])`,
      [      [...retailObjects, ...additionalStandardObjects, ...operationalObjects].map((object) => object.key)]
    );
    const byKey = new Map(objects.rows.map((row) => [row.object_key, row]));

    // Standard operational controls are metadata too: pages render these buttons,
    // while registered actions own the executable behaviour.
    const employeeObject = byKey.get("employee");
    if (employeeObject?.id) {
      await pool.query(
        `INSERT INTO platform_registered_actions (company_id,object_id,action_key,label,description,handler_key,required_permission,config,active)
         VALUES (NULL,$1,'employee.send_password_reset','Send Password Reset Email',
                 'Send a secure, expiring password-reset email without allowing an administrator to set or view the password.',
                 'SEND_PASSWORD_RESET_EMAIL','users.manage','{}'::jsonb,true)
         ON CONFLICT (action_key) WHERE company_id IS NULL DO UPDATE
           SET object_id=EXCLUDED.object_id,label=EXCLUDED.label,description=EXCLUDED.description,handler_key=EXCLUDED.handler_key,
               required_permission=EXCLUDED.required_permission,active=true,updated_at=NOW()`,
        [employeeObject.id]
      );
      await pool.query(
        `INSERT INTO platform_buttons (company_id,object_id,button_key,label,icon,action_key,placement,visibility_rule,config,active,target_type,target_key,variant,required_permission,input_mappings)
         VALUES (NULL,$1,'send_password_reset','Send Password Reset','key-round','employee.send_password_reset','record','{}'::jsonb,'{}'::jsonb,true,
                 'action','employee.send_password_reset','secondary','users.manage','{}'::jsonb)
         ON CONFLICT (button_key) WHERE company_id IS NULL DO UPDATE
           SET object_id=EXCLUDED.object_id,label=EXCLUDED.label,icon=EXCLUDED.icon,action_key=EXCLUDED.action_key,placement=EXCLUDED.placement,
               target_type=EXCLUDED.target_type,target_key=EXCLUDED.target_key,variant=EXCLUDED.variant,required_permission=EXCLUDED.required_permission,
               active=true,updated_at=NOW()`,
        [employeeObject.id]
      );
    }

    const valueSets = [
      ["transaction_type", "Transaction Type", [["SALE", "Sale"], ["RETURN", "Return"], ["EXCHANGE", "Exchange"]]],
      ["payment_direction", "Payment Direction", [["IN", "Incoming"], ["OUT", "Outgoing"]]],
      ["inventory_movement_type", "Inventory Movement Type", [
        ["OPENING", "Opening Stock"], ["PURCHASE", "Purchase Receipt"], ["SALE", "Sale"],
        ["CUSTOMER_RETURN", "Customer Return"], ["SUPPLIER_RETURN", "Supplier Return"],
        ["ADJUSTMENT_IN", "Adjustment In"], ["ADJUSTMENT_OUT", "Adjustment Out"],
        ["RETURN_IN", "Return In"], ["RETURN_OUT", "Return Out"],
        ["ONLINE_RESERVE", "Online Reserve"], ["ONLINE_RELEASE", "Online Release"],
        ["TRANSFER_IN", "Transfer In"], ["TRANSFER_OUT", "Transfer Out"],
        ["WASTAGE", "Wastage"], ["SHRINKAGE", "Shrinkage"],
      ]],
      ["inventory_record_type", "Inventory Record Type", [
        ["SALE", "Sale"], ["RETURN", "Return"], ["RECEIPT", "Receipt"],
        ["ADJUSTMENT_IN", "Adjustment In"], ["ADJUSTMENT_OUT", "Adjustment Out"],
        ["TRANSFER_IN", "Transfer In"], ["TRANSFER_OUT", "Transfer Out"],
        ["WASTAGE", "Wastage"], ["OPENING", "Opening Stock"],
      ]],
      ["batch_allocation_policy", "Batch Allocation Policy", [["FEFO", "First Expired, First Out"]]],
    ];
    for (const [key, label, values] of valueSets) {
      const existingSet = await pool.query(
        "SELECT id FROM platform_value_sets WHERE value_set_key=$1 AND company_id IS NULL LIMIT 1",
        [key]
      );
      const set = existingSet.rows[0]?.id
        ? await pool.query(
          "UPDATE platform_value_sets SET label=$1,description=$2,active=true,updated_at=NOW() WHERE id=$3 RETURNING id",
          [label, `Standard ${label} values`, existingSet.rows[0].id]
        )
        : await pool.query(
          `INSERT INTO platform_value_sets (value_set_key,label,description,company_id,active)
           VALUES ($1,$2,$3,NULL,true) RETURNING id`,
          [key, label, `Standard ${label} values`]
        );
      const valueSetId = set.rows[0]?.id;
      if (!valueSetId) continue;
      for (let index = 0; index < values.length; index += 1) {
        await pool.query(
          `INSERT INTO platform_value_set_values (value_set_id,value,label,display_order,active)
           VALUES ($1,$2,$3,$4,true)
           ON CONFLICT (value_set_id,value) DO UPDATE SET label=EXCLUDED.label,display_order=EXCLUDED.display_order,active=true`,
          [valueSetId, values[index][0], values[index][1], index]
        );
      }

      const inventoryMovement = byKey.get("inventory_movement");
      const movementTypeField = await pool.query(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name='movement_type' AND company_id IS NULL LIMIT 1",
        [inventoryMovement?.id]
      );
      const movementTypeSet = await pool.query(
        "SELECT id FROM platform_value_sets WHERE value_set_key='inventory_movement_type' AND company_id IS NULL LIMIT 1"
      );
      if (movementTypeField.rows[0]?.id && movementTypeSet.rows[0]?.id) {
        await pool.query(
          `UPDATE platform_fields SET config=jsonb_set(COALESCE(config,'{}'::jsonb),'{"value_set_key"}',$2::jsonb,true), options=$3::jsonb WHERE id=$1`,
          [movementTypeField.rows[0].id, JSON.stringify("inventory_movement_type"), JSON.stringify([
            "OPENING", "PURCHASE", "SALE", "CUSTOMER_RETURN", "SUPPLIER_RETURN", "ADJUSTMENT_IN",
            "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT", "ONLINE_RESERVE", "ONLINE_RELEASE",
            "TRANSFER_IN", "TRANSFER_OUT", "WASTAGE", "SHRINKAGE",
          ])]
        );
      }
      for (const [recordTypeKey, label] of [
        ["SALE", "Sale"], ["RETURN", "Return"], ["RECEIPT", "Receipt"],
        ["ADJUSTMENT_IN", "Adjustment In"], ["ADJUSTMENT_OUT", "Adjustment Out"],
        ["TRANSFER_IN", "Transfer In"], ["TRANSFER_OUT", "Transfer Out"],
        ["WASTAGE", "Wastage"], ["OPENING", "Opening Stock"],
      ]) {
        await pool.query(
          `INSERT INTO platform_record_types
            (object_id,record_type_key,label,description,company_id,default_values,is_default,active)
           VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,true)
           ON CONFLICT (object_id,record_type_key) WHERE company_id IS NULL DO UPDATE
             SET label=EXCLUDED.label,default_values=EXCLUDED.default_values,active=true`,
          [inventoryMovement?.id, recordTypeKey.toLowerCase(), label, `${label} inventory movement`, JSON.stringify({ movement_type: recordTypeKey }), recordTypeKey === "ADJUSTMENT_IN"]
        );
      }
      const expiryStatusField = await pool.query(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name='expiry_status' AND company_id IS NULL LIMIT 1",
        [byKey.get("inventory_batch")?.id]
      );
      if (expiryStatusField.rows[0]?.id) {
        await pool.query(
          `UPDATE platform_fields
              SET config=COALESCE(config,'{}'::jsonb) || $2::jsonb
            WHERE id=$1`,
          [expiryStatusField.rows[0].id, JSON.stringify({
            expression: "expiry_date",
            resultType: "date",
            policy: "FEFO",
            allocationOrder: "ASC",
            nulls: "LAST",
          })]
        );
      }
    }

    for (const [parentKey, childKey, relationshipKey, type, column] of STANDARD_RELATIONSHIPS) {
      const parent = byKey.get(parentKey);
      const child = byKey.get(childKey);
      const declaration = `${parentKey} -> ${childKey} (key "${relationshipKey}", ${type}${column ? `, column "${column}"` : ""})`;
      if (!parent || !child) {
        console.warn(`onePOS: platform relationship ${declaration} was not seeded - the declared objects are not available as global metadata`);
        continue;
      }
      try {
        const link = await resolveRelationshipLink({
          query: (sql, params) => pool.query(sql, params),
          relationshipType: type,
          column,
          parent,
          child,
        });
        if (column && !link.mapped) {
          const parentOwns = await sourceColumnExists({ query: (sql, params) => pool.query(sql, params), table: parent.source_table, column });
          const childOwns = parentOwns ? false : await sourceColumnExists({ query: (sql, params) => pool.query(sql, params), table: child.source_table, column });
          const location = parentOwns
            ? `it exists on "${parent.source_table}" but is not exposed as a Platform field of "${parentKey}"`
            : childOwns
              ? `it exists on "${child.source_table}" but is not exposed as a Platform field of "${childKey}"`
              : "it does not exist on either source table";
          console.warn(`onePOS: platform relationship ${declaration} was seeded without a link field - ${location}`);
        } else if (column && link.owner === RELATIONSHIP_LINK_OWNERS.PARENT && type !== "lookup") {
          console.warn(`onePOS: platform relationship ${declaration} is a ${type} but its link column belongs to the parent object; it was seeded without a child field`);
        }
        await pool.query(
          `INSERT INTO platform_relationships
            (parent_object_id,child_object_id,relationship_key,relationship_type,child_field_id,on_delete,on_update,active)
           VALUES ($1,$2,$3,$4,$5,'set_null','restrict',true)
           ON CONFLICT (parent_object_id,relationship_key) DO UPDATE
             SET child_object_id=EXCLUDED.child_object_id, relationship_type=EXCLUDED.relationship_type,
                 child_field_id=EXCLUDED.child_field_id, active=true`,
          [parent.id, child.id, relationshipKey, type, link.childFieldId]
        );
      } catch (error) {
        /* One malformed relationship must not abort unrelated provisioning
           (remaining relationships, record types, layouts, list views). The
           failure is reported with its exact metadata item so it stays visible. */
        console.error(`onePOS: platform relationship ${declaration} failed to seed:`, error.message);
      }
    }

    await pool.query(
      `UPDATE platform_relationships r
          SET active=false
         FROM platform_objects p, platform_objects c
        WHERE r.parent_object_id=p.id AND r.child_object_id=c.id
          AND p.object_key='product' AND c.object_key='category'
          AND r.relationship_key='category' AND p.company_id IS NULL AND c.company_id IS NULL`
    );

    const sale = byKey.get("sale");
    if (sale) {
      const transactionTypeField = await pool.query(
        "SELECT id FROM platform_fields WHERE object_id=$1 AND api_name='transaction_type' AND company_id IS NULL LIMIT 1",
        [sale.id]
      );
      const valueSet = await pool.query(
        "SELECT id FROM platform_value_sets WHERE value_set_key='transaction_type' AND company_id IS NULL LIMIT 1"
      );
      if (transactionTypeField.rows[0]?.id && valueSet.rows[0]?.id) {
        await pool.query(
          `UPDATE platform_fields
              SET config=jsonb_set(COALESCE(config,'{}'::jsonb),'{"value_set_key"}',$2::jsonb,true),
                  options=$3::jsonb
            WHERE id=$1`,
          [
            transactionTypeField.rows[0].id,
            JSON.stringify("transaction_type"),
            JSON.stringify(["SALE", "RETURN", "EXCHANGE"]),
          ]
        );
      }
      for (const [recordTypeKey, label, value] of [
        ["sale", "Sale", "SALE"],
        ["return", "Return", "RETURN"],
        ["exchange", "Exchange", "EXCHANGE"],
      ]) {
        const recordType = await pool.query(
          `INSERT INTO platform_record_types
            (object_id,record_type_key,label,description,company_id,default_values,is_default,active)
           VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,true)
           ON CONFLICT (object_id,record_type_key) WHERE company_id IS NULL DO UPDATE
             SET label=EXCLUDED.label,default_values=EXCLUDED.default_values,active=true
           RETURNING id`,
          [sale.id, recordTypeKey, label, `${label} transaction record type`, JSON.stringify({ transaction_type: value }), recordTypeKey === "sale"]
        );
        if (recordType.rows[0]?.id && transactionTypeField.rows[0]?.id) {
          await pool.query(
            `INSERT INTO platform_record_type_picklist_values
              (record_type_id,field_id,value,active)
             VALUES ($1,$2,$3,true)
             ON CONFLICT (record_type_id,field_id,value) DO UPDATE SET active=true`,
            [recordType.rows[0].id, transactionTypeField.rows[0].id, value]
          );
        }
      }
    }

    for (const object of objects.rows) {
      const fields = await pool.query(
        "SELECT id,api_name,source_column,required,writable,active FROM platform_fields WHERE object_id=$1 AND company_id IS NULL ORDER BY display_order,api_name",
        [object.id]
      );
      const definition = standardDefinition(fields.rows);
      const modes = [
        ["create", "Standard Create", "standard_create"],
        ["edit", "Standard Edit", "standard_edit"],
        ["detail", "Standard Details", "standard_detail"],
        ["quick_create", "Quick Create", "quick_create"],
      ];
      for (const [pageType, name, layoutKey] of modes) {
        const existing = await pool.query(
          `SELECT id FROM platform_layouts
            WHERE object_id=$1 AND page_type=$2 AND company_id IS NULL AND role_id IS NULL
              AND active=true LIMIT 1`,
          [object.id, pageType]
        );
        if (existing.rows.length) continue;
        await pool.query(
          `INSERT INTO platform_layouts
            (object_id,page_type,role_id,company_id,name,layout_key,definition,active,is_default)
           VALUES ($1,$2,NULL,NULL,$3,$4,$5::jsonb,true,true)
           ON CONFLICT (object_id,page_type,role_id,company_id) DO NOTHING`,
          [object.id, pageType, name, layoutKey, JSON.stringify(definition)]
        );
      }
    }
  }
export function isSafeIdentifier(value) {
  return typeof value === "string" && IDENTIFIER.test(value);
}
