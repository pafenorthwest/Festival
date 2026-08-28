# Shopify Order Projection, Festival Validation, and Teacher Membership Entitlement

## Goal reference

- `goals/issue-78-shopify-order-projection-entitlement/goals.v3.md` (locked; v2 remains binding except the status-route amendment)

## Scope

### In scope

- Exact `POST /api/shopify/webhooks/orders-paid` Shopify webhook ingress at API version `2026-07`, bounded raw-body/HMAC verification before generic API CORS/security middleware, durable idempotent event evidence, async processing, and a private service-authenticated reconciliation trigger plus documented scheduled CLI contract.
- Tenant-scoped Shopify Admin order reads; durable order/payment projections and Festival validation decisions; safe order-to-intent correlation through `festival_checkout_intent_id` only.
- Trusted active-division selection/snapshot and explicit consent in the customer checkout flow, plus customer-wide active/processing duplicate prevention at checkout and validation time.
- Immutable approved Teacher Membership grants, consent-gated Shopify contact projection, and the minimal customer-session-owned `GET /customer/membership-status` DTO endpoint for #94.
- Exact route-security and default-deny nginx rules for the customer checkout continuation and webhook endpoint, plus documentation for the deployment-owned Shopify webhook subscription.

### Out of scope

- Refunds/cancellations, renewals, transfers, gifts, other memberships, general cart work, and #94 Account UI.
- Shopify webhook subscription mutations, new Admin scopes, generic public/internal proxying, distributed queues/workers, or #95/#96 deployment hardening.

## Implementation approach

1. Extend the checkout contract/repository with trusted division and consent snapshots, correlation lookup that survives checkout lifecycle expiry/failure, and customer-wide processing checks. Keep all browser authority limited to an active division ID and explicit consent decision; resolve every other field server-side. Require the user to select these after authentication rather than auto-submitting checkout.
2. Add common/domain contracts and a dedicated commerce repository for delivery evidence, order projection, validation decisions, and customer status. Use PostgreSQL constraints/transactions and equivalent in-memory behavior to make delivery, correlation, order-line, decision, and grant processing idempotent.
3. Extend the tenant-bound Shopify Admin client with a bounded `read_orders` order reader pinned to `2026-07`. Re-read current paid facts before validation and never authorize grants from webhook JSON alone; require `fullyPaid`, exactly one matching quantity-one line, matching paid money, and the latest successful payment timestamp.
4. Add the exact public webhook route before generic API CORS/security middleware, reject browser credentials/origins, verify the untransformed raw body, and dispatch only after durable persistence. Add a private reconciliation trigger protected by a server-only configured credential and a CLI that deployment schedules at least daily per tenant.
5. Validate correlation, late-expired intent, shop/customer/offering/variant/quantity/division/duration/policy/fully-paid facts and issue a grant only as the transactionally idempotent approved result. Persist safe rejection/review categories otherwise; terminal outcomes and computed expired grants do not block a new checkout.
6. Project consent-permitted Shopify contact fields through the existing provenance boundary, preserve Festival-owned edits, and expose only the minimal customer-owned #94 handoff DTO through its exact authenticated GET route.
7. Update both nginx allowlists (webhook POST only and status GET only), route inventory tests, setup/deployment documentation, and focused security/repository/frontend/scheduler contract tests. Preserve default-deny behavior everywhere else.

## Verification commands

- Format and lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery gate

- Do not declare #78 complete until webhook/reconciliation, validation/issuance, duplicate prevention, consent/provenance, edge allowlists, status contract, and all pinned quality commands pass.
