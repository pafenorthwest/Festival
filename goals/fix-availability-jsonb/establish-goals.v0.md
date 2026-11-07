# Establish Goals

## Status

- Task name: fix-availability-jsonb
- Iteration: v0
- State: locked

## Request

- Fix availability JSONB stringification and validate the complete PostgreSQL integration suite using the user's selected `FESTIVAL_DB` connection from `./database.env`.
- The explicit request authorizes this bounded fix and creation/drop of isolated UUID test schemas on that connection; no additional approval is needed.

## Blocking ambiguity

- None.

## Assumptions

- Continue on `ericp/verified-paid-order` after local commit `87bf320`; preserve the pre-existing `.gitignore` edit and unrelated untracked database/test-data/goals/tasks artifacts.
- Load `database.env` privately; never print its value, stage it, or alter it. Only test subprocesses receive `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` derived from `FESTIVAL_DB`.
- PostgreSQL tests must use newly generated UUID schemas and clean up those schemas. Do not mutate existing application data or run deployment migrations against application schemas.

## Goals

1. Correct the availability JSONB binding and demonstrate raw object/array storage plus compatible round-trip behavior with targeted regression coverage.
2. Inspect the entire PostgreSQL integration suite for isolated schema ownership, then run all PostgreSQL-gated tests on the selected connection and record sanitized results.
3. Run proportional unit/toolchain/lint/build/SQL checks, preserve unrelated work, and document final delivered behavior and concrete limitations.

## Non-goals

- Existing application schema/data migration, unrelated JSONB changes/refactors, a new database/cluster, or changes to database.env and existing user edits.
- Commit, push, PR, deployment, external service posting, or external configuration/bootstrap mutation.
- Print or persist unredacted connection credentials in tool output, logs, goals or specs.

## Success criteria

- [G1] New availability writes bind JSON values directly; tests assert raw PostgreSQL JSONB shape and normal availability reads/updates rather than hiding encoding in a mapper.
- [G2] Every PostgreSQL integration test is audited for fresh UUID schema creation and cleanup; the complete gated suite passes against `FESTIVAL_DB` or its exact sanitized failure/blocker is reported. Existing application data remains untouched.
- [G3] Pinned checks pass or documented failures remain explicit; final spec records evidence, branch/worktree preservation, and scope without secrets. No commit or push occurs.

## Next action

- Hand off to implement; parent owns the bounded code change and final integration.
