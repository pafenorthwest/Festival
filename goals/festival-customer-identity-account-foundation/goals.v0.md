# Goals Extract
- Task name: festival-customer-identity-account-foundation
- Iteration: v0
- State: draft

## Goals

1. Define and persist a unique Festival customer identity scoped to one Organization and one verified Shopify customer GID.
2. Resolve the same Festival customer deterministically and safely for repeated/concurrent valid Shopify authentications.
3. Bind customer sessions and customer-facing Account reads to the trusted Organization/customer relationship without browser-selected authority.
4. Define a minimal allowlisted customer Account profile contract and protected local contact projection compatible with later population by #78.
5. Enforce the Shopify/Festival authority boundary, tenant isolation, PII minimization/protection, and secret/log redaction.
6. Prove that customer authentication or customer-record creation alone cannot create purchase, validation, membership, or entitlement state.


## Non-goals

- Shopify order/webhook ingestion, commerce projection, purchase validation, or entitlement issuance; owned by #78.
- Teacher/accompanist directory profiles or public discovery; owned by #97.
- Email-based identity matching or automatic cross-Shopify-customer merging.
- Firebase Admin/customer-principal interchangeability.
- Implementing source code during the establish-goals stage.


## Success criteria

- [G1] Database/domain constraints make `(organization_id, shopify_customer_gid)` unique while assigning one stable opaque Festival customer ID.
- [G2] Tests prove repeated and concurrent valid authentication resolves one customer and cannot produce duplicate customers or sessions referencing a missing customer.
- [G3] Tests deny anonymous, Firebase-only, cross-tenant, cross-customer, stale/revoked-session, and browser authority-field access.
- [G4] The Account DTO is explicitly allowlisted and excludes Shopify tokens, cookies, credentials, raw upstream payloads, and unnecessary customer PII.
- [G5] Stored profile/contact data has an explicit authoritative source, tenant-bound protection, update timestamp/source, minimization, retention/deletion rule, and log/response redaction tests.
- [G6] Authentication/customer creation produces no checkout intent, order projection, validation decision, membership, or entitlement.
- [G1][G2][G3][G4][G5][G6] Repository-pinned lint, build, and test command classes pass after later implementation.

