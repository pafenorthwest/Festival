# App-owned Shopify webhooks

## Goal reference

- `goals/app-owned-shopify-webhooks/goals.v1.md` (locked)

## Scope

### In scope

- Create and reconcile the app-owned `ORDERS_PAID` Admin GraphQL subscription
  when Shopify integration Save & Verify or diagnostics succeeds.
- Preserve tenant-bound verification, raw-body HMAC, and paid-order processing.
- Document the required Shopify/Festival configuration and add deterministic
  tests.

### Out of scope

- Manual Shopify Admin-webhook signing values, automatic background backfill,
  customer membership UI, payment changes, and changes to paid-order recovery.

## Approach

- Reuse the verified integration's tenant-bound Admin client to reconcile the
  exact webhook topic and callback endpoint. Surface non-secret registration
  results through the existing diagnostic and Save & Verify paths.

## Verification commands

- Lint: `bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: app-owned `ORDERS_PAID` subscription reconciliation on Save &
  Verify and diagnostics; tenant-bound endpoint validation and `read_orders`
  enforcement; a process-local per-organization reconciliation mutex; safe
  diagnostic status; replacement creation and response verification before old
  subscriptions are deleted; setup prerequisites; deterministic service and
  trigger tests.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; existing `SETUP.md` and Issue 78 goal
  artifacts are related context, while `token` remains untouched and out of
  scope.

## Quality gate results

- Lint: passed (`bun run lint`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`)
- Code review: pending
- Clean merge: pending
