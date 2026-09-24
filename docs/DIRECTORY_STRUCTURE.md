# onePOS Directory Structure

```
onePOS/
├── website/          public marketing website
├── app/              tenant application
│   ├── src/          current React application
│   ├── platform/     shared platform capabilities
│   ├── shared/       shared UI/runtime utilities
│   └── apps/         one canonical source per installable app (e.g. HRMS)
├── server/           backend routes/services/runtime
├── packages/         AppExchange/package manifests and dependencies
├── database/         database assets
├── tests/            automated tests
└── docs/             architecture/documentation
```

## Tenant rule

Never create a source tree per tenant. Tenant-specific configuration belongs in tenant-scoped metadata. A reusable feature such as HRMS is implemented once under `app/apps/hrms` and made available to selected tenants through package installation, licence/entitlement and permissions.

## Windows-compatible entrypoints

The root `src`, `routes`, `services`, `utils`, `server.js`, and `index.html`
entrypoints remain regular files and directories so the repository works on
Windows without filesystem symlinks. The app and server boundaries above remain
the architectural ownership boundaries; do not add another feature
implementation under a tenant or compatibility path.
