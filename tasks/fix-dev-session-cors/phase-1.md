# Phase 1 — Backend API CORS

## Objective
Add explicit backend CORS support for local frontend API calls and prove `/api/session` preflight behavior with tests.

## Code areas impacted
- `packages/backend/src/app.ts`
- `packages/backend/tests/auth-routes.test.ts`

## Work items
- [x] Add Hono CORS middleware before API routes.
- [x] Default allowed origins to local dev frontend origins and keep unconfigured origins non-permissive.
- [x] Add backend tests for allowed preflight, allowed normal response, and disallowed origin behavior.

## Deliverables
- Backend API routes return CORS headers for `http://localhost:5173`.
- Backend route tests cover `/api/session` CORS behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] `/api/session` preflight from `http://localhost:5173` succeeds with matching allow-origin.
- [x] `/api/session` response from `http://localhost:5173` includes matching allow-origin.
- [x] Unknown origins do not receive wildcard or reflected allow-origin.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run --cwd packages/backend test`
  - Expected: backend route tests pass.
- [x] Command: `bun run lint`
  - Expected: TypeScript/Biome lint pass.
- [x] Command: `bun run build`
  - Expected: all packages build.
- [x] Command: `bun run test`
  - Expected: full test suite passes.

## Risks and mitigations
- Risk: CORS allowlist becomes too broad.
- Mitigation: Use an explicit origin allowlist with local dev defaults and no wildcard.
