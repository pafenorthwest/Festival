# Public organization landing page

## Goal reference

- `goals/public-organization-landing-page/goals.v1.md` (locked)

## Scope

### In scope

- Public organization landing route and its trailing-slash variant.
- Public organization/festival data needed by that route.
- Shopify Customer Account sign-in/out control and the approved banner links.
- Focused frontend and backend tests for the public contract.

### Out of scope

- Administrator authentication, `/classes`, `/sign-up`, membership purchasing, festival authoring, and unrelated layout changes.

## Approach

- Add a tenant-scoped public landing read endpoint, render it on the organization root route, and use the existing Customer Account session endpoints for the customer-only auth control.

## Verification commands

- Lint: `bun run lint:frontend && bun run lint:backend`
- Build: `bun run build:common && bun run build:backend && bun run build:frontend`
- Tests: `bun run test:backend && bun run test:frontend`

## Delivery

- Delivered: public tenant-scoped landing API; slash/no-slash route parsing; upcoming festival list; Shopify Customer Account-only Login/Logout control; approved four clickable banners; All Memberships link; focused backend/frontend coverage.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; all four pre-existing entries are goal/workflow artifacts created for this task before implementation.

## Quality gate results

- Lint: passed (`bun run lint:frontend && bun run lint:backend`)
- Build: passed (`bun run build:common && bun run build:backend && bun run build:frontend`)
- Tests: passed (`bun run test:backend && bun run test:frontend`)
- Code review: pending
- Clean merge: pending
