# Goals Extract
- Task name: schema-parity-integration
- Iteration: v0
- State: locked

## Goals

1. Compare paired repository behavior and fix only demonstrated observable contract differences, with focused regression coverage for each material correction.
2. Restrict PostgreSQL integration tests to the current installed schema contract, retiring legacy upgrade/backfill compatibility cases while retaining meaningful current behavior, isolation and concurrency coverage.
3. Reduce avoidable setup and low-value duplication using efficient fixtures without weakening important assertions or allowing persistent synthetic application records.
4. Validate the resulting contract and current-schema suite against the selected private database, report comparable setup/runtime evidence and proportional quality checks, and preserve unrelated work.

## Non-goals

- Broad refactors, speculative parity changes, runtime schema initializer/deployment changes, migration execution, schema resets, env edits or persistent application data changes.
- Silently choosing the pending integration target, running the old legacy-upgrade suite before that choice, or lowering meaningful regression/security/concurrency assertions for speed.
- Commit, push, PR, deployment, external posting, shared configuration/bootstrap mutation, or cleanup of unrelated artifacts.
- Printing or persisting unredacted credentials, connection URLs or application row contents.

## Success criteria

- [G1] Audit evidence identifies the paired observable contracts and any proved divergence; each implemented correction has proportionate regression evidence, and unresolved uncertainty is explicit.
- [G2] The final integration inventory exercises the current schema only; legacy upgrade cases are removed or replaced with meaningful current behavior checks, with the selected target documented before dependent execution.
- [G3] Setup/fixture changes preserve important coverage and isolation; cleanup or forced rollback is verified, and reduced setup work is quantified rather than inferred solely from test counts.
- [G4] The complete relevant PostgreSQL suite and proportional unit/type/lint/format/SQL checks pass or exact blockers are reported; comparable before/after timing and final branch/scope status contain no secrets and no commit occurs.
