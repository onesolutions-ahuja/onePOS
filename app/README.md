# onePOS Application

Tenant application source for `app.onepos.com` and tenant subdomains.

- `src/` - current operational React application.
- `platform/` - shared platform-owned capabilities and metadata runtime.
- `shared/` - reusable UI/runtime utilities used by every tenant/app.
- `apps/` - installable application modules. A module exists once in source; tenants receive it through package installation/licensing, never by copying its source into a tenant folder.

JARVES and other cross-tenant platform capabilities remain shared. Tenant customisations should normally be metadata records rather than source-code forks.
