# Establish Goals

## Status

- Task name: schema-parity-integration
- Iteration: v4
- State: locked

## Request

- Audit observable in-memory/PostgreSQL repository contracts, correct proved drift, and make integration coverage exercise the current upgraded schema efficiently while retaining meaningful regression coverage.
- The user's explicit request approves this bounded work. Existing task history and unrelated work must remain intact.

## Blocking ambiguity

- None. The user explicitly selected actual orgs rollback-only ordinary fixtures and approved all 11 genuine multi-session/fault cases in three disposable current-schema namespaces. Explicit transaction executor routing remains required for ordinary actual-application fixtures.

## Assumptions

- Continue on `ericp/verified-paid-order`; preserve the uncommitted availability fix, its tests/new migration, the user's `.gitignore` change and unrelated untracked artifacts.
- Privately load `FESTIVAL_DB` from `database.env` using the established credential-loader convention; never print credentials, edit env files or expose the connection in logs.
- The application `orgs` schema was upgraded and validated in the preceding authorized task. The reviewed two-CHECK maintenance is completed and preserved as v2 evidence. Additional DDL is not authorized for the ordinary-test harness. Actual application fixture writes must use explicit transaction executors and unconditional full rollback, with private application fingerprints unchanged.
- Historical results provide an initial inventory only. A defensible runtime comparison requires the same selected target, comparable commands, workload and timing method before and after.

## Goals

1. Correct the four demonstrated JSONB native-binding paths (checkout repertoire, customer mailing address, registration-change prior/new state, communication variables/payload) and three memory parity defects (cart organization guard, metadata unique ID/line rejection, earliest consent), with focused observable-contract regressions.
2. Restrict integration coverage to the current installed schema, removing legacy reconstruction/upgrade/backfill/reapply cases. Run ordinary behavioral fixtures against actual `orgs` through explicit rollback transactions, without calling its runtime initializer or installing application-table triggers. Retain all 11 genuine multi-session/fault cases in the three explicitly approved disposable current-schema namespaces; never reconstruct old schema versions.
3. Reduce avoidable fixture/setup work without weakening meaningful assertions. Every actual-application fixture DML statement must enlist in its explicit rollback transaction; verify fixture absence and unchanged private application aggregates. Preserve all approved real concurrency/fault regressions and remove only their task-owned disposable namespaces afterward.
4. Validate the final user-selected harness and observable contracts against private FESTIVAL_DB, report setup/runtime evidence with changed-target/workload caveats and proportional quality checks, preserve all 67 application table counts/fingerprints and unrelated work. Earlier isolated-only and ordinary-only validation remain historical evidence; final acceptance requires all 11 files and 32 cases under the approved mixed target.

## Non-goals

- Broad refactors, speculative parity changes, runtime schema initializer/deployment changes, additional migrations or application-table DDL/triggers, schema resets, env edits or persistent application data changes.
- Persistent fixture writes, global SQL calls that bypass the rollback executor, runtime schema initialization on actual orgs, legacy-upgrade/reapply cases, or lowering meaningful regression/security/concurrency assertions for speed.
- Commit, push, PR, deployment, external posting, shared configuration/bootstrap mutation, or cleanup of unrelated artifacts.
- Printing or persisting unredacted credentials, connection URLs or application row contents.

## Success criteria

- [G1] Audit evidence identifies the paired observable contracts and any proved divergence; each implemented correction has proportionate regression evidence, and unresolved uncertainty is explicit.
- [G2] The final integration inventory exercises the current schema only; legacy upgrade cases are removed or replaced with meaningful current behavior checks, with ordinary actual-orgs rollback execution and all 11 approved current-schema concurrency/fault cases documented and passing.
- [G3] Setup/fixture changes preserve important coverage and isolation; cleanup or forced rollback is verified, and reduced setup work is quantified rather than inferred solely from test counts.
- [G4] The complete relevant PostgreSQL suite and proportional unit/type/lint/format/SQL checks pass or exact blockers are reported; comparable before/after timing and final branch/scope status contain no secrets with all application row fingerprints preserved and the complete approved mixed-target suite passing; no commit occurs.

## Next action

- Parent integrates bounded production/unit and current-schema fixture implementations; verifier measures structural setup reduction and validates the selected private connection without application writes.
