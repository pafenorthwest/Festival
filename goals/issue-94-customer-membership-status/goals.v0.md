# Goals Extract

- Task name: issue-94-customer-membership-status
- Iteration: v0
- State: locked

## Goals

1. Add a typed frontend client for the existing customer-owned membership-status endpoint without changing its backend or shared DTO contract.
2. Add a distinct Festival memberships section to Customer Account that renders every documented status and keeps Festival entitlement authority separate from Shopify order history.
3. Present approved grant snapshot details accurately, including currency formatting with an exact fallback and calendar dates with an explicitly exclusive end date.
4. Add independent membership loading, error, refresh, and bounded polling behavior that cannot overlap requests and cleans up timers on unmount.
5. Add focused frontend tests for API ownership, presentation states, polling decisions, Account wiring, privacy boundaries, and the repository quality gates.

## Non-goals

- Backend, database, shared DTO, checkout, Shopify order-history, or entitlement decision changes.
- Exposing checkout/order identifiers or correlating through browser-supplied authority.
- Refund, cancellation, renewal, transfer, accompanist, or class-registration workflows.

## Success criteria

- [G1] The frontend helper calls exactly the tenant-scoped membership-status GET route with the customer cookie session and consumes `CustomerMembershipStatusResponse`.
- [G2] The Account page renders Festival memberships before a separately labeled Shopify orders section and covers loading, empty, processing, rejected, needs-review, active, expired, and failure states.
- [G3] Active and expired cards render every available approved-grant field, format price safely, keep calendar dates stable across client timezones, and identify the end date as exclusive.
- [G4] Five-second polling is single-flight and stops within 60 seconds, on terminal transition, error, or cleanup; manual refresh remains available and may start a new bounded window.
- [G5] Tests prove state presentation, polling policy, API path/credentials, timer cleanup wiring, and exclusion of internal reasons, identifiers, secrets, raw payloads, and unnecessary PII; pinned checks pass.
