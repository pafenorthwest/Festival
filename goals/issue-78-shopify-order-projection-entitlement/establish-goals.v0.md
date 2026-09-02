# Establish Goals

## Status

- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v0
- State: locked

## Request

- Complete GitHub issue #78, `Phase 4: Shopify order projection, Festival validation, and Teacher Membership entitlement`, under the Teacher Membership MVP parent #91.
- Consume the trusted checkout intent and opaque `festival_checkout_intent_id` cart attribute produced by completed #77. Ingest Shopify paid-order evidence idempotently, validate it under Festival authority, and create exactly one immutable Teacher Membership entitlement grant only for an approved order.
- Preserve Shopify as the authority for payment/order facts and Festival as the authority for tenant association, checkout-intent correlation, policy validation, and entitlement state.

## Blocking ambiguity

- None. The following decisions make the issue implementable without broadening its authority or financial scope.

## Locked decisions and assumptions

- The MVP accepts only the Shopify `orders/paid` webhook topic at API version `2026-07`. Cancellation, refund, renewal, and order-change topics remain outside this task and belong to #98 or later work.
- The app verifies inbound subscriptions; it does not obtain `write_webhooks` or issue Shopify Admin webhook-subscription mutations. Deployment must register the documented `orders/paid` subscription against the exact allowlisted endpoint. The repository will include the required configuration/documentation artifact.
- The public webhook route accepts a bounded raw body, resolves a candidate Organization only from the normalized `X-Shopify-Shop-Domain` header, uses that Organization's server-side encrypted Shopify client secret to verify `X-Shopify-Hmac-Sha256` in constant time, and then validates topic, API version, and delivery ID. It never accepts a browser or payload Organization/customer authority field.
- Delivery persistence stores only safe event metadata, a SHA-256 payload hash, parsed non-PII correlation/order identifiers needed for a later Shopify Admin read, attempt state, and safe outcome/reason categories. It never persists or logs raw webhook bodies, HMAC values, credentials, tokens, cookies, or unneeded customer data.
- A durable inbox/outbox processor may acknowledge a valid delivery after persistence and process it asynchronously. A private, service-authenticated reconciliation entry point and repository-backed retry/reclaim behavior handle process interruption and missed Shopify delivery; broad production ingress, scheduler, and network hardening remain #95/#96.
- #78 extends the completed #77 checkout request to require one server-validated active Organization `divisionId`, snapshot that division's stable ID/name in the checkout intent before Shopify checkout, and reject a new cart attempt whenever the same Organization/customer has an active grant or a non-terminal Teacher Membership purchase/validation record. This is the explicit #77 TODO now owned by #78.
- Checkout captures an explicit, versioned staff-access-consent decision. Consent is never a purchase/entitlement precondition: when it is absent or declined, the paid order can still be validated, but name, email, mailing address, and phone are not projected for staff access. When consent exists, Shopify-origin fields can fill only blank or never Festival-edited fields through the existing protected profile boundary.
- The processor treats the opaque `festival_checkout_intent_id` order/cart attribute as the only order-to-intent correlation key. Missing, malformed, ambiguous, duplicate, cross-tenant, customer-mismatched, product/variant-mismatched, or expired/invalid correlation produces a stored `needs_review` or `rejected` decision and no entitlement.
- The paid amount/currency, paid timestamp, order GID, order-line GID, customer GID, product/variant, quantity, and current payment status are re-read from Shopify Admin GraphQL `2026-07` under the existing tenant-scoped `read_orders` capability. Webhook payload data is a trigger, never the authority for grant issuance.
- The first approved order line atomically records its immutable order projection/validation decision and grant. A unique delivery ID, checkout-intent correlation, Shopify order line, and grant relationship prevent webhook replay, reconciliation, and concurrent processors from duplicating a projection, decision, or entitlement.
- `pending_validation`, `approved`, `rejected`, and `needs_review` are stored Festival decisions. Only `approved` creates a grant. The grant uses the existing Organization timezone/date helpers, duration snapshot, division snapshot, and exclusive end-date rules.
- #78 exposes an allowlisted, tenant/customer-owned domain/API DTO for #94 to render processing, rejected, review-required, active, and expired states. It does not implement #94's Account-page UI or treat Shopify order history as Festival entitlement presentation.

## Goals

1. Add durable, tenant-scoped Shopify paid-order delivery evidence, order/payment projection, validation-decision, and reconciliation state with strict idempotency/uniqueness boundaries for webhook delivery IDs, checkout correlation, Shopify order lines, and entitlement grants.
2. Add the exact allowlisted `orders/paid` webhook ingress route with bounded raw-body handling, tenant lookup from normalized Shopify shop context, constant-time HMAC verification using tenant-bound server-only credentials, exact `2026-07` topic/version validation, safe status responses, and route-security inventory coverage.
3. Process accepted deliveries asynchronously from durable evidence and provide a private, service-authenticated tenant reconciliation path that safely retries pending/failed work and finds missed paid-order evidence without making a public diagnostic or generic Shopify proxy.
4. Extend the trusted checkout intent and checkout-start request to require and snapshot one active Organization division and to record an explicit versioned staff-access-consent decision without making consent a payment or entitlement eligibility gate.
5. Enforce active/processing Teacher Membership duplicate prevention before Shopify cart creation and again during paid-order validation, using Organization/customer-scoped local grants, checkout intents, deliveries, and decisions rather than browser state.
6. Re-read tenant-scoped Shopify Admin order facts with the existing least-privilege `read_orders` boundary, project only required order/payment and consent-permitted customer fields, and preserve existing Festival-local profile precedence, retention, tenant isolation, and redaction behavior.
7. Correlate an order only through the opaque checkout-intent attribute, validate Organization/shop/customer/offering/variant/quantity/division/duration/policy/paid-state facts, and persist explicit `pending_validation`, `approved`, `rejected`, or `needs_review` outcomes with safe actionable reason categories.
8. Atomically create exactly one immutable `teacher_membership` entitlement grant only for an approved, fully paid, correlated order line; snapshot the required trusted identifiers, division, price/currency, duration, and Organization-timezone start/exclusive-end dates without rewriting historical grants.
9. Expose a minimal allowlisted customer-owned validation/entitlement status contract for #94 that distinguishes non-active processing/rejected/review outcomes from active/expired grants and excludes other customers, tenant authority fields, tokens, full cart IDs, raw webhook/order payloads, and unnecessary PII.
10. Add deterministic unit, repository, route-security, webhook, concurrency, reconciliation, provenance/consent, timezone/DST, and redaction tests covering all locked invariants, then pass the repository-pinned format, lint, build, and test commands.

## Non-goals

- Customer cancellation/refund requests, financial approval, `orderCancel`, `refundCreate`, charge, credit, or ledger workflows (#98, #35, #36).
- Renewals, extensions, overlap exceptions, transfers, gifting, purchase for another customer, accompanist memberships, class registration, or a general-purpose cart.
- Treating a checkout browser return, a webhook payload, Shopify Customer Account order-history response, or a browser field as direct entitlement authority.
- Updating Shopify when Festival-local customer profile fields change, automatic consent withdrawal/deletion/anonymization, or exposing staff search UI.
- Admin OAuth scope changes, `write_webhooks`, Shopify App Store installation, public/internal metrics dashboards, broad private-route infrastructure, managed queues, distributed workers, or production deployment/edge configuration owned by #95/#96.
- #94's frontend Account status presentation, polling/refresh UI, or any customer-facing order-history redesign.

## Success criteria

- [G1] Repository tests prove delivery ID, order-line, checkout-correlation, and grant uniqueness across retries and concurrent processors; cross-tenant state cannot be read or mutated.
- [G2] Route tests prove oversized, malformed, HMAC-invalid, wrong-shop, wrong-topic, wrong-version, replayed, transformed-body, and browser-authority deliveries fail closed or deduplicate without raw sensitive data in responses/logs.
- [G3] Valid `orders/paid` delivery persistence acknowledges promptly, attempts only safe asynchronous processing, and durable reconciliation can reclaim pending/failed/missed work without a public worker endpoint.
- [G4] Checkout tests require one active tenant division, snapshot its immutable identity/name before redirect, reject inactive/cross-tenant divisions, preserve historical snapshots after division mutation, and block active/processing duplicate purchases before Shopify cart mutation.
- [G5] Shopify Admin read tests prove the order facts used for validation/issuance are tenant-bound, `read_orders`-gated, API-version-pinned, bounded, redacted, and cannot be selected from browser or webhook authority fields.
- [G6] Validation tests prove missing/ambiguous/duplicate correlation; wrong customer/variant/quantity/division; unpaid orders; stale/inactive offering; duplicate purchase; policy mismatch; and unsupported/malformed upstream facts create no active entitlement and retain only a safe reason category.
- [G7] A valid, fully paid correlated order line creates one immutable grant for only its purchasing Festival customer, with actual paid price/currency, snapshotted duration/division, Organization-timezone `startsOn`, and exclusive `endsOn`; replay, reconciliation, and concurrent processing cannot create another grant.
- [G8] Tests prove consented Shopify fields fill blank/unmodified local profile fields only, Festival-edited fields remain unchanged, unconsented protected fields are not projected, and no profile/order/secret material leaks through logs or allowlisted DTOs.
- [G9] Customer status contract tests prove tenant/customer ownership, processing/rejected/review non-active states, active/expired grant state, authority-field rejection, and data minimization needed for #94.
- [G10] `bun run format:check`, `bun run lint`, `bun run build`, and `bun run test` pass after implementation.

## Next action

- Create the implementation specification from these locked goals, then implement only this scope.
