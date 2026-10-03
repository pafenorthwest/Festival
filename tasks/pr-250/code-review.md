# Code Review
- Task name: pr-250
- Findings status: complete

## Context
- Base branch: origin/main
- Current branch: codex/fix-pr-250-multiline-followups
- Merge-base: dc173518b1fc5ba1f403b43343379136cffd9fcb
- Review baseline: current branch and working tree compared to that merge-base; the generated changed-files list below is the current working-tree supplement.
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `goals/pr-250/establish-goals.v0.md`
  - `goals/pr-250/goals.v0.md`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/commerce/membership-commerce-repository.ts`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts`
  - `packages/backend/src/repo/postgres-schema.ts`
  - `packages/backend/tests/membership-commerce-repository.test.ts`
  - `packages/backend/tests/postgres-schema.integration.test.ts`
  - `packages/backend/tests/shopify-order-projection-service.test.ts`
  - `packages/frontend/src/pages/cascadingRemoval.ts`
  - `packages/frontend/src/pages/registrationCartState.ts`
  - `packages/frontend/tests/cascadingRemoval.test.ts`
  - `review-feat-issue-35-drop-and-transfer-vs-origin-main.md`
  - `shopify.app.toml`
  - `specs/multi-line-purchase-entitlement-review-prompt.md`
  - `tasks/pr-250/code-review.md`
  - `tasks/pr-250/spec.md`
- Citation candidates (verify before use):
  - `packages/backend/src/checkout/checkout-repository.ts:430-466`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:19-42`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:194-194`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:199-199`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:258-258`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:436-436`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:445-445`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:455-602`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:614-614`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:616-626`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:630-632`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:634-641`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:646-650`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:717-717`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:719-719`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:724-724`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:735-744`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:746-746`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:748-748`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:753-753`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:781-782`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:327-327`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:330-337`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:339-339`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:344-344`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:360-361`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:363-363`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:365-365`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:367-367`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:369-369`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:371-373`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:380-380`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:417-419`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:421-428`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:435-439`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:471-471`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:652-653`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:678-681`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:747-751`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:669-678`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:688-688`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:690-695`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:937-939`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:958-958`
  - `packages/backend/src/repo/postgres-schema.ts:788-797`
  - `packages/backend/src/repo/postgres-schema.ts:804-804`
  - `packages/backend/tests/membership-commerce-repository.test.ts:150-248`
  - `packages/backend/tests/membership-commerce-repository.test.ts:2-2`
  - `packages/backend/tests/postgres-schema.integration.test.ts:66-149`
  - `packages/backend/tests/shopify-order-projection-service.test.ts:315-321`
  - `packages/backend/tests/shopify-order-projection-service.test.ts:324-325`
  - `packages/frontend/src/pages/cascadingRemoval.ts:109-112`
  - `packages/frontend/src/pages/cascadingRemoval.ts:120-120`
  - `packages/frontend/src/pages/cascadingRemoval.ts:17-22`
  - `packages/frontend/src/pages/cascadingRemoval.ts:57-57`
  - `packages/frontend/src/pages/cascadingRemoval.ts:60-93`
  - `packages/frontend/src/pages/registrationCartState.ts:19-20`
  - `packages/frontend/src/pages/registrationCartState.ts:65-66`
  - `packages/frontend/src/pages/registrationCartState.ts:82-83`
  - `packages/frontend/tests/cascadingRemoval.test.ts:411-507`
  - `packages/frontend/tests/cascadingRemoval.test.ts:43-44`

## Findings JSON
```json
[
  {
    "file": "packages/backend/src/commerce/shopify-order-projection-service.ts",
    "line_range": "850-879",
    "severity": "high",
    "explanation": "Multi-line validation and finalization correlate each intent line to order.lineItems[i]. ClassCheckoutService emits festival_checkout_intent_line_id on each cart line (class-checkout-service.ts:532-544), but ShopifyPaidOrderLine and the Admin order query never retrieve it (shopify/types.ts:140-147; shopify/admin-api-client.ts:1182-1207). Shopify reordering or duplicate product/variant lines therefore has no verified bijective identity mapping and can reject or assign an entitlement/metadata to the wrong child or class."
  },
  {
    "file": "packages/backend/src/commerce/shopify-order-projection-service.ts",
    "line_range": "164-179",
    "severity": "high",
    "explanation": "validateMultiLinePayment verifies only the sum of all order-line paid amounts. validateMultiLineClassPurchase never compares a mapped intentLine.amount with its order line, yet finalization persists that line amount on each entitlement (658-692). A $50+$40 intent with $0+$90 Shopify allocations is approved and creates two confirmed registrations with invalid per-line payment facts."
  },
  {
    "file": "packages/common/src/purchase-eligibility.ts",
    "line_range": "277-288",
    "severity": "high",
    "explanation": "Capacity only counts previously created entitlements and earlier items in the current request. Because checkout performs that check before creating the Shopify cart (class-checkout-service.ts:148-215), while production intent locking is customer-scoped (postgres-checkout-repository.ts:56-67) and paid-order finalization inserts confirmed entries without a class-capacity recheck (postgres-membership-commerce-repository.ts:652-700), two customers can each buy the final seat."
  },
  {
    "file": "packages/backend/src/checkout/checkout-recovery-helpers.ts",
    "line_range": "239-340",
    "severity": "high",
    "explanation": "Recovery accepts class-entry source intents but recreates only legacy/generic intent fields and one Shopify variant. It omits festivalClassId, childId, all checkout-intent lines, per-line metadata, and cart-line correlations. The recovered class_entry intent subsequently fails single-line projection validation (shopify-order-projection-service.ts:801-847), after the source has been marked failed and the recovery token consumed (checkout-recovery-service.ts:421-463)."
  },
  {
    "file": "packages/backend/src/billing/billing-repository.ts",
    "line_range": "386-418",
    "severity": "medium",
    "explanation": "Billing compares each class entitlement's paidAmountCents against checkout_intents.amount, which is now the aggregate cart total. A normal $50+$40 multi-line purchase creates two entitlements that each appear partially paid against $90. The production SQL repeats the same defect in postgres-billing-repository.ts:377-413; it must compare the entitlement to its checkout_intent_line amount."
  }
]
```

## Verdict
- Verdict: patch is incorrect
- Confidence: 0.99
- Justification: The multi-line implementation has verified integrity, payment, capacity, recovery, and billing regressions. The graph is recorded in specs/multi-line-purchase-entitlement-graph.md. Focused multi-line suites pass, but they do not cover reordered line identity, shifted per-line prices, competing last-seat purchases, class-entry recovery, or per-line billing reconciliation.
