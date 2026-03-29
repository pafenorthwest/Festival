# Phase 5 — Role-Based Invites and Invite Acceptance

## Objective
Implement the admin invite workflow, invite acceptance path, and first-visit welcome behavior for newly invited users.

## Code areas impacted
- `packages/backend/src/*`
- `packages/backend/tests/*`
- `packages/frontend/src/*`
- `packages/frontend/tests/*`
- `packages/common/src/*`

## Work items
- [x] Add admin invite creation APIs that only allow `Admin`, `Division Chair`, `Music Reviewer`, `Concert Chair`, and `Read Only`.
- [x] Add invite landing and acceptance flow that binds the authenticated user to the assigned organization role.
- [x] Persist and expose first-visit welcome state so newly invited users see a dismissible welcome box on initial landing.
- [x] Add tests for allowed-role enforcement, invite acceptance, and first-visit welcome behavior.

## Deliverables
- Role-limited invite creation and acceptance backend flow.
- Frontend invite landing and acceptance UI.
- First-visit welcome behavior tied to invited-user onboarding.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Invite creation rejects roles outside the locked set.
- [x] Invite acceptance results in the assigned role and organization membership for the authenticated user.
- [x] Newly invited users see the dismissible welcome box on first landing only.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: invite APIs, acceptance logic, and frontend invite flow code type-check cleanly. PASS
- [x] Command: `bun run test`
  - Expected: invite role enforcement and acceptance tests pass. PASS

## Risks and mitigations
- Risk:
  - Invite-role enforcement and first-visit state can become inconsistent across auth retries and repeated landings. Mitigated by persisted invite/membership state and explicit dismiss handling.
- Mitigation:
  - Persist invite acceptance and welcome-state transitions explicitly in backend data and exercise replay/revisit cases in tests.
