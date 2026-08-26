# Goals Extract
- Task name: shopify-integration-public-storefront-diagnostic
- Iteration: v0
- State: locked

## Goals

1. Add an authenticated, tenant-resolved, Admin-only Shopify diagnostic endpoint that uses the Organization's server-resolved verified shop domain and accepts no browser-selected domain, Shopify credential, token, or diagnostic target.
2. Add one bounded, credential-free `public_storefront_access` check that exercises Shopify's tokenless Storefront boundary without requiring an existing membership offering and distinguishes Shopify's locked Online Store condition from a successful public response.
3. Return only an allowlisted diagnostic result containing a stable check identifier, `passed` or `failed` status, and safe actionable display text; do not return Shopify response bodies, raw upstream errors, request IDs, credentials, tokens, secrets, or tenant-internal identifiers.
4. Add a `Run diagnostics` button at the bottom of the Shopify Integration section and render clear idle, running, passed, known-failed, and execution-error states inline without changing Save & Verify readiness.
5. Add automated backend, route-security, and frontend coverage for Admin authorization, tenant/domain authority, credential-free transport, locked-store classification, sanitized failures, UI states, and regression behavior.


## Non-goals

- Automatically running diagnostics during page load or Save & Verify.
- Persisting diagnostic results or diagnostic history.
- Adding a Storefront access token, bypassing Shopify storefront locks, or changing the public membership endpoint's tokenless security model.
- Testing membership product publication, product/variant identity, price, availability, checkout, or Customer Account configuration.
- Changing Shopify Admin API credential verification or capability readiness rules.


## Success criteria

- [G1] An authenticated Organization Admin can invoke the diagnostic for only the route-resolved tenant; unauthenticated, non-Admin, cross-tenant, or browser-authority attempts cannot trigger Shopify access.
- [G2] The check sends no authorization or Shopify credential/token headers, uses the verified canonical `*.myshopify.com` domain, applies the existing bounded timeout/response safety posture, passes for a valid tokenless Storefront response, and returns a known failed result for `Online Store channel is locked.`
- [G3] Every successful diagnostic response contains only the stable check ID, status, and safe display text; adversarial upstream bodies and sensitive canaries never appear in API responses or UI output.
- [G4] The Integration page places `Run diagnostics` at the bottom of the Shopify Integration section, prevents duplicate submissions while running, and visibly renders pass, locked-store failure, and execution failure without changing the saved verification status.
- [G5] Repository-pinned format, build, and test commands pass with focused tests covering the diagnostic endpoint, security declarations, transport classification, and frontend wiring/states.

