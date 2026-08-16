# Code Review
- Task name: admin-divisions-card
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `goals/admin-divisions-card/establish-goals.v0.md`
  - `goals/admin-divisions-card/establish-goals.v1.md`
  - `goals/admin-divisions-card/goals.v0.md`
  - `goals/admin-divisions-card/goals.v1.md`
  - `goals/task-manifest.csv`
  - `packages/frontend/src/App.tsx`
  - `packages/frontend/src/app/adminDivisions.ts`
  - `packages/frontend/src/app/createFestivalActions.ts`
  - `packages/frontend/src/app/createFestivalAppState.ts`
  - `packages/frontend/src/app/createFestivalDataLoaders.ts`
  - `packages/frontend/src/app/useFestivalLifecycle.ts`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/lib/routes.ts`
  - `packages/frontend/src/pages/AdminDivisionsPage.tsx`
  - `packages/frontend/src/pages/AdminHomePage.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/admin-divisions.test.ts`
  - `packages/frontend/tests/routes.test.ts`
  - `tasks/admin-divisions-card/spec.md`
- Citation candidates (verify before use):
  - `goals/task-manifest.csv:12-13`
  - `packages/frontend/src/App.tsx:65-67`
  - `packages/frontend/src/App.tsx:7-7`
  - `packages/frontend/src/app/createFestivalActions.ts:14-14`
  - `packages/frontend/src/app/createFestivalActions.ts:16-17`
  - `packages/frontend/src/app/createFestivalActions.ts:2-2`
  - `packages/frontend/src/app/createFestivalActions.ts:26-29`
  - `packages/frontend/src/app/createFestivalActions.ts:424-628`
  - `packages/frontend/src/app/createFestivalActions.ts:7-7`
  - `packages/frontend/src/app/createFestivalActions.ts:713-713`
  - `packages/frontend/src/app/createFestivalActions.ts:718-718`
  - `packages/frontend/src/app/createFestivalActions.ts:720-722`
  - `packages/frontend/src/app/createFestivalActions.ts:724-724`
  - `packages/frontend/src/app/createFestivalAppState.ts:241-242`
  - `packages/frontend/src/app/createFestivalAppState.ts:254-255`
  - `packages/frontend/src/app/createFestivalAppState.ts:317-325`
  - `packages/frontend/src/app/createFestivalAppState.ts:39-39`
  - `packages/frontend/src/app/createFestivalAppState.ts:402-406`
  - `packages/frontend/src/app/createFestivalAppState.ts:424-425`
  - `packages/frontend/src/app/createFestivalAppState.ts:439-439`
  - `packages/frontend/src/app/createFestivalAppState.ts:451-451`
  - `packages/frontend/src/app/createFestivalAppState.ts:457-460`
  - `packages/frontend/src/app/createFestivalAppState.ts:471-472`
  - `packages/frontend/src/app/createFestivalAppState.ts:485-485`
  - `packages/frontend/src/app/createFestivalAppState.ts:493-493`
  - `packages/frontend/src/app/createFestivalAppState.ts:506-506`
  - `packages/frontend/src/app/createFestivalAppState.ts:6-6`
  - `packages/frontend/src/app/createFestivalAppState.ts:65-79`
  - `packages/frontend/src/app/createFestivalDataLoaders.ts:104-141`
  - `packages/frontend/src/app/createFestivalDataLoaders.ts:190-190`
  - `packages/frontend/src/app/createFestivalDataLoaders.ts:5-6`
  - `packages/frontend/src/app/useFestivalLifecycle.ts:118-119`
  - `packages/frontend/src/app/useFestivalLifecycle.ts:165-169`
  - `packages/frontend/src/lib/api.ts:23-26`
  - `packages/frontend/src/lib/api.ts:321-385`
  - `packages/frontend/src/lib/api.ts:34-35`
  - `packages/frontend/src/lib/api.ts:9-9`
  - `packages/frontend/src/lib/routes.ts:12-13`
  - `packages/frontend/src/lib/routes.ts:126-135`
  - `packages/frontend/src/lib/routes.ts:47-50`
  - `packages/frontend/src/pages/AdminHomePage.tsx:42-56`
  - `packages/frontend/src/pages/AdminHomePage.tsx:5-5`
  - `packages/frontend/src/styles.css:821-901`
  - `packages/frontend/tests/routes.test.ts:103-105`
  - `packages/frontend/tests/routes.test.ts:5-5`
  - `packages/frontend/tests/routes.test.ts:65-68`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.93
- Justification: The Admin route, authorization guards, allowlisted API payloads, server-confirmed mutations, accessible ordering, timezone rollback, non-stale load handling, UI states, and focused tests satisfy the locked goals without changing backend behavior. The review's stale overlapping-load candidate was corrected with route-scoped request versioning before this final verdict.
