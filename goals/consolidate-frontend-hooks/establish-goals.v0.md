# Establish Goals

## Status

- Task name: consolidate-frontend-hooks
- Iteration: v0
- State: locked
- Approval: user explicitly requested both consolidations and a rebuild size comparison on 2026-10-23.

## Request

- Consolidate the eligibility hooks and duplicated admin festival selection logic, then rebuild and report the size difference.

## Blocking ambiguity

- None.

## Assumptions

- Preserve existing public APIs and runtime behavior; size reduction is to be measured, not guaranteed.
- Admin festival selection refers to the duplicated Rooms and Volunteer Roles logic identified in the preceding audit.

## Goals

1. Share the eligibility request lifecycle while preserving cart and class-option-specific inputs, result mapping, empty-state behavior, errors, stale-response protection, and cleanup.
2. Share Rooms and Volunteer Roles festival selection, fallback, authentication subscription cleanup, and selector UI while preserving each page's resource guards and behavior.
3. Validate the refactor and rebuild the frontend, reporting minified and gzip size differences against the exact prior baseline.

## Non-goals

- Route splitting, API compatibility or request-body refactors, unrelated resource-loader consolidation, dependency updates, backend changes, commits, and pull requests.

## Success criteria

- [G1] Existing eligibility tests and focused lifecycle regression tests pass; public eligibility hook APIs and mapping distinctions are preserved.
- [G2] Relevant admin tests and focused festival fallback/reactivity/cleanup checks pass; Rooms and Volunteer Roles retain their guards, UI labels, and classes.
- [G3] Frontend tests, TypeScript check, scoped Biome check, and production build pass, or any pre-existing failure is clearly evidenced.
- [G3] Report actual minified and Node gzip bytes against 502,122 and 138,605 bytes respectively; report whether the 500 kB warning remains.

## Next action

- Hand off to implement; approval is already present in the user's instruction.
