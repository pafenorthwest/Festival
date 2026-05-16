# Phase 1 — Contract and Surface Alignment

## Objective
Align shared TypeScript contracts and existing backend surfaces with locked #20 behavior before broader implementation.

## Code areas impacted
- `packages/common/src/organization.ts`
- `packages/common/src/index.ts`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/tests/organization-routes.test.ts`

## Work items
- [x] Inspect current contract names and response shapes against issue #20 and `specs/Multi-Tenant-Starter.md`.
- [x] Add or adjust shared types for membership listing, invite status/acceptance context, and org/invite API payloads.
- [x] Keep API contracts minimal and compatible with existing route conventions where possible.

## Deliverables
- Shared contracts compile and cover locked goals G1, G6, G8, and G9.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] No frontend scope introduced.
- [x] Shared contracts are sufficient for backend route/service implementation and focused tests.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run build:common`
  - Expected: common package compiles. PASS.

## Risks and mitigations
- Risk: contract churn expands into #22 frontend DTO work.
- Mitigation: update only backend/common contracts required by #20.
