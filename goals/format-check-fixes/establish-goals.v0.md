# Establish Goals

## Status

- Task name: format-check-fixes
- Iteration: v0
- State: locked

## Request

- Fix the failures reported by `bun run format:check`.

## Blocking ambiguity

- None. The formatter output identifies the required non-semantic formatting changes.

## Assumptions

- Apply only the safe formatting changes identified by Biome.

## Goals

1. Correct all current `bun run format:check` errors without changing application behavior.

## Non-goals

- Functional changes, unrelated refactors, and dependency updates.

## Success criteria

- [G1] `bun run format:check` exits successfully after the focused formatting edits.

## Next action

- Hand off to implement
