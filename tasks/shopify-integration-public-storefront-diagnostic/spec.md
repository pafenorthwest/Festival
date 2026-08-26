# Shopify Integration Public Storefront Diagnostic

## Goal reference

- `goals/shopify-integration-public-storefront-diagnostic/goals.v0.md`

## Scope

### In scope

- Admin-only, tenant-resolved endpoint for an on-demand public Storefront diagnostic.
- Bounded credential-free Shopify transport that safely classifies a locked Online Store.
- Inline `Run diagnostics` UI with idle, running, passed, known-failed, and execution-error states.
- Focused backend transport, route security, and frontend tests.

### Out of scope

- Automatic or persisted diagnostics.
- Storefront credentials or lock bypasses.
- Product publication, price, availability, checkout, Customer Accounts, or Admin API readiness changes.
- Changes to the existing public membership endpoint.

## Approach

- Extend the existing public-catalog transport with a minimal shop-level probe, expose it through a small diagnostic service/route, and keep transient UI state in the existing app controller.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Added a bodyless Admin-only tenant diagnostic endpoint, a bounded credential-free Storefront probe with exact locked-store classification, allowlisted shared response contracts, nginx/security inventory updates, and transient Integration-page idle/running/pass/action-required/execution-error UI. Focused tests cover domain authority, authorization, request-body rejection, sanitized transport failures, route serialization, and frontend wiring. A live credential-free probe of `test-pafe.myshopify.com` returned the expected `locked` classification.
- Exceptions: Interactive in-app browser QA could not run because the browser connection terminated during setup; the frontend compiled and its focused state/wiring tests passed.
- Deferred work: None
- Dirty-worktree decision: continue; only this task's generated goal/task artifacts and manifest entry are present after preflight.

## Quality gate results

- Lint: passed (`bun run format:check`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`; 30 common, 199 backend, 34 frontend)
- Code review: passed; no actionable findings (confidence 0.94)
- Clean merge: pending
