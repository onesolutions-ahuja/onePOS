# onePOS Directory Structure

```
onePOS/
├── website/          public marketing website
├── app/              application entry HTML and platform extension placeholders
├── src/              canonical React application source
├── routes/            backend HTTP routes
├── services/          backend services and metadata registries
├── utils/              shared runtime utilities
├── server.js          canonical backend entry point
├── packages/         AppExchange/package manifests and dependencies
├── database/         database assets
├── tests/            automated tests
└── docs/             architecture/documentation
```

## Tenant rule

Never create a source tree per tenant. Tenant-specific configuration belongs in tenant-scoped metadata. A reusable feature such as HRMS is implemented once under `app/apps/hrms` and made available to selected tenants through package installation, licence/entitlement and permissions.

## Source boundary

The root `src`, `routes`, `services`, `utils`, and `server.js` paths are the active application boundaries. The `app/` directory contains the Vite HTML entry point and reserved extension documentation; it is not a second frontend source tree.
