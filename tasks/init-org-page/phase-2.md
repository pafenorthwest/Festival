# Phase 2 — Firebase Auth and Backend Access Control

## Objective
Integrate Firebase authentication across frontend and backend, and add authenticated backend bootstrap surfaces required by the onboarding flow.

## Code areas impacted
- `packages/backend/src/*`
- `packages/backend/tests/*`
- `packages/frontend/src/*`
- `packages/common/src/*`
- `package.json`
- `bun.lock`

## Work items
- [x] Add Firebase configuration for Google SSO and passwordless email-link sign-in.
- [x] Add backend token-verification and authorization middleware for organization APIs.
- [x] Add backend auth/bootstrap endpoints or handlers needed to resolve the authenticated user and organization membership state.
- [x] Add shared request/response contracts for authenticated bootstrap flows.
- [x] Add tests for authenticated vs unauthorized backend access.

## Deliverables
- Working Firebase auth integration boundaries for the repo.
- Authenticated backend bootstrap/authorization layer for organization flows.
- Tests proving unauthorized requests are rejected and authenticated identity is resolved.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Firebase auth integration supports Google and passwordless email-link entry points.
- [x] Backend organization surfaces reject unauthenticated or invalid-token requests.
- [x] Auth/bootstrap contracts are stable enough for frontend onboarding work.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: auth middleware, route contracts, and Firebase frontend integration surfaces type-check cleanly. PASS
- [x] Command: `bun run test`
  - Expected: authenticated and unauthorized backend access paths pass. PASS

## Risks and mitigations
- Risk:
  - Firebase email-link flow can complicate invite acceptance and returning-user bootstrap if auth state handling is inconsistent. Mitigated by a shared pending-intent flow and auth observer handoff.
- Mitigation:
  - Centralize auth/bootstrap contracts in shared models and validate backend auth handling before deeper UI flows are implemented.
