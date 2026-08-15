# Festival Customer Identity and Account Foundation

## Goal reference

- `goals/festival-customer-identity-account-foundation/goals.v2.md`

## Scope

### In scope

- Durable Organization-scoped Festival customers keyed by verified Shopify customer GID.
- Atomic customer resolution/creation before session persistence, including deterministic backfill for existing trusted sessions.
- Customer-session binding to the internal Festival customer.
- Customer Account read/update contracts for Festival-local name, email, structured mailing address, and phone.
- Field-level Shopify/Festival source and update metadata with local-edit precedence.
- Versioned staff-access consent persistence for later capture by #77.
- Organization Admin-only profile read and bounded search by name, email, or phone, restricted to consented profiles.
- Tenant/role/session/CSRF/origin enforcement, response allowlists, PII/log redaction, and focused tests.

### Out of scope

- Shopify order/webhook ingestion and profile population from orders (#78).
- Entitlement, purchase, or validation creation.
- Staff customer-search frontend.
- Shopify profile mutation from Festival edits.
- Automatic customer merging, consent withdrawal, deletion/anonymization execution, and regulatory retention automation.
- Teacher/accompanist directory profiles and public discovery (#97).

## Approach

- Extend the existing customer-account repository/service boundary surgically: add the local customer/profile/consent model, bind sessions to it during callback/backfill, then expose narrowly authorized customer and Admin DTOs without changing Shopify authentication authority.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered:
  - Organization-scoped Festival customer records with stable opaque IDs, unique Shopify identity mapping, and atomic session creation.
  - Idempotent migration/backfill that binds trusted existing sessions to customers and enforces the customer/session foreign key.
  - Festival-local profile persistence and Account read/edit UI for name, email, structured mailing address, and phone.
  - Per-field Shopify/Festival source timestamps with Festival-edit precedence.
  - Versioned staff-access consent persistence for checkout capture by #77.
  - Consent-gated Organization Admin profile detail and bounded name/email/phone search APIs with minimized search DTOs and PII-free access audits.
  - Customer/Admin authorization, CSRF/origin, request-size/content-type, route inventory, nginx allowlist, response allowlist, and tenant-isolation coverage.
- Exceptions: None
- Deferred work: Shopify profile projection/order ingestion remains in #78; #77 must capture checkout-time consent through the provided service boundary; staff search UI, consent withdrawal, customer merge, and deletion/anonymization remain separate work.
- Dirty-worktree decision: continue — preflight found only this task's locked goal artifacts, manifest entry, and scaffolded spec.

## Quality gate results

- Lint: pass — `bun run format:check`
- Build: pass — `bun run build`
- Tests: pass — `bun run test` (222 tests)
- Code review: pass — no findings, `patch is correct` at 0.94 confidence
- Clean merge: pending `land-the-plan`
