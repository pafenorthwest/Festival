# Issue #120: Shopify purchase profile prefill

## Goal reference

- `goals/issue-120-customer-profile-shopify-prefill/goals.v0.md` (locked)

## Scope

### In scope

- Paid-order contact profile projection, retry behavior, and Shopify address
  selection.
- Customer account return-state messaging and profile refresh.
- Focused backend and frontend regression tests.

### Out of scope

- Festival-to-Shopify profile sync; entitlement/payment/refund policy; staff
  access authorization changes.

## Approach

- Make a failed contact projection fail the delivery so existing delivery
  recovery/reconciliation retries it. Prefer order shipping address, then
  customer default address. Refresh the returned account profile after the
  membership handoff resolves.

## Verification commands

- Lint: `bun run lint`
- Build: `bun run build`
- Tests: `bun test packages/backend/tests/shopify-order-projection.test.ts packages/backend/tests/shopify-admin-api-client.test.ts packages/frontend/tests/customer-account.test.ts packages/frontend/tests/browser/account-return.tsx`

## Delivery

- Delivered: Failed consented profile projections now leave the order delivery
  recoverable for retry; paid-order shipping addresses are preferred with a
  complete customer-default-address fallback; the account return page explains
  profile import processing and reloads the profile after confirmation.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; the three existing uncommitted entries
  are the locked goal artifact and implementation spec created for this task.

## Quality gate results

- Lint: passed (`bun run lint`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`; 353 tests across all workspaces)
- Code review: passed (no actionable findings after the P1 fix)
- Clean merge: passed (fast-forward with `main`)
