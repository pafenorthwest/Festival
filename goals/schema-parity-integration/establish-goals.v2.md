# Establish Goals

## Status

- Task name: schema-parity-integration
- Iteration: v2
- State: locked

## Request

- Audit observable in-memory/PostgreSQL repository contracts, correct proved drift, and make integration coverage exercise the current upgraded schema efficiently while retaining meaningful regression coverage.
- The user's explicit request approves this bounded work. Existing task history and unrelated work must remain intact.

## Blocking ambiguity

- None. Independent audit established actual-application rollback is unsafe for global SQL executors, multiple sessions and fault triggers. Use isolated current-schema namespaces, one per file where safe; actual `orgs` is read-only for behavior/preflight except the two independently confirmed missing webhook CHECK constraints, which receive narrowly authorized maintenance. This safe default follows the authorized current-schema validation scope.

## Assumptions

- Continue on `ericp/verified-paid-order`; preserve the uncommitted availability fix, its tests/new migration, the user's `.gitignore` change and unrelated untracked artifacts.
- Privately load `FESTIVAL_DB` from `database.env` using the established credential-loader convention; never print credentials, edit env files or expose the connection in logs.
- The application `orgs` schema was upgraded and validated in the preceding authorized task. Existing user maintenance authorization permits only the reviewed targeted migration adding the absent webhook failure_stage/failure_code CHECK constraints, after aggregate invalid-value preflight. Do not change persistent application rows or reset schemas.
- Historical results provide an initial inventory only. A defensible runtime comparison requires the same selected target, comparable commands, workload and timing method before and after.

## Goals

1. Correct the four demonstrated JSONB native-binding paths (checkout repertoire, customer mailing address, registration-change prior/new state, communication variables/payload) and three memory parity defects (cart organization guard, metadata unique ID/line rejection, earliest consent), with focused observable-contract regressions.
2. Restrict PostgreSQL integration tests to the current installed schema contract, removing legacy reconstruction, upgrade/backfill and migration-reapply cases while retaining meaningful current behavior, isolation and concurrency coverage. Validate actual `orgs` read-only and add only its two confirmed missing webhook CHECK constraints using reviewed guarded migration SQL; run behavioral fixtures only in isolated current-schema namespaces.
3. Reuse one isolated current-schema namespace per test file where safe, preserving genuine multi-session races and fault-trigger regressions, and reduce low-value setup duplication without weakening meaningful assertions. Clean up only task-owned generated namespaces.
4. Validate the resulting contract and current-schema suite against the selected private database, apply only the reviewed two-CHECK maintenance after invalid-row preflight with atomic locking/timeouts and unchanged application fingerprints, report comparable setup/runtime evidence and proportional quality checks, and preserve unrelated work.

## Non-goals

- Broad refactors, speculative parity changes, runtime schema initializer/deployment changes, migrations beyond the reviewed two-CHECK maintenance, schema resets, env edits or persistent application data changes.
- Behavioral fixture writes to actual `orgs`, running legacy-upgrade/reapply cases, or lowering meaningful regression/security/concurrency assertions for speed.
- Commit, push, PR, deployment, external posting, shared configuration/bootstrap mutation, or cleanup of unrelated artifacts.
- Printing or persisting unredacted credentials, connection URLs or application row contents.

## Success criteria

- [G1] Audit evidence identifies the paired observable contracts and any proved divergence; each implemented correction has proportionate regression evidence, and unresolved uncertainty is explicit.
- [G2] The final integration inventory exercises the current schema only; legacy upgrade cases are removed or replaced with meaningful current behavior checks, with isolated namespace execution and actual application read-only preflight documented.
- [G3] Setup/fixture changes preserve important coverage and isolation; cleanup or forced rollback is verified, and reduced setup work is quantified rather than inferred solely from test counts.
- [G4] The complete relevant PostgreSQL suite and proportional unit/type/lint/format/SQL checks pass or exact blockers are reported; comparable before/after timing and final branch/scope status contain no secrets with zero invalid existing webhook rows, both new CHECKs validated and all application row fingerprints preserved; no commit occurs.

## Next action

- Parent integrates bounded production/unit and current-schema fixture implementations; verifier measures structural setup reduction and validates the selected private connection without application writes.
