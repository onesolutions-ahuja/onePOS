# Formula fields

Formula fields are read-only metadata fields calculated from the same record.
They use the existing field editor, metadata APIs, company scope, and
`settings.manage` permission. Global object configuration remains Superadmin-only.
No business tables or physical product/customer columns are created.

## Configure

In Settings → Platform → an object's fields, choose **Formula (read-only)**.
Choose a result type, enter an expression using field API names, and save.

| Result | Example |
| --- | --- |
| Currency | `ROUND(price * quantity, 2)` |
| Decimal | `COALESCE(price, 0) * 1.2` |
| Text | `CONCAT(name, " - ", sku)` |
| Boolean | `price > 0 && quantity > 0` |
| Conditional | `IF(quantity == 0, 0, price / quantity)` |

Supported result types: number, decimal, currency, text, boolean.
Functions: `IF`, `COALESCE`, `CONCAT`, `ROUND`, `ABS`, `MIN`, `MAX`.
Operators: `+ - * / %`, comparisons `== != > >= < <=`, boolean `&& || !`,
and parentheses. Text literals use double quotes. Functions are uppercase;
field references use their exact API names. `true`, `false`, `null` are literals.

Numbers use JavaScript floating-point arithmetic; `ROUND(value, places)` accepts
0–10 decimal places. This is a display/metadata engine, not a replacement for
the existing payment, tax, stock, or accounting calculation services.

## API and persistence

Existing `POST /api/platform/objects/:objectId/fields` and
`PUT /api/platform/fields/:fieldId` accept:

```json
{
  "label": "Line value",
  "apiName": "line_value",
  "fieldType": "formula",
  "sourceColumn": null,
  "required": false,
  "writable": false,
  "config": {
    "expression": "ROUND(price * quantity, 2)",
    "resultType": "currency"
  }
}
```

Expressions live in the existing `platform_fields.config` JSON. The existing
platform schema initializer extends the field-type CHECK constraint to permit
`formula`, with an idempotent upgrade for the previous constraint. Restart the
backend using its normal initialization path to apply this metadata migration.
The migration was not applied to a live database during development.

Generic record GET, POST and PUT responses include calculated values. Formulas
are never sent as SQL column names or saved as record columns. Submitting a
formula field in a mutation returns HTTP 400. Existing validation rules may refer
to formula fields and evaluate them against the merged record before saving.

## Rules and limits

- References must belong to this object's active, readable metadata fields.
  Hidden, unmapped, unknown, date, datetime, lookup and multiselect dependencies
  are rejected in this increment. Hidden formulas are not returned to clients.
- Formula-to-formula references are evaluated in dependency order. Circular
  references are rejected. Renaming, hiding or deactivating a referenced field
  is rejected until dependent formulas are changed or deactivated.
- Expressions are parsed as a bounded language; no JavaScript, SQL, property
  access, arbitrary function calls, network access or cross-record queries.
  Limits: 2,000 characters, 256 tokens, 32 nesting levels and 32 dependency hops.
- Blank/missing inputs, division by zero, non-finite numbers, invalid stored
  numeric values and invalid ROUND precision produce `null` (blank). Arithmetic
  propagates null. Use `COALESCE` for defaults. `CONCAT` treats null as empty text
  and caps its output at 10,000 characters. Equality can explicitly compare null.
- Formula filters are rejected. Server search and pagination continue to operate
  on stored fields; formulas are calculated for the returned page. SQL sorting,
  filtering, roll-ups, cross-object references and date functions are future work.
- Invalid active formula configuration returns HTTP 422 `INVALID_FORMULA` from
  record APIs. Configuration endpoints reject it with HTTP 400 before writing.
- Domain-specific APIs, POS/offline behaviour and payment logic are unchanged.

## Verification

`node --test tests/platformFormula.test.mjs tests/platformValidation.test.mjs tests/platformValidationUi.test.mjs tests/platformMetadata.test.mjs tests/platformSettings.test.mjs`

Tests cover the parser/evaluator, dependency checks, real Express routes against
a strict SQL fake, metadata permissions, tenant/store scope, read-only writes,
formula-backed validation, and editor/form rendering and submission. A production
build is also run. Live PostgreSQL migration and browser-session testing remain
deployment checks.
