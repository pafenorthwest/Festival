# Code Review
- Task name: issue-77-direct-teacher-membership-checkout
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `.codex/scripts/gh-auth-check.sh`
  - `goals/issue-77-direct-teacher-membership-checkout/establish-goals.v0.md`
  - `goals/issue-77-direct-teacher-membership-checkout/establish-goals.v1.md`
  - `goals/issue-77-direct-teacher-membership-checkout/establish-goals.v2.md`
  - `goals/issue-77-direct-teacher-membership-checkout/goals.v0.md`
  - `goals/issue-77-direct-teacher-membership-checkout/goals.v1.md`
  - `goals/issue-77-direct-teacher-membership-checkout/goals.v2.md`
  - `goals/task-manifest.csv`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/checkout/membership-checkout-service.ts`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts`
  - `packages/backend/src/checkout/shopify-membership-checkout-client.ts`
  - `packages/backend/src/customer/customer-account-service.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/src/security/request-security.ts`
  - `packages/backend/tests/checkout-repository.test.ts`
  - `packages/backend/tests/membership-checkout-service.test.ts`
  - `packages/backend/tests/shopify-membership-checkout-client.test.ts`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/pages/CustomerAccountPage.tsx`
  - `packages/frontend/src/pages/MembershipPage.tsx`
  - `packages/frontend/tests/onboarding-integration.test.ts`
  - `tasks/issue-77-direct-teacher-membership-checkout/spec.md`
  - `token`
- Citation candidates (verify before use):
  - `.codex/scripts/gh-auth-check.sh:103-103`
  - `goals/task-manifest.csv:19-19`
  - `packages/backend/src/app.ts:164-180`
  - `packages/backend/src/app.ts:210-210`
  - `packages/backend/src/app.ts:47-48`
  - `packages/backend/src/app.ts:5-11`
  - `packages/backend/src/customer/customer-account-service.ts:871-908`
  - `packages/backend/src/routes/api-router.ts:141-141`
  - `packages/backend/src/routes/api-router.ts:21-21`
  - `packages/backend/src/routes/api-router.ts:759-800`
  - `packages/backend/src/routes/route-security.ts:64-68`
  - `packages/backend/src/security/request-security.ts:44-45`
  - `packages/backend/src/security/request-security.ts:51-52`
  - `packages/frontend/src/lib/api.ts:251-267`
  - `packages/frontend/src/pages/CustomerAccountPage.tsx:49-56`
  - `packages/frontend/src/pages/MembershipPage.tsx:45-49`
  - `packages/frontend/src/pages/MembershipPage.tsx:62-69`
  - `packages/frontend/src/pages/MembershipPage.tsx:89-93`
  - `packages/frontend/src/pages/MembershipPage.tsx:9-9`
  - `packages/frontend/tests/onboarding-integration.test.ts:379-379`
  - `packages/frontend/tests/onboarding-integration.test.ts:391-392`
  - `packages/frontend/tests/onboarding-integration.test.ts:394-394`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.86
- Justification: The checkout BFF derives organization, customer, session, integration version, and buyer token server-side; Shopify receives only the opaque correlation attribute. The Storefront client uses the existing DNS-pinned transport and the returned checkout URL must be HTTPS on the persisted tenant store domain. No actionable regression was identified.

## Final v4 review

- Diff reviewed: `35a0b5afcb9459b8cb74864654d551e66c1b1eb7..HEAD` plus the current v4 working-tree changes.
- Findings JSON: `[]`
- Verdict: patch is correct
- Confidence: 0.88
- Justification: The v4 outcome state is persisted under a scoped idempotency key, local PostgreSQL serialization ends before Shopify I/O, `checkout_started` is written before the external checkout-URL query, and any later failure is durably replayed as a safe terminal outcome. Frontend behavior receives only bounded error codes and no cart or credential data.
