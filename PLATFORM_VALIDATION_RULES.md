# Platform validation rules

Validation rules use the existing `platform_rules` table, Rules editor, and
`settings.manage` permission. No migration or new endpoint is required.

In Settings → Platform → Rules, choose **Validation — block save when conditions
match**, select the object and trigger, enter an error message, and add conditions.
Choose whether all conditions or any condition must match. Activate and save.

For example, `Amount less than 0` with the message `Amount must not be negative`
rejects a negative amount. The conditions describe the **invalid** state.

## API contract

`POST /api/platform/rules` (or `PUT /api/platform/rules/:ruleId`):

```json
{
  "objectId": "<existing object UUID>",
  "name": "Prevent negative amounts",
  "triggerKey": "before_save",
  "conditions": [{ "field": "amount", "operator": "less_than", "value": "0" }],
  "action": {
    "type": "validation",
    "match": "all",
    "message": "Amount must not be negative"
  },
  "active": true
}
```

- Triggers: `before_create`, `before_update`, `before_save` (both).
- Operators: `equals`, `not_equals`, `contains`, `greater_than`, `less_than`,
  `is_empty`, `is_not_empty`. Ordered comparisons require numeric/date fields;
  contains requires a text field. Numeric and boolean values are type-aware.
- Between 1 and 50 conditions, each referring to an active mapped field.
- A match rejects the generic record mutation with HTTP 422,
  `code: VALIDATION_RULE_FAILED`, `message`, and `errors: [{ruleId, message}]`.
- Invalid active metadata rejects the save with `VALIDATION_RULE_INVALID`.
  Administrators can deactivate the rule even if a referenced field was removed.
- Updates merge stored values with changed fields before validation. A PostgreSQL
  row-version check rejects concurrent changes with HTTP 409; reload and retry.
- Rule ownership is company-scoped. Applicable global rules also run. Store-scoped
  record mutations use the authenticated store and never accept scope fields from
  the client. Existing `settings.manage` gates remain in place.

## Scope and compatibility

Execution is limited to the generic Platform record POST/PUT endpoints. Existing
business APIs, POS/offline operations and payment calculations are unchanged.
Workflow actions and legacy `action.type: validate` definitions remain metadata
only; deliberately select the new Validation action to enable enforcement.

There is no JavaScript/SQL expression execution, formula engine, nested expression
builder, cross-record query, or automatic workflow action in this increment.
Create validation sees submitted fields before database defaults are applied;
an omitted field is empty. Configure forms to submit values required by a rule.

The existing ObjectForm can display rejected async submissions while retaining
input. The current ObjectPage is a read-only record browser; this change does not
add record-create/edit navigation. Rules can be configured in the existing editor
and are enforced for callers of the generic record APIs.

## Verification

`node --test tests/platformValidation.test.mjs tests/platformValidationUi.test.mjs tests/platformMetadata.test.mjs tests/platformSettings.test.mjs`

The validation suite exercises the real Express router over HTTP with a strict
SQL fake. It covers configuration, invalid records, partial updates, tenant/store
scope, auth, inactive rules, configuration errors and concurrent-edit rejection.
UI rendering tests verify saved rule values and form error rendering. All 26
focused tests pass. These tests do not substitute for a live PostgreSQL integration test.
