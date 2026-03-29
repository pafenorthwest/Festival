# Phase 6 — Organization Landing, Returning-User Routing, and Full Verification

## Objective
Finalize authenticated organization landing behavior, route returning users directly to their organization page, and complete the task’s verification coverage.

## Code areas impacted
- `packages/frontend/src/*`
- `packages/frontend/tests/*`
- `packages/backend/src/*`
- `packages/backend/tests/*`
- `packages/common/src/*`
- `tasks/init-org-page/final-phase.md`

## Work items
- [x] Add authenticated organization landing bootstrap and `/org/<organization-slug>` routing.
- [x] Show organization name, logout control, and role-specific welcome messaging on the landing page.
- [x] Route returning authenticated users directly to their organization landing page.
- [x] Close remaining automated coverage gaps and prepare full lint/build/test evidence for Stage 4.

## Deliverables
- Complete organization landing experience for invited and returning users.
- Returning-user routing integrated with backend membership bootstrap.
- Final verification-ready test surface for the task.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Authenticated users with memberships route directly to `/org/<organization-slug>`.
- [x] Organization landing page shows the required organization name, logout action, and role-specific welcome text.
- [x] Root lint/build/test can pass once final implementation is complete.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: common, backend, and frontend type-check cleanly for the full feature set. PASS
- [x] Command: `bun run build`
  - Expected: all workspaces build successfully with organization flows included. PASS
- [x] Command: `bun run test`
  - Expected: shared, backend, and frontend tests pass for the completed org/auth behavior. PASS

## Risks and mitigations
- Risk:
  - Returning-user routing can regress if frontend bootstrap and backend membership lookup diverge late in implementation. Mitigated by shared session contracts and root verification.
- Mitigation:
  - Keep landing bootstrap contracts shared across packages and use root verification to catch integration drift before Stage 4 completion.
