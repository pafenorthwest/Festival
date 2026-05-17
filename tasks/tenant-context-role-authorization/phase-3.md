# Phase 3 — Route Integration

## Objective
Apply the shared auth, tenant context, and role helpers to existing org-scoped routes while preserving authorized public response contracts.

## Code areas impacted
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/common/src/organization.ts` only if a narrow shared type adjustment is required

## Work items
- [x] Keep non-org auth-only routes auth-only, such as organization creation and membership listing.
- [x] Apply tenant context middleware to org-scoped routes using the route slug.
- [x] Apply Admin-only authorization to invite creation based on resolved membership role.
- [x] Simplify service methods that no longer need to repeat route-level tenant/role checks, without changing authorized response shapes.

## Deliverables
- Existing backend routes enforce tenant isolation and Admin gates through shared middleware/helpers.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Valid org members can still access their org landing/welcome flows.
- [x] Non-members and lower-privilege users are rejected before protected handler behavior can expose org data.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test:backend`
  - Expected: PASS.

## Risks and mitigations
- Risk: Tightening authorization can change existing status code expectations.
- Mitigation: Update tests only where the locked goals require stricter explicit auth/tenant failures.
