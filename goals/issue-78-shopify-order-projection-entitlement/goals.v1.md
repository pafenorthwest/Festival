# Goals Extract
- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v1
- State: locked
- Supersedes: `goals.v0.md`

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
