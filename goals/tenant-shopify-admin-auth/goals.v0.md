# Goals Extract
- Task name: tenant-shopify-admin-auth
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Persist one organization-scoped Shopify Admin integration containing a canonical `.myshopify.com` domain, verified Shopify shop GID, Admin client ID, a client secret encrypted through the tenant-bound encryption boundary owned by #83, verification timestamps/status, granted-scope diagnostics, and non-secret failure diagnostics; enforce shop-domain/shop-GID ownership uniqueness across organizations.
2. Require a verified Firebase identity, resolved route organization, active organization membership, required Festival role, and operation-specific authorization before loading any Shopify integration or credential; reject browser-controlled organization IDs, Shopify domains, credentials, and access tokens, and provide no fallback to global Shopify credentials.
3. Obtain Shopify Admin access tokens only server-side with the client-credentials grant and call only Admin GraphQL `2026-07`; keep access tokens transient rather than durable integration credentials.
4. Cache reusable Admin tokens in process with an early-expiry margin using tenant/store/client/secret-version identity in the cache boundary; fail explicitly when `expires_in` is absent or invalid, force a fresh exchange during verification, and invalidate old entries on credential or shop rotation.
5. During credential verification, confirm the actual Shopify shop GID/domain and compare the token's already-granted scopes against Festival capabilities without attempting to request or upgrade scopes in the token exchange; persist only safe verification diagnostics and fail closed on identity or scope mismatch.
6. Enforce explicit least-privilege capability checks for product reads (`read_products`), product writes (`write_products`), and order reads (`read_orders`); represent `write_orders` as a fail-closed future capability without enabling or invoking cancellation/refund mutations; keep order reads older than 60 days disabled without separately approved and recorded `read_all_orders` access.
7. Route in-scope existing Shopify Admin product read/write and order-read operations through the organization-scoped authenticated boundary so a token or integration associated with one tenant is unusable by another tenant even under malformed or duplicated identifiers.
8. Translate token endpoint failures, HTTP `401`/`403`, throttling, missing scopes, GraphQL errors, and Shopify mutation user errors into explicit safe application errors while redacting secrets, tokens, authorization headers, token request bodies, and sensitive diagnostics from responses and logs.
9. Append one bounded NDJSON record to `/var/log/festival/shopify-admin-audit.ndjson` for every attempted in-scope Shopify Admin GraphQL mutation, including timestamp, Firebase actor ID, Festival organization ID, operation name, Shopify request ID when returned, result, and bounded safe failure category; do not add a database audit table or include request/response bodies, business inputs, customer PII, raw error messages, stack traces, or secret material. Fail explicitly when the audit destination is unavailable, permit test-only path injection, and leave production rotation/retention to deployment operations.
10. When the configured Shopify client ID, client secret, or shop identity changes, invalidate prior process-cache entries and ensure subsequent requests use only the newly stored integration credentials; consume the tenant-bound encryption contract owned by #83 without implementing keyring configuration, ciphertext envelope formats, stored-secret re-encryption, encryption migration, or key retirement.
11. Make the minimal necessary updates to the existing Admin integration form and shared API contracts to expose safe configuration, verification state, capability status, and diagnostics; exclude the setup-instructions UI owned by #81.
12. Add automated tests covering cross-tenant route/repository/cache isolation; invalid Firebase identity and insufficient-role denial; fresh verification and normal reuse; expiry, early expiry, rotation, and missing `expires_in`; wrong-shop rejection; scope mismatch and capability denial; safe error mapping/redaction; ownership uniqueness; and mutation audit behavior within the final locked scope.
13. Keep repository documentation and contracts consistent with the implemented issue #75 boundary and pass the pinned repository lint, build, and test commands.


## Non-goals (explicit exclusions)

- Customer Account OAuth/OIDC sessions, customer tokens, and customer order-history UI (issue #76).
- Storefront cart, customer buyer identity, checkout, or payment behavior (issue #77).
- Webhook ingestion/reconciliation, order projections, entitlement decisions, cancellation/refund workflows, or financial mutations (issue #78).
- Shopify setup-instructions UI owned by sibling issue #81.
- Third-party merchant installation, Shopify App Store distribution, merchant authorization-code installation, or a global Shopify app credential.
- Automatic scope requests/upgrades during client-credentials exchange.
- Durable persistence or browser exposure of Shopify Admin access tokens.
- Order history older than 60 days or `read_all_orders` enablement.
- General security-policy work completed under #79; #75 consumes that boundary without duplicating it.
- Versioned encryption keyring configuration, ciphertext envelope design, tenant/purpose authenticated encryption, previous-key decryption, and related configuration validation owned by #83.
- Stored-secret re-encryption, encryption migration/backfill, and encryption-key retirement.


## Success criteria (objective checks)

- [G1, G5] Verification rejects a configured domain or credential that resolves to the wrong shop, rejects cross-organization shop ownership conflicts, and stores only encrypted credentials plus non-secret verified identity/scope diagnostics.
- [G2, G7] Automated route, repository, and cache tests prove that unauthenticated users, non-Admin members, and a valid Admin from another organization cannot load credentials or execute Shopify operations for the target tenant.
- [G3, G4] Tests prove fresh token exchange during verification, reuse before early expiry, refresh after expiry, explicit failure for missing/invalid `expires_in`, and non-reuse after credential/shop rotation; no Admin token is stored as a durable integration credential.
- [G5, G6] Tests prove product read/write and order-read capabilities fail closed when their corresponding granted scopes are absent and that the client-credentials request does not attempt to request scopes.
- [G6] Tests prove order reads beyond Shopify's default 60-day window remain unavailable without separately approved and recorded `read_all_orders` access.
- [G7] Existing in-scope product read/write and order-read paths use Admin GraphQL `2026-07` and cannot select tenant identity or credentials from operation bodies.
- [G8] Tests for token, HTTP, throttling, GraphQL, and user-error paths return explicit application errors while captured responses/logs contain no client secret, access token, authorization header, or token request body.
- [G9] Tests using an injected temporary audit path prove that each finalized in-scope Shopify Admin mutation attempt appends exactly one valid bounded NDJSON record with timestamp, actor, organization, operation, Shopify request ID when returned, result, and safe failure category; logger failures are explicit; records contain none of the prohibited content; no database audit table or routine success/error console logging is added.
- [G10] Credential/shop rotation tests demonstrate that prior process-cache entries and superseded integration credentials cannot authorize subsequent requests; #75 tests the encryption boundary interaction without duplicating #83's keyring/envelope tests.
- [G11] The finalized allowed Admin UI/API surface displays only safe integration state, capability status, and diagnostics and never returns a client secret or Admin access token.
- [G12, G13] All issue-specific automated tests pass, followed by `bun run format:check`, `bun run build`, and `bun run test` from the repository root.
