# Goals Extract
- Task name: schema-parity-integration
- Iteration: v1
- State: locked

## Goals

1. Correct the four demonstrated JSONB native-binding paths (checkout repertoire, customer mailing address, registration-change prior/new state, communication variables/payload) and three memory parity defects (cart organization guard, metadata unique ID/line rejection, earliest consent), with focused observable-contract regressions.
2. Restrict PostgreSQL integration tests to the current installed schema contract, removing legacy reconstruction, upgrade/backfill and migration-reapply cases while retaining meaningful current behavior, isolation and concurrency coverage. Validate actual `orgs` read-only; run behavioral fixtures only in isolated current-schema namespaces.
3. Reuse one isolated current-schema namespace per test file where safe, preserving genuine multi-session races and fault-trigger regressions, and reduce low-value setup duplication without weakening meaningful assertions. Clean up only task-owned generated namespaces.
4. Validate the resulting contract and current-schema suite against the selected private database, report comparable setup/runtime evidence and proportional quality checks, and preserve unrelated work.

## Non-goals

- Broad refactors, speculative parity changes, runtime schema initializer/deployment changes, migration execution, schema resets, env edits or persistent application data changes.
- Behavioral fixture writes to actual `orgs`, running legacy-upgrade/reapply cases, or lowering meaningful regression/security/concurrency assertions for speed.
- Commit, push, PR, deployment, external posting, shared configuration/bootstrap mutation, or cleanup of unrelated artifacts.
- Printing or persisting unredacted credentials, connection URLs or application row contents.

## Success criteria

- [G1] Audit evidence identifies the paired observable contracts and any proved divergence; each implemented correction has proportionate regression evidence, and unresolved uncertainty is explicit.
- [G2] The final integration inventory exercises the current schema only; legacy upgrade cases are removed or replaced with meaningful current behavior checks, with isolated namespace execution and actual application read-only preflight documented.
- [G3] Setup/fixture changes preserve important coverage and isolation; cleanup or forced rollback is verified, and reduced setup work is quantified rather than inferred solely from test counts.
- [G4] The complete relevant PostgreSQL suite and proportional unit/type/lint/format/SQL checks pass or exact blockers are reported; comparable before/after timing and final branch/scope status contain no secrets and no commit occurs.
