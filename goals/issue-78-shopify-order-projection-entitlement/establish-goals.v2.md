# Establish Goals

## Status

- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v2
- State: locked
- Supersedes: `establish-goals.v1.md` / `goals.v1.md`

## Request

- Complete GitHub issue #78, `Phase 4: Shopify order projection, Festival validation, and Teacher Membership entitlement`, under the Teacher Membership MVP parent #91.
- Consume the trusted checkout intent and opaque `festival_checkout_intent_id` cart attribute produced by completed #77. Ingest Shopify paid-order evidence idempotently, validate it under Festival authority, and create exactly one immutable Teacher Membership entitlement grant only for an approved order.
- Make every newly required public endpoint reachable only through the existing default-deny nginx policy: add exact method/path allowlists for the customer checkout continuation and narrowly scoped Shopify webhook route in both production nginx configurations, with matching route-policy tests.

## Blocking ambiguity

- None. The implementation audit identified the following necessary precision before code could continue; the choices below are now locked.

## Locked decisions and assumptions

- The MVP accepts only Shopify `orders/paid` at API version `2026-07`. Cancellation, refund, renewal, and order-change topics remain #98/later work.
- The app verifies inbound subscriptions; it does not obtain `write_webhooks` or issue Shopify Admin subscription mutations. Deployment registers the documented `orders/paid` subscription against the exact allowlisted endpoint. Repository configuration/documentation records that requirement.
- The exact webhook is `POST /api/shopify/webhooks/orders-paid`. It is registered before the generic `/api/*` CORS and browser request-security middleware; it accepts no CORS preflight and returns no CORS headers. It rejects `Origin`, `Cookie`, and `Authorization` request headers, receives a bounded untransformed raw body, resolves a candidate Organization only from normalized `X-Shopify-Shop-Domain`, uses the Organization's server-side encrypted Shopify client secret to verify `X-Shopify-Hmac-Sha256` in constant time, then validates topic, API version, and delivery ID. Browser/payload Organization/customer fields are never authority.
- Production nginx remains default-deny. Only the exact `POST` checkout and exact `POST` webhook paths required by this MVP may proxy to the backend; the webhook does not allow `OPTIONS`; all unrelated `/api` paths, including `/api/internal/*`, remain rejected. Nginx changes do not weaken method constraints, expose private reconciliation, or become a generic Shopify proxy.
- Delivery persistence stores only safe event metadata, a SHA-256 payload hash, and parsed non-PII correlation/order identifiers needed for a later Shopify Admin read, plus attempt state and safe outcome/reason categories. It never stores or logs raw bodies, HMAC values, credentials, tokens, cookies, or unnecessary customer data.
- A valid delivery is acknowledged only after durable persistence and asynchronously processed from that evidence. A private, service-token-authenticated reconciliation endpoint and a CLI entrypoint provide the execution surface. Production must schedule `bun run reconcile:shopify-orders -- --organization <organization-id>` at least daily for every enabled tenant; the repository documents this command and deployment contract. No unowned in-process timer, public worker endpoint, generic Shopify proxy, managed queue, or distributed worker is introduced.
- Reconciliation reclaims pending/failed deliveries and reads recent tenant-scoped paid orders from Shopify; it records a safe execution result and creates equivalent durable delivery evidence before normal processing. A command invocation failure exits non-zero so the deployment scheduler can alert/retry.
- `POST /api/organizations/:slug/customer/checkout` requires exactly `offeringId`, `divisionId`, and boolean `staffAccessConsent` (aside from normal request metadata). It validates that the division is active in the Organization and snapshots its stable ID/name in the intent. The browser must explicitly select the division and consent decision after authentication; it must not automatically create a cart. #93's offering-selection resume does not preserve a division or consent decision across the authentication boundary.
- Checkout records a versioned staff-access-consent decision when consent is true. Consent is not a payment or entitlement eligibility gate: absent/declined consent prevents staff-only contact projection but not valid entitlement issuance. Consent permits Shopify-origin fields to fill only blank or never Festival-edited local fields through the existing protected profile boundary.
- A duplicate check first returns the same idempotency outcome, then rejects a new cart attempt when the Organization/customer has an active Teacher Membership grant (an `active` grant whose `endsOn` is after the Organization-local current date) or another unexpired `creating`, `ready`, or `checkout_started` intent. `approved`, `rejected`, and `needs_review` intents do not block a new checkout.
- `expired` is a computed customer-status result from `endsOn` versus the Organization-local current date; it does not rewrite historical grants. If an intent has expired by the time its paid order is processed, the decision is terminal `needs_review`, no grant is issued, and the intent no longer blocks a new checkout.
- `festival_checkout_intent_id` is the only order-to-intent correlation key. A paid order must contain exactly one line item; that line must match the intent's product GID, variant GID, and quantity `1`. Missing, malformed, ambiguous, duplicate, cross-tenant, customer-mismatched, product/variant/quantity-mismatched, inactive-division, duration/policy-mismatched, or invalid correlation produces `needs_review`/`rejected` and no grant.
- Actual paid amount/currency come from the matching line's Shopify `discountedTotalSet.presentmentMoney`. Paid state is `Order.fullyPaid === true`; paid timestamp is the latest successful `SALE` or `CAPTURE` transaction `processedAt`. Missing/invalid payment facts produce no grant. Webhook JSON triggers processing; it never authorizes issuance.
- Shopify Admin reads used for validation/issuance are tenant-bound, `read_orders`-gated, API-version-pinned to `2026-07`, bounded, and redacted. The first approved order line atomically records immutable projection/decision/grant state. Delivery ID, checkout correlation, Shopify order line, and grant uniqueness prevent replay, reconciliation, and concurrent processing from duplicating a result.
- `pending_validation` is only a durable transient processing state; `approved`, `rejected`, and `needs_review` are terminal Festival decisions. Only `approved` creates a grant using existing Organization timezone/exclusive-date helpers. The customer contract exposes only allowlisted owned status data for #94, not #94's UI.

## Next action

- Implement only the locked v2 goals and specification, then run the pinned verification commands.
