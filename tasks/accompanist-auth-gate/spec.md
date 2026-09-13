# Accompanist membership authentication gate

## Goal reference

- `goals/accompanist-auth-gate/goals.v2.md` (locked)

## Scope

### In scope

- Gate the accompanist-membership page on its customer-session request before loading the protected profile or accompanist form.
- Present the approved centered modal dialog for anonymous visitors, with deliberate Shopify and Cancel actions.
- Add focused frontend coverage for the request ordering, dialog semantics/content, redirect target, cancellation target, and authenticated loading path.

### Out of scope

- PostgreSQL schema, provisioning, migrations, repositories, and Admin Tool work in #157 and #158–#163.
- Changes to Shopify OAuth payloads beyond the existing page-level `returnTo` path.
- Contact or division data in a URL or OAuth state.

## Approach

- Request the customer session first. Branch only after it resolves: render the anonymous dialog or load protected data. Keep the dialog local to the accompanist page and reuse the existing modal styles.

## Verification commands

- Lint: `bun run lint:frontend`
- Build: `bun run build:frontend`
- Tests: `bun run test:frontend`

## Delivery

- Delivered: Customer-session-first accompanist page loading; an accessible centered Shopify sign-in modal for anonymous visitors; fixed accompanist return target; public landing cancellation; duplicate-redirect protection; focused frontend regression coverage.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — the only existing changes are this task's locked-goal artifacts and task specification, restored after rebasing onto `ericp/exp-long-running-agent`.

## Quality gate results

- Lint: passed — `bun run lint:frontend`
- Build: passed — `bun run build:frontend`
- Tests: passed — `bun run test:frontend` (59 tests)
- Code review: passed — no findings; patch is correct (0.93 confidence)
- Clean merge: pending
