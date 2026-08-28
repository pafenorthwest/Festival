# Establish Goals

## Status

- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v1
- State: locked
- Supersedes: `establish-goals.v0.md` / `goals.v0.md`

## Request

- Complete GitHub issue #78, `Phase 4: Shopify order projection, Festival validation, and Teacher Membership entitlement`, under the Teacher Membership MVP parent #91.
- Consume the trusted checkout intent and opaque `festival_checkout_intent_id` cart attribute produced by completed #77. Ingest Shopify paid-order evidence idempotently, validate it under Festival authority, and create exactly one immutable Teacher Membership entitlement grant only for an approved order.
- Make every newly required public endpoint reachable only through the existing default-deny nginx policy: add exact method/path allowlists for the customer checkout continuation and the narrowly scoped Shopify webhook route in both production nginx configurations, with matching route-policy tests.

## Blocking ambiguity

- None. The choices below are locked for implementation.

## Locked decisions and assumptions

- The MVP accepts only Shopify `orders/paid` at API version `2026-07`. Cancellation, refund, renewal, and order-change topics remain #98/later work.
- The app verifies inbound subscriptions; it does not obtain `write_webhooks` or issue Shopify Admin subscription mutations. Deployment registers the documented `orders/paid` subscription against the exact allowlisted endpoint. Repository configuration/documentation records that requirement.
- The webhook route accepts a bounded raw body, resolves a candidate Organization only from normalized `X-Shopify-Shop-Domain`, uses the Organization's server-side encrypted Shopify client secret to verify `X-Shopify-Hmac-Sha256` in constant time, then validates topic, API version, and delivery ID. Browser/payload Organization/customer fields are never authority.
- Production nginx remains default-deny. Only exact `POST` checkout and `POST` webhook paths required by this MVP may proxy to the backend; all unrelated `/api` paths remain rejected. Nginx changes do not weaken method constraints, expose private reconciliation, or become a generic Shopify proxy.
- Delivery persistence stores only safe event metadata, a SHA-256 payload hash, and parsed non-PII correlation/order identifiers needed for a later Shopify Admin read, plus attempt state and safe outcome/reason categories. It never stores or logs raw bodies, HMAC values, credentials, tokens, cookies, or unnecessary customer data.
- A durable inbox/outbox processor acknowledges a valid delivery after persistence and processes it asynchronously. A private, service-authenticated reconciliation entry point and repository-backed retry/reclaim behavior handle process interruption and missed delivery; broad production ingress, scheduler, and network hardening stay #95/#96.
- #78 extends #77 checkout to require one server-validated active Organization `divisionId`, snapshots its stable ID/name in the checkout intent before Shopify checkout, and rejects a new cart attempt whenever the Organization/customer has an active grant or non-terminal Teacher Membership purchase/validation record.
- Checkout records an explicit versioned staff-access-consent decision. Consent is not purchase/entitlement eligibility: absent/declined consent prevents staff-only contact projection but not valid entitlement issuance. Consent permits Shopify-origin fields to fill only blank or never Festival-edited local fields through the existing protected profile boundary.
- `festival_checkout_intent_id` is the only order-to-intent correlation key. Missing, malformed, ambiguous, duplicate, cross-tenant, customer-mismatched, product/variant-mismatched, or invalid correlation produces `needs_review`/`rejected` and no grant.
- Actual paid amount/currency, paid timestamp, order GID, order-line GID, customer GID, product/variant, quantity, and payment state are re-read via tenant-scoped Shopify Admin GraphQL `2026-07` under the existing `read_orders` capability. Webhook data triggers processing; it never authorizes issuance.
- The first approved order line atomically records immutable projection/decision/grant state. Delivery ID, checkout correlation, Shopify order line, and grant uniqueness prevent replay, reconciliation, and concurrent processing from duplicating a result.
- `pending_validation`, `approved`, `rejected`, and `needs_review` are Festival decisions; only `approved` creates a grant using existing Organization timezone/exclusive-date helpers. The output is an allowlisted customer-owned status contract for #94, not #94's UI.

## Goals

1. Add durable tenant-scoped Shopify paid-order delivery evidence, order/payment projection, validation-decision, and reconciliation state with strict idempotency/uniqueness for delivery IDs, checkout correlation, Shopify order lines, and grants.
2. Add the exact allowlisted `orders/paid` webhook ingress route with bounded raw-body handling, tenant lookup from Shopify shop context, constant-time HMAC verification with tenant-bound server-only credentials, exact `2026-07` topic/version validation, safe responses, route-security inventory coverage, and matching default-deny nginx method/path allowlists in both production configurations.
3. Process accepted deliveries asynchronously from durable evidence and provide a private, service-authenticated tenant reconciliation path that safely retries pending/failed work and finds missed paid-order evidence without a public worker endpoint or generic Shopify proxy.
4. Extend the trusted checkout intent/start request to require and snapshot one active Organization division and record an explicit versioned staff-access-consent decision without making consent a payment or entitlement gate.
5. Enforce active/processing Teacher Membership duplicate prevention before Shopify cart creation and during paid-order validation using Organization/customer-scoped grants, checkout intents, deliveries, and decisions rather than browser state.
6. Re-read tenant-scoped Shopify Admin order facts with least-privilege `read_orders`, project only required order/payment and consent-permitted customer fields, and preserve Festival-local profile precedence, retention, tenant isolation, and redaction.
7. Correlate only through the opaque checkout-intent attribute; validate Organization/shop/customer/offering/variant/quantity/division/duration/policy/paid-state facts; persist explicit `pending_validation`, `approved`, `rejected`, or `needs_review` outcomes with safe reason categories.
8. Atomically create exactly one immutable `teacher_membership` grant only for an approved fully paid correlated order line, snapshotting trusted identifiers, division, price/currency, duration, and Organization-timezone start/exclusive-end dates without rewriting history.
9. Expose a minimal allowlisted customer-owned validation/entitlement status contract for #94 that distinguishes non-active processing/rejected/review outcomes from active/expired grants and excludes cross-customer data, authority fields, tokens, cart IDs, raw webhook/order payloads, and unnecessary PII.
10. Add deterministic unit, repository, route-security, nginx, webhook, concurrency, reconciliation, provenance/consent, timezone/DST, and redaction tests for every locked invariant; pass pinned format, lint, build, and test commands.

## Non-goals

- Customer cancellation/refund requests, financial approval, `orderCancel`, `refundCreate`, charge, credit, or ledger workflows (#98, #35, #36).
- Renewals, extensions, overlap exceptions, transfers, gifting, purchase for another customer, accompanist memberships, class registration, or a general-purpose cart.
- Treating checkout return, webhook payload, Customer Account order history, or browser fields as direct entitlement authority.
- Updating Shopify when Festival-local profile data changes, automatic consent withdrawal/deletion/anonymization, or staff search UI.
- Admin OAuth scope changes, `write_webhooks`, App Store installation, generic public/internal diagnostics, managed queues, distributed workers, or broad production edge/network controls owned by #95/#96.
- #94's Account-page UI/polling/refresh behavior or a customer order-history redesign.

## Success criteria

- [G1] Repository tests prove delivery-ID, order-line, checkout-correlation, and grant uniqueness across retry/reconciliation/concurrency; tenant boundaries hold.
- [G2] Backend and nginx tests prove only exact checkout/webhook `POST` paths are newly reachable, unrelated API paths remain default-denied, and malformed/oversized/HMAC-invalid/wrong-shop/wrong-topic/wrong-version/replayed/transformed-body deliveries fail closed or deduplicate without sensitive-data exposure.
- [G3] Valid delivery persistence acknowledges promptly, invokes only safe asynchronous processing, and durable private reconciliation reclaims pending/failed/missed work.
- [G4] Checkout requires/snapshots one active tenant division, rejects inactive/cross-tenant values, preserves historical snapshots after mutation, records consent safely, and blocks active/processing duplicates before Shopify cart mutation.
- [G5] Shopify Admin reads used for validation/issuance are tenant-bound, `read_orders`-gated, API-version-pinned, bounded, redacted, and cannot be selected by browser/webhook authority fields.
- [G6] Missing/ambiguous/duplicate correlation; wrong customer/variant/quantity/division; unpaid order; inactive offering; duplicate purchase; policy mismatch; and malformed upstream facts produce no active entitlement and only a safe reason category.
- [G7] One valid fully paid correlated order line creates one immutable grant for its purchasing Festival customer with actual paid price/currency, duration/division snapshots, Organization-timezone `startsOn`, and exclusive `endsOn`; replay/reconciliation/concurrency cannot create a second.
- [G8] Consented Shopify fields fill only blank/unmodified local fields, Festival edits win, unconsented protected fields are not projected, and no secret/PII leaks through logs or allowlisted DTOs.
- [G9] Customer status contract proves ownership, non-active processing/rejected/review state, active/expired grant state, authority-field rejection, and minimization for #94.
- [G10] `bun run format:check`, `bun run lint`, `bun run build`, and `bun run test` pass.

## Next action

- Create the implementation specification from these locked v1 goals, then implement only this scope.
