# Goals Extract
- Task name: issue-93-public-teacher-membership-auth-resume
- Iteration: v0
- State: locked

## Goals

1. Restore the Organization membership-products endpoint as an explicitly classified public-read surface limited to `GET` and `HEAD`, with server-side Organization and active-offering resolution and only the active `teacher_membership` offering returned.
2. Define and enforce a minimal allowlisted public DTO containing the permitted Organization/offering presentation data and current Shopify title, description, availability, price, and currency, with no private credentials, tokens, customer PII, raw Shopify payloads, or unnecessary identifiers.
3. Apply an explicit public-route security policy covering authentication classification, method restrictions, cache behavior, request/response limits, credential-free execution, and denial of anonymous cart or checkout mutations.
4. Present the active Teacher Membership offering and a Purchase control to anonymous and authenticated visitors, while rendering deterministic no-active-offering, unavailable, and authentication-failure states without stale-price fallback.
5. Route an anonymous Purchase selection into Shopify Customer Account authentication without creating or mutating a cart, while allowing an already authenticated tenant-scoped customer to continue without a redundant authentication round trip.
6. Preserve authentication return/resume state that is bounded, tenant-bound, one-time or integrity-protected, limited to a server-validated Organization-relative destination and an opaque local offering selection, and unable to accept or derive authority from browser-supplied Shopify identifiers.
7. After successful authentication, resolve and resume exactly the originally selected local Teacher Membership offering for the same Organization and hand it to issue #77's authorized purchase continuation; reject replay, tampering, cross-tenant selection, changed Organization, changed variant, and invalid/expired state.
8. Add frontend and API coverage for public listing behavior, DTO allowlisting, method/mutation denial, empty/unavailable/error states, anonymous authentication initiation, authenticated bypass, successful resume, and replay/tampering/cross-tenant rejection, and keep repository-pinned lint, build, and test commands passing.


## Non-goals

- Implementing authenticated cart creation, checkout mutation, checkout return handling, order validation, or entitlement issuance owned by #77 and later purchase-processing issues.
- Returning accompanist memberships, unrelated Shopify products, multiple active Teacher Membership offerings, or a general public product catalog.
- Exposing Shopify Storefront, Customer Account, or Admin credentials/tokens; raw Shopify payloads; customer PII; or browser-selected Shopify product/variant identifiers.
- Redefining the customer identity/session foundation from #76/#23 or the offering/entitlement domain model from #92.
- Adding stale or locally cached price fallback when current Shopify commercial data is unavailable.


## Success criteria

- [G1] Anonymous `GET` requests and bodyless `HEAD` requests can resolve an Organization by slug and receive at most its one active Teacher Membership offering; unsupported methods, accompanist offerings, unrelated products, inactive offerings, and cross-tenant results are absent or denied as appropriate.
- [G2] Contract and response tests prove the public DTO contains only the documented public Organization/offering fields and current Shopify title, description, availability, price, and currency, and never exposes credentials, tokens, customer PII, raw upstream payloads, or unnecessary Shopify/local identifiers.
- [G3] Route-policy tests prove the public-read authentication class, explicit cache policy, request/response limits, no credential forwarding, and anonymous denial of every cart or checkout mutation surface involved in this flow.
- [G4] Frontend tests prove an active offering displays its name, description, current price, and Purchase control, while no-active-offering, current-data unavailable, and authentication-failure states are explicit and never retain or substitute a stale price.
- [G5] Tests prove anonymous Purchase initiates Shopify Customer Account authentication without cart mutation, while a valid tenant-scoped authenticated customer proceeds directly without a second authentication redirect.
- [G6] Return/resume tests reject absolute and protocol-relative redirects, unapproved or cross-Organization paths, oversized/expired/replayed/tampered state, cross-tenant offering selection, and any browser-supplied Shopify GID or variant authority.
- [G7] Successful authentication resumes the same opaque local offering for the same Organization and passes only the trusted, server-resolved selection into #77; changed/missing/inactive offerings and Organization/variant mismatches fail closed before cart or checkout mutation.
- [G8] Automated frontend/API suites cover all listed public-read, state, authentication, mutation-denial, resume, replay/tampering, and tenant-isolation behaviors, and the repository-pinned lint, build, and test command classes pass after later implementation.

