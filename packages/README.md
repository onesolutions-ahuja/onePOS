# onePOS Packages

Package/AppExchange manifests and dependency metadata live here. Packages reference canonical implementations in `app/apps` and shared registered platform Functions/Actions/Components.

Tenant activation is data/configuration, not a code copy. This keeps one deployable codebase while allowing different tenants to have different installed capabilities.

Finance Core is a hidden, non-billable foundation package. Its metadata adopts the existing supplier invoice, supplier payment, payment allocation, supplier ledger, and common financial ledger tables; installation never creates a parallel accounting model or removes historical financial rows.

The built-in package catalog is declared in `services/internalAppCatalog.js` and `services/packageRegistry.js`. The `uber_eats` package provisions shared connection metadata, tenant-scoped status views, registered connector/menu/order/item actions, and an inactive-by-default product-save menu-sync recipe. Its package manifest also declares least-privilege permissions, native product/store mapping and override contracts, and connection-page/form metadata. Each Uber store has an independently saved menu field mapping and menu sync is explicitly targeted to one configured store. Installing or reinstalling it does not create or overwrite the tenant's existing integration credentials/configuration.

`products` is Product Core: a hidden, non-billable foundation package that adopts the canonical Product and Category Platform Objects and their existing SQL tables. Its manifest owns Product identity, category and variant metadata, standard list/detail/form layouts, validation rules, registered generic record actions, and package-version upgrade metadata. It has no higher-level package dependencies. Product IDs and operational data remain in the existing `products` and `categories` tables.

Current framework limits: package workflows are installed as `platform_rules` recipes (there is no standalone workflow-definition table/API); connection form fields intentionally point to the existing Online Platforms settings because the generic custom-page controls do not persist integration configuration. Mapping/override contracts are declarative package-manifest metadata; existing product mapping fields and integration configuration remain the persistence/runtime source of truth.
