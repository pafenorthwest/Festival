# Fix PostgreSQL entitlement-grant bootstrap ordering

## Goal reference

- `goals/review-pr-150-fix-open-issue/goals.v2.md`

## Scope

### In scope

- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/tests/product-repository.test.ts`

### Out of scope

- #157 and its child issues; schema redesign; data reset; unrelated PR changes.

## Approach

- Create `entitlement_grants` before applying its compatibility constraint transition, then assert that ordering in the existing source-contract test.

## Verification commands

- Lint: `bun run lint:backend`
- Build: `bun run build:backend`
- Tests: `bun run --cwd packages/backend test product-repository.test.ts`

## Delivery

- Delivered: #151 bootstrap now creates `entitlement_grants` before its compatibility constraint transition; the existing product repository source-contract test verifies that order.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — the pre-existing goal/task artifacts are part of this task; no unrelated source changes are present.

## Quality gate results

- Lint: passed (`bun run lint:backend`)
- Build: passed (`bun run build:backend`)
- Tests: passed (`bun run test:backend`; 277 passing)
- Code review: passed (`code-review-validate.sh review-pr-150-fix-open-issue validate main`)
- Clean merge: not run (not requested; changes remain uncommitted)
