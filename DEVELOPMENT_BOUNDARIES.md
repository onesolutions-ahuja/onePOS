# onePOS Development Boundaries

## Supplier Accounts

Existing foundation:
- Supplier invoices/bills
- Invoice totals and outstanding balances
- Supplier payments
- Payment allocation
- Supplier ledger
- Supplier statements
- Credit/debit ledger adjustments
- Company and store scoping
- Existing supplier permissions

Rules:
- Reuse existing supplierAccounts routes/services.
- Do not create a second supplier ledger.
- Do not create duplicate payment logic.
- Do not bypass existing authentication/RBAC.
- Do not introduce company/store IDs from the frontend.

## Platform

Existing foundation:
- Metadata-driven objects
- Metadata-driven fields
- Relationships
- Object records
- Object search
- Pagination
- Filtering
- Object editor
- Read-only record display where applicable

Rules:
- Platform remains generic.
- Do not hard-code Customer/Product/Sale/Supplier/Store/Employee business logic into Platform.
- Reuse metadata APIs.
- Do not create duplicate configuration systems.

## POS

Rules:
- Do not modify POS sales/payment architecture unless the task explicitly requires it.
- Offline-first behaviour must remain intact.
- Card payment integration remains a future dedicated integration.
- Existing permissions must be respected.

## JARVIS

Rules:
- JARVIS actions must use existing permissions.
- Do not create separate business rules inside JARVIS.
- JARVIS should call existing application services/routes where appropriate.

## Development Rule

Before creating a new backend endpoint, service, database table, or frontend module:

1. Search the repository for an existing implementation.
2. Reuse existing functionality where possible.
3. Only create a new component when the required functionality genuinely does not exist.
4. Keep unrelated modules unchanged.
5. Add focused tests for new behaviour.
