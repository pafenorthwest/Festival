# Checkout diagnosis and remaining return-flow blocker

## Confirmed checkout defect

Read-only database inspection matched the reported idempotency key to a failed intent with an attached Shopify cart (2026-09-10 02:07:09 UTC). The cart's Customer Account integration version is 14 and matches the current Customer Account configuration. The independently maintained Shopify integration version is 21. A read-only Storefront query for that saved cart returned HTTP 200, no GraphQL errors, and a checkout URL on the configured store hostname. No cart was created or order placed during diagnosis.

`CustomerAccountService.checkoutAccess` supplies the session's Customer Account integration version. `MembershipCheckoutService` previously compared it with the unrelated Shopify integration version after obtaining checkoutUrl, then marked the intent failed and returned checkout_retryable_upstream. A regression test with unequal counters failed before the change and passes afterward, including idempotent cart reuse.

The correction compares the cart's Customer Account version with the authenticated Customer Account context and compares a before/after snapshot of the Shopify configuration against itself. It retains exact HTTPS checkout-host validation and rejects Storefront reconfiguration during checkout. Regression tests cover reconfiguration, invalid destinations, stale customer context, database persistence failures, and consent/division prerequisites.

The original failed intent is intentionally not revived. The page clears the idempotency key after an explicitly failed intent; uncertain network failures retain it to prevent duplicate checkout. A key already saved by the previous deployed frontend may first receive checkout_terminal_failure; another Purchase starts a fresh attempt. No production records were changed.

## G4: revised confirmation-page return button

The user approved replacing automatic return with a **Return to Festival account** button. The extension in `packages/shopify-confirmation` targets Shopify's Thank you and Order status blocks. It uses native button navigation to the configured Festival organization account with `checkout=processing`, asks for no network/API capabilities, and includes editor guidance for missing or invalid configuration.

Festival's existing account page polls server-confirmed membership status. The checkout-processing return now survives an expired-session sign-in through a narrowly allowlisted OAuth return path; arbitrary URLs and cross-tenant returns remain rejected. Navigation never grants a membership.

The SDK typecheck, browser-target bundle, and renderer/configuration unit tests pass. No linked Shopify app configuration existed in the repository, and production deployment remains excluded by the locked goals. Thus live Shopify preview, deployment, and editor placement are outstanding external verification steps, explicitly documented in `packages/shopify-confirmation/README.md`. The prior platform limitation is resolved by the approved button flow; automatic redirect is no longer a requirement.

## Verification

- All 352 Bun tests pass (31 common, 255 backend, 46 frontend, 20 confirmation-extension tests).
- Format/lint, build, and frontend TypeScript checks pass.
- The real MembershipPage mounted against mock APIs passed 19 browser assertions at 1000px and 360px widths: four prerequisite combinations, unchecking, approved copy, one Purchase action, placement, submission lock, error display, retry, cancellation, and reopening with cleared state. No horizontal overflow. Mobile screenshot inspected.
- Account-return browser fixtures also verify expired-session sign-in, no unauthenticated membership reads, pending state without a grant, and server confirmation transitioning to Active.
- The local Vite HMR websocket reported a development connection warning; page rendering and all browser assertions passed.

- Supplementary Docker dependency-stage verification was stopped while waiting for the uncached oven/bun:1.3.14-alpine registry lookup. No Docker install/build result is claimed. All workspace manifests are now copied by the Dockerfiles, and the local frozen-lockfile install passed.
