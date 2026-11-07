# Goals Extract
- Task name: consolidate-frontend-hooks
- Iteration: v0
- State: locked

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
