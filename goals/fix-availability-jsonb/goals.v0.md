# Goals Extract
- Task name: fix-availability-jsonb
- Iteration: v0
- State: locked

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
