# Organization side navigation

## Goal reference

- `goals/organization-side-navigation/goals.v2.md` (locked)

## Scope

### In scope

- Add a collapsible left sidebar only to `/org/:slug`, `/org/:slug/membership`, and `/org/:slug/account/**`.
- Keep the account pages' existing horizontal navigation intact.
- Render the Accounts links, Festival Home link, icon-only collapsed state, and responsive non-persistent default.

### Out of scope

- Admin organization routes, non-organization routes, new Festival links, and account data/API work.

## Approach

- Use the existing organization route guard to wrap only the confirmed page families in a shared layout.

## Verification commands

- Lint: `bun run lint` (from `packages/frontend`)
- Build: `bun run build` (from `packages/frontend`)
- Tests: `bun test` (from `packages/frontend`)

## Delivery

- Delivered: Shared additive sidebar with three account links and a Festival Home link, desktop/mobile initial collapsed state, and accessible collapse toggle.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; the only pre-existing changes are the goals and task artifacts produced by this locked-goals workflow.

## Quality gate results

- Lint: passed (`bun run lint`, from `packages/frontend`)
- Build: passed (`bun run build`, from `packages/frontend`)
- Tests: passed (`bun test`, from `packages/frontend`)
- Code review: pending
- Clean merge: pending
