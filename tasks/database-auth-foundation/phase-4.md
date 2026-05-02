# Phase 4 — Focused Coverage and Contract Assertions

## Objective
Broaden automated coverage enough to verify locked goals and failure paths without adding unrelated product behavior.

## Code areas impacted
- `packages/backend/tests/**`
- `packages/common/tests/**` only if common auth contracts are added.
- `packages/backend/src/**` only for minimal testability fixes discovered by tests.

## Work items
- [ ] Add or refine tests for no duplicate app users for the same Firebase UID.
- [ ] Add or refine tests for updating email/full name on sync.
- [ ] Add or refine tests for case-insensitive email uniqueness at schema/repository level.
- [ ] Add or refine tests for login metadata capture and append-only insert behavior.
- [ ] Add or refine tests for 401 and validation failure responses.
- [ ] Run targeted backend/common tests and address failures within approved surfaces.

## Deliverables
- Focused automated coverage mapped to G1-G9.
- Any minimal code fixes required by coverage output.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [ ] Tests cover success and failure paths for sync, login-event, and me.
- [ ] Tests cover repository/schema uniqueness and lookup expectations.
- [ ] No tests assert out-of-scope organization, role, invite, or frontend behavior.

## Verification steps
List exact commands and expected results.
- [ ] Command: `bun run test:backend`
  - Expected: backend tests pass.
- [ ] Command: `bun run test:common`
  - Expected: common tests pass if shared contracts are changed.

## Risks and mitigations
- Risk: Tests may accidentally require live Firebase or Postgres.
- Mitigation: Use repository-local fakes and schema string assertions where live services are not part of canonical test setup.
- Risk: Coverage could drift into organization flows.
- Mitigation: Keep assertions tied to locked auth foundation goals only.
