# Code Review
- Task name: align-shopify-discovery-url
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `goals/align-shopify-discovery-url/establish-goals.v0.md`
  - `goals/align-shopify-discovery-url/goals.v0.md`
  - `goals/task-manifest.csv`
  - `packages/backend/src/customer/customer-account-service.ts`
  - `packages/backend/tests/customer-account-service.test.ts`
  - `tasks/align-shopify-discovery-url/code-review.md`
  - `tasks/align-shopify-discovery-url/spec.md`
- Citation candidates (verify before use):
  - `goals/task-manifest.csv:46-47`
  - `packages/backend/src/customer/customer-account-service.ts:393-393`
  - `packages/backend/src/customer/customer-account-service.ts:405-405`
  - `packages/backend/src/customer/customer-account-service.ts:407-411`
  - `packages/backend/src/customer/customer-account-service.ts:414-415`
  - `packages/backend/src/customer/customer-account-service.ts:64-65`
  - `packages/backend/tests/customer-account-service.test.ts:123-124`
  - `packages/backend/tests/customer-account-service.test.ts:140-140`
  - `packages/backend/tests/customer-account-service.test.ts:161-161`
  - `packages/backend/tests/customer-account-service.test.ts:269-271`
  - `packages/backend/tests/customer-account-service.test.ts:275-275`
  - `packages/backend/tests/customer-account-service.test.ts:443-501`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.97
- Justification: The final diff remains confined to the Customer Account discovery normalization, focused regression coverage, and task workflow artifacts. The discovery URL undergoes the existing explicit-port and destination validation before it must match the exact Customer Account GraphQL path without a query or fragment; only its version segment is changed to Festival's `2026-07` pin before caching. Both callback identity lookup and orders consume that cached API URL. Tests cover the existing pin, the live shop-ID/account newer-version form, outbound pinned URLs, and malformed/pre-pin rejection. The delivery update in the spec accurately records those checks and makes no production change. No actionable findings found.

## Review evidence
- `code-review-validate.sh align-shopify-discovery-url prepare main`: passed (`REVIEW READY`).
- Inspected the full final diff against `main`, including untracked goals and task artifacts; confirmed the delivery/quality-gate spec update is documentation-only and accurate to the reviewed patch.
- `git diff --check main`: passed.
