# Phase 2 — Persistence and Uniqueness Foundation

## Objective
Close repository and durable persistence gaps for organizations, memberships, and invites, including uniqueness behavior required by #20.

## Code areas impacted
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/tests/organization-routes.test.ts`

## Work items
- [x] Ensure Postgres initialization creates/verifies org, membership, and invite tables with appropriate uniqueness constraints.
- [x] Ensure in-memory repository mirrors persistence semantics for tests.
- [x] Prevent duplicate organization name/slug creation consistently.
- [x] Prevent duplicate membership rows for the same user/org pair.
- [x] Preserve room for future multi-org membership unless current locked goals require otherwise.

## Deliverables
- Repository implementations satisfy G2, G3, and G4 with deterministic error behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Duplicate org and duplicate membership tests can be expressed without relying on live external services.
- [x] No issue #21 tenant middleware abstraction introduced.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test:backend`
  - Expected: backend tests for repository-backed route behavior pass. PASS as part of `bun run test`.

## Risks and mitigations
- Risk: schema edits break existing runtime data.
- Mitigation: use additive/compatible initialization where possible and explicit conflict handling.
