# Goals Extract
- Task name: shopify-headless-private-token
- Iteration: v0
- State: locked

## Goals

1. Add a validated optional `storefrontPrivateToken` input to the Shopify Integration form and API contract, with a password field, safe placeholder/presence state, and clear save/update semantics.
2. Persist the private Storefront token encrypted at rest with organization-bound purpose separation from the Shopify client secret; preserve it when omitted on updates and support replacement when supplied.
3. Decrypt the token only in backend Shopify Storefront clients and send it using Shopify’s private-token header for applicable headless API calls; never send it to frontend code or Admin API OAuth flows.
4. Preserve tenant scoping, Admin authorization, bounded transport behavior, sanitized upstream errors, and existing tokenless fallback behavior when no private token is configured.
5. Update the Shopify Integration UI to communicate that the private token is server-only, retained when blank, and distinct from the client secret; expose only whether one is configured.
6. Add focused common, backend, route, persistence/security, and frontend tests covering validation, encryption/purpose separation, preservation/replacement, private-header usage, fallback behavior, redaction, and regression compatibility.


## Non-goals

- Changing Shopify Admin API credentials, OAuth flows, or Admin API capability scopes.
- Exposing a private token, decrypted secret, or raw Shopify response in API responses, logs, browser state, or rendered UI.
- Automatically creating or rotating Headless channel storefronts/tokens in Shopify.
- Removing Shopify development-store password protection or bypassing a locked Online Store channel.
- Adding a public Storefront token or changing browser-direct Storefront API architecture.


## Success criteria

- [G1] Admin Shopify Integration save/update accepts an optional private Storefront token, validates it without persisting whitespace-only input, and returns only a boolean/presence indicator.
- [G2] Stored private-token ciphertext is organization-bound and purpose-separated from the client-secret ciphertext; omitted updates preserve the existing token and supplied updates replace it.
- [G3] Applicable backend Storefront requests use `Shopify-Storefront-Private-Token` only when configured, otherwise retain the existing tokenless request path; no token appears in frontend payloads, logs, or errors.
- [G4] Existing Admin API verification and current public membership catalog behavior remain compatible for integrations without a private token.
- [G5] Focused security, persistence, transport, and UI tests prove authorization/tenant boundaries, header selection, secret redaction, fallback behavior, and field wiring.
- [G6] Repository-pinned format, build, and test commands pass.

