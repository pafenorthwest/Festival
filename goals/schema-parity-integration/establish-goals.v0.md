# Establish Goals

## Status

- Task name: schema-parity-integration
- Iteration: v0
- State: locked

## Request

- Audit observable in-memory/PostgreSQL repository contracts, correct proved drift, and make integration coverage exercise the current upgraded schema efficiently while retaining meaningful regression coverage.
- The user's explicit request approves this bounded work. Existing task history and unrelated work must remain intact.

## Blocking ambiguity

- Integration target preference remains pending: actual `orgs` with rollback-only fixtures or isolated namespaces containing the current schema. Independent contract audit and current-version coverage goals are locked now; dependent harness edits/execution wait for that decision.

## Assumptions

- Continue on `ericp/verified-paid-order`; preserve the uncommitted availability fix, its tests/new migration, the user's `.gitignore` change and unrelated untracked artifacts.
- Privately load `FESTIVAL_DB` from `database.env` using the established credential-loader convention; never print credentials, edit env files or expose the connection in logs.
- The application `orgs` schema was upgraded and validated in the preceding authorized task. This task does not apply migrations, change persistent application data or reset schemas.
- Historical results provide an initial inventory only. A defensible runtime comparison requires the same selected target, comparable commands, workload and timing method before and after.

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

## Next action

- Parent coordinates independent contract and test audits; resolve the integration target before dependent harness changes or database execution.
