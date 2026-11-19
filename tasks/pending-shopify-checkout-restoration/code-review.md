# Code Review
- Task name: pending-shopify-checkout-restoration
- Findings status: none

## Context
- Base branch: origin/main
- Base commit: 49233e45d7dbcd92c921dfe595833d53685d319a
- Branch: codex/pending-shopify-checkout-restoration
- Diff command: `git diff origin/main -- <approved paths below>`; explicitly inspect every new file, including files shown as untracked or intent-to-add.
- Baseline provenance: refreshed origin/main contains merged PR #409 and has the same tree as the initial implementation HEAD f5ce41811e6f4213a0e7e6f7b116518755133387. Prior branch history is not included in this review.
- Scope: the 88 parent-approved checkout, auth recovery, diagnostic, UI, test, specification and review paths below. Pre-existing user edits in AGENTS.md and bun.lock are excluded and preserved. Private operational artifacts, browser profiles, backups, environment contents and unrelated files are excluded.
- The validator's initial workspace-wide inventory was narrowed to this explicit scope. The reviewer performed no source edits, staging, branch changes, commits or pushes. Only this review artifact was refreshed.
- Changed files:
  - `docker/nginx.festival.conf`
  - `goals/task-manifest.csv`
  - `nginx/festival.conf`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/checkout/class-checkout-execution.ts`
  - `packages/backend/src/checkout/in-memory-checkout-helpers.ts`
  - `packages/backend/src/checkout/in-memory-checkout-query-helpers.ts`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts`
  - `packages/backend/src/commerce/in-memory-commerce-deliveries.ts`
  - `packages/backend/src/composition/class-checkout.ts`
  - `packages/backend/src/composition/runtime.ts`
  - `packages/backend/src/customer/in-memory-customer-account-repository.ts`
  - `packages/backend/src/customer/postgres-customer-account-repository.ts`
  - `packages/backend/src/domains/class-checkout/checkout-execution-helpers.ts`
  - `packages/backend/src/domains/class-checkout/checkout-execution-queries.ts`
  - `packages/backend/src/domains/class-checkout/checkout-intent-queries.ts`
  - `packages/backend/src/domains/class-checkout/checkout-intent-repository.ts`
  - `packages/backend/src/domains/class-checkout/checkout-types.ts`
  - `packages/backend/src/domains/class-checkout/index.ts`
  - `packages/backend/src/domains/class-checkout/ports.ts`
  - `packages/backend/src/domains/commerce-projection/membership-order-projection-validator.ts`
  - `packages/backend/src/domains/commerce-projection/order-projection-membership-tx.ts`
  - `packages/backend/src/domains/commerce-projection/order-projection-repository.ts`
  - `packages/backend/src/domains/commerce-projection/shopify-order-projection-service.ts`
  - `packages/backend/src/domains/commerce-projection/shopify-orders-client.ts`
  - `packages/backend/src/domains/customer-identity/customer-integration-repository.ts`
  - `packages/backend/src/domains/customer-identity/customer-oauth-flow.ts`
  - `packages/backend/src/domains/customer-identity/types.ts`
  - `packages/backend/src/routes/customer/customer-class-checkout.routes.ts`
  - `packages/backend/src/routes/customer/customer-registration.routes.ts`
  - `packages/backend/src/routes/route-group-options.ts`
  - `packages/backend/src/routes/route-groups.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/class-order-projection.test.ts`
  - `packages/backend/tests/customer-account-repository.test.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
  - `packages/backend/tests/domains/customer-identity/customer-identity.test.ts`
  - `packages/backend/tests/nginx-security.test.ts`
  - `packages/backend/tests/postgres-class-checkout-recovery.integration.test.ts`
  - `packages/backend/tests/postgres-customer-account-repository.integration.test.ts`
  - `packages/backend/tests/postgres-expired-checkout-restart-payment.integration.test.ts`
  - `packages/backend/tests/route-security.test.ts`
  - `packages/backend/tests/shopify-admin-api-client.test.ts`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts`
  - `packages/common/src/index.ts`
  - `packages/frontend/src/components/AppHeader.tsx`
  - `packages/frontend/src/components/FestivalRegistrationCartView.tsx`
  - `packages/frontend/src/domains/customer/CustomerIdentityContext.tsx`
  - `packages/frontend/src/domains/registration/FestivalRegistrationForm.tsx`
  - `packages/frontend/src/domains/registration/registrationPageActions.ts`
  - `packages/frontend/src/domains/registration/useFestivalRegistrationPage.ts`
  - `packages/frontend/src/lib/api/registration.ts`
  - `packages/frontend/src/pages/CustomerAccountClassesPage.tsx`
  - `packages/frontend/src/pages/CustomerAccountOrdersPage.tsx`
  - `packages/frontend/src/pages/FestivalClassRegistrationPage.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/checkout-auth-rejection.test.ts`
  - `packages/frontend/tests/class-checkout-hook.test.ts`
  - `packages/frontend/tests/customer-registration-session.test.ts`
  - `packages/frontend/tests/fixtures/class-checkout-hook.ts`
  - `packages/frontend/tests/fixtures/purchased-history-hook.ts`
  - `goals/pending-shopify-checkout-restoration/establish-goals.v0.md`
  - `goals/pending-shopify-checkout-restoration/goals.v0.md`
  - `packages/backend/src/checkout/shopify-pending-checkout-orders.ts`
  - `packages/backend/src/domains/class-checkout/pending-checkout-payment.ts`
  - `packages/backend/src/domains/class-checkout/pending-checkout-queries.ts`
  - `packages/backend/src/domains/class-checkout/pending-checkout-types.ts`
  - `packages/backend/src/domains/class-checkout/pending-class-checkout-service.ts`
  - `packages/backend/src/domains/customer-identity/customer-graphql-errors.ts`
  - `packages/backend/src/routes/customer/customer-pending-checkout.routes.ts`
  - `packages/backend/tests/customer-graphql-errors.test.ts`
  - `packages/backend/tests/customer-pending-checkout.routes.test.ts`
  - `packages/backend/tests/pending-class-checkout-service.test.ts`
  - `packages/backend/tests/postgres-pending-payment-history.integration.test.ts`
  - `packages/backend/tests/shopify-pending-checkout-orders.test.ts`
  - `packages/common/src/pending-class-checkout.ts`
  - `packages/frontend/src/components/PendingClassCheckoutPanel.tsx`
  - `packages/frontend/src/domains/customer/pending-checkout-state.ts`
  - `packages/frontend/tests/pending-checkout-api.test.ts`
  - `packages/frontend/tests/pending-checkout-state.test.ts`
  - `specs/pending-shopify-checkout-restoration.md`
  - `tasks/customer-login-readiness/code-review.md`
  - `tasks/customer-order-history-diagnostics/code-review.md`
  - `tasks/customer-order-history-diagnostics/spec.md`
  - `tasks/pending-shopify-checkout-restoration/code-review.md`
  - `tasks/pending-shopify-checkout-restoration/live-e2e.md`
  - `tasks/pending-shopify-checkout-restoration/spec.md`

## Integrated correctness and security review

- Integrated the earlier independent whole-checkout review and follow-up gates with a final task footprint inspection and focused reread of the current service, payment helper, provider adapters, repositories/admission/restart guards, routes/Nginx/composition, frontend resource/identity/submission flows, auth recovery, diagnostic helper and UI cascade. Meaningful new regression coverage was inspected, including real Postgres writers.
- Current Shopify cart and financial observations remain authoritative. Existing intent/cart/execution rows are durable locators and Festival metadata; historical receipt timestamps are retained as history, without establishing a current balance. No DDL, payment-copy tables, payment-write scopes, automatic discard/replacement, changed eligibility policy or new balance-collection operation was introduced.
- Order discovery verifies tenant/store/customer identity, scans financial states with bounded pagination, validates exact intent-line identity and handles incomplete/missing identifiers or overlapping merchandise conservatively. Historical scope limits, unavailable evidence and ambiguous candidates retain the registration block. GET performs no checkout lifecycle writes.
- Resume requires the authenticated owner and current-session CSRF/origin checks, verifies the original storefront/cart/lines, refreshes an absent buyer only with the current owner's lazy token, checks URL domain, then rechecks generation/provider/payment state. Original deadlines still prevent resumed payment links after unpaid expiry. Optional submission proof returns only a boolean and grants no authority.
- Backend admission and legacy entry/status routes retain unresolved issued checkouts across local expiry. Partial payment observations remain retryable rather than terminally rejecting later full payment. Approved and historical receipt evidence survives delayed incomplete observations in both stores.
- Frontend discovery blocks registration while checking or unresolved; navbar count and saved details use the owning checkout. Owner/generation checks reject stale reads. Forced error refresh invalidates earlier null observations; uncertain local submissions stay frozen. Captured-line cleanup requires verified resolution and, for uncertain resume association, exact server match proof. Unrelated selections are not consumed by resume proof; navigation preserves appropriate owner-scoped handoffs while logout/account replacement invalidate the relevant private state.
- Authentication readiness recovery uses fresh validated discovery and integration-version-conditional health writes. Order observations change capability independently. Safe diagnostics use fixed operations, exact code/query-field allowlists, capped metadata and bounded finite numbers; no raw response messages, credentials, customer data or success events are logged. Unknown failures preserve the prior generic 403 contract. The historical upstream order failure's reason remains unknown.
- Both Nginx configurations allow only GET/OPTIONS for discovery and POST/OPTIONS for resume. Security metadata and proxy-method regressions cover the new routes.
- Final UI controls share one action wrapper in View/Continue/refresh order and wrap only when needed. Native button semantics, accessible label/title, hidden SVG and loading disable behavior remain intact. The icon selector includes .parent-shell and outranks the later parent stylesheet's button base, preserving its 44px target, zero padding and centering. The earlier cascade oversight was corrected before this final gate.

## Validation evidence

- Prior independent checkout gates passed: backend service/routes 44 tests, then 49 after bounded follow-ups; frontend resource/session 17 tests, then hook/resource/API 39 tests; final delayed-proof race 4 tests. These overlap and are not summed.
- Independent auth recovery checks passed 65 tests / 347 assertions, with 4 Postgres cases skipped in that invocation. The new real Postgres health branch/CAS/preservation regression was inspected; its implementation owner separately passed the isolated Postgres repository/token-refresh/contract run (23 tests).
- Independent final diagnostic helper/service/transport/auth-route/architecture run passed 104 tests / 494 assertions / 0 failures. Malicious metadata, bounds, no success logging, fixed operation wiring and no retry are covered.
- Final validation owner reports all 2,806 tests passed: backend with actual isolated PostgreSQL 1,870 / 10,739 assertions; common 365 / 1,328 assertions; frontend 551 / 3,103 assertions; confirmation extension 20 / 29 assertions. Final types, all builds, formatting (831 files), SQL validation (517 backend TypeScript files), retained locked goals and fresh canonical restore plus 13 migrations/schema-dump parity passed. The reviewer did not duplicate these full suites. Scoped UI checks/types/formatting passed after the final row and specificity changes.
- Genuine development-store browser acceptance passed: fresh sign-in, order history 200 with five orders in both sessions, one abandoned Solo checkout, logout/relogin, Cart 1, new-registration guard, reload and same-cart resume. The original intent/line/provider-cart hashes and generation 1 were unchanged. Original children and purchase/entitlement/projection/decision hashes were preserved. The profile whole-row hash changed on relogin; unchanged individual profile fields are not claimed. No payment was attempted. See live-e2e.md.
- Genuine partial-to-full payment, refund behavior and payment completion remain unverified. The unpaid synthetic fixture remains for review. Automated partial-state/history/reconciliation coverage does not substitute for that live exercise; the implementation must not be represented as a released payment-flow certification.

## Publication and scope checks

- Explicit-path scans cover all 88 approved files. No hardcoded private key, Shopify credential, AWS key or JWT literal was detected. No live customer email was detected. Known synthetic cart literals are confined to offline test fixtures.
- Final explicit-path publication scan of all 88 approved files returned zero findings for the credential patterns above and public-document email, local filesystem path, raw keyed-cart and private checkout-URL patterns. Three earlier local-path findings in the task specification were removed and rechecked. The primary specification now accurately distinguishes completed unpaid-checkout E2E from unexecuted payment/refund acceptance.
- Read-only diff whitespace checks passed. Git owner independently owns exact staging and verifies the excluded user-file fingerprints.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: The final integrated task preserves Shopify financial authority, exact checkout ownership/line identity, current-session CSRF, conservative unresolved-payment gates, captured browser state and historical payment evidence. Earlier material findings and the UI cascade oversight were corrected and rechecked. Current source inspection, independent focused suites, reported full landing checks, genuine unpaid-checkout E2E and final explicit publication scans found no outstanding actionable issue. Live payment/refund acceptance remains an explicit external limitation rather than a claimed result.
