# Issue #258: paid Shopify line correlation

## Goal reference

- `goals/issue-258-paid-line-correlation/goals.v0.md` (locked)

## Scope

### In scope

- Exact server-only UUID correlation between checkout intent lines and paid
  Shopify order lines; Admin paid-order parsing; order-independent projection;
  database cardinality constraints/migration; refund-event line audit; focused
  backend, common, schema, and migration tests.

### Out of scope

- No checkout UI/API redesign or new checkout POST error; no positional
  fallback; no Shopify `write_orders` or automatic refunds; no selection,
  capacity, prerequisite, or catalog changes.

## Approach

- Add line identity/read-model support first, then replace projection pairing,
  add durable constraints and refund-event audit, and verify with focused tests
  before broader lint/build/test gates.

## Verification commands

- Lint: `bun run lint:common && bun run lint:backend`
- Build: `bun run build:common && bun run build:backend`
- Tests: `bun test packages/common/tests/entitlements.test.ts packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/class-order-projection.test.ts packages/backend/tests/shopify-admin-api-client.test.ts packages/backend/tests/postgres-schema.test.ts packages/backend/tests/drop-transfer-service.test.ts packages/backend/tests/postgres-commerce-repository.test.ts`

## Delivery

- Delivered: issue #258 paid-line correlation.
- Exceptions: `database/postgres17-schema.sql` is a known pre-Phase-2
  rebaseline artifact and was not updated; runtime canonical initializer and
  forward migration are authoritative for this change; rebaseline plan governs
  the dump.
- Deferred work: Live Shopify rollout verification remains governed by the
  approved rollout plan.
- Dirty-worktree decision: continue. Preflight found only this task's approved
  graph/spec/review artifacts, goal artifacts, and scaffold-generated manifest
  update; no unrelated user changes were present.

## Quality gate results

- Lint: passed — common and backend.
- Build: passed — common and backend.
- Tests: passed after corrective rerun — common (211 passed, 0 failed) and
  backend (1,012 passed, 5 PostgreSQL integration skips, 0 failures). The first
  full backend run found one partial-refund regression, which was corrected
  before this rerun; `POSTGRES_INTEGRATION_URL` is not configured.
- Code review: final PASS — no actionable P0–P3 findings.
- Diff check: passed — `git diff --check`.
- Clean merge: pending.
