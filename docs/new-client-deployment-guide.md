# Tenant Database Isolation Guide

This document describes the target architecture for onePOS: a shared application runtime with server-authoritative tenant resolution and separate client databases.

Important status note:
- The application still uses a shared codebase and shared platform runtime.
- The tenant resolver and per-tenant pool selection are now added as the server-side routing foundation.
- Full automated provisioning and production migration tooling remain operational work beyond the application layer.
- The existing `company_id`, `store_id`, and RBAC protections remain in place as defense-in-depth.

---

## A. Existing architecture discovered

The repository originally used a single PostgreSQL pool driven by `DATABASE_URL` in `server.js`.

The legacy pattern was:
- one application instance
- one global database pool
- tenant isolation by `company_id` and store filtering
- business tables and platform metadata living in the same database

This means the original architecture was effectively:

Shared codebase
  ↓
Shared database
  ↓
company_id-based filtering

The target architecture is:

Shared onePOS application runtime
  ↓
Tenant resolver
  ↓
control tenant directory
  ↓
separate client database per company

---

## B. Control-plane / tenant directory

The control plane is a small server-side registry that resolves request hostnames to tenant metadata.

It is not a normal business database and should contain only:
- tenant key
- hostname / subdomain
- database connection reference or config reference
- tenant status
- created / updated timestamps

It should not store normal operational records such as:
- sales
- products
- inventory
- customers
- suppliers
- payments

---

## C. Tenant resolver and routing

The resolver is implemented in `services/tenantResolver.js`.

It supports:
- `alpha.localhost:10000` → tenant key `alpha`
- `beta.localhost:10000` → tenant key `beta`
- `clientcompany.onepos.com` → tenant key `clientcompany`
- custom host mapping through `TENANT_HOST_MAP`
- tenant directory metadata from environment config

The resolver is server-authoritative and ignores browser-supplied tenant or database indicators.

---

## D. Pool lifecycle and cache behavior

The tenant pool manager creates one pool per tenant key and caches it for reuse.

Behavior:
- tenant key is used as the cache key
- no cross-tenant pool reuse
- default local/bootstrap host uses the global fallback pool when present
- tenant database failover is isolated to that tenant
- caches can be cleared for maintenance or reconfiguration

This is intentionally bounded and safe for multi-tenant hosting.

---

## E. Localhost behavior

The resolver supports a development pattern like:
- `alpha.localhost:10000`
- `beta.localhost:10000`

This allows multi-tenant testing without external DNS.

Normal `localhost:10000` remains available for default/bootstrap use.

---

## F. Authentication flow

Authentication now resolves the tenant from the request hostname before login queries run.

This avoids the unsafe pattern of querying every tenant database to discover a user.

The login flow also keeps tenant selection server-side and does not trust a browser-provided `company_id` or database name.

---

## G. New client provisioning flow

The intended provisioning flow is:

1. Validate unique tenant key and hostname
2. Create the client database
3. Initialize schema
4. Run migrations
5. Bootstrap company data
6. Register tenant metadata in the control directory
7. Enable the correct One-* modules
8. Validate tenant-specific routing and login

This is the correct target architecture, but full automated provisioning still needs environment-level infrastructure work outside the application code.

---

## H. Schema and migration handling

Each client database must run the same onePOS schema version.

Initialization executes the canonical ordered schema in `database/schema.sql`
before the additive compatibility migrations in `database/init.js`. This is
important for a completely empty PostgreSQL database: indexes, constraints,
alterations, and seed queries cannot run until their base tables exist.
Initialization is idempotent and a partially initialized database is reported
as `MIGRATION_REQUIRED`, allowing a later explicit Superadmin retry without
dropping or recreating existing data.

The lifecycle is:
1. Save the Customer-Managed configuration
2. Test Connection (connectivity only; no schema changes)
3. Initialize Database (canonical schema, then compatibility migrations)
4. Validate Schema
5. Activate only after validation reports `COMPATIBLE`

Initialization diagnostics log only the operation, company ID, PostgreSQL
code/category, safe relation name when PostgreSQL provides one, and a
bootstrap step (`canonical_schema` or `compatibility_migrations`). Passwords,
connection strings, and other secrets are never returned or logged.

This is intentionally conservative and avoids destructive migration.

---

## I. Package installer integration

The existing One-* package architecture remains authoritative.

For tenant-isolated operation:
- package install and configuration are executed against the tenant database chosen by the request context
- the package install flow is not allowed to target a database chosen by client-controlled input
- the package dependency rules and canonical module registry remain unchanged

---

## J. Superadmin behavior

The platform role is named **Platform Developer Superadmin**. It is a
developer-only, server-authoritative role represented by `users.is_superadmin`.
It has full CRUD access across platform and company business surfaces, can
inspect every company, and can perform tenant database configuration and
initialization. It is not a read-only support role.

Superadmin can:
- create, read, update, and delete platform/company records through the same
  authenticated API authorization path
- view and operate on every company without changing the company-admin
  permission model
- provision or manage a tenant context
- configure, test, validate, initialize, and activate customer databases
- install packages for the selected client
- diagnose tenant status

Company Admin accounts remain company-scoped and cannot access these
superadmin/database configuration endpoints. Normal client traffic still
executes against the resolved tenant database and not a merged global database.

---

## K. Background jobs and task execution

Any scheduled or queued background work must resolve the tenant database from a stable tenant identifier or job metadata before executing.

The implementation pattern is designed to support this, but full job-level propagation should be completed during the operational rollout.

---

## L. Existing-client migration strategy

No destructive migration is attempted automatically.

The safe approach is:
1. choose a company to migrate
2. create a target tenant database
3. copy only the selected company's data
4. preserve IDs and relationship integrity
5. validate row counts and tenant ownership
6. validate platform metadata and package configuration
7. keep source data untouched until validation passes
8. support rollback if validation fails

This foundation is in place, but the full production migration pipeline is still future work.

---

## M. Security model

The tenant resolver is deliberately server-authoritative.

It does not trust:
- `company_id` from the browser request body
- database names passed by the client
- connection strings from browser input
- arbitrary tenant override parameters

The tenant is resolved from host metadata and server-side configuration only.

---

## N. Test coverage added

Focused tests cover:
- tenant lookup
- hostname parsing
- custom host mapping
- local `.localhost` resolution
- pool selection
- pool isolation
- tenant-aware database selection

These tests validate the server-side resolver behavior without redesigning the application business logic.

---

## O. Remaining gaps

The following remain intentionally documented as not complete:
- automated physical database creation for every client is not fully production-automated yet
- full production migration tooling for existing shared-database clients is still pending
- full background-job tenant propagation still needs rollout in operational systems
- tenant provisioning infrastructure remains an environment-level concern

The architecture foundation is now in place, but the broader production rollout remains operational work.

---

## V1 request routing implementation

The runtime now resolves the authenticated user's `companyId` before protected
route handlers run. `ONEPOS_MANAGED` requests use the shared control/business
pool, while `CUSTOMER_MANAGED` requests use a lazily-created, bounded pool
whose credentials are stored encrypted in the control plane. A customer
database connection failure returns `TENANT_DATABASE_UNAVAILABLE`; it never
falls back to the shared pool.

The request context is held with `AsyncLocalStorage`, so concurrent requests
cannot mutate a global current database. The existing route-level `db()` helper
therefore routes Products, Customers, Sales, Inventory, Reports, Platform
Objects, and other consumers consistently. Sales binds its transaction client
from the same request pool and keeps the transaction on that client.

Superadmins can configure and test a company's database at:
- `GET/PUT /api/superadmin/companies/:id/database`
- `POST /api/superadmin/companies/:id/database/test`
- `POST /api/superadmin/companies/:id/database/validate-schema`
- `POST /api/superadmin/companies/:id/database/initialize`
- `POST /api/superadmin/companies/:id/database/activate`

Responses expose only connection metadata and `credentialsConfigured`; the
password is never returned, logged, or placed in session state. The control
plane retains users, companies, tenant database configuration, licensing, and
routing metadata. Customer-managed operational data remains in the configured
customer database.

## Final status

The application now has the server-side tenant routing foundation required for multi-tenant database isolation, while preserving the shared application runtime and existing business-layer protections.

This is the correct architectural step toward per-client database isolation, but it is not the claim that full multi-tenant production provisioning and live migration automation are complete.
