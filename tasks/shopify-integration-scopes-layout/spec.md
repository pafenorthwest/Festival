# Shopify integration scopes and settings layout

## Goal reference

- `goals/shopify-integration-scopes-layout/goals.v3.md` (locked)

## Scope

### In scope

- Update the Shopify Dev Dashboard scope instructions in `SETUP.md` and the
  admin integrations page to the eight confirmed scopes.
- Return an allowlisted `verifiedScopes` list in the admin integration settings,
  render each required scope's granted/missing status, and use it for the
  missing-scope warning.
- Compact and visually contain the verified-settings content above the
  credential inputs.
- Mark `read_customers` as requiring manual verification, while retaining
  automatic warnings for the other configured scopes, and show the scope rows
  without list markers.
- Add a subtle light background to the verified-settings box without changing
  its dark text color.

### Out of scope

- Shopify credential acquisition, persistence, and unrelated integration cards.
- Database schema changes; the existing verified granted-scope record is the
  source for the new public allowlisted view.

## Approach

- Keep existing three capability diagnostics for backend operation gates; add a
  separate public verified-scope view for the complete user-confirmed list.

## Verification commands

- Lint: `bun run lint:common && bun run lint:backend && bun run lint:frontend`
- Build: `bun run build:common && bun run build:backend && bun run build:frontend`
- Tests: `bun run test:common && bun run test:backend && bun run test:frontend`

## Delivery

- Delivered: added the shared eight-scope list; updated `SETUP.md` and the
  integrations setup instructions; exposed only verified required scopes to
  admins; displayed every scope and missing-scope warnings; and compacted the
  verified-settings presentation with an input-like border and bottom spacing.
  `read_customers` now explicitly requires manual verification and is excluded
  from automatic warnings; scope rows are unbulleted and indented.
  The verified-settings box now has a subtle light-gray background.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; the only pre-existing changes are the
  goal/task artifacts created by this lifecycle. Preserve them.

## Quality gate results

- Lint: passed — `bun run lint:common && bun run lint:backend && bun run lint:frontend`
- Build: passed — `bun run build:common && bun run build:backend && bun run build:frontend`
- Tests: passed — `bun run test:common && bun run test:backend && bun run test:frontend`
- Code review: pending
- Clean merge: pending
