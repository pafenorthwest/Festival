# Phase 4 — Invite Primitives

## Objective
Implement invite creation, lookup, and acceptance primitives with role assignment and clear failure behavior.

## Code areas impacted
- `packages/common/src/organization.ts`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/tests/organization-routes.test.ts`

## Work items
- [x] Ensure Admin invite creation stores target email and role.
- [x] Reject unauthenticated, non-member, or non-Admin invite creation as required by #20.
- [x] Return invite lookup context with organization name/slug, email, role, and status/acceptance data.
- [x] Accept invites for authenticated users, create or reuse membership for the invited org, apply invite role, and mark invite accepted.
- [x] Prevent invalid duplicate/cross-org acceptance behavior.

## Deliverables
- Invite APIs satisfy G7, G8, and G9.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Invite happy path and common failure cases are covered by backend tests.
- [x] No frontend invite UI work introduced.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test:backend`
  - Expected: invite route/service tests pass. PASS as part of `bun run test`.

## Risks and mitigations
- Risk: invite acceptance rules overreach beyond #20.
- Mitigation: implement only primitives needed by issue #20 and document blockers if #21 policy is required.
