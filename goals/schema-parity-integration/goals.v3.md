# Goals Extract
- Task name: schema-parity-integration
- Iteration: v3
- State: locked

## Goals

1. Correct the four demonstrated JSONB native-binding paths (checkout repertoire, customer mailing address, registration-change prior/new state, communication variables/payload) and three memory parity defects (cart organization guard, metadata unique ID/line rejection, earliest consent), with focused observable-contract regressions.
2. Restrict integration coverage to the current installed schema, removing legacy reconstruction/upgrade/backfill/reapply cases. Run ordinary behavioral fixtures against actual `orgs` through explicit rollback transactions, without calling its runtime initializer or installing application-table triggers. Hold the multi-session/fault-test exception decision pending user response.
3. Reduce avoidable fixture/setup work without weakening meaningful assertions. Every actual-application fixture DML statement must enlist in its explicit rollback transaction; verify fixture absence and unchanged private application aggregates. Do not silently retire real concurrency/fault regressions while their target exception is pending.
4. Validate the final user-selected harness and observable contracts against private FESTIVAL_DB, report setup/runtime evidence with changed-target/workload caveats and proportional quality checks, preserve all 67 application table counts/fingerprints and unrelated work. Earlier isolated-target validation is historical evidence, not final acceptance for the new target.

## Non-goals

- Broad refactors, speculative parity changes, runtime schema initializer/deployment changes, additional migrations or application-table DDL/triggers, schema resets, env edits or persistent application data changes.
- Persistent fixture writes, global SQL calls that bypass the rollback executor, runtime schema initialization on actual orgs, legacy-upgrade/reapply cases, or lowering meaningful regression/security/concurrency assertions for speed.
- Commit, push, PR, deployment, external posting, shared configuration/bootstrap mutation, or cleanup of unrelated artifacts.
- Printing or persisting unredacted credentials, connection URLs or application row contents.

## Success criteria

- [G1] Audit evidence identifies the paired observable contracts and any proved divergence; each implemented correction has proportionate regression evidence, and unresolved uncertainty is explicit.
- [G2] The final integration inventory exercises the current schema only; legacy upgrade cases are removed or replaced with meaningful current behavior checks, with ordinary actual-orgs rollback execution documented and any concurrency/fault exception explicitly resolved before final execution.
- [G3] Setup/fixture changes preserve important coverage and isolation; cleanup or forced rollback is verified, and reduced setup work is quantified rather than inferred solely from test counts.
- [G4] The complete relevant PostgreSQL suite and proportional unit/type/lint/format/SQL checks pass or exact blockers are reported; comparable before/after timing and final branch/scope status contain no secrets with all application row fingerprints preserved and no final target decision pending; no commit occurs.
