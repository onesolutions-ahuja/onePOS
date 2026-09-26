-- Additive OneSolutions Base Foundation services.

ALTER TABLE package_registry
  ADD COLUMN IF NOT EXISTS package_type VARCHAR(30) NOT NULL DEFAULT 'APPLICATION',
  ADD COLUMN IF NOT EXISTS publisher VARCHAR(200) NOT NULL DEFAULT 'OneSolutions',
  ADD COLUMN IF NOT EXISTS category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS required_platform_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS publication_state VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS installable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS billable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS system_only BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS available_tiers JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE package_registry
    ADD CONSTRAINT package_registry_type_check CHECK(package_type IN ('FOUNDATION','APPLICATION','BUNDLE')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE package_registry
    ADD CONSTRAINT package_registry_publication_check CHECK(publication_state IN ('DRAFT','PUBLISHED','RETIRED')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE package_dependencies
  ADD COLUMN IF NOT EXISTS min_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS max_version VARCHAR(40);
ALTER TABLE company_package_installations
  ADD COLUMN IF NOT EXISTS installation_type VARCHAR(30) NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN IF NOT EXISTS available_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS last_upgrade_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_upgrade_state VARCHAR(20) NOT NULL DEFAULT 'READY';

ALTER TABLE platform_objects
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_fields
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_relationships
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_layouts
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_rules
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_reports
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_package_version VARCHAR(40),
  ADD COLUMN IF NOT EXISTS managed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS user_modified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS package_metadata_ownership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
  package_version VARCHAR(40) NOT NULL,
  metadata_type VARCHAR(50) NOT NULL,
  metadata_id UUID NOT NULL,
  managed BOOLEAN NOT NULL DEFAULT TRUE,
  package_required BOOLEAN NOT NULL DEFAULT FALSE,
  user_modified BOOLEAN NOT NULL DEFAULT FALSE,
  default_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, metadata_type, metadata_id)
);
CREATE TABLE IF NOT EXISTS package_upgrade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE RESTRICT,
  from_version VARCHAR(40),
  to_version VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  migration_key VARCHAR(200),
  error_text TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_package_upgrade_history_company
  ON package_upgrade_history(company_id, package_id, started_at DESC);

CREATE TABLE IF NOT EXISTS platform_connector_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  publisher VARCHAR(200),
  auth_type VARCHAR(30) NOT NULL DEFAULT 'none',
  base_url TEXT NOT NULL,
  credentials_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  operations JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_ms INTEGER NOT NULL DEFAULT 15000 CHECK(timeout_ms BETWEEN 100 AND 120000),
  retry_policy JSONB NOT NULL DEFAULT '{"maxAttempts":3,"backoffMs":1000}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','DEPRECATED')),
  source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  source_package_version VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE integration_connections
  ADD COLUMN IF NOT EXISTS connector_definition_id UUID REFERENCES platform_connector_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credential_id UUID,
  ADD COLUMN IF NOT EXISTS retry_policy JSONB NOT NULL DEFAULT '{"maxAttempts":3,"backoffMs":1000}'::jsonb,
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER NOT NULL DEFAULT 15000;

CREATE TABLE IF NOT EXISTS platform_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES platform_connector_definitions(id) ON DELETE CASCADE,
  credential_key VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  ciphertext TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(company_id IS NOT NULL OR connector_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_credentials_company_key
  ON platform_credentials(company_id, connector_id, credential_key) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_credentials_platform_key
  ON platform_credentials(connector_id, credential_key) WHERE company_id IS NULL;
DO $$ BEGIN
  ALTER TABLE integration_connections
    ADD CONSTRAINT integration_connections_credential_fk FOREIGN KEY(credential_id)
    REFERENCES platform_credentials(id) ON DELETE SET NULL NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES platform_rules(id) ON DELETE CASCADE,
  trigger_type VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
  schedule_type VARCHAR(20) NOT NULL CHECK(schedule_type IN ('ONCE','HOURLY','DAILY','WEEKLY','MONTHLY','CRON')),
  schedule_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  active BOOLEAN NOT NULL DEFAULT FALSE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  execution_state VARCHAR(20) NOT NULL DEFAULT 'READY' CHECK(execution_state IN ('READY','RUNNING','COMPLETED','FAILED','PAUSED')),
  last_error TEXT,
  locked_until TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_schedules_due ON platform_schedules(active, next_run_at);

CREATE TABLE IF NOT EXISTS platform_event_types (
  event_type VARCHAR(200) PRIMARY KEY,
  description TEXT,
  source_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS platform_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  event_type VARCHAR(200) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_platform_events_company_type ON platform_events(company_id, event_type, created_at DESC);
CREATE TABLE IF NOT EXISTS platform_webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type VARCHAR(200) NOT NULL,
  target_url TEXT NOT NULL,
  credential_id UUID REFERENCES platform_credentials(id) ON DELETE SET NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  signing_secret_ciphertext TEXT,
  retry_policy JSONB NOT NULL DEFAULT '{"maxAttempts":5,"backoffMs":1000}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_webhook_subscriptions_match ON platform_webhook_subscriptions(company_id, event_type, active);
CREATE TABLE IF NOT EXISTS platform_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES platform_webhook_subscriptions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES platform_events(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DELIVERED','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_http_status INTEGER,
  last_error TEXT,
  response_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscription_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_webhook_deliveries_due ON platform_webhook_deliveries(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS platform_inbound_webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES platform_connector_definitions(id) ON DELETE SET NULL,
  endpoint_key VARCHAR(120) NOT NULL UNIQUE,
  auth_type VARCHAR(30) NOT NULL DEFAULT 'none',
  credential_id UUID REFERENCES platform_credentials(id) ON DELETE SET NULL,
  event_type VARCHAR(200) NOT NULL,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS platform_inbound_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES platform_inbound_webhook_endpoints(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  external_event_id VARCHAR(255),
  payload JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED' CHECK(status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED','REJECTED')),
  error_text TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  UNIQUE(endpoint_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS platform_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  object_key VARCHAR(100) NOT NULL,
  sequence_key VARCHAR(100) NOT NULL,
  prefix VARCHAR(50) NOT NULL DEFAULT '',
  suffix VARCHAR(50) NOT NULL DEFAULT '',
  numeric_length INTEGER NOT NULL DEFAULT 8 CHECK(numeric_length BETWEEN 1 AND 18),
  starting_number BIGINT NOT NULL DEFAULT 1,
  increment_by BIGINT NOT NULL DEFAULT 1 CHECK(increment_by > 0),
  next_number BIGINT NOT NULL DEFAULT 1,
  reset_policy VARCHAR(20) NOT NULL DEFAULT 'NEVER' CHECK(reset_policy IN ('NEVER','DAILY','MONTHLY','YEARLY')),
  period_key VARCHAR(20) NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, store_id, object_key, sequence_key)
);
CREATE INDEX IF NOT EXISTS idx_platform_sequences_scope ON platform_sequences(company_id, store_id, object_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_sequences_scope
  ON platform_sequences(company_id, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid), object_key, sequence_key);

CREATE TABLE IF NOT EXISTS platform_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  object_id UUID REFERENCES platform_objects(id) ON DELETE CASCADE,
  record_id UUID,
  entity_type VARCHAR(50) NOT NULL DEFAULT 'OBJECT',
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  category VARCHAR(100),
  visibility VARCHAR(20) NOT NULL DEFAULT 'PRIVATE' CHECK(visibility IN ('PRIVATE','COMPANY','PUBLIC')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_files_record ON platform_files(company_id, object_id, record_id, created_at DESC);

CREATE TABLE IF NOT EXISTS licence_packages (
  licence_id UUID NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  optional BOOLEAN NOT NULL DEFAULT FALSE,
  version_range VARCHAR(80),
  PRIMARY KEY(licence_id, package_id)
);
CREATE TABLE IF NOT EXISTS licence_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS licence_bundle_packages (
  bundle_id UUID NOT NULL REFERENCES licence_bundles(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE CASCADE,
  entitlement_type VARCHAR(20) NOT NULL DEFAULT 'COMMERCIAL' CHECK(entitlement_type IN ('COMMERCIAL','REQUIRED_DEPENDENCY','OPTIONAL')),
  version_range VARCHAR(80),
  PRIMARY KEY(bundle_id, package_id)
);
CREATE TABLE IF NOT EXISTS licence_bundle_entitlements (
  bundle_id UUID NOT NULL REFERENCES licence_bundles(id) ON DELETE CASCADE,
  entitlement_key VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(bundle_id, entitlement_key)
);
CREATE TABLE IF NOT EXISTS company_bundle_assignments (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bundle_id UUID NOT NULL REFERENCES licence_bundles(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(company_id, bundle_id)
);
CREATE TABLE IF NOT EXISTS company_package_entitlement_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES package_registry(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL CHECK(source_type IN ('DIRECT_LICENCE','BUNDLE','TIER','REQUIRED_DEPENDENCY','OPTIONAL_DEPENDENCY','PLATFORM_DEFAULT','SUPERADMIN_ASSIGNMENT')),
  source_key VARCHAR(200) NOT NULL,
  parent_package_id UUID REFERENCES package_registry(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, package_id, source_type, source_key)
);
CREATE INDEX IF NOT EXISTS idx_company_package_entitlements_effective ON company_package_entitlement_sources(company_id, package_id, active, expires_at);
