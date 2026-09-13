# Code Review
- Task name: issue-153-postgres-festival-insert
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `goals/issue-153-postgres-festival-insert/establish-goals.v0.md`
  - `goals/issue-153-postgres-festival-insert/goals.v0.md`
  - `goals/task-manifest.csv`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/tests/postgres-organization-repository.test.ts`
  - `tasks/issue-153-postgres-festival-insert/spec.md`
- Citation candidates (verify before use):
  - `goals/task-manifest.csv:40-41`
  - `packages/backend/src/repo/postgres-organization-repository.ts:1370-1373`
  - `packages/backend/src/repo/postgres-organization-repository.ts:1598-1614`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.96
- Justification: `createFestival` now supplies eight values for its eight target columns, deriving the first-Festival primary state atomically from the tenant's existing rows. The misplaced expression is removed from the six-column invite INSERT. Focused regression coverage verifies both SQL contracts, and backend lint, build, and the full backend test suite pass. A live PostgreSQL check could not run because the local Docker daemon is unavailable.
