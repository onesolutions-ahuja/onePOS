# onePOS Platform Consolidation Audit

Audit date: 2026-09-23

Scope: source/navigation architecture mapping only. No routes, schema, navigation, or runtime behavior were changed by this audit.

## A. Executive summary

The repository has two deliberately different layers:

1. **Operational onePOS pages and services** remain authoritative for POS, stock, purchasing, payments, accounting, loyalty, delivery, and other integrity-sensitive workflows.
2. **The Platform/SFDC ecosystem** owns configurable metadata: objects, fields, relationships, layouts/forms, record types, rules, formulas/rollups, workflows, actions, reports, dashboards, permissions, and audit metadata.

The most important consolidation findings are:

- The operational Dashboard and configurable Dashboard Builder are separate experiences, not identical implementations.
- Reports have a real overlap: fixed operational report pages and the saved Custom Report Builder both expose reporting, but serve different depths and should be presented as one Reports family.
- Platform Objects wrap many standard business tables, but `systemObject()` intentionally routes writes back to specialised business modules. This is a bridge, not a duplicate write engine.
- Platform Forms/Layout Builder is the configurable form system. Legacy `RecordModal`/module-specific forms remain specialised CRUD UI and should not be treated as a second metadata builder.
- Platform navigation is currently hard-coded at the module/page level. Newly created custom Objects cannot automatically appear in the Dock without a small metadata-driven navigation bridge.
- Existing internal app/module catalogue and module access are the closest reusable navigation/licensing primitives. New Object navigation fields are not currently required if navigation is represented as a separate Object-to-App/Page configuration.
- No separate legacy configurable validation/formula/workflow/action schema was found outside the Platform metadata tables. Several specialised services contain business rules; those should remain authoritative.

## B. Confirmed duplicates and overlaps

### B1. Reports: overlapping experiences

**OLD / operational**

- Feature: fixed operational reports.
- Route: `/app/reports`, `/app/reports/<report>`.
- Components/files: [ReportsAdmin.jsx](../src/pages/reports/ReportsAdmin.jsx), [ReportPage.jsx](../src/pages/reports/ReportPage.jsx), report modules under `src/pages/reports/`.
- Navigation: `Reports` in [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx), `REPORT_MENU_ITEMS`.
- Purpose: curated Sales, Products, Payments, Customers, Inventory, Profit, Till, VAT, and stock movement reports backed by business-specific APIs.

**NEW / Platform-configurable**

- Feature: saved Custom Report Builder.
- Route: `/app/reports/custom`.
- Components/files: [CustomReportsAdmin.jsx](../src/pages/reports/CustomReportsAdmin.jsx), [customReports.js](../src/services/customReports.js).
- Navigation: `My Reports` in [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx) and [adminApps.js](../src/utils/adminApps.js).
- Purpose: user-defined fields, filters, grouping, aggregates, platform-object sources, saved definitions, sharing, duplication, archive, preview, and execution.

**Classification:** **DIFFERENT PURPOSE — KEEP BOTH**, but consolidate presentation under one Reports navigation family. `Reports` should remain curated operational reporting; `My Reports` should remain configurable reporting.

### B2. Dashboards: two dashboard experiences

**OLD / operational dashboard**

- Feature: current-day business dashboard.
- Route: `/app/dashboard`.
- Component/API: [Dashboard.jsx](../src/pages/dashboard/Dashboard.jsx), [dashboard.js](../routes/dashboard.js).
- Navigation: `Dashboard` in [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx), default landing in [runtimeAccess.js](../services/runtimeAccess.js).
- Purpose: today's sales, transactions, average sale, low stock, sales overview, logo, and quick actions.

**NEW / configurable dashboard builder**

- Feature: saved dashboard builder/runtime.
- Route: `/app/dashboards`.
- Components/API: [DashboardBuilder.jsx](../src/pages/dashboard/DashboardBuilder.jsx), [dashboardBuilder.js](../routes/dashboardBuilder.js), [dashboardBuilder.js](../services/dashboardBuilder.js).
- Navigation: `Dashboards` in [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx), also exposed by Platform's “Open in the main app” rail.
- Purpose: saved dashboards containing KPI, chart, table, and text components that consume saved reports.

**Other dashboard-like surfaces**

- Marketing-only dashboard mockups: [AppMockups.jsx](../src/marketing/components/AppMockups.jsx). These are not runtime functionality.
- External provider dashboards are documentation/help text only.

**Classification:** **DIFFERENT PURPOSE — KEEP BOTH**. The operational dashboard is a fast default landing page; Dashboard Builder is configurable analytics. They should not be merged blindly. The only later consolidation recommended is shared naming, permissions, and optional default-dashboard selection.

### B3. Object record pages versus legacy CRUD pages

**OLD / specialised CRUD**

- Features: Products, Customers, Suppliers, Categories, Inventory, Purchases, Stores, Employees, Business Divisions, and other operational pages.
- Routes: `/app/products`, `/app/customers`, `/app/suppliers`, `/app/inventory`, `/app/purchases`, `/app/stores`, `/app/employees`, `/app/business-divisions`.
- Components: `src/pages/products/`, `src/pages/customers/`, `src/pages/suppliers/`, `src/pages/inventory/`, `src/pages/purchases/`, `src/pages/stores/`, `src/pages/employees/`, `src/pages/businessDivisions/`.
- Purpose: business-safe workflows, specialised calculations, imports, payments, stock movement, loyalty, accounting, and integrations.

**NEW / Platform generic records**

- Feature: object list/page/form runtime.
- Route: Platform object routes under `/platform/objects/:objectKey/...`; UI is reached from [ObjectList.jsx](../src/pages/settings/Platform/ObjectList.jsx), [ObjectPage.jsx](../src/pages/settings/Platform/ObjectPage.jsx), and [PlatformAdmin.jsx](../src/pages/settings/PlatformAdmin.jsx).
- Purpose: metadata-driven list, create, edit, view, relationships, extensions, layouts, record types, and generic reporting.

**Evidence of intentional bridge:** [platformSystemObjects.js](../services/platformSystemObjects.js) identifies system objects and returns `SYSTEM_OBJECT_OPERATION_REQUIRED` so generic Platform CRUD cannot replace protected business writes.

**Classification:** **LEGACY BUT STILL REQUIRED** for specialised operational pages; **PLATFORM VERSION SHOULD REPLACE LEGACY** only for generic metadata administration and custom Objects. Do not remove the operational pages.

### B4. Dashboard/report navigation duplication

- `Reports` and `My Reports` both sit in the Insights group in [adminApps.js](../src/utils/adminApps.js).
- `Dashboards` is a separate top-level page but is also linked from Platform's “Open in the main app” group in [platformNav.js](../src/pages/settings/Platform/platformNav.js).

**Classification:** **P1 — presentation overlap**, not a duplicate execution engine.

## C. Dashboard duplication analysis

| Surface | Runtime | Purpose | Duplicate? |
|---|---|---|---|
| `/app/dashboard` | [Dashboard.jsx](../src/pages/dashboard/Dashboard.jsx) + `/api/dashboard/summary` | Fast operational landing dashboard | No; specialised |
| `/app/dashboards` | [DashboardBuilder.jsx](../src/pages/dashboard/DashboardBuilder.jsx) + `/api/dashboards/*` | Configurable saved dashboard builder/runtime | No; configurable analytics |
| Platform “Dashboards” link | [platformNav.js](../src/pages/settings/Platform/platformNav.js) | Entry point to configurable dashboard page | Same destination, intentional cross-link |
| Marketing dashboard mockup | [AppMockups.jsx](../src/marketing/components/AppMockups.jsx) | Product marketing only | No runtime overlap |

The current implementation has **two dashboard implementations**, but they are not duplicate products. The older operational dashboard should remain the default landing experience. The configurable Dashboard Builder should remain separately discoverable and may later become a selectable landing destination only through existing landing-precedence rules.

## D. Dock / Platform Object integration

### Current discovery model

- Dock rendering is in [AdminNavDock.jsx](../src/components/AdminNavDock.jsx).
- Dock items are assembled by [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx).
- Page grouping and app switching are in [adminApps.js](../src/utils/adminApps.js).
- Stable page routes are declared in [adminRoutes.js](../src/utils/adminRoutes.js).
- App/module catalogue is defined in [internalAppCatalog.js](../services/internalAppCatalog.js).
- Module enablement is persisted in `platform_modules` and `platform_module_access`.
- Platform Objects are persisted in `platform_objects` and configured through [PlatformAdmin.jsx](../src/pages/settings/PlatformAdmin.jsx).

The Dock currently discovers **hard-coded page names** after server-side module and permission filtering. It does not discover `platform_objects` or `platform_pages` as navigation entries.

### Smallest clean integration

Reuse the existing module/app catalogue and page metadata rather than adding navigation columns directly to `platform_objects`.

Recommended model:

```text
platform_objects
  -> platform_pages (page_type = dashboard/page, target object key)
  -> platform_apps / platform_modules
  -> module access/licence
  -> object permission + user permission
  -> device/profile filtering
  -> AdminLayout/AdminNavDock
```

Required metadata can live in an existing `platform_pages.definition` or app/page configuration:

- `showInNavigation`
- `navigationLabel`
- `iconKey`
- `navigationOrder`
- `targetObjectKey`
- optional `moduleKey`/app association

This avoids schema changes to `platform_objects` and reuses `platform_pages`, `platform_apps`, `platform_modules`, and existing permissions.

Expected behavior:

- Standard Objects: exposed only when their owning module/configuration enables them.
- Custom Objects: administrators choose whether a page targeting the Object is visible in navigation.
- No module/licence: no entry.
- No Object permission/user permission: no entry and no usable deep link.
- Device/app profile filtering remains applied after access filtering.

**Classification:** **P1 — PLATFORM VERSION SHOULD REPLACE HARDCODED NAVIGATION for configurable Objects**, but do not remove current hard-coded operational pages.

## E. Configuration outside the Object ecosystem

### E1. Legacy/custom configuration inventory

| Name | Files | Current owner/module | What it does | Platform equivalent | Classification |
|---|---|---|---|---|---|
| Customer platform extensions | [PlatformExtensionFields.jsx](../src/components/platform/PlatformExtensionFields.jsx), [platformDomainRecords.js](../services/platformDomainRecords.js) | Platform bridge attached to Customer/Product/User forms | Stores tenant custom values in `platform_record_associations.custom_values` | Platform Object → Fields/Record Types | **ALREADY BRIDGED** |
| Product import `platform.*` fields | [productImportExport.js](../services/productImportExport.js) | Product import/export | Maps CSV headers beginning `platform.` into Platform extension values | Platform Object → Product → Fields | **ALREADY BRIDGED** |
| Generic Form/Layout definitions | [formDefinition.js](../src/pages/settings/Platform/formDefinition.js), [LayoutEditor.jsx](../src/pages/settings/Platform/LayoutEditor.jsx), [platform_layouts] | Platform | Defines field/text/divider/action/related-list layouts | Platform Form/Layout | **PLATFORM OWNER** |
| Validation rules | [platformValidation.js](../services/platformValidation.js), [RuleEditor.jsx](../src/pages/settings/Platform/RuleEditor.jsx), `platform_rules` | Platform | Safe metadata rules evaluated on record mutation | Platform Validation Rules | **PLATFORM OWNER** |
| Formula/rollup definitions | [platformFormula.js](../services/platformFormula.js), field config in `platform_fields` | Platform | Safe derived fields and rollup metadata | Platform Formula/Rollup | **PLATFORM OWNER** |
| Workflow/automation rules | [platformWorkflow.js](../services/platformWorkflow.js), [platformAutomation.js](../services/platformAutomation.js), [WorkflowAdmin.jsx](../src/pages/settings/Platform/WorkflowAdmin.jsx) | Platform | Workflow lifecycle, durable jobs, actions, approvals | Platform Workflow/Action | **PLATFORM OWNER** |
| Registered record actions | [platformActions.js](../services/platformActions.js), action execution in [platform.js](../routes/platform.js) | Platform | Shared action registry and record action execution | Platform Action | **PLATFORM OWNER** |
| Platform relationships | [RelationshipEditor.jsx](../src/pages/settings/Platform/RelationshipEditor.jsx), `platform_relationships` | Platform | Registered lookup/one-to-many/many-to-many relationships | Platform Relationship | **PLATFORM OWNER** |
| Platform list views | [ObjectRecordList.jsx](../src/pages/settings/Platform/ObjectRecordList.jsx), `platform_list_views` | Platform | Configurable object list columns/filters/sort | Platform List View | **PLATFORM OWNER** |
| Saved custom reports | [CustomReportsAdmin.jsx](../src/pages/reports/CustomReportsAdmin.jsx), `custom_reports` | Reports | User-created report definitions | Platform Report | **ALREADY BRIDGED / P1 presentation consolidation** |
| Saved dashboards | [DashboardBuilder.jsx](../src/pages/dashboard/DashboardBuilder.jsx), `dashboards` | Reports/Dashboard | Saved report-backed dashboard layouts | Platform Dashboard | **ALREADY BRIDGED** |
| Settings field catalogue | [SettingsAdmin.jsx](../src/pages/settings/SettingsAdmin.jsx) | Settings / integrations | Provider/integration field configuration, not record metadata | Platform fields are not an equivalent | **SPECIALISED BUSINESS CONFIGURATION — KEEP** |
| Integration field mapping | [integrationFieldResolver.js](../services/integrationFieldResolver.js), [integrationMapping.js](../src/services/integrationMapping.js) | Integrations | Resolves partner payload paths and mappings | Not a record-field builder | **SPECIALISED BUSINESS LOGIC — KEEP** |

### E2. Business logic that should remain outside Platform metadata

These are not duplicate configuration systems and should remain authoritative:

- Stock movement and persisted balances: [inventory.js](../services/inventory.js), [stockMovement.js](../src/services/stockMovement.js).
- Sale finalisation, payments, returns, exchanges: [sales.js](../routes/sales.js), [returns.js](../routes/returns.js), [exchanges.js](../routes/exchanges.js).
- Purchase receiving and supplier accounting: [purchases.js](../routes/purchases.js), [supplierAccounts.js](../routes/supplierAccounts.js), [purchasing.js](../services/purchasing.js).
- VAT/profit calculations: [profitMargin.js](../services/profitMargin.js), VAT report routes, sale/inventory services.
- Customer credit/loyalty: [customerCredit.js](../services/customerCredit.js), customer loyalty routes/components.
- Online order providers and sale creation: `services/onlineOrders/`, [online.js](../routes/online.js).
- Offline queue/reconciliation: [offlineQueue.js](../src/services/offlineQueue.js), [connectivity.js](../src/services/connectivity.js).
- Accounting export/integration dispatch: [accountingExportDispatch.js](../services/accountingExportDispatch.js), [integrationDispatcher.js](../services/integrationDispatcher.js).

Classification for all above: **SPECIALISED BUSINESS LOGIC — KEEP**.

## F. Object coverage matrix

Legend: `YES` = registered/integrated; `PARTIAL` = registered or bridged but incomplete coverage; `OPTIONAL` = navigation depends on configuration; `NO` = not currently represented as a Platform Object.

| Entity | Object | Fields | Relationships | Forms | Validation | Actions | Reportable | Dock | Specialised page |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Product | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Customer | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Supplier | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Category | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Price List | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Store | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Business Division | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | OPTIONAL | YES |
| Employee/User | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Sale | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Sale Item | NO | NO | NO | NO | NO | NO | PARTIAL via Sales | NO | NO |
| Inventory balance | YES (operational seed) | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Inventory movement | YES (optional operational seed) | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Purchase Order/Purchase | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Purchase Receipt | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Supplier Invoice | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | NO | YES |
| Payment | NO as standalone object | NO | NO | NO | NO | NO | YES via Payments report | NO | YES |
| Return/Exchange | NO as standalone object | NO | NO | NO | NO | NO | PARTIAL via Sales/Returns | NO | YES |
| Layaway | NO | NO | NO | NO | NO | NO | NO | NO | YES |
| Online Order | YES (operational seed) | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Promotion/Discount | NO standalone object | NO | NO | NO | NO | NO | PARTIAL via Sales | NO | YES |
| Loyalty | NO standalone object | NO | NO | NO | NO | NO | PARTIAL via Customers | NO | YES |
| Customer Credit | NO standalone object | NO | NO | NO | NO | NO | NO | NO | YES |

The `YES` values for forms/validation/actions mean the generic platform mechanisms are available, not that every specialised business page has been fully migrated to use them for every operation. System-object protections intentionally keep writes in specialised services.

## G. Specialised Custom Pages that should remain

Keep these as specialised pages even when a corresponding Platform Object exists:

- POS/Till and checkout: [POS.jsx](../src/pages/pos/POS.jsx).
- Sales, payments, returns, exchanges, held sales, layaways.
- Inventory, batches, replenishment, stock movement, opening stock.
- Purchasing, receiving, supplier accounts, invoices.
- Customer credit, loyalty, segments, imports, gift cards.
- Online order intake/prep and provider integrations.
- Accounting exports and integration setup.
- Attendance and employee operational management.
- Global product master/import and barcode workflows.
- Self-checkout and scan-and-go.

Reason: these pages encode transaction ordering, concurrency, financial integrity, provider protocols, offline behavior, or domain-specific UX that generic metadata pages must not replace.

## H. Orphan/dead UI candidates

These are cleanup candidates requiring a separate reachability decision; none were deleted:

1. **Platform global versus object-scoped tools**: `PlatformAdmin.jsx` exposes global lists for Objects, Relationships, Forms, and Validation Rules while selected-object tabs expose the same concepts. The UI comments explicitly distinguish the contexts, so this is not currently dead, but it is a consolidation candidate.
2. **Legacy settings tab aliases**: `SETTINGS_TAB_SLUGS` in [adminRoutes.js](../src/utils/adminRoutes.js) retains `Users & Permissions`, `Online Platforms`, and `Integrations` aliases for old deep links. These are compatibility routes, not active duplicate pages.
3. **Platform studio naming**: `Platform Reports & Apps` in [platformNav.js](../src/pages/settings/Platform/platformNav.js) overlaps conceptually with Reports and Dashboards but currently owns Platform app/page configuration. Review naming only.
4. **Marketing dashboard mockups**: [AppMockups.jsx](../src/marketing/components/AppMockups.jsx) is not dead, but should remain clearly separated from runtime dashboard code.
5. **Unused/conditionally loaded platform screens**: Platform subcomponents such as `ValueSetList`, `InternalAppCatalog`, `WorkflowRunsAdmin`, and lazy `LayoutList`/`LayoutEditor` are route/view dependent. Their imports should be checked during a future cleanup, but no source evidence in this audit justifies deletion.
6. **Operational seed coverage flag**: `initializePlatformMetadata(pool, { includeOperationalObjects = false })` means operational Objects may be absent in deployments that do not enable the flag. This is a deployment/configuration review item, not an orphan UI.

## I. Navigation duplication and issues

### Current navigation map

```text
AdminLayout
├─ Floating AdminNavDock
│  ├─ Quick access: Dashboard, Sales, Products, Inventory, Customers, Reports
│  └─ Launcher:
│     ├─ Operations: Sales, Returns, Supplier Returns, Order Prep, Payments, Open Till
│     ├─ Catalogue & Supply: Products, Global Products, Categories, Purchases, Suppliers, Inventory, Replenishment
│     ├─ Business: Customers, Employees, Stores, Reports
│     └─ Admin: Integrations, Accounting, Settings, Audit Log
├─ Reports
│  ├─ Reports → curated operational reports
│  └─ My Reports → custom saved report builder
├─ Dashboards → configurable Dashboard Builder
├─ Settings → Settings sections
│  └─ Platform → PlatformAdmin
│     ├─ Objects
│     ├─ Value Sets
│     ├─ Relationships
│     ├─ Forms
│     ├─ Validation Rules
│     ├─ Automation & Approvals
│     ├─ Workflow Runs
│     ├─ Platform Reports & Apps
│     └─ Internal Apps
└─ Platform object context
   ├─ Object list
   ├─ Object editor
   ├─ Fields
   ├─ Relationships
   ├─ Forms/layouts
   ├─ Rules
   ├─ Record Types
   └─ Object records
```

### Issues

- `Reports` appears in both the `Business` launcher group and the `Insights` switcher group depending on which navigation surface is used. It is the same destination, not a feature duplicate.
- `Dashboards` is not in the `GROUPS` list in [AdminNavDock.jsx](../src/components/AdminNavDock.jsx), although it is inserted into the primary `items` list by [AdminLayout.jsx](../src/pages/admin/AdminLayout.jsx). This can make it appear in an uncategorised/remaining group rather than a deliberate Insights location.
- Platform links to Reports and Dashboards intentionally leave Platform, but the labels “Platform Reports & Apps” and “Dashboards” can be confused by administrators.
- Object-specific configuration is deliberately absent from the global Platform rail and appears only after selecting an Object. This is correct context separation, but needs clear breadcrumbs.
- There is no metadata-driven custom Object entry in the Dock. The current Dock is page/module-driven.
- The Settings page still carries compatibility destinations and broad configuration that do not belong to Platform Objects, especially hardware, providers, VAT, receipts, and integrations. These should remain outside the Object ecosystem.

## J. Recommended migration order

### P0 — architectural duplication / dangerous

1. Do not introduce another Object CRUD/query/action engine.
2. Preserve `systemObject()` protections so generic Platform CRUD cannot bypass sale, stock, payment, purchasing, accounting, loyalty, or provider services.
3. Keep inventory balances, financial calculations, sale finalisation, returns, and reconciliation authoritative in domain services.
4. Treat any future navigation-generated Object page as permission/licence filtered server-side; metadata alone must never grant access.

### P1 — should consolidate

1. Add a metadata-driven Object-to-Page navigation bridge using existing `platform_pages`, `platform_apps`, `platform_modules`, module access, permissions, and device/profile filtering.
2. Make `Dashboards` an explicit Insights item in every navigation grouping rather than allowing it to fall through to “Workspace”.
3. Present `Reports` and `My Reports` as one Reports family with clear curated/configurable labels.
4. Add an explicit “Object configuration” breadcrumb/context indicator so global and selected-object Forms/Rules/Relationships are visibly different.
5. Review whether operational seed Objects should be enabled consistently in all deployment/bootstrap paths.

### P2 — useful cleanup

1. Inventory all legacy settings aliases and document which are compatibility-only.
2. Audit conditional/lazy Platform imports and remove only proven unreachable components.
3. Standardise names: “Platform Reports & Apps” versus “Reports”, “Dashboards”, and “Internal Apps”.
4. Add a generated route/navigation inventory test to detect duplicate labels pointing to different destinations or uncategorised pages.
5. Add a coverage report for standard Objects showing whether fields, relationships, layouts, rules, actions, and report metadata are seeded.

### P3 — optional polish

1. Allow administrators to choose a configurable dashboard as a landing destination while preserving current user → role → device/profile → company precedence.
2. Add icon/order metadata to Object-targeted navigation page definitions.
3. Improve Dock search to include permitted configured Objects after the navigation bridge exists.
4. Add a visual distinction between specialised operational pages and generic Object pages.

## Audit conclusion

The repository does not show a second competing configurable Object/Field/Form/Workflow/Action architecture. The Platform metadata system is the configuration owner. Most apparent duplicates are either:

- specialised operational pages intentionally protected from generic CRUD, or
- curated versus configurable reporting/dashboard experiences.

The clearest genuine consolidation gap is navigation: Platform Objects and Platform Pages are not yet first-class Dock/app-menu entries. That can be addressed later by reusing existing page/app/module metadata and access checks, without schema duplication or changes to the business engines.
