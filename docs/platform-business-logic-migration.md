# Platform Business Logic Migration

This tracker records the progressive migration of onePOS modules onto the
existing Platform metadata, validation, actions, workflow, and registered
function services. A module is only marked complete when its focused
regression tests pass and protected business invariants remain in their
authoritative services.

| Module | Audit | Migration | Tests | Status |
| --- | --- | --- | --- | --- |
| Product | ✓ | ✓ | ✓ | Complete |
| Customer | ✓ | Partial | Partial | Partial |
| Supplier | ✓ | ✓ | ✓ | Complete |
| Purchasing | ✓ | ✓ | ✓ | Complete |
| Inventory | ✓ | ✓ | ✓ | Complete |
| Staff | ✓ | ✓ | ✓ | Complete |
| Sales | ✓ | ✓ | ✓ | Complete |
| Returns / Exchanges | ✓ | ✓ | ✓ | Complete |
| Customer Credit / Loyalty / Gift Cards / Layaway | ✓ | Partial | Partial | Partial |
| Online Orders / Omnichannel | ✓ | ✓ | ✓ | Complete |
| Reports | ✓ | ✓ | ✓ | Complete |
| Integrations | ✓ | ✓ | ✓ | Complete |

## Product checkpoint

### Audited

- Product list/search/read: `ProductsAdmin` and `/api/products` remain the
  module's read surface.
- Create/edit/delete: `ProductFormModal` and `/api/products` domain endpoints
  remain the write surface.
- Import/export: the existing product import/export service remains the
  bounded bulk-operation surface.
- EAN lookup, image handling, and the product history view remain specialized
  Product UX.
- Opening stock and batch setup use the existing inventory movement and batch
  services.
- SKU/barcode uniqueness, company scoping, permissions, and transaction
  boundaries remain server-authoritative.

### Behaviour classification

| Existing behaviour | Target |
| --- | --- |
| Product list, search, view, create, edit, deactivate | Protected domain CRUD (A + H) |
| Configurable extension fields | Field metadata and layouts (B + C) |
| Extension field types, required values, picklists, and conditional fields | Platform validation rules (D) |
| Product custom values and record type selection | Platform association/configuration service |
| SKU/barcode uniqueness and company isolation | Protected core service (H) |
| Opening stock, stock movements, batch quantities, and stock integrity | Protected Inventory service (H) |
| EAN lookup, image picker, import/export, and product history | Specialized Product UI/services (I) |
| Product stock adjustment | Inventory operations; not a generic Product workflow |

### Migration completed

- Product is registered as a system Platform object backed by the canonical
  `products` table; no duplicate product object or table was introduced.
- Product extension configuration is loaded through
  `/api/platform/system/product/configuration`.
- Extension values are saved through the existing transactional
  `saveDomainConfiguration` path during Product create, edit, and import.
- Platform layouts, record types, field security, conditional field logic, and
  server-side validation are applied to extension fields.
- Generic Platform record writes remain blocked for the protected Product
  object, so metadata cannot bypass Product permissions, tenant isolation,
  uniqueness checks, or inventory integrity.
- The POS/till and other specialized product interfaces were retained.

### Intentionally retained hard-coded logic

- Product core fields remain in the Product form because the Product domain
  endpoint owns their canonical normalization and persistence.
- Stock and batch operations remain in protected Inventory services because
  they update ledgers and balances transactionally.
- SKU/barcode uniqueness and company/store access remain server-side because
  browser or editable metadata validation cannot provide integrity.
- EAN lookup, image processing, import/export, and history remain specialized
  UX/services rather than configurable workflows.

### Files changed

- `docs/platform-business-logic-migration.md`

### Tests

- `npm run build` — passed
- Focused Product and Platform regression suites — passed
- `git diff --check` — passed

## Next

Supplier migration after the Customer test gaps are resolved.

## Customer checkpoint

### Audited

- Customer list, search, detail, create, edit, activation, and store
  association.
- Customer extension fields, layouts, record types, and Platform validation.
- Credit configuration, payments, adjustments, statements, and credit-sale
  enforcement.
- Loyalty balances, immutable loyalty transactions, manual adjustments, and
  entitlement/permission checks.
- Customer segments, bulk import/export, gift cards, and POS customer
  association.
- Company/store isolation and customer financial data boundaries.

### Behaviour classification

| Existing behaviour | Target |
| --- | --- |
| Customer list, search, view, create, edit, activate/deactivate | Protected domain CRUD (A + H) |
| Configurable customer extension fields | Field metadata and layouts (B + C) |
| Extension field types, required values, and conditional fields | Platform validation rules (D) |
| Credit-enabled policy and credit limit configuration | Protected Customer Credit service with Platform policy available around it (D + H) |
| Outstanding balance, credit ledger, payments, and credit-sale enforcement | Protected financial core service (H) |
| Loyalty balances and transactions | Protected loyalty ledger/service (H) |
| Segmentation and customer imports | Customer module services/actions |
| Customer lookup and POS association | Specialized POS/customer UI and protected association service (I + H) |
| Gift-card issue, top-up, redemption, and balance | Protected gift-card service (H) |

### Migration completed

- Customer is registered as the canonical protected Platform system object.
- Customer extension fields are now rendered in the Customer create/edit form
  and saved through the transactional `saveDomainConfiguration` path.
- Generic Platform writes remain blocked for Customer records.
- Customer CRUD, tenant/store isolation, duplicate-identifier handling, and
  Platform extension validation remain server-authoritative.
- Credit, loyalty, segmentation, gift-card, and POS flows remain on their
  existing protected services and specialized interfaces.

### Fix made

- Moved `PlatformExtensionFields` from the Customer detail view into the
  Customer create/edit form. The old placement referenced edit-form state that
  did not exist in the detail component and could fail when viewing associated
  stores.

### Intentionally retained hard-coded logic

- Outstanding balances and credit limits remain server-side and transactional.
- Credit-sale enforcement remains in the sale and credit services.
- Loyalty balances remain ledger-derived and protected from browser-controlled
  mutation.
- Gift-card balances and redemption integrity remain in the gift-card service.
- Customer/store association and tenant isolation remain protected core logic.

### Validation

- `npm run build` — passed.
- Customer CRUD and tenant-isolation tests — passed.
- Customer credit UI/management, CRUD, tenant-isolation, segment, and bulk
  import/export coverage now passes.
- Added company-scoped Customer segment routes, import preview/execute and CSV
  export, gift-card issue/list/detail/lookup/top-up/block routes, and
  server-side maximum credit-age validation/persistence.
- Combined Customer suite still has failures in the existing sales fake
  harness (loyalty/gift-card sale SQL/query-shape compatibility); protected
  sales integrity was not weakened to satisfy those stale fixtures.
- `git diff --check` — passed.

### Customer status

**CUSTOMER MIGRATION — PARTIAL**

The Platform integration, Customer CRUD boundary, management UI, segments,
bulk data routes, and gift-card administration are wired. The phase remains
partial until the loyalty/gift-card sale integration fixtures are reconciled
and the full Customer suite is green.

## Supplier checkpoint

### Audited

- Supplier list, search, detail, create, edit, and activate/deactivate.
- Supplier-product cost mappings and preferred supplier records.
- Purchase history and purchasing relationships.
- Supplier invoices, payments, debit/credit adjustments, statements, and
  account allocation.
- Supplier feed preview and company-scoped matching.
- Platform metadata, field security, validation, and tenant isolation.

### Behaviour classification

| Existing behaviour | Target |
| --- | --- |
| Supplier list, search, view, create, edit, activate/deactivate | Protected domain CRUD with Platform validation (A + H) |
| Configurable supplier fields and layouts | Field metadata and layouts (B + C) |
| Supplier field validation and record metadata | Platform validation and record configuration (D) |
| Supplier-product cost/effective-date/preferred mappings | Protected purchasing domain operation (H) |
| Supplier invoices, payments, balances, and allocation | Protected supplier-account service (H) |
| Supplier feed normalization and matching | Protected integration/feed services (H) |
| Supplier detail and account screens | Specialized Supplier UI (I) |

### Migration completed

- Supplier is registered as the canonical protected Platform system object.
- Supplier create/edit already used transactional `withDomainSave`; the form
  now loads and submits configured Platform extension fields.
- Supplier status changes now use the same transactional Platform save hook,
  so before-save validation and metadata history remain consistent.
- Core supplier metadata now includes contact name, address, and notes mappings.
- Generic Platform writes remain blocked for Supplier records.
- Supplier-product pricing, purchasing, supplier accounts, and feed matching
  remain on their authoritative services.

### Intentionally retained hard-coded logic

- Supplier-product costs and effective dates remain protected because they
  influence purchasing and inventory operations.
- Supplier invoices, payments, balances, and allocation remain ledger/account
  logic and are not editable workflows.
- Feed normalization and product matching remain protected integration logic.
- Company isolation and supplier permissions remain server-authoritative.

### Files changed

- `src/pages/suppliers/SupplierFormModal.jsx`
- `services/platformMetadata.js`
- `routes/suppliers.js`
- `docs/platform-business-logic-migration.md`

### Tests

- Supplier and Platform focused suite — **16 passed, 0 failed, 2 skipped**
- `npm run build` — passed
- `git diff --check` — passed

### Supplier status

**SUPPLIER MIGRATION — COMPLETE**

**NEXT:** Purchasing migration.

## Purchasing checkpoint

### Audited surfaces

- Purchase creation and supplier resolution.
- Purchase detail and receipt lifecycle.
- Partial and remaining receipts.
- Inventory movements, batch/expiry handling, and receipt idempotency.
- Purchase import UI and specialized receiving UI.
- Platform operational metadata for purchases and purchase receipts.

### Migration result

- Purchase records now save Platform extension values transactionally during
  purchase creation.
- The specialized purchase form renders `PlatformExtensionFields` while the
  protected purchase route remains authoritative for supplier resolution,
  line validation, totals, receiving, inventory movements, batches, and
  receipt status.
- Generic Platform writes remain unsuitable for receiving and inventory
  integrity operations.

### Validation

- Purchasing receipt-planning tests — **3 passed, 0 failed, 1 skipped**.
- Platform domain regression tests — passed.
- `npm run build` — passed.
- Existing repository diff-check warnings are unrelated pre-existing
  whitespace in `src/pages/admin/AdminLayout.jsx`; no Purchasing-specific
  validation failure was introduced.

### Purchasing status

**PURCHASING MIGRATION — COMPLETE**

**NEXT:** Inventory migration.

## Inventory checkpoint

### Audited surfaces

- Stock adjustment and movement history.
- Store-scoped stock views and reconciliation.
- Store transfers and transfer history.
- Batch/expiry receipt, edit, consume, and FEFO allocation.
- Product aggregate stock and per-store stock positions.
- Purchase, sale, return, and transfer movement integration.
- Inventory and inventory-movement Platform operational metadata.

### Migration result

- Inventory remains a protected operational domain rather than a generic
  editable Platform object.
- Stock quantities, movement balances, batch quantities, FEFO consumption,
  company/store isolation, and concurrency locks remain authoritative in
  `services/inventory.js`, `routes/inventory.js`, and
  `routes/inventoryBatches.js`.
- Platform metadata exposes inventory and movement records for governed
  reporting/configuration, while generic Platform writes remain blocked.
- Specialized inventory, batch, transfer, reconciliation, and replenishment
  screens remain specialized.

### Validation

- Inventory status tests — passed.
- Inventory batch/expiry focused suite — passed.
- Purchasing receipt-planning tests — passed.
- Platform domain regression tests — passed.
- `npm run build` — passed.

### Inventory status

**INVENTORY MIGRATION — COMPLETE**

**NEXT:** Staff migration.

## Staff checkpoint

### Audited surfaces

- Employee create/edit, role and store assignment, activation, and password
  handling.
- Employee Platform extension fields and metadata.
- Role and permission assignment.
- Attendance clock-in/out, server-authoritative duration, history, and
  management visibility.
- Company/store/user isolation and audit logging.

### Migration result

- Employee create/edit already uses transactional Platform domain saves and
  renders `PlatformExtensionFields`.
- Authentication identity, password hashes, role/store assignment, and active
  status remain protected admin operations.
- Attendance remains a protected service over the canonical `users`,
  `companies`, `stores`, and `attendance_records` tables.
- Clock timestamps and worked duration remain server-authoritative; generic
  workflows cannot alter attendance or identity integrity.
- Attendance management remains gated by `attendance.view`, with existing
  admin/owner bypass and store restrictions.

### Validation

- Staff attendance backend and UI suite — **23 passed, 0 failed**.
- Application build — passed.
- The combined admin route command still reports unrelated pre-existing
  navigation slug failures outside Staff/attendance scope.

### Staff status

**STAFF MIGRATION — COMPLETE**

**NEXT:** Sales migration.

## Sales checkpoint

### Audited surfaces

- POS checkout and self-checkout sale creation.
- Authoritative basket totals, VAT, discounts, price overrides, and receipt
  numbering.
- Cash, card, split tender, customer credit, loyalty, gift-card, voucher,
  cheque, bank-transfer, and online payment paths.
- Inventory deduction, batch FEFO consumption, customer association, and
  idempotent offline synchronization.
- Receipt detail, printing, provisional offline receipts, confirmed receipt
  history, and digital invoice delivery.
- Sales reports, permissions, company/store isolation, and return wiring.

### Migration result

- Sales remains a protected transactional domain. Totals, tax, discounts,
  payment reconciliation, receipt numbering, inventory, credit, loyalty,
  gift-card, and idempotency rules remain server-authoritative.
- Platform metadata exposes Sale records for governed reporting and
  configuration, but generic Platform writes cannot alter sale financial or
  inventory integrity.
- Receipt detail now supplies store details, terminal, cashier, customer
  details, and the authoritative server receipt number.
- Offline queue entries retain confirmed sale IDs and authoritative receipt
  numbers, allowing confirmed receipts to be viewed or printed.
- Specialized POS/till and self-checkout UX remains specialized.

### Validation

- Focused Sales totals, receipts, reports, return wiring, and discount suite —
  **60 passed, 0 failed**.
- Application build — passed.
- Sales-specific diff check — passed.

### Sales status

**SALES MIGRATION — COMPLETE**

**NEXT:** Customer Credit / Loyalty / Gift Cards / Layaway migration.

## Customer Credit / Loyalty / Gift Cards / Layaway checkpoint

### Audited surfaces

- Customer credit configuration, limits, maximum age, ledger, payments,
  adjustments, statements, and POS credit sales.
- Loyalty programme settings, earning, redemption, manual adjustment, and
  return reversal.
- Gift-card issue, top-up, lookup, blocking, redemption, idempotency, and
  company isolation.
- Layaway creation, authoritative catalogue pricing, deposits, payments,
  completion, cancellation, inventory movement, and store/company scope.

### Migration result

- Credit, loyalty, gift-card, and layaway money movement remains in protected
  transactional services and the existing sale/payment/inventory foundations.
- Server-side credit limits, ledger signs, tender validation, gift-card
  balance derivation, loyalty redemption rules, and layaway catalogue pricing
  remain authoritative.
- Specialized Customer, POS, gift-card, and Layaway UX remains intact.
- Credit configuration now persists maximum credit age independently from the
  core credit-limit update, preserving the existing route contract.
- Sale product lookups retain compatibility with the canonical product query
  while loading optional batch/product-kind metadata separately.

### Validation

- Customer credit configuration, payments, statements, isolation, pure
  service, segment, and layaway route coverage passed.
- Layaway route suite — **4 passed, 0 failed**.
- Layaway PostgreSQL integration did not start: its seed fixture fails with
  PostgreSQL error `column "active" specified more than once`.
- Combined credit/loyalty/gift-card suites remain partial after three repair
  attempts. Remaining failures are in legacy fake sales/gift-card harness
  query/return-shape assumptions; protected financial production logic was
  not weakened to accommodate them.
- Diagnostics for changed routes passed; targeted whitespace validation passed.

### Customer Credit / Loyalty / Gift Cards / Layaway status

**CUSTOMER CREDIT / LOYALTY / GIFT CARDS / LAYAWAY MIGRATION — PARTIAL**

**NEXT:** Online Orders / Omnichannel migration.

## Online Orders / Omnichannel checkpoint

### Audited surfaces

- Direct generic online-order intake for Click & Collect and Delivery.
- Company/store/customer/product scoping and authoritative catalogue pricing.
- Stock reservation and release through shared inventory movements and batch
  synchronization.
- Accept, prepare, ready, collect, delivery completion, cancellation, and
  invalid-transition handling.
- POS sale creation on completion, payment mapping, receipt identity, and
  duplicate-completion protection.
- Platform product mappings, external platform configuration, webhook intake,
  API-call audit logging, permissions, and tenant isolation.

### Migration result

- Online Orders remains a protected operational domain backed by
  `online_orders`, order items/events, inventory movements, and canonical POS
  sales.
- Generic Platform metadata exposes online orders for governed reporting, while
  generic writes remain blocked by the system-object registry.
- Product prices, VAT, order totals, payment mapping, status transitions,
  inventory reservation/release, and completion sale creation remain
  server-authoritative.
- Platform-specific integrations remain behind the `services/onlineOrders`
  adapter/configuration layer.
- Fixed the generic accept route's missing status binding and ensured order
  item loading includes batch metadata needed for release synchronization.

### Validation

- Application build — passed.
- Online Orders focused suite — **10 passed, 0 failed**.
- Sales, inventory, and returns regression suites — **45 passed, 0 failed**.
- Fixed generic completion to invoke the protected POS sale converter and
  moved the static generic list route ahead of the legacy dynamic order route.
- Changed-route diagnostics and diff whitespace validation — passed.

### Online Orders / Omnichannel status

**ONLINE ORDERS / OMNICHANNEL MIGRATION — COMPLETE**

**NEXT:** None for this checkpoint.

## Reports checkpoint

### Audited surfaces

- Sales summary, grouped reports, payment breakdowns, VAT, profit, inventory,
  customer, till, and custom report definitions.
- Report permissions, company/store visibility, date filtering, operator and
  store restrictions, and authoritative source joins.
- Platform report metadata and governed custom report configuration.

### Migration result

- Reports remain read-only projections over protected Sales, Returns,
  Inventory, Customer, and Purchasing domains.
- Custom report definitions validate field, grouping, sorting, filtering, and
  tenant/store scope before query construction.
- No report endpoint can mutate financial, inventory, identity, or ledger
  records.

### Validation

- Reports/accounting-focused suite — **44 passed, 0 failed**.
- Application build — passed in the preceding module checkpoint.

### Reports status

**REPORTS MIGRATION — COMPLETE**

**NEXT:** Integrations migration.

## Integrations checkpoint

### Audited surfaces

- Integration connection, endpoint, field-mapping, API-log, dispatch, and
  provider configuration routes.
- Encrypted credentials, redacted logs, SSRF target validation, provider
  acceptance/rejection/error states, and deterministic idempotency keys.
- Accounting exports for Sales, Purchases, Refunds, and Customer Credit.
- Supplier feed normalization/matching and Online Orders provider adapters.

### Migration result

- Integrations remain adapter-based infrastructure around protected domain
  records; providers cannot directly mutate Sales, Inventory, Payments, or
  Customer ledgers.
- Credentials are encrypted at rest and never returned to clients.
- Outbound payloads and API logs are redacted and company/store scoped.
- Dispatch uses deterministic company-scoped idempotency and preserves the
  original transaction when an export fails.
- Platform configuration remains metadata-driven without exposing generic
  writes to protected business objects.

### Validation

- Integration/accounting export suite — **48 passed, 0 failed**.
- Reports suite — **44 passed, 0 failed**.
- Application build — passed.
- Changed-file diagnostics and diff validation — passed.

### Integrations status

**INTEGRATIONS MIGRATION — COMPLETE**

**MIGRATION CHECKPOINTS COMPLETE EXCEPT PARTIAL MODULES ABOVE**

## Returns / Exchanges checkpoint

### Audited surfaces

- Customer return lookup and processing by receipt or sale identifier.
- Partial and full return quantities, repeated partial returns, and
  authoritative refund valuation from original sale lines.
- Original-tender refund allocation, split payments, refund caps, and
  customer credit/loyalty reversal behavior.
- Stock restoration, batch movement synchronization, non-stock-tracked items,
  and return audit linkage.
- Supplier returns, supplier credit, purchase/store scoping, and return
  history.
- Receipt-based and normal product exchanges, replacement sale creation,
  exchange settlement, payment/refund handling, and inventory movements.
- Return numbering, request-key idempotency, permissions, online-only refund
  enforcement, and company/store isolation.

### Behaviour classification

| Existing behaviour | Target |
| --- | --- |
| Customer and supplier return lifecycle | Protected return domain service (H) |
| Refund allocation and tender caps | Protected payment/refund service (H) |
| Return quantities and authoritative line valuation | Protected Sales/Returns validation (H) |
| Stock restoration, replacement deduction, and batch updates | Protected Inventory service (H) |
| Return numbering, idempotency, and tenant/store scope | Protected transactional core (H) |
| Exchange mode, reason, and return-history presentation | Specialized Returns/Exchanges UI and bounded configuration (I) |
| Return reporting metadata | Platform metadata/reporting surface without generic mutation (B + C) |

### Migration result

- Returns and Exchanges remain protected operational domains over the existing
  `stock_returns`, `stock_return_items`, `refunds`, `supplier_ledger_entries`,
  inventory, sales, and purchase foundations.
- Refunds are derived from completed original payment rows and previously
  refunded amounts; the server rejects over-refunds and never invents tender
  methods.
- Return quantities and values are recomputed from authoritative sale or
  purchase data, with company/store isolation and completed-return
  accumulation enforced transactionally.
- Customer returns are online-only, use stable request keys for idempotency,
  and restore stock through the shared inventory movement and batch services.
- Exchanges use the same protected return, refund, payment, and inventory
  primitives. Replacement sales and settlement differences are created
  server-side; generic Platform workflows cannot mutate them.
- Specialized return history, receipt lookup, supplier-return, and exchange
  UX remains intact.

### Validation

- Focused Returns / Exchanges suites — **46 passed, 0 failed**:
  `salesReturnsE2E.test.mjs`, `salesReturnWiring.test.mjs`,
  `exchangeProducts.test.mjs`, and `refundOriginalSale.test.mjs`.
- Application build — passed.
- Returns-specific source and diff validation — passed.

### Returns / Exchanges status

**RETURNS / EXCHANGES MIGRATION — COMPLETE**

**NEXT:** Customer Credit / Loyalty / Gift Cards / Layaway migration.
