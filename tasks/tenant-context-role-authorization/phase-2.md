# Phase 2 — Auth, Tenant Context, and Role Helpers

## Objective
Create shared backend middleware/helper composition for auth-only requests, org-scoped tenant context, and explicit role gates.

## Code areas impacted
- `packages/backend/src/auth/**`
- `packages/backend/src/routes/api-router.ts`
- Optional new backend middleware module under `packages/backend/src/`

## Work items
- [x] Centralize Authorization header parsing and invalid/missing credential failures.
- [x] Build middleware that verifies the injected `AuthVerifier`, resolves the app user, finds membership for the route org slug, and sets typed Hono variables.
- [x] Add role helper(s) for Admin-only and explicit allowed-role checks.
- [x] Keep Firebase verifier/app creation outside per-request middleware construction.

## Deliverables
- Shared middleware/helpers provide typed identity, user, organization, membership, and role context to handlers.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Missing auth, malformed auth, verifier failure, non-member, and role-denied paths each have explicit failure behavior.
- [x] Handler code can read tenant/role context from Hono variables.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run build:backend`
  - Expected: PASS.

## Risks and mitigations
- Risk: Returning different error shapes across auth and tenant failures.
- Mitigation: Route all expected failures through `AppError`/JSON error handling or an equivalent shared JSON response path.
