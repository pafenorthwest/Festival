# Phase 4 — Organization Creation and Creator Admin Assignment

## Objective
Implement the organization creation flow end to end, including slug validation, persistence, and creator role assignment.

## Code areas impacted
- `packages/backend/src/*`
- `packages/backend/tests/*`
- `packages/frontend/src/*`
- `packages/frontend/tests/*`
- `packages/common/src/*`

## Work items
- [x] Add backend organization-creation APIs with slug validation, uniqueness checks, and creator membership creation.
- [x] Persist the originating user as the `Admin` role for the created organization.
- [x] Add frontend organization-creation form and validation feedback.
- [x] Add tests for invalid slug, duplicate slug, and creator-admin assignment paths.

## Deliverables
- Organization creation API and UI flow.
- Persisted creator-as-`Admin` membership behavior.
- Tests covering slug rules and creator role assignment.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Slugs allow only lowercase letters and hyphens, with the length and uniqueness rules enforced.
- [x] Successful organization creation persists the originating user as `Admin`.
- [x] Frontend create-organization flow can progress from sign-in entry to org creation success.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: organization-creation route, persistence, and frontend flow code type-check cleanly. PASS
- [x] Command: `bun run test`
  - Expected: organization creation and creator membership tests pass. PASS

## Risks and mitigations
- Risk:
  - Slug uniqueness and creator membership writes can drift if they are not handled atomically. Mitigated by backend-side validation and shared slug helpers.
- Mitigation:
  - Design the backend write path so organization creation and creator-role persistence are validated together and covered by tests.
