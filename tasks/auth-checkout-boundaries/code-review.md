# Code Review
- Task name: auth-checkout-boundaries
- Findings status: none

## Context
- Base branch: 4fbb68dd4f3462ef475390af4d74bdcb408e4079
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `packages/backend/src/checkout/class-checkout-service.ts`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-cart-recovery.ts`
  - `packages/backend/src/domains/class-checkout/class-checkout-errors.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts`
- Citation candidates (verify before use):
  - `packages/backend/src/checkout/class-checkout-service.ts:15-15`
  - `packages/backend/src/checkout/class-checkout-service.ts:33-33`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:12-12`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:164-164`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:165-165`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:167-167`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:179-181`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts:183-207`
  - `packages/backend/src/domains/class-checkout/class-checkout-cart-recovery.ts:16-16`
  - `packages/backend/src/domains/class-checkout/class-checkout-cart-recovery.ts:199-227`
  - `packages/backend/src/domains/class-checkout/class-checkout-cart-recovery.ts:237-241`
  - `packages/backend/src/domains/class-checkout/class-checkout-errors.ts:152-163`
  - `packages/backend/tests/class-checkout-service.test.ts:30-30`
  - `packages/backend/tests/class-checkout-service.test.ts:32-32`
  - `packages/backend/tests/class-checkout-service.test.ts:37-40`
  - `packages/backend/tests/class-checkout-service.test.ts:371-435`
  - `packages/backend/tests/class-checkout-service.test.ts:437-529`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts:4-4`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts:7-55`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.97
- Justification: The credential-specific error is emitted only while reading or decrypting local private Storefront credentials before the HTTP call. Only that proof, or the existing pre-request configuration error, can reset a claimed creation to prepared/retryable; the claim-fenced transition must succeed before the retryable response is returned. Repair reuses the same immutable intent and idempotency key with a fresh binding. Remote dispatch failures and malformed cart results retain conservative recovery behavior. No actionable regression was found.


## Unit #400 validation evidence

- Independent targeted run passed 95 backend tests across drop-transfer-routes, drop-transfer-service, and csrf-guard suites.
- Independent targeted frontend run passed 35 tests across drop-transfer, drop-transfer-ui-gating, and customer-account suites.
- Backend/test TypeScript and frontend `check:types` passed. The first sandboxed attempts could not write ignored incremental cache files, and both checks passed when rerun with the authorized worktree write permission.
- Biome check passed for all five changed TypeScript files.
- `git diff --check` passed.
- Tests exercise both endpoints with missing, empty, incorrect tokens and absent, opaque, malformed, or different origins. Denials preserve registrations and change logs, avoid promotion, and never call mutation or refund methods. Existing valid operations and cross-customer ownership denial remain covered.
- Client tests assert the CSRF header and cookie credentials without adding a Firebase Authorization header.
- Independently reviewed unit committed and pushed as `222e3cee07564d5cc6891cd2bf1b5a88bd2e93f3`. The coordinating agent also reported a successful full build and full test run using the isolated PostgreSQL 17 database, with log `/private/tmp/festival-auth-b1-validation.log`.


## Unit #404 validation evidence

- Independent run passed 51 tests across api/api-clients, festival-class-registration, and multiLineCheckoutHandoff suites.
- Frontend `check:types` passed.
- Biome check passed for both changed TypeScript files, and `git diff --check` passed.
- Reviewed supported call forms against `c6a4029c0185ead366d747942c8b2bffb2c00b7e`, including positional overrides, token/input/key, token/key/input, current object-only calls, omitted positional keys, and empty overrides.
- Repeated calls retain explicit keys and strip embedded header fields from the JSON body. Existing items-to-lineItems normalization coverage remains in place.
- Independently reviewed with no findings and committed/pushed as `e2e5282f87076840f47c3f319001d465c7173471`.


## Unit #398 validation evidence

- Independent targeted run passed 38 frontend tests across checkout-auth-rejection, class-checkout-hook, multiLineCheckoutHandoff, customer-registration-session, and parent-registration-state suites. Run these from `packages/frontend` so Bun applies the package JSX configuration. An initial root-directory invocation failed to load the TSX runtime; the corrected package-directory invocation passed.
- Frontend `check:types` passed.
- Biome check passed for both changed source files and the new test file, and `git diff --check` passed.
- Reviewed fresh 401/403 rejection, repeated retry, same-session draft retention, replacement-session clearing, delayed eligibility and disposal guards, no automatic checkout retry, existing uncertain submissions, retryable recovery, response recovery evidence, and rejected recovery-status requests.
- Independently reviewed with no findings and committed/pushed as `ee9275a7d6a7d661abf7b55a04311b3e5ebded44`.


## Units #402 and #406 validation evidence

- Independent backend run passed 37 tests across admin-entitlements-ops, customer-checkout-recovery, and checkout-recovery-service suites.
- Independent frontend run passed 38 tests across admin-entitlement-ops-panel, checkout-recovery-ui, and api/api-clients suites.
- Backend/test TypeScript and frontend `check:types` passed. Biome passed for all six changed TypeScript files, and `git diff --check` passed.
- Admin tests cover realistic-length bearer tokens, missing/overlong CSRF denial, separate bounded CSRF success, and all six shared client helper consumers.
- Customer tests use actual encrypted customer sessions, deny missing/empty/wrong/other-session tokens and invalid origins or recovery ownership before mutation, preserve source/recovery/audit state and zero Storefront calls, and cover valid resume plus consumed-link replay.
- Independently reviewed with no findings and committed/pushed as `23eca3a11bb7183c3ee52e5871756afd3cae45c0`.


## Unit #405 validation evidence

- Independent backend run passed 92 tests across admin-class-checkout-recovery, csrf-guard, nginx-security, and customer-logout-csrf suites.
- Backend/test TypeScript, Biome for both changed files, and `git diff --check` passed.
- Reviewed HTTP/HTTPS authority parsing, case normalization, default and explicit non-default ports, optional root slash, and rejection of path/userinfo/query/fragment/opaque/malformed/absent configuration. Both reap and resolve retain nonempty CSRF and exact request-origin checks.
- Independently reviewed with no findings and committed/pushed as `4fbb68dd4f3462ef475390af4d74bdcb408e4079`.


## Unit #357 local Storefront credential subitem validation evidence

- Independent `bun test tests/class-checkout-service.test.ts tests/shopify-membership-checkout-client.test.ts tests/class-checkout-execution.test.ts tests/architecture-boundaries.test.ts` from `packages/backend` passed 170 tests. The first invocation also listed a nonexistent `class-checkout-recovery.test.ts` path; Bun selected the four existing suites. The explicit four-suite command describes the executed coverage.
- Independent PostgreSQL 17 run of `postgres-class-checkout-recovery.integration.test.ts` and `postgres-class-checkout-payment.integration.test.ts` passed 14 tests using the isolated checkout database. These exercise claim fencing, transactional recovery/lease release, payment races, and conservative unknown outcomes.
- Backend/test TypeScript using `packages/backend/tsconfig.json`, Biome for all six changed TypeScript files, and `git diff --check` passed. An extra attempted `tsconfig.tests.json` check referred to a nonexistent separate config; the successful repository backend config includes all backend tests.
- Reviewed missing and undecryptable AES credentials through the real adapter, zero HTTP dispatch on denial, the claim-fenced successful reset, rejected persistence, same-intent/key repair and replay with exactly one created cart, and unchanged recovery requirements after an upstream 503.
- The coordinating agent reported final branch gates passed: format/lint (808 files), full build, frontend types, backend/test types, SQL checks, PostgreSQL 17 schema parity, and all tests (365 common, 1703 backend, 515 frontend, 20 confirmation extension). Evidence: `/private/tmp/festival-auth-b-final-validation.log` lines 1-3275. A later log-tail command failed after all gates had completed; it did not affect source or validation results.
- Independent review found no findings. Commit/push authorized by the coordinating agent after the full gates. This completes only the credential failure subitem of #357; the umbrella remains open for its other work.
