# Fix PostgreSQL festival creation INSERT

## Goal reference

- `goals/issue-153-postgres-festival-insert/goals.v0.md`

## Scope

### In scope

- `PostgresOrganizationRepository.createFestival` SQL and focused repository regression coverage.

### Out of scope

- Schema bootstrap, festival route behavior, and unrelated repository methods except restoring the misplaced invite INSERT values discovered in the PR diff.

## Approach

- Move the first-festival primary expression to the festival INSERT, where its column list expects it, and restore `createInvite` to its six-column value list.

## Verification commands

- Lint: `bun run lint:backend`
- Build: `bun run build:backend`
- Tests: `bun --cwd packages/backend test tests/postgres-organization-repository.test.ts`

## Delivery

- Delivered: `createFestival` now binds all eight target values and atomically derives `is_primary`; `createInvite` is restored to its six-column insert; regression tests cover both SQL contracts.
- Exceptions: A live PostgreSQL insert check is pending because the local Docker daemon is not running. The focused and full backend suites validate the repository source contract.
- Deferred work: None
- Dirty-worktree decision: continue — the task's own goal/spec artifacts are uncommitted and no unrelated user edits are present.

## Quality gate results

- Lint: passed — `bun run lint:backend`
- Build: passed — `bun run build:backend`
- Tests: passed — `bun --cwd packages/backend test tests/postgres-organization-repository.test.ts`; `bun run test:backend` (277 passed)
- Code review: passed — no actionable findings in the scoped diff.
- Clean merge: pending
