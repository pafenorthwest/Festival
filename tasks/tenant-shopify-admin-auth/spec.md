# Tenant Shopify Admin Authentication

## Overview

Implement GitHub issue #75's organization-scoped Shopify Admin API boundary on top of the completed route-security work from #79. Firebase-authenticated Festival Admins may verify their tenant's Shopify store/app, use least-privilege product and order-read capabilities, and perform existing product mutations without exposing Shopify credentials or permitting cross-tenant credential/token reuse.

This task consumes the tenant-bound encryption boundary owned by #83. It does not implement #83's keyring, ciphertext envelope, re-encryption, migration, or key-retirement scope.

## Goals

1. Persist an organization-scoped canonical Shopify store identity, encrypted Admin app credential, verification state, granted-capability diagnostics, and safe failure diagnostics with cross-organization shop ownership constraints.
2. Preserve the completed Firebase, tenant-resolution, membership, and Admin-role route boundary before any Shopify integration or credential is loaded; accept no browser-selected tenant identity or Shopify credential.
3. Use only server-side Shopify client-credentials exchange and Admin GraphQL `2026-07`, without durable access-token persistence.
4. Use a process-local, early-expiry token cache bound to organization, store, client, and secret/integration version; force refresh for verification and invalidate superseded credential/shop entries.
5. Verify actual shop identity and already-granted Shopify scopes, without attempting to request or upgrade scopes during token exchange.
6. Fail closed for the current `read_products`, `write_products`, and `read_orders` capabilities; keep `write_orders` future-facing and keep `read_all_orders` disabled.
7. Route in-scope product reads/writes and order-read capability through the authenticated tenant boundary with explicit safe error translation and secret redaction.
8. Append minimal bounded mutation-audit records to `/var/log/festival/shopify-admin-audit.ndjson`, with test-only path injection and no database audit table or verbose routine logging.
9. Make only the necessary existing Admin integration form/contract updates for safe identity, capability, verification, and diagnostic status; exclude #81's setup instructions.
10. Add deterministic automated coverage for isolation, authorization, verification, token lifecycle, scope checks, safe errors/redaction, rotation, audit records, persistence constraints, and frontend safe-state behavior.

## Non-goals

- Customer Account OAuth/OIDC, customer tokens, or customer order-history UI (#76).
- Storefront cart, buyer identity, checkout, or payment behavior (#77).
- Webhooks, reconciliation, order projections, entitlement decisions, cancellation/refund workflows, or financial mutations (#78).
- Shopify setup-instruction UI owned by #81.
- General route-security work already completed by #79.
- Versioned keyring configuration, ciphertext envelope implementation, tenant/purpose authenticated encryption internals, previous-key decryption behavior, or configuration validation owned by #83.
- Stored-secret re-encryption, encryption migration/backfill, and key retirement.
- Third-party merchant installation, Shopify App Store distribution, merchant authorization-code installation, or global Shopify credentials.
- Scope requests/upgrades during client-credentials exchange.
- Durable or browser-readable Admin access-token storage.
- `write_orders`, cancellation/refund mutations, `read_all_orders`, or order reads beyond Shopify's default 60-day window.
- A shared/distributed token cache or application-managed audit-log rotation/retention.

## Use cases / user stories

- As a Festival organization Admin, I can save and freshly verify only my organization's Shopify app/store credentials and see safe shop/capability status.
- As a Festival organization Admin, I can use existing Shopify-backed membership product operations only when the tenant's verified app has the required product scopes.
- As a future order-read caller, I receive a fail-closed capability result unless the tenant app has `read_orders`; older-than-60-day access remains disabled.
- As an Admin in another Festival organization, I cannot load or use another tenant's integration, cached token, shop identity, or product operation.
- As an operator, I receive one small structured file record for each attempted Shopify Admin GraphQL mutation without payloads, PII, credentials, or tokens.

## Current behavior

- Notes:
  - The #79-derived branch declares the Shopify settings and membership-product routes as `admin` and enforces Firebase authentication, tenant resolution, and Admin membership before route handlers.
  - `shopify_integrations` currently stores only organization ID, store domain, client ID, encrypted secret, coarse verification status/timestamps, and a generic last error. It has no verified shop GID, scope/capability diagnostics, integration credential version, or cross-organization shop-domain/GID uniqueness constraint.
  - Credential verification forces a token exchange and queries `shop { id myshopifyDomain }`, but accepts any non-empty shop ID and does not compare the returned identity with persisted configuration or inspect granted scopes.
  - The Admin client is pinned to `2026-07` and caches access tokens by store/client/secret hash with a one-minute early-expiry margin. A missing or invalid `expires_in` currently returns an uncached token instead of failing explicitly, and cache invalidation is implicit rather than an integration-rotation operation.
  - Shopify credentials are reconstructed and passed to product operations. Tenant identity is not part of the Shopify client boundary or cache-key contract.
  - Product creation uses three possible Shopify mutations: product creation, price update, and compensating product deletion after a downstream failure. The authenticated Firebase actor is not passed into the product service, Shopify request IDs are not surfaced, and no durable mutation audit file exists.
  - The only current Shopify operational log is a bounded `console.error` when compensating deletion itself fails.
  - The Admin integration form displays store/client fields, coarse status, and a generic error but no verified shop identity or capability status.
  - The current branch still contains the legacy single-key `AesSecretEncryptor`; #75 must depend only on the encryption abstraction consumed from #83 and must not absorb #83's implementation scope.
- Key files:
  - `packages/common/src/shopify.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/src/repo/organization-repository.ts`
  - `packages/backend/src/repo/in-memory-organization-repository.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/shopify/types.ts`
  - `packages/backend/src/shopify/admin-api-client.ts`
  - `packages/backend/src/shopify/errors.ts`
  - `packages/backend/src/shopify/shopify-integration-service.ts`
  - `packages/backend/src/shopify/shopify-membership-product-service.ts`
  - `packages/backend/src/shopify/encryption.ts` (integration boundary only; #83 owns internals)
  - `packages/backend/src/app.ts`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx`
  - `packages/frontend/src/app/createFestivalAppState.ts`
  - `packages/frontend/src/app/createFestivalActions.ts`
  - `packages/frontend/src/lib/api.ts`

## Proposed behavior

- Behavior changes:
  - Saving credentials persists canonical organization-scoped configuration, resets verification state, advances an integration/credential version, and invalidates cache entries derived from the superseded store/client/secret identity.
  - Verification always performs a fresh client-credentials exchange, validates positive finite expiry, confirms the returned shop GID and canonical `.myshopify.com` domain, reads already-granted access scopes, compares them with Festival capability requirements, and persists only safe diagnostics.
  - Normal Admin calls reuse a non-expired process-local token only when the full tenant/store/client/secret-or-integration-version cache identity matches.
  - Capability checks distinguish `read_products`, `write_products`, `read_orders`, and the disabled future `write_orders` capability. Missing scopes fail closed before the protected operation.
  - Shopify Admin transport returns bounded typed results/errors including Shopify request ID when supplied, while never exposing secrets, token bodies, access tokens, authorization headers, or raw Shopify error content.
  - Each attempted in-scope Shopify GraphQL mutation appends exactly one bounded NDJSON audit record containing only timestamp, Firebase actor ID, Festival organization ID, bounded operation, Shopify request ID when returned, result, and bounded failure category.
  - The Admin integration page displays only safe verified-shop/capability/diagnostic state. It continues to omit the client secret and all tokens.
- Edge cases:
  - Missing, non-numeric, non-finite, zero, or negative `expires_in` fails verification/token acquisition explicitly.
  - A returned shop domain or GID that disagrees with the configured or already-owned shop is rejected and cannot mark the integration verified.
  - Duplicate canonical domains or shop GIDs across organizations fail at both service/repository boundaries and PostgreSQL constraints.
  - Reusing the same client ID or malformed duplicate input cannot collapse tenant cache keys.
  - Changing the domain, client ID, secret, or integration version prevents reuse of the previous token.
  - Missing `read_all_orders` cannot be interpreted as permission to query beyond the default Shopify order window.
  - File-audit destination startup/open/write failures are explicit. Automated tests use an injected temporary path and do not require `/var/log` permissions.
  - Shopify failures before a response may have no request ID; the audit field is omitted/null without substituting raw error text.
  - Audit records preserve the exact verified Firebase UID, accept non-empty Firebase UIDs up to 128 characters, use field-specific organization/request-ID validation, are prevalidated before mutation, remain bounded to 2,048 serialized bytes, and never include operation inputs or response bodies.

## Technical design

### Architecture / modules impacted

- Shared contracts define safe verification identity, capability status, and diagnostics returned to the existing frontend.
- The organization repository owns tenant-scoped integration persistence, verified identity fields, credential/integration version, and uniqueness behavior for both PostgreSQL and in-memory test implementations.
- The Shopify Admin boundary owns token exchange/cache behavior, identity/scope discovery, capability enforcement, request-ID extraction, bounded error translation, and API version pinning.
- The integration service orchestrates save, rotation invalidation, forced verification, persistence of safe diagnostics, and mapping to public contracts.
- Existing product services obtain a tenant-bound Admin context rather than freely reconstructing cross-tenant credentials and propagate the Firebase actor for mutation auditing.
- A small injected audit writer owns bounded atomic NDJSON append behavior. Production composition targets `/var/log/festival/shopify-admin-audit.ndjson`; tests inject a temporary path/writer.
- Existing route declarations remain under the completed #79 security inventory. Any route signature change must preserve the `admin` declaration and middleware sequence.
- The existing frontend integration form consumes only the safe expanded settings response.
- The encryption dependency remains behind the secret-encryption/decryption boundary supplied by #83; modifications to keyring/envelope internals are forbidden in this task.

### API changes (if any)

- Extend the existing Shopify settings response with safe fields for verified shop identity and explicit Festival capability status/diagnostics.
- Keep save input limited to store URL, client ID, and optional replacement secret. Ignore/reject organization IDs, shop GIDs, scopes, tokens, or credentials supplied outside those fields.
- Do not add a browser API for tokens, raw granted scopes, audit-file contents, `write_orders`, or `read_all_orders`.
- Preserve explicit safe JSON errors from existing Admin endpoints; Shopify-specific raw errors remain server-internal.

### UI/UX changes (if any)

- Update the existing Admin integrations form/status area to show verified store identity and fail-closed capability results for product read, product write, and order read.
- Keep secret replacement behavior (`Leave blank to keep existing secret`) and prevent any response/state from repopulating the secret.
- Display only bounded non-secret diagnostic text for failed verification.
- Do not add the collapsible Shopify setup instructions owned by #81.

### Data model / schema changes (PostgreSQL)

- Migrations:
  - Extend `shopify_integrations` with verified shop GID/domain data, granted-capability/scope diagnostics, verification metadata, and an integration/credential version suitable for cache invalidation.
  - Add uniqueness constraints/indexes preventing a canonical Shopify shop domain or verified shop GID from being owned by multiple Festival organizations.
  - Do not add an audit table.
- Backward compatibility:
  - Existing integration rows remain tenant-owned but must fail closed until reverified when new verified-identity/capability fields are absent.
  - No access token becomes a durable database field.
  - Encryption record interpretation is delegated to #83's boundary; this task adds no legacy ciphertext compatibility or migration.
- Rollback:
  - Application rollback may stop reading new safe diagnostic/version fields; schema rollback must not expose or decrypt secrets and should preserve integration ownership data until an explicit migration decision.
  - Audit-file cleanup/retention is not part of application rollback.

## Security & privacy

- Firebase identity, route tenant, active membership, and Admin role are required before credential lookup.
- Tenant/store/client/secret-or-version identity participates in cache isolation; no global credential fallback exists.
- Admin credentials, access tokens, token request bodies, authorization headers, raw GraphQL errors, and ciphertext internals never enter frontend responses or logs.
- The audit file contains stable Firebase actor ID and organization ID but no email, display name, product inputs, customer PII, raw error, token, or credential.
- Audit records are bounded, appended with a production path under `/var/log/festival/`, and written with deployment-provided service-user permissions. Rotation/retention and host-level collection are operator responsibilities.
- `read_products`, `write_products`, and `read_orders` are checked independently; `write_orders` and `read_all_orders` remain disabled.
- The #83 tenant-bound encryption interface is consumed as provided; #75 does not weaken or duplicate its authenticated-context contract.

## Observability (logs/metrics)

- Mutation audit destination: `/var/log/festival/shopify-admin-audit.ndjson` in production.
- Exactly one bounded record per attempted in-scope Shopify Admin GraphQL mutation.
- Allowed fields: timestamp, Firebase actor ID, Festival organization ID, bounded operation, Shopify request ID when returned, result, and bounded failure category.
- Prohibited fields: request/response bodies, business inputs, product description/price, customer PII, raw error messages, stack traces, client secrets, ciphertext, access tokens, authorization headers, and token endpoint bodies.
- No database audit table, new metrics system, or routine success/error console output.
- Existing exceptional cleanup-failure signal may remain bounded and secret-free.
- Deployment owns directory provisioning, file permissions, rotation, retention, disk monitoring, and aggregation.

## Verification Commands

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy

- Unit:
  - Token exchange/cache: forced verification, normal reuse, early expiry, invalid/missing expiry, rotation invalidation, and tenant-distinct keys.
  - Identity/scope verification: correct shop, wrong shop/domain, required-scope mismatch, disabled future capabilities, and no scope parameter in token exchange.
  - Error translation/redaction: token, HTTP `401`/`403`, throttling, GraphQL, user errors, request IDs, and captured-log secret absence.
  - Audit writer: success/failure records, bounded schema/size, prohibited-value absence, explicit destination errors, and temporary-path injection.
  - Repository/service: ownership uniqueness, safe diagnostics, fail-closed unverified records, and superseded credential behavior.
- Integration:
  - Route tests for unauthenticated, non-Admin, correct-tenant Admin, and cross-tenant Admin access.
  - Existing membership-product mutation flow through tenant-bound capability and audit context, including compensating deletion.
  - PostgreSQL schema/constraint behavior using the repository's established test strategy; no live Shopify dependency.
- E2E / UI (if applicable):
  - Frontend tests confirm safe identity/capability diagnostics render, secret replacement remains write-only, and no token/secret enters browser state.
  - Live Shopify, Firebase, database service, and `/var/log` access are not required by root verification commands.

## Acceptance criteria checklist

- [x] A tenant Admin can save and freshly verify only that tenant's Shopify app/store configuration.
- [x] Verification rejects wrong-shop identity and cross-organization shop ownership conflicts.
- [x] Product read/write and order-read capabilities fail closed when their corresponding granted scopes are absent; token exchange does not request scopes.
- [x] Firebase, tenant, membership, and Admin-role checks precede integration/credential lookup on every in-scope route.
- [x] Process-local token reuse respects early expiry and complete tenant credential identity; invalid expiry fails; rotation makes old cache entries unusable.
- [x] Shopify Admin requests remain pinned to `2026-07`; access tokens are never durable or browser-readable.
- [x] `write_orders`, financial mutations, `read_all_orders`, and older-than-60-day order access remain disabled.
- [x] Token/HTTP/throttling/GraphQL/user failures map to bounded explicit errors without secret leakage.
- [x] Every in-scope Shopify Admin mutation attempt produces exactly one bounded test-verified NDJSON record with only allowed fields; production path is `/var/log/festival/shopify-admin-audit.ndjson`; no audit table is added.
- [x] Existing Admin UI exposes only safe verification identity, capability status, and diagnostics; #81 UI is absent.
- [x] #75 consumes but does not implement #83 encryption internals, re-encryption, migration, or key retirement.
- [x] Issue-specific tests and `bun run format:check`, `bun run build`, and `bun run test` pass.

## IN SCOPE

- Shared Shopify settings/capability contracts and validation needed by #75.
- Backend organization integration repository/schema changes for verified identity, capability diagnostics, uniqueness, and credential/integration version.
- Backend Shopify Admin token, cache, verification, capability, error, request-ID, and mutation-audit boundaries.
- Existing Shopify integration and membership-product service/route composition changes required to consume the hardened boundary and propagate actor context.
- Minimal existing Admin integration form/state/API-helper changes for safe status.
- Deterministic common/backend/frontend tests and directly affected README/setup/technical-requirement documentation.
- Lifecycle artifacts under `goals/tenant-shopify-admin-auth/` and `tasks/tenant-shopify-admin-auth/`.

## OUT OF SCOPE

- Source surfaces owned by issues #76, #77, #78, #81, or #83.
- New customer, cart, checkout, webhook, entitlement, cancellation, refund, or financial-action behavior.
- New order-history UI or general order-management feature surface.
- General route-security redesign beyond preserving completed #79 enforcement.
- Shared/distributed cache infrastructure, database audit storage, application-managed log rotation, or a new observability platform.
- Encryption keyring/envelope implementation or stored-secret re-encryption.

## Goal lock assertion

- Locked goals approved from `goals/tenant-shopify-admin-auth/goals.v0.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Locked operational assumptions:
  - #79 route-security work is complete and consumed rather than duplicated.
  - Existing Admin form changes are allowed; #81 setup instructions remain excluded.
  - The token cache is process-local for this phase.
  - `write_orders` is future-facing and disabled.
  - Production mutation audit output is `/var/log/festival/shopify-admin-audit.ndjson`; tests inject a temporary path; deployment owns rotation/retention.
  - #83 supplies the encryption boundary; #75 owns only Shopify credential/shop rotation and cache invalidation.

## Governing context

- Rules:
  - Root and repository `AGENTS.md` lifecycle, goal-lock, verification, drift, and scope contracts.
  - `.codex/codex-config.yaml` bootstrap and code-review base configuration.
  - `.codex/project-structure.md` canonical project layout and command record.
- Lifecycle resources:
  - `/Users/eric/.codex/scripts/prepare-takeoff-bootstrap.sh`
  - `/Users/eric/.codex/scripts/prepare-takeoff-worktree.sh`
  - `/Users/eric/.codex/scripts/task-scaffold.sh`
- Sandbox and repo context:
  - Workspace-write filesystem sandbox; network is restricted.
  - Current branch: `eric/admin-security-basics`, three commits ahead of `main`, containing the completed #79-derived route-security work required by #75.
  - Code-review base branch: `main`.

## Execution posture lock

- Simplicity bias: extend the existing Shopify integration/Admin client boundaries instead of adding a second integration stack.
- Surgical changes: touch only the shared/backend/frontend/documentation/test surfaces directly required by locked goals.
- Fail fast: reject missing tenant context, invalid expiry, wrong shop, missing scope, unavailable audit destination, unsupported older-order access, and impossible repository states explicitly.
- No source implementation begins in Stage 2.

## Dirty worktree decision

- Decision: continue.
- Evidence at Stage 2 safety prep: the only uncommitted entry was `?? goals/`, containing the newly approved and locked artifacts for this same task.
- The Stage 2 scaffold then added only `tasks/tenant-shopify-admin-auth/` lifecycle artifacts.
- No unrelated user changes are present or authorized for modification.

## Change control

- Any change to locked goals, non-goals, success criteria, audit destination/schema, issue ownership boundaries, scope surfaces, or verification commands requires an explicit goal relock.
- Override authority rests with the user.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L5 (program)
- Complexity scoring details: score=20; recommended-goals=18; guardrails-all-true=false; signals=/Users/eric/pafenorthwest/Festival/tasks/tenant-shopify-admin-auth/complexity-signals.json
- Active phases: 1..12
- No new scope introduced: required
