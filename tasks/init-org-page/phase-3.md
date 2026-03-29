# Phase 3 — No-Org Landing and Sign-In Entry Flow

## Objective
Build the unaffiliated-user frontend experience so users without an organization can start sign-in and return safely on cancel.

## Code areas impacted
- `packages/frontend/src/*`
- `packages/frontend/tests/*`
- `packages/common/src/*`

## Work items
- [x] Add frontend routing/state for the default no-organization landing page.
- [x] Add sign-up/sign-in entry UI that offers Google SSO and passwordless email-link authentication.
- [x] Implement cancel/failure paths that return the user to the no-org landing page.
- [x] Add frontend tests for no-org landing and sign-in entry behavior.

## Deliverables
- No-org landing experience wired to the chosen auth flows.
- Frontend handling for cancel/failure return paths.
- Tests covering the unaffiliated-user entry flow.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] No-org landing page presents the required welcome content and auth choices.
- [x] Cancelled or failed sign-in returns cleanly to the no-org landing state.
- [x] Frontend tests cover the entry-flow state transitions.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: onboarding entry UI and route code type-check cleanly. PASS
- [x] Command: `bun run test`
  - Expected: frontend route helper tests and onboarding-related flow coverage pass. PASS

## Risks and mitigations
- Risk:
  - Frontend state can fork between Google and email-link entry points and leave users stranded on partial flows. Mitigated by a shared modal + pending-intent flow.
- Mitigation:
  - Keep the initial entry UI minimal and route both auth methods through a single no-org landing state machine.
