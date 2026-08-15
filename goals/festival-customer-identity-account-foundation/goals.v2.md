# Goals Extract
- Task name: festival-customer-identity-account-foundation
- Iteration: v2
- State: locked

## Goals

1. Define and persist a unique Festival customer identity scoped to one Organization and one verified Shopify customer GID.
2. Resolve the same Festival customer deterministically and safely for repeated/concurrent valid Shopify authentications.
3. Bind customer sessions and customer-facing Account reads to the trusted Organization/customer relationship without browser-selected authority.
4. Define a minimal allowlisted customer Account profile contract and protected local contact projection compatible with later population by #78.
5. Enforce the Shopify/Festival authority boundary, tenant isolation, PII minimization/protection, and secret/log redaction.
6. Prove that customer authentication or customer-record creation alone cannot create purchase, validation, membership, or entitlement state.
7. Permit authenticated customers to edit the authorized local Festival profile fields without changing Shopify identity or transferring ownership.
8. Preserve existing valid customer sessions through a deterministic, idempotent customer backfill during schema adoption.
9. Provide Organization Admin-only, tenant-scoped customer profile read and bounded search APIs that operate only on profiles with applicable recorded consent.
10. Define versioned staff-access consent persistence for capture by #77 and enforce it independently from customer authentication or profile existence.
11. Track field-level Shopify/Festival provenance so local customer edits take precedence while later Shopify projections may populate only blank or never-locally-edited fields.


## Non-goals

- Shopify order/webhook ingestion, commerce projection, purchase validation, or entitlement issuance; owned by #78.
- Teacher/accompanist directory profiles or public discovery; owned by #97.
- Email-based identity matching or automatic cross-Shopify-customer merging.
- Firebase Admin/customer-principal interchangeability.
- Implementing source code during the establish-goals stage.
- A Festival Admin/staff customer-search frontend; only the protected APIs are included in issue #23.
- Updating Shopify when a Festival-local profile is edited.
- Automatic consent withdrawal, customer deletion/anonymization execution, or regulatory retention automation; these require separately scoped workflows.


## Success criteria

- [G1] Database/domain constraints make `(organization_id, shopify_customer_gid)` unique while assigning one stable opaque Festival customer ID.
- [G2] Tests prove repeated and concurrent valid authentication resolves one customer and cannot produce duplicate customers or sessions referencing a missing customer.
- [G3] Tests deny anonymous, Firebase-only, cross-tenant, cross-customer, stale/revoked-session, and browser authority-field access.
- [G4] The Account DTO is explicitly allowlisted and excludes Shopify tokens, cookies, credentials, raw upstream payloads, and unnecessary customer PII.
- [G5] Stored profile/contact data has an explicit authoritative source, tenant-bound protection, update timestamp/source, minimization, retention/deletion rule, and log/response redaction tests.
- [G6] Authentication/customer creation produces no checkout intent, order projection, validation decision, membership, or entitlement.
- [G7] Customer profile mutation requires the correct customer session plus CSRF/origin protection, rejects identity/ownership fields, and cannot change the Festival customer ID or Shopify customer GID.
- [G8] Migration tests prove trusted existing session records backfill one customer per Organization/GID and retain valid sessions without duplicate customers.
- [G9] Organization Admin APIs can view the full consented profile and perform bounded tenant-scoped search by name, email, or phone; non-Admins, other tenants, and unconsented profiles are denied or omitted without existence leakage.
- [G10] Consent records are bound to Festival customer, Organization, timestamp, and privacy-notice version; staff access requires applicable consent, while authentication/customer creation alone never implies consent.
- [G11] Field-level source/update metadata proves later Shopify imports fill blank/unmodified fields but never overwrite Festival-edited values; Festival edits never update Shopify.
- [G4][G7] The customer Account DTO/mutation permits only the authenticated customer's name, email, structured mailing address, and phone and never exposes the internal Festival customer ID.
- [G1][G2][G3][G4][G5][G6][G7][G8][G9][G10][G11] Repository-pinned lint, build, and test command classes pass after later implementation.

