# Organization divisions and timezone API

## Goal reference

- `goals/organization-divisions-timezone-api/goals.v1.md` (locked)

## Scope

### In scope

- Durable Organization-scoped divisions with stable IDs, normalized unique names, activation state, and deterministic ordering.
- Required Organization IANA timezone persistence and Admin read/update API.
- Tenant-scoped Admin configuration routes and active-only public purchase-flow DTO.
- Trusted tenant authority, Admin authorization, explicit validation/conflict errors, and selectable-division validation for downstream purchase work.
- In-memory and PostgreSQL repository support, migrations, route inventory, and automated tests.

### Out of scope

- Admin cards/screens and other UI work tracked by issue #25.
- Profiles, colors, multi-division directory membership, and public discovery tracked by issue #97.
- Membership offering/date behavior and purchase-selection orchestration tracked by issues #92 and #77.
- Hard deletion of divisions.

## Approach

- Extend the existing common contract, Organization service/repository boundary, Hono routes, and route-security inventory without introducing a parallel subsystem.
- Preserve historical references by keeping stable IDs and exposing deactivation instead of deletion; provide active-selection validation for purchase orchestration.

## Verification commands

- Lint: `bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Common DTOs and validators; Organization timezone default/migration; division persistence and ordering; Admin list/create/update/reorder and timezone routes; public active-only division route; tenant/role/field allowlisting; downstream selectable-division guard; focused automated coverage.
- Exceptions: None.
- Deferred work: UI remains in issue #25. Issues #77 and #92 consume the delivered public DTO and selectable-division guard when their purchase and entitlement records are implemented.
- Dirty-worktree decision: continue; preserve the unrelated pre-existing untracked `tasks/festival-customer-identity-account-foundation/skill-friction-retrospective.md` and isolate this task's changes by path.

## Quality gate results

- Lint: passed (`bun run lint`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`; 226 total: 24 common, 175 backend, 27 frontend)
- Code review: passed (`patch is correct`, confidence 0.94, no findings)
- Clean merge: pending
