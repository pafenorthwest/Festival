# Goals Extract
- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v0
- State: locked

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
