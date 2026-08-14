# Establish Goals

## Status

- Task name: shopify-customer-account-auth
- Iteration: v2
- State: locked

## Request

- Establish goals for GitHub issue #76, "Phase 2: Confidential Shopify Customer Account authentication through the Festival BFF," aligned with `specs/tech-requirements.md`, parent architecture issue #74, completed tenant Shopify prerequisite #75, and service-boundary security policy #79.

## Blocking ambiguity

- None.

## Assumptions

- Shopify Customer Accounts means Shopify's new customer accounts with the Headless channel, never legacy customer accounts.
- The Customer Account confidential client is tenant-scoped and distinct from the tenant's Admin API client credentials; no credential or token may cross organization, store, API-family, or environment boundaries.
- Discovery, OAuth/OIDC, token, end-session, and Customer Account GraphQL endpoints are dynamically discovered from a validated tenant storefront domain, HTTPS-only, redirect-restricted, SSRF-hardened, bounded, and pinned to the `2026-07` Customer Account API contract where versioning applies.
- The existing deployment-wide AES-256-GCM tenant-bound keyring is the encryption boundary for new Customer Account client secrets and customer tokens, using distinct authenticated purposes and organization binding; plaintext secrets and tokens never enter browser-readable storage, frontend state, responses, or logs.
- PostgreSQL is the durable store for tenant Customer Account configuration and customer-session/token records; in-memory-only persistence is insufficient.
- This phase runs one backend process. Refresh serialization needs to be correct within that process only; distributed locking and multi-replica coordination are deferred.
- Firebase Admin and Shopify customer sessions remain non-substitutable principals, and every new route declares exactly one authentication class under the #79 fail-closed inventory.
- Customer order reads use `customer_read_orders`, derive the customer exclusively from the validated server session, return allowlisted Festival DTOs rather than raw GraphQL, and cannot select another customer or owner from browser input.
- Customer Account protected-data configuration/approval is an operator prerequisite. Festival does not maintain a manual approval flag; it verifies required scope/readiness and fails closed on Shopify protected-data denial or redaction.
- The minimal customer profile/session DTO excludes name, address, email, and phone so this phase requests only the minimum Level 1 protected customer data needed for order history/status.
- Canonical frontend organization navigation remains `/org/:shortOrgName`, frontend routing remains `@solidjs/router`, API calls remain behind `packages/frontend/src/lib/api.ts`, and any in-scope UI follows `specs/Style.md`.
- Repository verification remains `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Goals

1. Add a separate tenant-scoped Festival Admin configuration contract and persistence record for Customer Accounts rather than reusing the Shopify Admin API integration; persist a validated tenant storefront/account domain, encrypted confidential client secret, client ID, server-derived exact callback/logout URI configuration, API version, credential version, readiness timestamps/status, and safe diagnostics without exposing secret material.
2. Discover and validate the tenant's OIDC and Customer Account API metadata dynamically from the stored storefront domain; enforce HTTPS, approved Shopify origins, no URL credentials, no unsafe redirects, SSRF protections, timeouts, bounded responses/retries, issuer consistency, and the Customer Account API `2026-07` contract.
3. Implement tenant-bound confidential authorization-code start and callback flows with cryptographically random one-time state and nonce, exact allowlisted redirect/return targets, replay prevention, server-side client authentication, and validation of state, nonce, issuer, audience, tenant/store, authorization response, and ID-token claims before establishing a session.
4. Persist access, refresh, and ID tokens only as encrypted server-side session material with expirations and rotation metadata, keyed by organization ID, Shopify customer GID, and a random Festival session ID; issue only an opaque Festival customer-session cookie with `Secure`, `HttpOnly`, and `SameSite=Lax` attributes; enforce configurable defaults of 7 days idle and 30 days absolute, with either cap shortened by applicable Shopify token or refresh-token expiry.
5. Refresh tokens only server-side, serialize concurrent refresh per session within the single backend process, handle refresh-token rotation and expiry, and invalidate the complete session fail-closed on refresh failure, revoked or rotated credentials, invalid issuer/audience, tenant/shop mismatch, token decryption failure, or expired session policy.
6. Implement logout that clears/revokes Festival session state and the browser cookie, then uses Shopify's validated discovered end-session endpoint with the required ID-token hint without permitting an open redirect or leaking the token.
7. Register auth-start, OAuth-callback, and customer BFF routes with exactly one #79 authentication class each; keep Shopify Customer Account traffic outbound from the BFF, prevent Firebase and customer principals from substituting for one another, and enforce trusted Origin/Referer plus CSRF protection on every cookie-authenticated state-changing endpoint.
8. Expose an allowlisted minimal customer session/profile DTO and cursor-paginated order history/status BFF responses for only the Shopify customer and tenant bound to the validated Festival session, using `customer_read_orders`; exclude name, address, email, and phone; include order number/date, totals/currency, financial and fulfillment status, cancellation/refund summary, and line items; verify required scope/readiness and fail closed with a safe capability error on Shopify protected-data denial or redaction without a manually maintained Festival approval flag, raw GraphQL proxying, or browser ownership identifiers as authority.
9. Reject callback replay, genericize browser-facing failures, and produce only secret-free and unnecessary-PII-free diagnostic logs and safe upstream request identifiers; explicitly defer auth rate limiting because the currently proposed 500-request-per-second threshold would not provide a meaningful control until benchmarking and load testing establish an evidence-based policy.
10. Add the minimum shared contracts, a distinct Customer Accounts section in the existing Admin integration UI, and customer-facing SolidJS UI necessary for tenant setup, sign-in/logout, minimal non-identifying profile/session state, and order history/status while keeping the Hono BFF as the priority; the Admin surface accepts the storefront/account domain, client ID, and replace-only client secret, displays server-derived callback/logout URIs read-only, and reports safe discovery/readiness without impersonating a customer or completing a customer login; preserve `/org/:shortOrgName`, allow implementation to choose exact API paths, require exact tenant-bound allowlisted return targets, use `@solidjs/router` and the existing frontend API-helper boundary, and follow `specs/Style.md`.
11. Add automated tests covering configuration isolation, discovery/SSRF/redirect validation, state replay/mismatch, nonce mismatch, issuer/audience mismatch, cross-tenant callback/session rejection, code-exchange failures, cookie attributes, refresh success/serialization/rotation/expiry/revocation, credential rotation, CSRF/Origin denial, logout, invalidation, ownership-only profile/order reads, DTO allowlisting, route authentication classes, and absence of tokens/secrets/PII from logs and frontend payloads within the final locked scope.
12. Update `README.md` and `SETUP.md` with the Customer Account architecture, tenant Headless/customer-account prerequisites, Admin configuration and Save & Verify workflow, exact callback/logout setup guidance, environment/session-cap configuration, protected-customer-data and `customer_read_orders` prerequisites, local testing guidance, security boundaries, and the intentional rate-limit deferral; keep repository documentation and contracts aligned with issues #74, #75, #79 and `specs/tech-requirements.md`, then pass the pinned repository formatting, build, and test commands.

## Non-goals

- Firebase Admin authentication or authorization changes beyond ensuring principal separation.
- Shopify Admin API product/order operations or tenant Admin credential work completed under #75.
- Storefront cart, buyer identity, checkout, or payment behavior owned by #77.
- Webhooks, reconciliation, order projections, cancellation/refund requests or mutations, registration validity, and entitlement decisions owned by #78.
- Legacy Shopify customer accounts, third-party merchant installation, Shopify App Store distribution, or merchant-install OAuth.
- Browser access to Shopify access, refresh, or ID tokens; raw Customer Account GraphQL proxying; or client-selected tenant/customer/order ownership.
- Festival handling card data or treating Shopify authentication, payment, or order state as Festival Admin identity, registration approval, or entitlement.
- Obtaining production protected-customer-data approval itself, managed WAF/edge configuration, external secret-store infrastructure, database/cache public-network configuration, or deployment topology changes.
- Multi-process or multi-replica session coordination and distributed refresh locking.
- Auth start/callback rate-limit implementation in this phase; benchmarking, load testing, and a follow-up rate policy are required before enabling it, which is an explicit deferral from issues #76 and #79.

## Success criteria

- [G1, G2] Tests prove each organization loads only its own validated Customer Account configuration and dynamically discovered HTTPS Shopify metadata; invalid origins, redirects, issuer relationships, credentials-in-URL, private/loopback/link-local/metadata targets, oversized responses, and cross-tenant configuration fail closed.
- [G3] Tests prove callback processing rejects state replay/mismatch, nonce mismatch, issuer/audience mismatch, tenant/store mismatch, non-exact redirect/return targets, and invalid authorization responses without creating a session or leaking an authorization code/token.
- [G4, G5] Storage and response tests prove Shopify access/refresh/ID tokens are encrypted at rest and server-only, the browser receives only a random opaque correctly flagged cookie, single-process refresh is serialized and rotation-aware, configurable defaults enforce 7 idle days and 30 absolute days without outliving applicable Shopify token/refresh-token expiry, and all listed expiry/failure/rotation cases invalidate the session.
- [G6] Logout tests prove local session revocation and cookie clearing occur and only a validated discovered Shopify end-session redirect with the required ID-token hint is used.
- [G7] Route-inventory, principal-separation, cross-tenant, CSRF, and Origin/Referer tests prove every route has exactly one auth class and that Firebase credentials cannot authorize customer routes or vice versa.
- [G8] Profile/order tests prove an authenticated customer receives only a minimal non-identifying session/profile DTO and cursor-paginated order number/date, totals/currency, financial and fulfillment status, cancellation/refund summary, and line items for that same session's Shopify customer and tenant; name/address/email/phone are absent; protected-data denial/redaction produces a safe fail-closed capability error; another owner cannot be supplied as authority; and raw Customer Account GraphQL is never returned.
- [G9] Tests prove browser errors, application logs, and captured frontend payloads contain no client secret, authorization code, access/refresh/ID token, session cookie, raw upstream sensitive payload, or unnecessary customer PII; task documentation records the intentional rate-limit deferral and prerequisite benchmarking/load testing without claiming #79 rate-limit completion.
- [G10] Tests and UI inspection prove the distinct Customer Accounts Admin section uses a separate safe contract, keeps secrets replace-only, displays server-derived callback/logout URIs read-only, validates discovery/readiness without customer impersonation/login, and that minimal customer flows preserve canonical organization routing, exact allowlisted return targets, the API-helper boundary, accessible controls, and `specs/Style.md` without exposing server credentials or tokens.
- [G12] Documentation review proves `README.md` and `SETUP.md` cover every configuration, setup, testing, protected-data, security, session-cap, and deferred-rate-limit topic listed in G12 and do not instruct operators to expose secrets or Shopify tokens.
- [G11, G12] All finalized issue-specific tests pass, followed by `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Next action

- Hand the locked goals to the next permitted lifecycle stage.
