# Code Review
- Task name: class-checkout-recovery
- Findings status: none

## Context
- Base branch: ericp/registration-flow-redesign
- Base SHA: a0c9906f248d79d0f297a6ba64f370885bef0235
- Reviewed branch: codex/class-checkout-recovery-plan
- Working-tree HEAD SHA: a0c9906f248d79d0f297a6ba64f370885bef0235
- Diff command: `git diff --cached; git diff; inspect in-scope untracked files`
- At validation handoff, the implementation was uncommitted on the new branch. The starting redesign changes against main are outside this review.
- Preexisting untracked `tasks/cart-consistency-review/` is excluded and preserved.
- Changed scoped files:
  - `database/migrations/20261108000000_class_checkout_execution_recovery.sql`
  - `database/postgres17-schema.sql`
  - `docker/nginx.festival.conf`
  - `goals/class-checkout-recovery/goals.v0.md`
  - `nginx/festival.conf`
  - `package.json`
  - `packages/backend/scripts/reap-class-checkout-recovery.ts`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/checkout/class-checkout-execution.ts`
  - `packages/backend/src/checkout/class-checkout-recovery.ts`
  - `packages/backend/src/checkout/class-checkout-service.ts`
  - `packages/backend/src/checkout/in-memory-checkout-admission-lock.ts`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts`
  - `packages/backend/src/checkout/postgres-class-checkout-execution.ts`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts`
  - `packages/backend/src/commerce/membership-commerce-repository.ts`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/repo/postgres-schema.ts`
  - `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/customer/customer-registration.routes.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/tests/admin-class-checkout-recovery.test.ts`
  - `packages/backend/tests/class-checkout-execution.test.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/class-order-projection.test.ts`
  - `packages/backend/tests/customer-registration.routes.test.ts`
  - `packages/backend/tests/postgres-class-checkout-payment.integration.test.ts`
  - `packages/backend/tests/postgres-class-checkout-recovery.integration.test.ts`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts`
  - `packages/common/src/class-checkout-recovery.ts`
  - `packages/common/src/index.ts`
  - `packages/frontend/src/components/FestivalRegistrationCartView.tsx`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/pages/FestivalClassRegistrationPage.tsx`
  - `packages/frontend/src/pages/registrationCartState.ts`
  - `packages/frontend/src/pages/useFestivalRegistrationPage.ts`
  - `packages/frontend/tests/class-checkout-hook.test.ts`
  - `packages/frontend/tests/fixtures/class-checkout-hook.ts`
  - `packages/frontend/tests/registrationCartState.test.ts`
  - `tasks/class-checkout-recovery/code-review.md`
  - `tasks/class-checkout-recovery/implementation-plan.md`
  - `tasks/class-checkout-recovery/spec.md`
  - `tasks/class-checkout-recovery/validation/postgres-full-summary.json`
  - `tasks/class-checkout-recovery/validation/run-postgres.ts`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.93
- Justification: Independent bounded reviews and final expiry-aware validation found no remaining actionable regressions. Recovery results, evidence, and lease release commit atomically; stable payload-bound identity, fenced workers, explicit unknown-outcome resolution, original-expiry guards, owner/provider boundaries, and payment admission remain consistent with the locked goals.

## Review coverage
- Compared implementation changes to the registration redesign starting commit; excluded preexisting review notes and unrelated main-to-redesign changes.
- Traced pre-dispatch preparation, dispatch ambiguity, known-cart recovery, URL lookup, recorded recovery replay before OAuth access, and preservation of original application expiry.
- Inspected atomic evidence/outcome/lease release, claim generations, late evidence, alternate-key/session admission, operator resolution races, and payment finalization lock ordering. Expired unfulfilled known carts cannot be replaced without recorded recovery and audited abandonment, regardless of status lookup order.
- Checked customer-safe DTO projection, Festival-only idempotency headers, independent Shopify correlation IDs, admin tenant authorization, nginx route/method parity, and maintenance recovery paths.
- Verified actual frontend hook behavior for ambiguous network outcomes, frozen payload replay, blocked recovery, explicit audited-abandonment restart, and pagehide snapshot cleanup.

## Verification
- Final backend suite: 1,459 passed, 50 skipped, 0 failed across 128 files; 7,139 assertions. PostgreSQL-gated cases were separately exercised with no skips below.
- Final frontend suite: 414 passed, 0 failed, 2,335 assertions across 49 files.
- Common suite: 353 passed, 0 failed, 1,248 assertions across 22 files.
- Toolchain: Bun 1.4.2, TypeScript 5.9.3. Common/backend builds and frontend typecheck/build passed. SQL safety check passed across 276 source files; Biome passed all 35 changed package TypeScript files.
- Final portable full PostgreSQL validation sourced database.env: 61 passed, 0 failed, 0 skipped across all 17 gated files, including recovery, expiry/admission, and paid-order races. Eight fixture schema initializations and ten application transaction rollbacks were verified. Owned target cleanup was verified; configured application schema was unchanged.
- The initial full PostgreSQL run exposed an unchanged baseline array-binding failure. Its authorized one-expression sql.array correction and retained initial evidence are documented in the task spec.
- Final sanitized PostgreSQL evidence: committed validation/postgres-full-summary.json and local-only validation/postgres-full.log. Initial failure and diagnosis artifacts remain local and are excluded from the implementation commit. Portable command: bun --env-file=database.env tasks/class-checkout-recovery/validation/run-postgres.ts.
- Native PowerShell validation implements the original code-review-validate.sh JSON/status/verdict/confidence checks, plus base/branch context checks, without executing a forbidden Bash script.

## Operational limits
- Production migration and recurring maintenance scheduling are not performed by this change. The reaper CLI, authorized admin pass, and lazy request-triggered reaping are supplied.
- Shopify does not participate in a distributed transaction. Unknown creation remains recorded until verified evidence or explicit audited abandonment resolves it; no automatic second cart creation, orphan cancellation, or exactly-once upstream guarantee is promised.
- At validation handoff, no implementation commit, push, pull request, deployment, live Shopify mutation, or configured application schema migration had been performed. The user subsequently requested a local commit on the implementation branch; publication remains outside scope.
