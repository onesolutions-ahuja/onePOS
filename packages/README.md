# onePOS Packages

Package/AppExchange manifests and dependency metadata live here. Packages reference canonical implementations in `app/apps` and shared registered platform Functions/Actions/Components.

Tenant activation is data/configuration, not a code copy. This keeps one deployable codebase while allowing different tenants to have different installed capabilities.

The built-in package catalog is declared in `services/internalAppCatalog.js` and `services/packageRegistry.js`. The `uber_eats` package provisions shared connection metadata, tenant-scoped status views, registered connector/menu/order/item actions, and an inactive-by-default product-save menu-sync recipe. Its package manifest also declares least-privilege permissions, native product/store mapping and override contracts, and connection-page/form metadata. Each Uber store has an independently saved menu field mapping and menu sync is explicitly targeted to one configured store. Installing or reinstalling it does not create or overwrite the tenant's existing integration credentials/configuration.

Current framework limits: package workflows are installed as `platform_rules` recipes (there is no standalone workflow-definition table/API); connection form fields intentionally point to the existing Online Platforms settings because the generic custom-page controls do not persist integration configuration. Mapping/override contracts are declarative package-manifest metadata; existing product mapping fields and integration configuration remain the persistence/runtime source of truth.

`supplier_core` is a hidden, non-billable foundation package. It owns the existing Supplier metadata object and the `supplier_products` bridge object, while depending on Product Core rather than duplicating Product metadata. Its manifest maps only the existing supplier and supplier-product columns; the supplier catalog app remains responsible for the existing CRUD surface, and Purchasing and Supplier Accounting retain their own lifecycles.
