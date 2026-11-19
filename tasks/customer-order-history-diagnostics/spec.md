# Customer Account order-history diagnostics

## Problem and evidence

The confirmed defect was error classification and observability: Festival discarded Shopify GraphQL error metadata and returned the same generic 403 for every error. The historical provider failure's underlying reason cannot be reconstructed from the retained generic error. This change does not claim to fix that unknown reason.

The separate sign-in readiness fix already prevents an order-access failure from disabling organization-wide authentication. The genuine abandoned-checkout browser exercise passed: both authenticated sessions returned HTTP 200 with five orders; Cart 1 restored after fresh sign-in and reload; registration stayed blocked; and resume used the same persisted Shopify cart at execution generation 1. No payment was made, and the test fixture remains. See [live-e2e.md](../pending-shopify-checkout-restoration/live-e2e.md). No customer information is recorded here.

An independent check of Shopify's public pinned 2026-07 schema inspected 493 types and confirmed all 21 selected fields and their arguments exist. No query change was justified. Shopify's official schema source configuration is documented in [Hydrogen codegen.ts](https://github.com/Shopify/hydrogen/blob/main/packages/hydrogen/codegen.ts) at lines 8–10 and 44–49.

Related checkout specification: [Pending Shopify checkout restoration](../../specs/pending-shopify-checkout-restoration.md).

## Scope

The diagnostic delta touches exactly four files:

- `packages/backend/src/domains/customer-identity/customer-graphql-errors.ts`: bounded error classification and safe structured diagnostics.
- `packages/backend/src/domains/customer-identity/customer-oauth-flow.ts`: invoke the helper with fixed `customer_identity` and `customer_orders` operation literals.
- `packages/backend/tests/customer-graphql-errors.test.ts`: classification, redaction, bounds and success behavior.
- `packages/backend/tests/customer-account-service.test.ts`: provider-code fixtures and service-level classification regressions.

The earlier readiness changes in the shared flow and service test files are separately scoped. This diagnostic change does not alter Shopify queries, permissions, scopes, endpoints, tokens, retries, readiness or session policy. It adds no database schema or configuration changes.

## Error and diagnostic contract

All failures retain a generic public message and expose no provider payload in AppError details.

| Provider classification | HTTP status | Public machine code |
| --- | --- | --- |
| `ACCESS_DENIED` | 403 | `customer_account_access_denied` |
| `THROTTLED` | 503 | `customer_account_throttled` |
| `INTERNAL_SERVER_ERROR` | 503 | `customer_account_upstream_error` |
| Recognized GraphQL schema/parse errors | 503 | `customer_account_query_error` |
| Unrecognized or absent provider code | Existing generic 403 | None |

Only nonempty GraphQL error responses produce a structured `shopify_customer_account_graphql_failure` warning. The event contains a fixed operation/category, exact allowlisted provider codes, allowlisted query-field path segments, a bounded error count and finite nonnegative cost/throttle numbers no greater than 1e9. Inspection is capped at 20 errors, eight unique codes, eight unique paths and 12 input segments per path. Arbitrary path values and numeric indices are omitted.

Raw provider messages, successful response data, arbitrary extensions, query variables, headers, identifiers and credentials are excluded. Successful responses produce no diagnostic warning. No automatic retry is introduced.

## Validation and review

The focused suite passed **104 tests, 494 assertions, zero failures**:

```bash
bun test packages/backend/tests/customer-graphql-errors.test.ts packages/backend/tests/customer-account-service.test.ts packages/backend/tests/customer-account-transport.test.ts packages/backend/tests/customer-auth.routes.test.ts packages/backend/tests/architecture-boundaries.test.ts
bun run --cwd packages/backend lint
bun run --cwd packages/backend build
bunx biome check packages/backend/src/domains/customer-identity/customer-graphql-errors.ts packages/backend/src/domains/customer-identity/customer-oauth-flow.ts packages/backend/tests/customer-graphql-errors.test.ts packages/backend/tests/customer-account-service.test.ts
```

Backend types, build and scoped formatting passed. Tests cover known categories, unknown-error compatibility, malicious metadata containing credentials/identifiers, invalid or oversized numeric metadata, bounded arrays/paths, no success logging, service operation wiring and unchanged authentication without retry. The flow remains below the 500-line architecture ceiling.

Independent review independently reran the focused suite and found no actionable issue: **READY**, patch correct, confidence 0.94. See [code-review.md](./code-review.md).

## Remaining acceptance

Genuine sign-in, successful order-history reads and the abandoned-checkout logout/login/restoration exercise passed; evidence is recorded in [live-e2e.md](../pending-shopify-checkout-restoration/live-e2e.md). The historical provider reason remains unknown. Partial-to-full payment, refunds and payment completion remain unverified. No payment was made; the test fixture remains.
