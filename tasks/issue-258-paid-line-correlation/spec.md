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
- Corrective pass: reviewed gaps are closed. The checkout writer now verifies
  every durable class-line association before constructing cart attributes;
  paid-order-line replays are accepted only when every immutable association
  matches; conflicting associations roll back before metadata linking.
- Paid-line conflict diagnostics: conflicting replays now fail with a typed
  error and persist the bounded `persistence` / `paid_line_conflict` delivery
  diagnostic. Class processing awaits the projection path so the shared retry
  handler records that failure before returning.
- Canonical schema: `database/postgres17-schema.sql` now includes the
  paid-line protocol column, checkout-line/cardinality indexes, class
  entitlements, registration change logs, and refund-event line identity.
- Migration diagnostics: duplicate preflight errors now list each conflicting
  identifier and count in PostgreSQL `DETAIL`, with an explicit remediation
  `HINT`; the migration remains non-destructive.
- Deferred work: Live Shopify rollout verification remains governed by the
  approved rollout plan.
- Dirty-worktree decision: continue. Preflight found only this task's approved
  graph/spec/review artifacts, goal artifacts, and scaffold-generated manifest
  update; no unrelated user changes were present.

## Quality gate results

- Lint: passed — common and backend.
- Build: passed — common and backend.
- Tests: full common (211 passed, 0 failed) and backend suites pass. Focused
  corrective coverage includes duplicate same-variant lines, shifted discounts,
  reconciliation parity, persistence mapping validation, migration/schema
  parity, and conflicting paid-line replay. PostgreSQL transaction coverage is
  present but skipped locally because `POSTGRES_INTEGRATION_URL` is not
  configured.
- Code review: the final fresh review identified the corrective gaps above;
  this pass addresses each source, schema, migration, and test finding.
- Latest targeted validation: paid-line projection/repository suites passed
  (23 passed, 1 PostgreSQL integration skip); backend lint/build, format, and
  diff checks passed.
- Diff check: passed — `git diff --check`.
- Clean merge: pending.
