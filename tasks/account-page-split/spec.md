# Split customer account pages

## Goal reference

- `goals/account-page-split/goals.v4.md` (locked)

## Scope

### In scope

- Customer-account routes, legacy redirect, and route helpers.
- Separate Memberships, Contact Information, and Order History page components.
- Shared account-page navigation and focused frontend tests.

### Out of scope

- Customer-account APIs, authorization, and stored data.
- Organization landing header and its Log In/Log out behavior.

## Approach

- Extract a small authenticated account-page shell and a navigation component so
  each route only loads the data required by its own section.

## Verification commands

- Lint: `bun run lint:frontend`
- Build: `bun run build:frontend`
- Tests: `bun run test:frontend`

## Delivery

- Delivered: Separate Memberships, Contact Information, and Order History account
  pages; a query-preserving legacy redirect; compact shared account navigation;
  body-level authentication controls removed; and focused route/account tests.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; the only existing uncommitted changes are
  this task's locked goal artifacts and task spec.

## Quality gate results

- Lint: passed (`bun run lint:frontend`)
- Build: passed (`bun run build:frontend`)
- Tests: passed (`bun run test:frontend`, 52 tests)
- Code review: pending
- Clean merge: pending
