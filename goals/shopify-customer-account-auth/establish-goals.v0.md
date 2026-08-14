# Establish Goals

## Status

- Task name: shopify-customer-account-auth
- Iteration: v0
- State: blocked

## Request

- Establish goals for GitHub issue #76, "Phase 2: Confidential Shopify Customer Account authentication through the Festival BFF," aligned with `specs/tech-requirements.md`, parent architecture issue #74, completed tenant Shopify prerequisite #75, and service-boundary security policy #79.

## Blocking ambiguity

- Does #76 include the SolidJS customer-facing sign-in, profile, and order-history/status pages, as well as the Hono BFF and shared DTOs; and does it include an Admin UI/API extension for entering and verifying Customer Account client configuration?
- What exact public route and post-authentication return-target contract should be exposed (including the auth-start, callback, session/profile, orders, and logout paths), or may those paths be chosen during implementation so long as they are tenant-bound under canonical `/org/:shortOrgName` navigation and open redirects are impossible?
- Must session storage and serialized token refresh be correct across multiple concurrent backend replicas, or is single-process serialization acceptable for this phase? What idle and absolute Festival session lifetimes should be enforced when Shopify token metadata does not itself provide the complete policy?
- What exact UI-specific order DTO and pagination behavior are required for the first slice (fields for order summary, fulfillment, cancellation, refunds, line items, and detail views)?
- What concrete rate-limit buckets and thresholds must auth start/callback use so the requirement and its tests are objective?
- Is protected-customer-data approval an operator prerequisite outside the repository, with order endpoints failing closed until an explicit configuration/capability is enabled, or should this task only document the production prerequisite?

## Assumptions

- Shopify Customer Accounts means Shopify's new customer accounts with the Headless channel, never legacy customer accounts.
- The Customer Account confidential client is tenant-scoped and distinct from the tenant's Admin API client credentials; no credential or token may cross organization, store, API-family, or environment boundaries.
- Discovery, OAuth/OIDC, token, end-session, and Customer Account GraphQL endpoints are dynamically discovered from a validated tenant storefront domain, HTTPS-only, redirect-restricted, SSRF-hardened, bounded, and pinned to the `2026-07` Customer Account API contract where versioning applies.
- The existing deployment-wide AES-256-GCM tenant-bound keyring is the encryption boundary for new Customer Account client secrets and customer tokens, using distinct authenticated purposes and organization binding; plaintext secrets and tokens never enter browser-readable storage, frontend state, responses, or logs.
- PostgreSQL is the durable store for tenant Customer Account configuration and customer-session/token records; in-memory-only persistence is insufficient.
- Firebase Admin and Shopify customer sessions remain non-substitutable principals, and every new route declares exactly one authentication class under the #79 fail-closed inventory.
- Customer order reads use `customer_read_orders`, derive the customer exclusively from the validated server session, return allowlisted Festival DTOs rather than raw GraphQL, and cannot select another customer or owner from browser input.
- Canonical frontend organization navigation remains `/org/:shortOrgName`, frontend routing remains `@solidjs/router`, API calls remain behind `packages/frontend/src/lib/api.ts`, and any in-scope UI follows `specs/Style.md`.
- Repository verification remains `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Goals

1. Persist one organization-scoped Customer Account integration containing a validated tenant storefront domain, encrypted confidential client secret, client ID, exact callback/logout URI configuration, API version, credential version, verification status/timestamps, and safe diagnostics without exposing secret material.
2. Discover and validate the tenant's OIDC and Customer Account API metadata dynamically from the stored storefront domain; enforce HTTPS, approved Shopify origins, no URL credentials, no unsafe redirects, SSRF protections, timeouts, bounded responses/retries, issuer consistency, and the Customer Account API `2026-07` contract.
3. Implement tenant-bound confidential authorization-code start and callback flows with cryptographically random one-time state and nonce, exact allowlisted redirect/return targets, replay prevention, server-side client authentication, and validation of state, nonce, issuer, audience, tenant/store, authorization response, and ID-token claims before establishing a session.
4. Persist access, refresh, and ID tokens only as encrypted server-side session material with expirations and rotation metadata, keyed by organization ID, Shopify customer GID, and a random Festival session ID; issue only an opaque Festival customer-session cookie with `Secure`, `HttpOnly`, and `SameSite=Lax` attributes.
5. Refresh tokens only server-side, serialize concurrent refresh per session, handle refresh-token rotation and expiry, and invalidate the complete session fail-closed on refresh failure, revoked or rotated credentials, invalid issuer/audience, tenant/shop mismatch, token decryption failure, or expired session policy.
6. Implement logout that clears/revokes Festival session state and the browser cookie, then uses Shopify's validated discovered end-session endpoint with the required ID-token hint without permitting an open redirect or leaking the token.
7. Register auth-start, OAuth-callback, and customer BFF routes with exactly one #79 authentication class each; keep Shopify Customer Account traffic outbound from the BFF, prevent Firebase and customer principals from substituting for one another, and enforce trusted Origin/Referer plus CSRF protection on every cookie-authenticated state-changing endpoint.
8. Expose allowlisted customer profile and order history/status BFF responses for only the Shopify customer and tenant bound to the validated Festival session, using `customer_read_orders`; include the finalized order, fulfillment, cancellation, and refund fields without proxying raw GraphQL or accepting browser ownership identifiers as authority.
9. Apply caller-appropriate, tenant-aware rate limiting to auth start and callback; reject callback replay, genericize browser-facing failures, and produce only secret-free and unnecessary-PII-free diagnostic logs and safe upstream request identifiers.
10. Add the minimum shared contracts and, if confirmed in scope, SolidJS/Admin UI necessary for tenant setup and end-to-end customer sign-in/profile/order use while preserving `/org/:shortOrgName`, `@solidjs/router`, the existing frontend API-helper boundary, and `specs/Style.md`.
11. Add automated tests covering configuration isolation, discovery/SSRF/redirect validation, state replay/mismatch, nonce mismatch, issuer/audience mismatch, cross-tenant callback/session rejection, code-exchange failures, cookie attributes, refresh success/serialization/rotation/expiry/revocation, credential rotation, CSRF/Origin denial, logout, invalidation, ownership-only profile/order reads, DTO allowlisting, rate limits, route authentication classes, and absence of tokens/secrets/PII from logs and frontend payloads within the final locked scope.
12. Keep repository documentation and contracts aligned with issues #74, #75, #79 and `specs/tech-requirements.md`, and pass the pinned repository formatting, build, and test commands.

## Non-goals

- Firebase Admin authentication or authorization changes beyond ensuring principal separation.
- Shopify Admin API product/order operations or tenant Admin credential work completed under #75.
- Storefront cart, buyer identity, checkout, or payment behavior owned by #77.
- Webhooks, reconciliation, order projections, cancellation/refund requests or mutations, registration validity, and entitlement decisions owned by #78.
- Legacy Shopify customer accounts, third-party merchant installation, Shopify App Store distribution, or merchant-install OAuth.
- Browser access to Shopify access, refresh, or ID tokens; raw Customer Account GraphQL proxying; or client-selected tenant/customer/order ownership.
- Festival handling card data or treating Shopify authentication, payment, or order state as Festival Admin identity, registration approval, or entitlement.
- Production protected-customer-data approval itself, managed WAF/edge configuration, external secret-store infrastructure, database/cache public-network configuration, or deployment topology changes unless explicitly brought into scope by the answers above.

## Success criteria

- [G1, G2] Tests prove each organization loads only its own validated Customer Account configuration and dynamically discovered HTTPS Shopify metadata; invalid origins, redirects, issuer relationships, credentials-in-URL, private/loopback/link-local/metadata targets, oversized responses, and cross-tenant configuration fail closed.
- [G3] Tests prove callback processing rejects state replay/mismatch, nonce mismatch, issuer/audience mismatch, tenant/store mismatch, non-exact redirect/return targets, and invalid authorization responses without creating a session or leaking an authorization code/token.
- [G4, G5] Storage and response tests prove Shopify access/refresh/ID tokens are encrypted at rest and server-only, the browser receives only a random opaque correctly flagged cookie, refresh is serialized and rotation-aware, and all listed expiry/failure/rotation cases invalidate the session.
- [G6] Logout tests prove local session revocation and cookie clearing occur and only a validated discovered Shopify end-session redirect with the required ID-token hint is used.
- [G7] Route-inventory, principal-separation, cross-tenant, CSRF, and Origin/Referer tests prove every route has exactly one auth class and that Firebase credentials cannot authorize customer routes or vice versa.
- [G8] Profile/order tests prove an authenticated customer can receive only the finalized allowlisted fields for that same session's Shopify customer and tenant, cannot supply another owner as authority, and never receives raw Customer Account GraphQL.
- [G9] Tests prove the finalized rate-limit policy denies excess start/callback attempts and that browser errors, application logs, and captured frontend payloads contain no client secret, authorization code, access/refresh/ID token, session cookie, raw upstream sensitive payload, or unnecessary customer PII.
- [G10] Tests and UI inspection prove the finalized in-scope flows preserve canonical organization routing, the API-helper boundary, accessible controls, and `specs/Style.md` without exposing server credentials or tokens.
- [G11, G12] All finalized issue-specific tests pass, followed by `bun run format:check`, `bun run build`, and `bun run test` from the repository root.

## Next action

- Ask the blocking questions, then create a new immutable iteration incorporating the answers and request explicit goal approval.
