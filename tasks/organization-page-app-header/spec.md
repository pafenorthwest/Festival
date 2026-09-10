# Organization Page App Header

## Goal reference

- `goals/organization-page-app-header/goals.v1.md` (locked)

## Scope

### In scope

- Add an Organization Page variant to `AppHeader` for `/org/:slug`,
  `/org/:slug/membership`, and `/org/:slug/account`.
- Move the shared organization name and customer Login / Logout controls into
  that variant.
- Remove duplicate organization headings from the public landing and membership
  pages.
- Add focused route and component-source tests.

### Out of scope

- Do not change routes, customer-auth APIs, Admin Page header behavior, or
  unrelated page content.

## Approach

- Identify Organization Pages through a route helper so the component and tests
  share the same definition. The header independently loads public organization
  and customer-session data for the active organization route.

## Verification commands

- Lint: `bun run lint:frontend`
- Build: `bun run build:frontend`
- Tests: `bun run test:frontend`

## Delivery

- Delivered: `AppHeader` now renders an Organization Page variant on the
  landing, membership, and customer-account routes. It loads the public
  organization name and customer session, replaces the default masthead, and
  shows Login or Logout after the customer session resolves. The landing and
  membership pages no longer duplicate the organization heading.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue. The pre-existing entries are the goal and
  task artifacts created by this workflow, including its manifest update.

## Quality gate results

- Lint: passed (`bun run lint:frontend`)
- Build: passed (`bun run build:frontend`)
- Tests: passed — 50 tests (`bun run test:frontend`)
- Code review: pending
- Clean merge: pending
