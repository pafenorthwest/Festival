# Duplicate Membership Conflict Error

## Goal reference

- `goals/duplicate-membership-conflict-error/goals.v0.md`

## Scope

### In scope

- Preflight an Admin membership-product creation against the tenant's active `teacher_membership` offering.
- Return HTTP 409 with the locked explicit duplicate message before any Shopify or mutation-audit operation.
- Add focused service and route coverage for the duplicate behavior and retained existing behavior.

### Out of scope

- Duration selection and offering edit/replacement/deactivation/deletion workflows.
- Public membership listing and purchase behavior.
- Existing membership data changes.

## Approach

- Reuse the tenant-scoped repository lookup before loading Shopify operation contexts, then exercise the service boundary and endpoint serialization with existing test doubles.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Added tenant-scoped active-offering preflight before Shopify integration/audit access; duplicate creation now returns HTTP 409 with the locked explicit message. Added service and route coverage proving no Shopify create/update/delete or mutation-audit record occurs for the duplicate case.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; all pre-existing changes are the immediately preceding, verified issue-93 implementation in this same task flow. This change will be limited to the membership service, focused tests, and this task's artifacts.

## Quality gate results

- Lint: passed (`bun run format:check`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`; 30 common, 194 backend, 33 frontend)
- Code review: pending
- Clean merge: pending
