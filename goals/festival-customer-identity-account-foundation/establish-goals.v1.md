# Establish Goals

## Status

- Task name: festival-customer-identity-account-foundation
- Iteration: v1
- State: draft

## Request

- Establish explicit, verifiable goals for GitHub issue #23, `Festival customer identity and Account foundation`, stopping before implementation planning or source-code changes.
- Introduce a durable Organization-scoped Festival customer for a verified Shopify Customer Account identity while preserving the Shopify/Festival authority split locked by parent issue #91.

## Blocking ambiguity

- Which profile fields the authenticated customer can view and edit on their Festival Account page.
- Whether Organization staff PII search/read APIs and UI are in issue #23 or only enabled by its data model for a later issue.
- Whether later Shopify customer/order data may overwrite fields independently edited in Festival, and whether source/provenance is tracked per field.
- How the customer's permission for Festival staff to store, view, and search PII is captured and evidenced.

## Assumptions

- Shopify Customer Accounts remains authoritative for authentication and Shopify customer identity.
- Festival is authoritative for its local customer ID, Organization association, application state, purchase-validation linkage, and Account experience.
- The only external identity key is `(organization_id, shopify_customer_gid)`; email, name, phone, address, cookie, bearer token, and browser input never establish identity or ownership.
- Firebase Admin and Shopify customer sessions remain non-interchangeable principals.
- The existing confidential Shopify session work in #76 is a dependency to extend, not replace.
- Issue #78, not issue #23, ingests Shopify orders and populates permitted customer/order projections.
- A customer is resolved/created atomically during the verified Shopify OAuth callback before a Festival session referencing that customer is committed.
- The stable opaque Festival customer ID is internal-only and is not returned or displayed through the Account DTO.
- Customer PII is tenant-bound but not application-encrypted so authorized Festival staff can store and search it; database/storage encryption, tenant/role authorization, auditability, response allowlists, and log redaction remain mandatory.
- Festival customers may independently edit the local profile copy.
- Only the latest customer contact profile is retained while the customer exists; automatic expiry is not required, deletion/anonymization is a separate workflow, and #78 owns separate order/entitlement snapshot retention.
- A different Shopify customer GID creates a different Festival customer and is never automatically merged.
- Existing valid sessions are preserved by deterministic customer backfill from their trusted Organization/Shopify-customer-GID records.

## Goals

1. Define and persist a unique Festival customer identity scoped to one Organization and one verified Shopify customer GID.
2. Resolve the same Festival customer deterministically and safely for repeated/concurrent valid Shopify authentications.
3. Bind customer sessions and customer-facing Account reads to the trusted Organization/customer relationship without browser-selected authority.
4. Define a minimal allowlisted customer Account profile contract and protected local contact projection compatible with later population by #78.
5. Enforce the Shopify/Festival authority boundary, tenant isolation, PII minimization/protection, and secret/log redaction.
6. Prove that customer authentication or customer-record creation alone cannot create purchase, validation, membership, or entitlement state.
7. Permit authenticated customers to edit the authorized local Festival profile fields without changing Shopify identity or transferring ownership.
8. Preserve existing valid customer sessions through a deterministic, idempotent customer backfill during schema adoption.

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
- [G7] Customer profile mutation requires the correct customer session plus CSRF/origin protection, rejects identity/ownership fields, and cannot change the Festival customer ID or Shopify customer GID.
- [G8] Migration tests prove trusted existing session records backfill one customer per Organization/GID and retain valid sessions without duplicate customers.
- [G1][G2][G3][G4][G5][G6][G7][G8] Repository-pinned lint, build, and test command classes pass after later implementation.

## Next action

- Ask only the remaining blocking product/data-contract questions, check answers for consistency, and prepare a new immutable confirmation iteration.
