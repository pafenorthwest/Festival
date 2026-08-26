# Establish Goals

## Status

- Task name: issue-93-public-teacher-membership-auth-resume
- Iteration: v0
- State: locked

## Request

- GitHub issue #93: `Public Teacher Membership listing and authentication-resume purchase entry` (open), under parent issue #91.
- Objective: Restore an explicitly public, read-only Teacher Membership listing and connect its Purchase entry point to Shopify Customer Account authentication with deterministic return/resume behavior.
- Background: Issue #69 delivered the original listing page without checkout. The route was later intentionally changed to fail closed while the public security policy and Storefront/customer boundaries were incomplete. Issue #93 restores only the allowlisted public-read behavior needed by the MVP.
- Scope:
  - Restore `GET /api/organizations/:slug/membership-products` as an explicit public-read route.
  - Resolve Organization and active Teacher Membership offering server-side.
  - Return an allowlisted DTO containing only public Organization/offering data and current Shopify title, description, availability, price, and currency.
  - Return only the Teacher Membership offering in the MVP; accompanist and unrelated products are excluded.
  - Add a **Purchase** control for an active offering.
  - An anonymous click may initiate Shopify Customer Account authentication but cannot create or mutate a cart.
  - Preserve only a server-validated Organization-relative return target and opaque/local offering selection across authentication; do not accept an open redirect or browser-supplied Shopify identifiers.
  - After authentication, resume the same Teacher Membership selection and continue into #77.
  - Show unavailable, authentication-failure, and no-active-offering states without stale price fallback.
- Security requirements:
  - Public access is `GET`/`HEAD` only with an explicit route authentication class, response allowlist, cache policy, body/response limits, and no credentials or customer PII.
  - Public listing cannot load or expose private Storefront tokens, Customer Account tokens, Admin credentials, raw Shopify payloads, or unnecessary identifiers.
  - Cart and checkout mutations require the tenant-scoped customer session, CSRF/origin controls, and #77 authorization.
  - Return/resume state is one-time or integrity-protected, tenant-bound, bounded, and cannot select a different Organization or variant.
- Acceptance criteria:
  - Anonymous visitors can view the active Teacher Membership name, description, and current Shopify price.
  - Anonymous visitors cannot call cart or checkout mutations successfully.
  - Selecting Purchase starts authentication when necessary and resumes exactly the selected local offering afterward.
  - An already authenticated customer proceeds without a second authentication round trip.
  - No open redirect, cross-tenant resume, browser-controlled Shopify GID, stale-price fallback, secret, or customer PII reaches the public response.
  - Frontend/API tests cover public read, unavailable state, anonymous mutation denial, authenticated resume, replay/tampering, and cross-tenant denial.
  - Repository-pinned lint, build, and test commands pass.
- Dependencies: public listing baseline #69; customer/session foundation #76 and #23; membership offering #92; purchase continuation #77.

## Blocking ambiguity

- None.

## Assumptions

- Issue #93 consumes the tenant/customer-session foundations from #76 and #23 and the Organization-scoped Teacher Membership offering from #92 rather than redefining those domains.
- Issue #77 owns authenticated cart creation, checkout mutation, and the purchase continuation after issue #93 restores and validates the selected local offering.
- The public DTO may expose only explicitly documented Organization and Teacher Membership presentation fields plus the listed current Shopify commercial fields; all other fields are private by default.
- When current Shopify commercial data cannot be obtained or says the offering is unavailable, the public experience reports an unavailable/error state and does not substitute previously displayed or locally persisted price data.
- `HEAD` has the same public authorization, cache, and response-metadata policy as `GET` and returns no response body.
- The post-authentication destination stays within the selected Organization's Festival routes; arbitrary absolute URLs, protocol-relative URLs, and cross-Organization paths are invalid.

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

## Next action

- Hand the locked goals to `implement`; do not plan or implement during establish-goals.
