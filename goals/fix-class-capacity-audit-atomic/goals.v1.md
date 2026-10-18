# Goals Extract
- Task name: fix-class-capacity-audit-atomic
- Iteration: v1
- State: locked
- Approval: Explicit user request, 2026-10-18: Fix both P2 findings by making class creation and capacity updates atomic with their audit records. Add regression tests for audit failures, then rerun the full PostgreSQL suite and code review.

## Goals
1. Persist new classes and their initial capacity audit atomically, preserving Shopify compensation behavior on persistence failures.
2. Persist capacity changes and their capacity audit atomically.
3. Add regression coverage for audit failures, rollback, and successful retry across service and repository implementations, including PostgreSQL.
4. Rerun the complete PostgreSQL-enabled test suite and independent correctness/project structure review.

## Non-goals
- No unrelated refactors, frontend fixes, deployment, commit, push, or pull request.
- No optional page performance benchmark.

## Success criteria
- G1: Failed creation audit leaves no class and correctly compensates a newly created Shopify product; successful creation writes both records.
- G2: Failed capacity audit preserves previous capacity and retry can write the update and audit successfully.
- G3: Targeted regression tests cover atomic repository/service paths and PostgreSQL fault injection.
- G4: Full test suite executes with DB_CONNECTION supplied as DATABASE_URL and POSTGRES_INTEGRATION_URL; lint/types/SQL/format and independent review results recorded with any existing failures identified.
