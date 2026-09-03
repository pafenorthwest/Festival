# Diagnose app-created ORDERS_PAID webhook registration failures

## Goal reference

- `goals/issue-112-webhook-registration-diagnosis/goals.v0.md` (locked)

## Scope

### In scope

- Fail-fast runtime validation for the public callback origin required whenever
  Shopify services are enabled.
- Focused startup and webhook prerequisite regression tests.
- An ordered operator checklist and sanitized investigation record.

### Out of scope

- Issue #113's separate webhook result DTO, persistence, route, and frontend
  states.
- Manual Shopify Admin webhooks, expanded scopes, or commerce/entitlement
  changes.

## Evidence before implementation

- The branch was created from merge commit `9a2752f` for PR #110.
- The workspace `.env` contains both Shopify secret-keyring variables but no
  `FESTIVAL_PUBLIC_ORIGIN`.
- `createApp` therefore constructs `ShopifyWebhookSubscriptionService` with an
  undefined origin. Save & Verify can complete token exchange, identity, and
  effective-scope persistence before `reconcileForTenant` throws `Festival
  public origin is not configured.` without making a subscription request.
- `ShopifyIntegrationService` catches that `AppError` and records `transport`,
  which explains the misleading category but does not prove the target store's
  external Shopify configuration.
- The configured development database connection closes from this workspace,
  so the target integration record and a live Shopify request cannot be safely
  inspected here.

## Approach

1. Assert the public callback prerequisite during application construction when
   the keyring enables Shopify services.
2. Update the existing keyring-construction route test to prove missing and
   valid public-origin behavior.
3. Tighten the paid-order webhook setup checklist using Shopify's documented
   client-credentials and protected-customer-data prerequisites.
4. Run focused tests and all pinned repository checks.

## Verification commands

- Focused: `bun test packages/backend/tests/organization-routes.test.ts packages/backend/tests/shopify-webhook-subscription-service.test.ts`
- Format and lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery gate

- Do not claim the `test-pafe.myshopify.com` subscription succeeds until a live
  run proves token scopes, subscription listing/creation, and callback behavior.

## Current delivery

- Delivered so far:
  - Keyring-enabled startup now rejects a missing or invalid
    `FESTIVAL_PUBLIC_ORIGIN` before Shopify access.
  - Focused regression coverage proves the missing-origin stage makes no webhook
    client call and valid HTTPS configuration retains service construction.
  - The setup guide now contains the ordered same-organization, distribution,
    protected-data, released-scope, callback, and app-owned reconciliation
    checklist.
- Confirmed root cause in this workspace: callback configuration is absent, and
  the pre-fix request path mislabeled that local `AppError` as `transport`.
- External blocker: the configured development database is unavailable from this
  workspace, and no target-environment `FESTIVAL_PUBLIC_ORIGIN` or Shopify
  credentials are available here. Therefore the branch does not yet claim the
  exact `test-pafe.myshopify.com` failure, an effective-scope readback, a Shopify
  request ID, or successful live subscription creation.
- Deferred to #113: persisting and presenting store verification and webhook
  readiness as separate application results.

## Quality gate results

- Focused tests: passed — 38 tests.
- Format and lint: passed — `bun run format:check && bun run lint`.
- Build: passed — `bun run build`.
- Tests: passed — `bun run test` (30 common, 242 backend, 45 frontend).
