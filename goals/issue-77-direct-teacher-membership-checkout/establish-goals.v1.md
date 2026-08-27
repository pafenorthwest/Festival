# Establish Goals

## Status

- Task name: issue-77-direct-teacher-membership-checkout
- Iteration: v1
- State: locked

## Request

- GitHub issue #77: `Phase 3: Direct Teacher Membership cart and authenticated Shopify checkout` (open), under parent #91 and architecture #74.
- Continue the trusted local offering selection from #93. A Shopify-authenticated customer may purchase exactly one active Teacher Membership for themself through Festival-validated, tenant/customer-scoped cart operations and Shopify-hosted checkout.
- Fixed quantity one. Division selection and duplicate-purchase prevention are deferred to #78. Create a Festival checkout intent before requesting a fresh Shopify checkout URL; browser return shows only `Processing`.
- Reuse the existing Shopify integration's `storeDomain` and separately encrypted private Storefront token; use Storefront GraphQL `2026-07` with canonical HTTPS/SSRF/redirect/timeout/response-size controls.
- Implement one customer-session-only `POST /customer/checkout` BFF entry point. Retain full Shopify cart IDs server-side behind opaque Festival references, revalidate current offering/price/availability, bind buyer identity, and require CSRF plus trusted Origin/Referer for mutations. Buyer-IP forwarding is out of scope because no trusted source exists.
- Create a trusted checkout intent with required offering, commercial, cart, status/timestamp, and safe correlation snapshots; attach only that safe correlation identifier to Shopify metadata for #78. Allow only configured `*.myshopify.com` checkout URLs.

## Blocking ambiguity

- None.

## Assumptions

- #93 supplies a trusted, local offering continuation and #92 supplies the server-side offering/variant mapping.
- The customer/session, Festival customer, division, and configuration foundations named by the issue are available as dependencies; this work consumes rather than redefines them.
- "Create/read/add/update/remove" BFF operations are internal/protected cart capabilities, but MVP client behavior exposes only direct creation and checkout for the one resolved Teacher Membership at quantity one—not a general cart UI.
- Browser-return `Processing` is a neutral state only; #78 owns webhook/order correlation, validation, and entitlement issuance.
- Reusing `storeDomain` with a purpose-separated encrypted private token is not a material security risk: credentials remain distinct cryptographic purposes and are never browser-visible. It reduces scope because no additional configuration record or UI is needed; integration-version rotation remains a checkout invalidation boundary.
- Account checkout return uses `/org/:slug/account?checkout=processing`.

## Goals

1. Complete #93's trusted purchase continuation with customer-session-only BFF cart and checkout operations that permit only one server-resolved active Teacher Membership variant for the authenticated customer and Organization at quantity one.
2. Reuse the existing Shopify integration `storeDomain` and its purpose-separated encrypted private Storefront token, with integration-version invalidation on rotation and no new configuration surface.
3. Implement Storefront API `2026-07` access with canonical HTTPS destination validation, SSRF/redirect/timeout/response-size controls and buyer-identity attachment from the authenticated customer token; do not forward buyer IP without a trusted source.
4. Persist the full Shopify cart ID only behind an opaque Festival cart reference bound to Organization, Festival customer, session/ownership context, integration version, status, and expiration; never derive any of those authority fields from the browser.
5. Re-resolve the local offering and current Shopify availability/price before checkout. Defer division selection and active/processing duplicate prevention to #78, recorded with an explicit TODO.
6. Require CSRF and trusted exact Origin/Referer validation for every cookie-authenticated mutation, register all cart/checkout routes under the customer-session class, and return only allowlisted DTOs with explicit upstream/cart lifecycle failures.
7. Atomically persist a checkout intent before redirect with trusted Organization, customer, offering, entitlement, duration, product/variant, quantity-one, division, current commercial, policy, cart-reference, status, expiry, and safe correlation snapshots; attach only the safe correlation identifier to controlled Shopify metadata.
8. Request and return a fresh allowlisted Shopify-hosted checkout URL only at checkout start; explicitly handle Storefront user errors, warnings, throttling, completed/deleted/expired carts, integration rotation, and stale checkout URLs.
9. Deliver direct-purchase UI that calls `POST /customer/checkout`, presents unavailable, expired-cart, retryable-upstream, and terminal failure states, and redirects only to a server-returned configured `*.myshopify.com` checkout URL; do not build a general cart UI.
10. On checkout browser return, navigate to `/org/:slug/account?checkout=processing` only and create no order projection, payment/validation decision, or entitlement; provide the safe correlation handoff required by #78.
11. Add focused API/frontend/security tests for resume integration, CSRF/origin, tenant/customer isolation, browser-authority rejection, division/duplicate checks, buyer identity/IP, credential rotation, Storefront failure modes, checkout correlation/redaction, and no-entitlement-on-return; repository-pinned lint, build, and test commands must pass.

## Non-goals

- Festival card collection, payment capture, general cart UI, quantities above one, accompanist membership, gifting, purchase for another customer, division selection, and buyer-IP forwarding.
- Active/processing duplicate-purchase prevention, deferred to #78 with an explicit implementation TODO.
- Trusting checkout return or completion as payment or entitlement evidence.
- Webhook ingestion, order projection, validation decisions, or entitlement issuance owned by #78.
- Exposing private Storefront credentials, Shopify customer tokens, full cart IDs, cart secrets, authorization codes, cookies, sensitive upstream payloads, or unnecessary PII to the browser or logs.

## Success criteria

- [G1] Authenticated customers can create and use only their own tenant-scoped cart and checkout intent for one current active Teacher Membership, while anonymous, cross-tenant, cross-customer, replayed, expired, and browser-authority attempts fail before Shopify mutation.
- [G2] Configuration and security tests prove the Headless Storefront credential is separately encrypted, versioned, readiness-verified, cache/state-invalidating on rotation, never returned by Admin APIs, and accessed only through the required Storefront transport controls.
- [G3] Cart and checkout tests prove fixed quantity one, trusted offering/variant and current commercial revalidation, buyer identity behavior, no buyer-IP forwarding, and explicit handling of Storefront errors, warnings, throttling, and invalid cart states.
- [G4] Route and response tests prove customer-session authentication, CSRF and exact-origin enforcement for mutations, Organization/customer cart ownership, authority-field rejection, DTO allowlisting, and redaction of tokens, full cart IDs, secrets, cookies, codes, and unnecessary PII.
- [G5] Checkout tests prove an atomic intent and safe Shopify correlation identifier exist before a newly requested, allowlisted checkout URL is returned; no secret or unsafe cart metadata reaches Shopify/browser surfaces, and #78 can correlate without heuristic matching.
- [G6] Frontend tests prove direct purchase continuation through `POST /customer/checkout`, all required failure states, configured `*.myshopify.com` server-only checkout redirect, no general cart UI, and Account `checkout=processing` return without order, validation, payment, or entitlement success.
- [G7] Repository-pinned lint, build, and test command classes pass after implementation.

## Next action

- Hand the locked goals to `implement`; do not plan or implement during establish-goals.
