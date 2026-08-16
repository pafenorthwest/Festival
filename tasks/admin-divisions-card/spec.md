# Admin Divisions card

## Goal reference

- `goals/admin-divisions-card/goals.v1.md` (locked)

## Scope

### In scope

- Organization Admin home card and dedicated Divisions route/page.
- Admin division listing, create, rename, activate/deactivate, and accessible reorder controls using the existing #24 APIs.
- Organization timezone loading, valid IANA selection, and persistence.
- Explicit loading, empty, validation, conflict, authorization, success, and backend-failure states.
- Frontend route, API, state/action, presentation, styling, and automated test coverage.

### Out of scope

- Backend API or persistence changes.
- Teacher/accompanist profiles, colors, directory membership, and public discovery.
- Historical entitlement or checkout snapshot editing.
- Customer purchase-flow behavior.
- Drag-and-drop reordering or a new notification framework.

## Approach

- Extend the existing Admin card/page, controller state/action, API helper, banner, and route patterns. Keep server-confirmed division order and timezone as the authoritative state; use explicit move controls for accessible reordering.

## Verification commands

- Lint: `bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Organization Admin Divisions card and dedicated route/page; trusted tenant Admin API helpers; server-backed list/create/rename/activation/reorder workflows; IANA timezone selection and persistence; historical-purchase guidance; explicit loading, empty, saving, validation, conflict, authorization, success, and backend-failure states; responsive styling; focused frontend coverage; and request ordering allocated before asynchronous token retrieval so older loads cannot supersede newer configuration.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; preserve the user's untracked root `AGENTS.md` and isolate this fix to the Admin Divisions loader, focused test, and task record.

## Quality gate results

- Lint: passed (`bun run lint`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`; 232 total: 24 common, 176 backend, 32 frontend)
- Code review: passed (`patch is correct`, confidence 0.93, no findings after correcting stale overlapping-load handling)
- Clean merge: passed against `main` by fast-forward
