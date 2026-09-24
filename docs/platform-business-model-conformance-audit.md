# onePOS SFDC Business-Model Conformance Audit

Audit scope: read-only architecture and source audit. No code, schema, routes, navigation, data, or tests were changed for this audit.

## A. Executive summary

onePOS has a substantial metadata-driven Platform layer, but the physical business model is still a set of authoritative module-owned transaction and accounting services with selective Platform exposure. This is generally the correct safety boundary for POS and accounting integrity, but it is not yet a single SFDC-style record model.

The highest-impact findings are:

1. **Sale, return, and exchange are not one canonical transaction record.** `sales` is authoritative for sales, while returns use `stock_returns`/`refunds` and receipt exchanges create a stock return plus a replacement sale. There is no canonical SALE/RETURN/EXCHANGE discriminator.
2. **Sale Item and Payment are not reusable Platform records.** `sale_items` is not a standard Platform Object, and `payments` is tied to `sales`; layaway, supplier, and exchange settlement use additional payment models.
3. **There is no common internal Financial Ledger Object.** Customer credit and supplier accounting have separate ledgers, while sales/payment/accounting export remain separate models.
4. **Inventory has a sound authoritative movement service, but multiple persisted stock projections.** `inventory_movements` is the history, while `product_store_stock` and `products.stock_quantity` are current-state projections. Batch records and FEFO are integrated operationally but FEFO remains service policy rather than fully configurable Platform policy.
5. **Platform metadata is strongest for configuration, discovery, permissions, reporting, and audit.** Generic CRUD is deliberately blocked from protected system writes, so Platform Objects are currently a governed view/metadata layer over authoritative services, not a replacement transaction engine.
6. **Installable apps do not automatically create Dock entries from an Object alone.** A company Platform Page targeting the Object is still required. Entitlements, module access, permissions, and device profiles are available enforcement layers.

### Overall conformance

| Area | Status | Assessment |
|---|---|---|
| Metadata objects, fields, layouts, rules, reports, dashboards | **PARTIAL / STRONG** | Platform owns configurable metadata, but coverage is uneven across business records. |
| Canonical transaction model | **GAP** | Sales, returns, exchanges, refunds, and replacement sales are separate physical records. |
| Reusable payment model | **GAP** | Payments are sale-centric and split across module-specific tables. |
| Financial ledger model | **GAP** | Customer and supplier ledgers are separate; no common Financial Ledger record model. |
| Inventory integrity | **AUTHORITATIVE / PARTIAL PLATFORM** | Service and movement history are authoritative; current balances are projections and only partly metadata-exposed. |
| Platform navigation and search | **PARTIAL** | Generic search exists; Object-to-Dock still needs configured Platform Pages. |
| Permissions and audit/history | **STRONG / PARTIAL COVERAGE** | Platform permission/FLS/audit mechanisms exist; not every legacy record is first-class Platform metadata. |
| Specialised pages and integrations | **INTENTIONAL** | POS, accounting, purchasing, credit, and external integrations should remain service-owned. |

## B. Business record and transaction conformance

### B1. Sales, returns, and exchanges

| Concept | Current authoritative model | Platform status | Classification | Conformance |
|---|---|---|---|---|
| Sale header | `sales`; [routes/sales.js](../routes/sales.js) | Basic `sale` system Object in [services/platformMetadata.js](../services/platformMetadata.js) | Platform Object backed by authoritative service | **PARTIAL** |
| Sale item | `sale_items`; created by sales and online-order services | No standard Sale Item Object/complete relationship metadata | Related record outside Object ecosystem | **GAP** |
| Return | `stock_returns`; [routes/returns.js](../routes/returns.js) | No canonical Return Object | Authoritative specialised transaction | **GAP** |
| Refund | `refunds`; return/exchange settlement logic | No reusable Refund/Payment Object | Related financial record outside common model | **GAP** |
| Exchange | stock return plus replacement `sales` and `sale_items`; [routes/exchanges.js](../routes/exchanges.js) | No Exchange Object or transaction type | Specialised business workflow | **GAP** |

The current return/exchange Customer Credit reversal is transactionally integrated into the existing service, but it does not change the underlying split model.

**Required future convergence direction (recommendation only):** introduce a canonical transaction header/type association only after preserving the existing service ownership and audit semantics. Do not replace the existing sale, return, or exchange workflows with generic CRUD.

### B2. Payments and settlement

The primary `payments` table has `sale_id`, payment method, amount, provider fields, and status. It is therefore structurally sale-owned rather than a reusable settlement record. Other surfaces include:

- `layaway_payments` for layaway instalments;
- supplier payments and allocations in [routes/supplierAccounts.js](../routes/supplierAccounts.js);
- exchange refund allocation through `refunds` and replacement-sale payments;
- customer-credit ledger entries, which are accounting entries rather than payment rows;
- online orders that eventually create sales, items, and payments through [services/onlineOrders/saleCreator.js](../services/onlineOrders/saleCreator.js).

**Classification:** **DUPLICATE/PARALLEL CONFIGURATION CANDIDATE — NEEDS REVIEW**, not a reason to merge financial posting code immediately. A reusable Payment/Settlement Object could become the reportable relationship layer while authoritative tender posting remains service-owned.

### B3. Financial ledger

| Ledger | Physical model | Platform status | Assessment |
|---|---|---|---|
| Customer credit | `customer_credit_ledger`; [services/customerCredit.js](../services/customerCredit.js) | Package-owned customer credit account/ledger metadata and system mappings | Strong domain-specific ledger; not a general ledger |
| Supplier accounting | `supplier_ledger_entries`, supplier payments/allocations; [routes/supplierAccounts.js](../routes/supplierAccounts.js) | Not a common Financial Ledger Object | Separate authoritative accounting model |
| Sales/payments/accounting export | sales, payments, refund tables and [services/accountingExport.js](../services/accountingExport.js) | Export/normalisation only | Technical integration and separate posting sources |

There is no common internal Financial Ledger record model that relates customer credit, supplier accounting, payment settlement, refunds, and other future modules. This is a **P0/P1 architecture gap**, but any future convergence must preserve domain-specific posting controls and external-accounting boundaries.

## C. Inventory, stock movements, and FEFO

### C1. Current model

- `inventory_movements` is the authoritative movement history for sale, receipt, return, transfer, and adjustment effects.
- `product_store_stock` stores store-level current stock.
- `products.stock_quantity` stores an aggregate product projection.
- `inventory_batches` stores batch quantities, manufacturing/expiry dates, and batch status.
- [services/inventory.js](../services/inventory.js) owns movement posting, current-stock updates, batch consumption, receiving, expiry state, and FEFO allocation.
- [routes/inventory.js](../routes/inventory.js) provides balance reconciliation/rebuild operations.

**Classification:** **AUTHORITATIVE BUSINESS SERVICE WITH DERIVED PROJECTIONS — KEEP**, with Platform exposure and reconciliation improvements rather than generic replacement.

### C2. FEFO and batch policy

FEFO (`fefoCompare`, `allocateBatchConsumption`, `consumeInventoryBatch`) is hard-coded service policy. Batch metadata is available to Platform search/reporting and Batch & Expiry is an installable package, but there is no complete configurable Platform policy for FEFO ordering, exception handling, or allocation strategy.

**Classification:** **SPECIALISED BUSINESS LOGIC — KEEP**, with a later **P2 configurable-policy candidate** where company policy genuinely varies. Financial and stock integrity must remain in the inventory service.

### C3. Stock adjustments, transfers, and reconciliation

Adjustments and transfers are service/route workflows that write movements and update projections. They are not a single generic adjustment Object with metadata-driven posting. Reconciliation/rebuild is an operational safeguard, not a duplicate configuration engine.

**Classification:** **SPECIALISED BUSINESS LOGIC — KEEP**; expose records and audit evidence through Platform where useful.

## D. Platform metadata coverage matrix

| Business entity | Object registered | Fields | Relationships | Forms/layouts | Validation | Actions | Reportable | Dock | Specialised page |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Product | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Customer | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Supplier | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | YES | YES |
| Category | PARTIAL/system-backed | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NO | PARTIAL | OPTIONAL | YES |
| Price List | NO/PARTIAL module model | NO/PARTIAL | NO | NO | NO | NO | PARTIAL | NO | YES |
| Store | YES | YES | PARTIAL | YES | PARTIAL | PARTIAL | YES | OPTIONAL | YES |
| Business Division | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NO | PARTIAL | OPTIONAL | YES |
| Employee/User | YES/permission-backed | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | NO | YES |
| Sale | YES | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | YES | OPTIONAL | YES |
| Sale Item | NO | NO | NO | NO | NO | NO | INDIRECT | NO | NO |
| Payment | NO reusable Object | NO | NO | NO | NO | NO | YES via source | NO | NO |
| Return | NO | NO | NO | NO | Service checks | Service actions | INDIRECT | NO | YES |
| Refund | NO | NO | NO | NO | Service checks | Service actions | INDIRECT | NO | NO |
| Exchange | NO | NO | NO | NO | Service checks | Service actions | INDIRECT | NO | YES |
| Inventory / store stock | YES | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | YES | OPTIONAL | YES |
| Inventory Movement | YES | PARTIAL | PARTIAL | NO/limited | Service-owned | Service-owned | YES | NO | YES |
| Inventory Batch | YES | YES | YES | PARTIAL | PARTIAL | Service-owned | YES | OPTIONAL | YES |
| Purchase | YES/PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | YES | OPTIONAL | YES |
| Purchase Receipt | YES/PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | Service-owned | YES | NO | YES |
| Supplier Invoice | YES/PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | Service-owned | YES | OPTIONAL | YES |
| Supplier Ledger | NO common Object | NO | NO | NO | Service-owned | Service-owned | Indirect | NO | YES |
| Customer Credit Account | Package-owned YES | YES | YES | Package list views | YES templates | Registered actions, incomplete adapter | YES after package | OPTIONAL | Customer page |
| Customer Credit Ledger | Package-owned YES | YES | YES | Package list views | YES templates | Service-owned posting | YES after package | NO | Customer page |
| Layaway | NO/PARTIAL | NO/PARTIAL | NO/PARTIAL | NO | Service-owned | Service-owned | PARTIAL | OPTIONAL | YES |
| Online Order | YES | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | YES | NO | YES |
| Promotion | PARTIAL/module-specific | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Service-owned | PARTIAL | OPTIONAL | YES |
| Loyalty | Module/service model | PARTIAL | PARTIAL | NO/limited | Service-owned | Service-owned | PARTIAL | NO | YES |

“YES” means metadata registration exists, not that generic Platform CRUD owns mutations. System-object writes remain protected and delegated to authoritative services.

## E. Configuration outside the Object ecosystem

| Area | Files/modules | What it does | Platform equivalent | Classification |
|---|---|---|---|---|
| Customer credit configuration and posting | [routes/customers.js](../routes/customers.js), [services/customerCredit.js](../services/customerCredit.js) | Credit limits, payments, adjustments, statements, balance calculation, ledger posting | Customer Credit Account/Ledger Objects plus rules/actions | **ALREADY BRIDGED; specialised financial logic KEEP** |
| Supplier accounting | [routes/supplierAccounts.js](../routes/supplierAccounts.js) | Supplier invoices, payments, allocations, credits/debits, statements | Supplier, Invoice, Payment, Financial Ledger records | **NEEDS REVIEW** |
| Inventory and batch policy | [services/inventory.js](../services/inventory.js), [routes/inventoryBatches.js](../routes/inventoryBatches.js) | Stock posting, FEFO, expiry, receiving, consumption | Inventory Movement, Inventory Batch, policy metadata | **SPECIALISED BUSINESS LOGIC — KEEP; policy candidate** |
| Sales/returns/exchanges | [routes/sales.js](../routes/sales.js), [routes/returns.js](../routes/returns.js), [routes/exchanges.js](../routes/exchanges.js) | Integrity-sensitive posting, refunds, replacement sales, stock effects | Transaction, Sale Item, Payment, Return/Exchange related records | **NEEDS REVIEW; do not genericise posting** |
| Layaways | [routes/layaways.js](../routes/layaways.js) | Layaway lifecycle and instalment payments | Transaction/Payment related records | **NEEDS REVIEW** |
| Online order creation | [services/onlineOrders/saleCreator.js](../services/onlineOrders/saleCreator.js) | Converts online orders to sale/items/payments | Online Order related to canonical transaction | **ALREADY BRIDGED partially; needs common relationships** |
| Accounting export | [services/accountingExport.js](../services/accountingExport.js) | Normalises internal records for external accounting | External integration, not Platform configuration | **GENUINE EXTERNAL/TECHNICAL INTEGRATION — KEEP** |
| POS pricing/tender/stock workflows | [src/pages/pos/](../src/pages/pos/), sales/inventory services | Fast offline-capable operational UI and posting | Platform Objects can expose/report; services remain owner | **CUSTOM PAGE / SPECIALISED BUSINESS LOGIC — KEEP** |
| Loyalty posting | loyalty services/routes | Points earning/redemption and ledger effects | Loyalty Object/rules may describe configuration | **SPECIALISED BUSINESS LOGIC — KEEP** |
| VAT/financial calculations | sales, purchasing, accounting services | Financial integrity and tax calculations | Formula/report metadata may describe, not replace | **SPECIALISED BUSINESS LOGIC — KEEP** |

No separate legacy configurable form/field/rule/function builder comparable to Platform metadata was confirmed in the audited source. Legacy forms are primarily specialised page forms, not a second generic configuration system.

## F. Customer Credit, supplier accounting, purchasing, and other modules

### Customer Credit

Customer Credit is now an installable package with account and ledger metadata, relationships, list views, validation templates, permissions, system mappings, and registered workflow action names. The authoritative service remains [services/customerCredit.js](../services/customerCredit.js). It is surfaced through the customer page rather than a dedicated first-class app page. Registered workflow actions still require a supplied `creditActionExecutor`; a complete route/API adapter was not established.

**Status:** **ALREADY BRIDGED / PARTIAL**, with financial posting correctly service-owned.

### Supplier accounting and purchasing

Supplier invoices, ledger entries, payments, allocations, receiving, and purchase workflows remain module-specific. Purchase and supplier-invoice Objects exist only as partial metadata representations and do not provide a common accounting record model.

**Status:** **SPECIALISED BUSINESS LOGIC — KEEP; NEEDS REVIEW for metadata/reporting convergence.**

### Layaways and online orders

Layaways have their own lifecycle and payment table. Online orders eventually create ordinary sales and payments through a dedicated creator service. These are not duplicates of the POS UI; they are different channels that should converge at canonical transaction/payment relationships over time.

**Status:** **DIFFERENT PURPOSE — KEEP BOTH**, with a future shared record model.

### Hospitality, integrations, and custom pages

Hospitality and external/provider integrations are channel or domain-specific. Accounting export, payment providers, delivery, and online-order integrations should remain technical integration boundaries. Custom POS, purchasing, inventory, customer-credit, and supplier-account pages should remain where they protect operational workflows.

## G. Navigation, installable apps, permissions, and search

The current navigation chain is:

`Dock → module/app catalogue → app/page route → specialised page or Platform page → Object list/record view`.

Internal app catalogue entries in [services/internalAppCatalog.js](../services/internalAppCatalog.js) and package metadata in [services/packageRegistry.js](../services/packageRegistry.js) provide module identity, dependencies, permissions, and entitlements. They do not, by themselves, create a Dock item.

Dynamic Object navigation currently requires a company Platform Page targeting the Object through [services/platformObjectNavigation.js](../services/platformObjectNavigation.js). The runtime can then apply:

- licence/module entitlement;
- company enablement;
- Object permission;
- user permission;
- field-level security;
- device/app profile;
- page and navigation visibility.

This is the smallest clean integration already supported by the architecture: provision or configure a Platform Page for the Object, then let the existing navigation resolver expose it. A new Object-specific schema field is not demonstrably required.

**Important behaviour:** no permission must mean no usable Object, even when navigation metadata exists. Standard Objects may be exposed by package/module policy; custom Objects should be selectable by administrators through a Platform Page/navigation configuration.

Platform Search is generic over permitted active Objects and readable/searchable fields. It does not compensate for missing Object registration: Sale Item, common Payment, Return, Exchange, and general Ledger records remain absent or indirect from search until represented.

## H. Orphan, dead, and superseded UI candidates

These are cleanup candidates only; nothing was removed:

1. Platform/admin entry points that expose the same configuration destination under both Platform navigation and settings routes.
2. Dashboard Builder links duplicated between the main Insights navigation and the Platform “Open in the main app” rail.
3. Report entry points where `Reports` and `My Reports` are siblings without an explicit curated-vs-configurable distinction.
4. Platform Object configuration pages that are reachable through settings but not discoverable from the corresponding installed app.
5. Generic Object pages for system-backed records that appear editable even though protected writes correctly return `SYSTEM_OBJECT_OPERATION_REQUIRED`; the UX may need clearer “operational page required” messaging.
6. Marketing-only dashboard mockups in [src/marketing/components/AppMockups.jsx](../src/marketing/components/AppMockups.jsx) are not runtime pages and should not be treated as dashboard implementations.

These require reachability confirmation in a running tenant before any deletion or route change.

## I. Priority and recommended migration order

Recommendations are recorded only; none are implemented.

### P0 — architectural duplication / dangerous

1. Define the boundary and audit contract between authoritative service records and Platform projections. Do not allow generic CRUD to post sales, inventory, refunds, credit, or supplier accounting.
2. Establish a conformance design for a canonical transaction identity/type that can relate SALE, RETURN, and EXCHANGE without invalidating existing records.
3. Establish a common settlement/ledger direction before adding more module-specific financial tables.

### P1 — should consolidate

1. Register Sale Item as a related Platform Object with safe read/report/search relationships.
2. Design reusable Payment/Settlement records that can relate to sales, returns, exchanges, layaways, online orders, and credit events while preserving service-owned posting.
3. Model customer and supplier ledger entries as related financial records under a common reporting/audit vocabulary, without merging their domain rules prematurely.
4. Complete Object-to-Platform-Page-to-Dock provisioning for standard and custom Objects.
5. Clarify Reports/My Reports and Dashboard/Dashboards navigation naming.

### P2 — useful cleanup

1. Expand metadata fields and relationships for inventory movements, purchases, receipts, supplier invoices, layaways, and online orders.
2. Add explicit report/search coverage for related records once they are safely registered.
3. Add clear system-object operational-page messaging to generic Object screens.
4. Represent configurable FEFO/company batch policy where policy variance justifies it; retain service enforcement.
5. Complete adapters for registered Customer Credit workflow actions or remove/mark action templates that are not executable.

### P3 — optional polish

1. Optional default dashboard selection and shared dashboard/report permission UX.
2. Consistent app icons, labels, ordering, and empty states across specialised and Platform pages.
3. Optional dedicated Customer Credit and Batch & Expiry app landing pages if usage warrants them.

## J. Known test harness note

The two known Customer Credit sale failures in `tests/customerCredit.test.mjs` are stale fake-DB harness mismatches. They are not evidence that production credit-sale behaviour should change and were intentionally not altered during this audit.

## K. Final conclusion

onePOS is best described as a **service-authoritative transactional system with an expanding metadata Platform overlay**, not yet a fully unified SFDC record system. The Platform foundation is appropriate for configurable objects, fields, layouts, permissions, reports, dashboards, search, rules, actions, and audit metadata. The remaining work is primarily record-model convergence and safe projection/relationship coverage—not wholesale migration of business logic into metadata.

## L. OUTSIDE PLATFORM / OWNER DECISION REQUIRED

This inventory applies the requested standard execution model literally. “Outside Platform” means that the function is currently entered through a specialised route/service or custom page and does not complete as `Object → Record → Action → Workflow → related-record changes`. It does **not** decide whether the function should remain there.

| Business function | Current file/service/table | Trigger | Reads | Writes | Platform Object? | Platform Action from current form/page? | Workflow trigger? | Current-record context? | Creates/updates Platform records? | Why outside / suggested representation |
|---|---|---|---|---|---|---|---|---|---|---|
| Sale finalisation | [routes/sales.js](../routes/sales.js), `sales`, `sale_items`, `payments` | POS submit/API sale request | Cart, customer, pricing, tenders, stock, credit balance | Sale/items/payments, credit ledger, stock movements, loyalty | Sale only; item/payment incomplete | No; POS uses domain endpoint | Not as the initiating chain; Platform automation may run only for separately exposed records | No Platform workflow context | No; writes physical domain tables | Hard-coded orchestration. Suggested: **OBJECT, RELATED OBJECT, RECORD TYPE, FORM, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, ROLLUP FIELD, OWNER DECISION REQUIRED** |
| Sale payment settlement | [routes/sales.js](../routes/sales.js), `payments` | Tender selection during sale finalisation | Sale total, tender, provider result, credit account | `payments`, credit ledger/provider state | No reusable Payment Object | No | No common payment workflow | No | No | Sale-owned payment model. Suggested: **OBJECT, RELATED OBJECT, ACTION, WORKFLOW, TECHNICAL INTEGRATION, OWNER DECISION REQUIRED** |
| Ordinary return/refund | [routes/returns.js](../routes/returns.js), `stock_returns`, `refunds` | Return form/API request | Original sale/items/payments, quantities, refund allocation, stock | Return/refund rows, inventory movements, customer-credit debit note | No Return/Refund Object; Sale is separate | No | No initiating Platform trigger | No | No | Separate return transaction. Suggested: **RECORD TYPE, RELATED OBJECT, FORM, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, OWNER DECISION REQUIRED** |
| Receipt exchange | [routes/exchanges.js](../routes/exchanges.js), `stock_returns`, replacement `sales`, `sale_items`, `payments`, `refunds` | Exchange request from receipt/custom page | Original sale/items/payments, replacement items, refund allocation | Return, replacement sale/items/payments, refund, stock, credit ledger | No Exchange Object; Sale only partial | No | No initiating Platform trigger | No | No | Multi-record hard-coded transition. Suggested: **RECORD TYPE, RELATED OBJECT, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, OWNER DECISION REQUIRED** |
| Customer-credit sale posting | [services/customerCredit.js](../services/customerCredit.js), [routes/sales.js](../routes/sales.js), `customer_credit_ledger` | Sale tender `customer_credit` | Customer lock, credit limit, existing ledger balance | Credit ledger entry and sale payment | Customer Credit Account/Ledger package Objects exist | No from POS sale form | No generic initiating trigger | No | No generic Platform record; service writes protected ledger | Protected financial operation. Suggested: **RELATED OBJECT, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, ROLLUP FIELD, OWNER DECISION REQUIRED** |
| Customer-credit payment/adjustment/freeze | [routes/customers.js](../routes/customers.js), [services/customerCredit.js](../services/customerCredit.js) | Customer page button/API | Customer account, ledger, permissions | Ledger entries, customer credit flags | Yes, package-owned | Registered action names exist, but customer page does not invoke them through FormRenderer | No complete route adapter; executors require `creditActionExecutor` | Not consistently; executor receives supplied context only | Service writes physical ledger/customer rows | Partially bridged but not complete. Suggested: **FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, OWNER DECISION REQUIRED** |
| Stock sale deduction | [services/inventory.js](../services/inventory.js), called by [routes/sales.js](../routes/sales.js) | Sale finalisation | Product/store stock, batches, FEFO allocation | Inventory movements, batch quantities, current stock projections | Inventory/Movement/Batch Objects exist | No | No initiating Platform trigger | No | No generic Platform records | Authoritative stock mutation bypasses Platform action chain. Suggested: **RELATED OBJECT, WORKFLOW, RELATED RECORD CREATION, ROLLUP FIELD, OWNER DECISION REQUIRED** |
| Stock receiving/purchase receipt | [routes/purchases.js](../routes/purchases.js), [services/inventory.js](../services/inventory.js), purchase tables | Receiving action/API | Purchase, supplier invoice, product, batch policy | Receipt/purchase rows, batches, movements, stock projections | Purchase/Receipt/Batch partial Objects | No | No initiating Platform trigger | No | No | Module-specific receiving state transition. Suggested: **OBJECT, RELATED OBJECT, FORM, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, OWNER DECISION REQUIRED** |
| FEFO batch allocation | [services/inventory.js](../services/inventory.js) | Stock consumption inside sale/adjustment/transfer | Batch expiry/status/quantity, product/store | Batch consumption and movement rows | Inventory Batch exists | No | No | No | No generic Platform records | Hard-coded policy engine. Suggested: **FIELD, FORMULA FIELD, VALIDATION RULE, WORKFLOW TRIGGER, WORKFLOW, FORM/RECORD ACTION, OWNER DECISION REQUIRED** |
| Stock adjustment | [routes/inventory.js](../routes/inventory.js), [services/inventory.js](../services/inventory.js) | Adjustment form/API | Product/store stock, reason, quantity | Movement and stock projections | Inventory/Movement only | No | No | No | No | Direct state transition. Suggested: **OBJECT, RECORD TYPE, FORM, FORM/RECORD ACTION, VALIDATION RULE, WORKFLOW, RELATED RECORD CREATION** |
| Transfer | [services/inventory.js](../services/inventory.js), inventory routes | Transfer request/action | Source/destination store, product, stock | Transfer/movement records and stock projections | Partial inventory/movement Objects | No | No | No | No | Multi-store orchestration outside Platform. Suggested: **OBJECT, RELATED OBJECT, RECORD TYPE, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION** |
| Supplier invoice/payment posting | [routes/supplierAccounts.js](../routes/supplierAccounts.js), supplier ledger/payment tables | Supplier account form/API | Supplier, invoices, allocations, existing ledger | Supplier ledger, payments, allocations | Supplier/Invoice partial; no common Ledger/Payment | No | No common initiating trigger | No | No | Separate accounting domain. Suggested: **RELATED OBJECT, RECORD, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, ROLLUP FIELD, OWNER DECISION REQUIRED** |
| Layaway lifecycle/installments | [routes/layaways.js](../routes/layaways.js), layaway tables | Layaway page/API | Customer, sale/items, due dates, instalments | Layaway and `layaway_payments` state | No complete Layaway/Payment model | No | No | No | No | Separate payment/lifecycle model. Suggested: **OBJECT, RELATED OBJECT, RECORD TYPE, FORM, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION** |
| Online-order conversion | [services/onlineOrders/saleCreator.js](../services/onlineOrders/saleCreator.js) | Online order state transition | Online order/items/customer, pricing | Sales/items/payments and order status | Online Order exists; Sale partial | No; provider/order UI is not Platform FormRenderer | No common Platform trigger | No | Physical records, not generic Platform records | Channel integration writes core tables directly. Suggested: **TECHNICAL INTEGRATION, RELATED OBJECT, WORKFLOW, RELATED RECORD CREATION, OWNER DECISION REQUIRED** |
| Promotion/discount pricing | [routes/pricing.js](../routes/pricing.js), pricing services and sale calculation | Product/cart pricing request | Product, customer/store, promotion/configuration data | Usually computed sale discount; promotion state where applicable | Partial/unclear Platform coverage | No | No common pricing workflow | No | Usually no Platform record for calculation result | Pricing engine outside metadata model. Suggested: **OBJECT, FIELD, DEPENDENT FIELD, FORMULA FIELD, VALIDATION RULE, WORKFLOW, OWNER DECISION REQUIRED** |
| Loyalty earn/redeem posting | Loyalty routes/services called by sales | Sale finalisation or loyalty action | Customer, sale total, loyalty account/ledger | Loyalty points/account/ledger state | No complete standard Loyalty Object | No | No generic initiating trigger | No | Physical module records | Domain ledger outside Platform. Suggested: **OBJECT, RELATED OBJECT, FORM/RECORD ACTION, WORKFLOW, RELATED RECORD CREATION, ROLLUP FIELD** |
| VAT/tax and financial totals | Sales/purchase calculation services | Sale/receipt/invoice calculation | Lines, tax configuration, discounts, totals | Stored sale/invoice totals and accounting export values | Partial Sale/Purchase | No | No | No | No | Integrity-sensitive calculation outside metadata formula runtime. Suggested: **FIELD, FORMULA FIELD, VALIDATION RULE, REPORT, OWNER DECISION REQUIRED** |
| Accounting export | [services/accountingExport.js](../services/accountingExport.js), [routes/accountingExport.js](../routes/accountingExport.js) | Export request/scheduled integration | Sales, payments, ledgers, invoices | Export payload/status/external accounting records | No internal common Ledger Object | No | No Platform workflow; external connector boundary | No | External system records | Genuine technical integration. Suggested: **TECHNICAL INTEGRATION, WORKFLOW, OWNER DECISION REQUIRED** |
| Offline queue/reconciliation | POS offline services and sales sync routes | Network recovery/background sync | Local queued sales, device/store/company state | Queue status, synced sales, reconciliation state | Sale partial; queue is technical | No | No Platform trigger | No | Physical sale records after sync | Device reliability mechanism. Suggested: **TECHNICAL INTEGRATION, CUSTOM PAGE, OWNER DECISION REQUIRED** |

The table intentionally records **Owner Decision Required** wherever the audit cannot safely choose between keeping authoritative domain code, exposing it as Platform records, or moving policy into metadata.

## M. Complete Platform execution-chain verification

| Link | Status | Evidence and limitation |
|---|---|---|
| Form Builder → saved form/layout definition | **COMPLETE** | Platform form definitions are normalized and rendered through [FormRenderer.jsx](../src/pages/settings/Platform/FormRenderer.jsx), with field/layout components. |
| Action configured on a form/record | **MISSING** | `FormRenderer` renders fields and delegates to `ObjectForm`; it has no configured action-button/action registry rendering path. |
| FormRenderer displays Action | **MISSING** | No action component or action list is handled in the renderer’s component switch. |
| User clicks Action | **MISSING** for Platform forms | Specialised pages have buttons, but they call domain routes rather than a common Platform Action dispatcher. |
| Action receives current Object + Record context | **PARTIAL** | Workflow action executors accept `object`, `record`, `previousRecord`, and `recordId`; there is no end-to-end UI action invocation supplying them. |
| Action starts Workflow | **PARTIAL** | `executeWorkflowAction`/`executeWorkflowActions` support workflow actions, but only configured automation paths or direct server callers invoke them. |
| Workflow receives current Object + Record context | **COMPLETE** within automation execution | [platformAutomation.js](../services/platformAutomation.js) passes object, fields, current record, previous record, recordId, trigger, request, and company context. |
| Workflow conditions evaluate fields/previous values | **COMPLETE** | [platformConditions.js](../services/platformConditions.js) supports field comparisons and changed operators against current/previous records. |
| Workflow creates/updates records | **PARTIAL** | Set-field actions can update writable extension/system-mapped fields; protected system fields are skipped. A general create/update-related-record action is not demonstrated in the audited path. |
| Workflow creates/updates RELATED records | **MISSING** | No verified generic related-record creation/update executor is wired from FormRenderer through workflow. |
| Formula/rollup recalculation | **PARTIAL** | Platform create/update routes calculate formulas and populate rollups after generic writes; domain-service writes do not universally invoke the same pipeline. |
| Result appears in related lists | **PARTIAL** | Generic Platform relationships/related lists work for registered Objects; unregistered Sale Item, Payment, Return, Exchange, and ledger models are absent or indirect. |
| Result appears in list/search/report | **PARTIAL** | Search and reports enforce registered Object permissions and readable fields; physical records without Platform Objects are not uniformly discoverable. |

### M1. Lifecycle triggers

| Trigger | Status | Evidence |
|---|---|---|
| record created / `after_create` | **COMPLETE for generic Platform create** | [routes/platform.js](../routes/platform.js) invokes `executePlatformAutomations` after generic creation. |
| record updated / `after_update` | **COMPLETE for generic Platform update** | Platform update route invokes automation with `previousRecord`. |
| created or updated / `after_save` | **SUPPORTED** | Accepted by [platformAutomation.js](../services/platformAutomation.js) and included in rule selection. |
| before create / before update / `before_save` | **PARTIAL** | Trigger keys are accepted, but audited route evidence primarily executes after generic writes; validation is not a universal pre-write hook for domain routes. |
| field changed / `field_changed` | **PARTIAL** | Trigger and `changed` operators exist, but reliable previous-record context depends on the generic update path. |
| `changed` | **COMPLETE in condition evaluator; PARTIAL end-to-end** | Supported by [platformConditions.js](../services/platformConditions.js), not universal across specialised writes. |
| `changed_from` | **COMPLETE in condition evaluator; PARTIAL end-to-end** | Supported against `previousRecord`; domain services do not consistently provide it. |
| `changed_to` | **COMPLETE in condition evaluator; PARTIAL end-to-end** | Same limitation. |
| `changed_from_to` | **COMPLETE in condition evaluator; PARTIAL end-to-end** | Same limitation. |
| before delete | **SUPPORTED / PARTIAL** | Accepted by automation service and rule editor validation; no complete generic delete-to-workflow chain was confirmed for all Objects. |
| after delete | **SUPPORTED / PARTIAL** | Accepted by automation service; coverage depends on the delete route and record context. |

Additional triggers are not automatically required until the owner decides which domain transitions should become Platform records. The current material gap is not trigger vocabulary; it is that specialised business routes do not consistently enter the Platform trigger/action/workflow pipeline.

## N. OUTSIDE PLATFORM / OWNER DECISION REQUIRED — final owner-decision table

| Existing Function | Currently Wired? | Possible Platform Home | Current Code | Owner Decision |
|---|---|---|---|---|
| Sale finalisation | Partial | OBJECT + RELATED OBJECTS + WORKFLOW | `routes/sales.js`, `services/inventory.js`, `services/customerCredit.js` | |
| Sale Items | Missing | RELATED OBJECT | `sale_items`, sales/online-order writers | |
| Payment settlement | Missing | OBJECT + RELATED OBJECT + ACTION | `payments`, layaway/supplier payment models | |
| Returns/refunds | Missing | RECORD TYPE + RELATED OBJECT + WORKFLOW | `routes/returns.js`, `refunds`, `stock_returns` | |
| Exchanges | Missing | RECORD TYPE + RELATED OBJECT + WORKFLOW | `routes/exchanges.js` | |
| Customer Credit | Partial | OBJECT + WORKFLOW + RELATED RECORD CREATION | `services/customerCredit.js`, `routes/customers.js` | |
| Supplier accounting | Missing | RELATED OBJECT + LEDGER RECORDS + WORKFLOW | `routes/supplierAccounts.js` | |
| Inventory movements | Partial | RELATED OBJECT + ROLLUP | `services/inventory.js`, `inventory_movements` | |
| FEFO | Missing | FORMULA/RULE/WORKFLOW/ACTION | `services/inventory.js` | |
| Stock receiving | Missing | OBJECT + FORM + ACTION + WORKFLOW | `routes/purchases.js`, inventory services | |
| Stock adjustment/transfer | Missing | RECORD TYPE + ACTION + WORKFLOW | inventory routes/services | |
| Layaway | Missing | OBJECT + RELATED PAYMENT OBJECT + WORKFLOW | `routes/layaways.js` | |
| Online-order conversion | Partial | TECHNICAL INTEGRATION + RELATED OBJECTS | `services/onlineOrders/saleCreator.js` | |
| Promotion/discount pricing | Partial | OBJECT + RULE + FORMULA/AUTOMATION | pricing routes/services | |
| Loyalty posting | Missing | OBJECT + RELATED LEDGER + WORKFLOW | loyalty services/routes | |
| VAT/tax calculations | Partial | FORMULA FIELD + VALIDATION RULE | sales/purchase calculation services | |
| Accounting export | Partial | TECHNICAL INTEGRATION | `services/accountingExport.js` | |
| Offline reconciliation | Missing | TECHNICAL INTEGRATION + CUSTOM PAGE | POS offline queue/sync services | |
| Platform form action buttons | Missing | FORM/RECORD ACTION | `FormRenderer.jsx`, Object form components | |
| Related-record workflow creation | Missing | RELATED RECORD CREATION | `platformWorkflow.js` and automation execution | |
