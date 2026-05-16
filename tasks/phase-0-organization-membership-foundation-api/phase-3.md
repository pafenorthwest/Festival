# Phase 3 — Organization and Membership APIs

## Objective
Implement authenticated organization creation and current-membership listing API behavior.

## Code areas impacted
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/tests/organization-routes.test.ts`

## Work items
- [x] Ensure authenticated organization creation creates the org and initial Admin membership.
- [x] Add or adjust current-membership listing service/repository/route behavior.
- [x] Return organization identity and role in a contract suitable for later routing/session use.
- [x] Cover unauthenticated and duplicate/conflict paths.

## Deliverables
- Backend APIs satisfy G5 and G6.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Authenticated org creation succeeds with Admin membership.
- [x] Membership listing returns current user memberships and rejects unauthenticated calls.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test:backend`
  - Expected: organization creation and membership listing tests pass. PASS as part of `bun run test`.

## Risks and mitigations
- Risk: membership listing drifts into issue #21 tenant context.
- Mitigation: expose foundation data only; leave reusable tenant middleware for #21.
