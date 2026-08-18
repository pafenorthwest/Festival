# Teacher Membership Offering and Entitlement Domain Model

## Goal reference

- `goals/teacher-membership-offering-entitlement-domain-model/goals.v1.md` (locked)

## Scope

### In scope

- Shared Teacher Membership entitlement-class, offering, grant-snapshot, validation, and date contracts.
- Migration of the current membership-product association from fixed entitlement periods to bounded positive `durationDays`, initially 365.
- Tenant-scoped offering and immutable grant persistence in the in-memory and PostgreSQL repositories.
- Server-owned offering authority and current Shopify commercial-data boundaries.
- Focused common/backend tests for invariants, snapshots, tenant isolation, timezone conversion, DST, and exclusive end dates.

### Out of scope

- Checkout-return or Shopify-event grant issuance (#78).
- Customer purchase selection and checkout (#77).
- New admin UX, renewals, extensions, overlap policy, transfers, gifting, accompanist offerings, or other entitlement classes.
- Changes to unrelated personal-prompt task artifacts already present in the worktree.

## Approach

- Treat the existing tenant product association as the Teacher Membership offering persistence surface, replace its durable period/type fields with server-owned class/duration/active fields, add a separate immutable grant snapshot contract/table, and centralize calendar-date derivation in shared code.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Added the shared `teacher_membership` class, bounded duration and date helpers, offering/grant contracts, current-Shopify purchasability helper, server-owned 365-day offering creation, PostgreSQL development-state backfill and constraints, tenant-scoped offering and immutable grant repository methods, admin request allowlisting, frontend contract updates, focused invariant/boundary tests, strict application validation that a grant's exclusive end date equals its start date plus its snapshotted duration, and rejection of fully-paid timestamps that omit `Z` or an explicit numeric UTC offset.
- Exceptions: The accepted PostgreSQL grant-date constraint enforces only `ends_on > starts_on`; shared application validation enforces exact duration equality before repository writes. Concurrent calls can bypass the one-active-offering check in `InMemoryOrganizationRepository`; this is accepted because the runtime always constructs `PostgresOrganizationRepository`, whose partial unique index enforces the invariant, while the in-memory repository is injected only by tests.
- Deferred work: Checkout selection (#77) and validated grant issuance from Shopify paid-order evidence (#78), as locked non-goals.
- Dirty-worktree decision: continue; preserve the unrelated `add-github-issue-goals-prompt` artifacts and change only issue #92 plus lifecycle files.

## Quality gate results

- Lint: passed — `bun run format:check`
- Build: passed — `bun run build`
- Tests: passed — `bun run test` (30 common, 180 backend, and 32 frontend tests)
- Code review: passed — no actionable findings; patch is correct with 0.98 confidence and the two operator-accepted exceptions above
- Clean merge: pending
