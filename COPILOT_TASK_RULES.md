# onePOS Copilot Task Rules

## Before coding

1. Read DEVELOPMENT_BOUNDARIES.md.
2. Read ARCHITECTURE_MAP.md when it exists.
3. Inspect the repository for existing functionality before creating new code.
4. Search for existing routes, services, components, database tables, permissions, and tests related to the task.
5. Reuse existing functionality wherever possible.

## Implementation

- Keep the task scope focused.
- Do not modify unrelated modules.
- Do not create duplicate business logic.
- Do not create duplicate APIs or database systems.
- Preserve existing authentication and authorization.
- Preserve company/tenant scoping.
- Preserve store scoping where applicable.
- Preserve existing offline-first POS behaviour.
- Do not change JARVIS behaviour unless explicitly requested.
- Do not change Platform architecture unless explicitly requested.
- Do not add dependencies unless genuinely required.

## Frontend

- Reuse existing components and services where practical.
- Follow existing onePOS UI patterns.
- Include loading, empty, error, and permission states where applicable.
- Do not hard-code company, store, user, or business IDs.
- Keep business rules out of purely presentational components when an existing service layer is available.

## Backend

- Reuse existing services and database tables.
- Validate authenticated ownership and permissions server-side.
- Never trust company/store identifiers supplied by the client.
- Use existing authorization helpers.
- Validate user input before database operations.
- Avoid unsafe dynamic SQL.
- Preserve existing API compatibility unless the task explicitly requires a breaking change.

## Testing

Every functional change should include focused tests where practical.

At minimum, verify:
- Authentication
- Authorization/permissions
- Company/tenant scoping
- Store scoping where applicable
- Validation
- Main success path
- Important failure paths

## Validation

Before reporting completion:

1. Run the relevant focused tests.
2. Run 
pm run build for frontend-affecting changes.
3. Run git diff --check.
4. Review git status --short.
5. Review the final diff for unrelated changes.

## Completion Report

Report:

- What was implemented
- Files changed
- Existing functionality reused
- APIs/routes added or changed
- Database changes, if any
- Tests added
- Tests executed and results
- Build result
- git diff --check result
- Any known limitations
- Any unrelated files that were changed accidentally

## Stop Conditions

Stop and ask for clarification instead of guessing when:

- Existing architecture conflicts with the requested feature.
- A new database table appears necessary but the requirement is unclear.
- Existing permissions are insufficient.
- A change would affect POS payment/offline architecture unexpectedly.
- A change would require modifying unrelated business modules.
- A duplicate implementation appears to already exist.

## Core Principle

onePOS should grow by extending and connecting existing systems, not by creating parallel systems that perform the same job.
