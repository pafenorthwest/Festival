# Phase 4 — Authorization Test Coverage

## Objective
Add focused backend tests proving the locked auth, tenant isolation, role gate, and context availability criteria.

## Code areas impacted
- `packages/backend/tests/organization-routes.test.ts`
- Optional new backend test file under `packages/backend/tests/`

## Work items
- [x] Cover unauthenticated org-scoped requests.
- [x] Cover malformed and invalid auth failures.
- [x] Cover valid member access and unchanged authorized response shape.
- [x] Cover wrong-tenant access without leaking requested org data.
- [x] Cover Admin-only invite creation rejection for a lower-privilege member.
- [x] Cover a handler path that consumes resolved tenant/role context rather than duplicating lookup logic.

## Deliverables
- Backend tests fail on missing middleware enforcement and pass with the implemented shared authorization behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Tests map to G1-G5 success criteria.
- [x] Tests remain deterministic with the in-memory repository and fake auth verifier.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run test:backend`
  - Expected: PASS.

## Risks and mitigations
- Risk: Tests assert implementation details too tightly.
- Mitigation: Assert externally observable failures and the presence of context-driven route behavior, not private function names.
