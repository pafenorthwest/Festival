# Phase 1 — Repository and Service Context Support

## Objective
Prepare the backend data-access surface for shared tenant middleware by ensuring middleware can resolve the authenticated app user and the user's membership in a requested organization.

## Code areas impacted
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/src/services/organization-service.ts`

## Work items
- [x] Identify the minimum repository/service calls middleware needs for user upsert and membership lookup by slug.
- [x] Add only narrow type or method adjustments needed to return app user, organization, membership, and role context.
- [x] Keep existing service response mapping stable for authorized requests.

## Deliverables
- Repository/service surface supports tenant context resolution without broad API redesign.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Middleware can be implemented using existing or narrowly adjusted backend interfaces.
- [x] No schema migration or external dependency is introduced.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run build:backend`
  - Expected: PASS.

## Risks and mitigations
- Risk: Duplicating user upsert or membership lookup logic across route handlers and middleware.
- Mitigation: Keep one shared resolver path and have routes consume request variables where org context is required.
