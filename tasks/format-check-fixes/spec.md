# Format check fixes

## Goal reference

- `goals/format-check-fixes/goals.v0.md` (locked)

## Scope

### In scope

- Apply only Biome's current formatting fixes in the frontend package.

### Out of scope

- Behavior changes, refactors, and dependency updates.

## Approach

- Apply the exact safe output from `bun run format:check`.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run format:check`
- Tests: `bun run format:check`

## Delivery

- Delivered: Applied Biome's import ordering and line-wrapping changes only.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; pre-existing changes are the task's goals and spec artifacts.

## Quality gate results

- Lint: passed (`bun run format:check`)
- Build: not applicable; no behavior changed.
- Tests: not applicable; no behavior changed.
- Code review: pending
- Clean merge: pending
