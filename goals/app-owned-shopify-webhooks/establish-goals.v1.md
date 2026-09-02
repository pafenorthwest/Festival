# Establish Goals

## Status

- Task name: app-owned-shopify-webhooks
- Iteration: v1
- State: locked

## Request

- Replace manually created Shopify Admin `orders/paid` webhooks with one
  app-owned, Admin GraphQL-managed subscription per verified Organization. Keep
  onboarding low-friction by using the existing saved app client secret for HMAC
  verification rather than asking operators to copy Shopify's store-level webhook
  signing secret.

### Operator prerequisites to configure first

1. In Shopify Dev Dashboard, set the app webhook API version to `2026-07`.
   Shopify determines app-owned webhook payload version from this app setting,
   not from an individual `webhookSubscriptionCreate` request.
2. Add `read_orders` to the app version's requested Admin API scopes, release
   that app version, and update/reinstall the app on each target store so the
   scope is actually granted. `ORDERS_PAID` requires `read_orders`; a separate
   `write_webhooks` scope is not required for this subscription flow.
3. For production stores, complete Shopify protected-customer-data access as
   required for Festival's tenant-bound order re-read. Festival fails closed if
   Shopify denies or redacts required order facts.
4. In Festival, save and verify the same store's Shopify Admin integration with
   its app client ID and client secret. The stored client secret is the HMAC key
   for app-owned HTTPS deliveries; do not configure a Shopify Admin UI webhook
   or its store-level signing value.
5. Set `FESTIVAL_PUBLIC_ORIGIN` to Festival's externally reachable HTTPS origin.
   The exact webhook endpoint will be
   `https://<origin>/api/shopify/webhooks/orders-paid`.

## Lifecycle decision

- **Save & Verify** will create or repair the app-owned subscription after it
  successfully verifies an Organization's Shopify integration.
- The Shopify Integration-page diagnostic will also create or repair that
  subscription after it identifies a verified integration. This makes the
  diagnostic a safe operational recovery action, not merely a read-only check.
- Do not automatically backfill subscriptions at backend startup or during the
  existing paid-order reconciliation. Existing verified integrations are
  enrolled when an administrator saves/verifies them or runs the diagnostic.

## Assumptions

- The existing app client-credentials flow can obtain an Admin API token with
  the released `read_orders` grant and use it to create, list, and delete its
  own app-owned webhook subscriptions.
- Festival should own exactly one `ORDERS_PAID` HTTPS subscription per verified
  Organization/store and reconcile it if its endpoint or topic is wrong.
- The manual Shopify Admin webhook has been deleted and will remain unsupported.

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

## Approval

- Approved by the user on 2026-09-01.

## Next action

- Implement the locked goals.
