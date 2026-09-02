# Goals Extract
- Task name: app-owned-shopify-webhooks
- Iteration: v1
- State: locked

## Goals

1. Document the Shopify Dev Dashboard, store-installation, protected-data,
   Festival integration, and public-origin prerequisites above before enabling
   app-owned subscriptions.
2. On **Save & Verify** and on an explicit Shopify Integration-page diagnostic
   for a verified Shopify integration, use
   tenant-bound Admin GraphQL to list and reconcile the Organization's
   `ORDERS_PAID` subscription to the exact public Festival endpoint at app API
   version `2026-07`.
3. Preserve one-subscription-per-Organization/store behavior without creating
   duplicates, and surface safe registration/reconciliation status to the
   Organization Admin.
4. Continue using raw-body HMAC verification with the saved app client secret,
   durable delivery evidence, and paid-order reconciliation; never introduce a
   browser-visible or operator-copied webhook signing secret.
5. Add deterministic tests for scope/verification prerequisites, subscription
   creation/listing/reconciliation failures, tenant isolation, idempotency, the
   exact endpoint/topic/version contract, and both approved repair triggers.


## Non-goals

- Manually created Shopify Admin webhooks or support for their store-level
  signing secret.
- New customer-facing membership-status UI, payment changes, or entitlement
  validation changes.
- Broad Shopify scope expansion beyond the already-required `read_orders`, or
  a generic webhook-management UI.
- Changing the 48-hour paid-order reconciliation safety net.


## Success criteria

- [G1] The setup documentation lists the exact operator prerequisites and
  correctly identifies `read_orders` as the required order-webhook scope.
- [G2] Save & Verify and the Shopify Integration diagnostic each create or
  retain exactly one app-owned `ORDERS_PAID` HTTPS subscription for a verified
  tenant at the exact Festival endpoint and app API version `2026-07`.
- [G3] Missing scope, failed Shopify subscription mutations, mismatched shop
  identity, invalid public origin, and duplicate/misconfigured subscriptions
  fail closed with actionable, non-secret Admin diagnostics.
- [G4] Tests prove tenant isolation, idempotent reconciliation, exact
  topic/endpoint/version handling, both repair triggers, and continued
  client-secret HMAC acceptance.
- [G5] `bun run format:check`, `bun run lint`, `bun run build`, and `bun run
  test` pass.

