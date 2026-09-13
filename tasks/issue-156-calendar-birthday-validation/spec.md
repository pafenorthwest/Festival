# Reject calendar-invalid child birthdays

## Goal reference

- `goals/issue-156-calendar-birthday-validation/goals.v0.md`

## Scope

### In scope

- Calendar-date validation used by child age-snapshot creation and refresh.
- Focused backend regression tests.

### Out of scope

- Snapshot persistence, authorization, API contracts, and unrelated date handling.

## Approach

- Parse the birthday once, verify its UTC calendar components exactly match the input, then reuse the parsed date for age calculations.

## Verification commands

- Lint: `bun run lint:backend`
- Build: `bun run build:backend`
- Tests: `bun --cwd packages/backend test tests/customer-account-service.test.ts`

## Delivery

- Delivered: birthday parsing now rejects calendar-invalid values before child age calculations in both creation and refresh flows; regression coverage verifies invalid dates and a valid leap day.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — existing `tasks/exp-long-running-agent/` is untracked user work and will not be touched; the goal and task artifacts are required workflow files for this task.

## Quality gate results

- Lint: passed — `bun run lint:backend`
- Build: passed — `bun run build:backend`
- Tests: passed — `bun --cwd packages/backend test tests/customer-account-service.test.ts`
- Code review: passed — no actionable findings in the scoped implementation diff.
- Clean merge: pending
