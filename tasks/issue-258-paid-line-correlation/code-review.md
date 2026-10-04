# Code Review
- Task name: issue-258-paid-line-correlation
- Findings status: complete

## Context
- Base branch: origin/main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `database/migrations/20261004_issue_258_paid_line_identity.sql`
  - `database/postgres17-schema.sql`
  - `packages/backend/src/checkout/checkout-line-helpers.ts`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/checkout/class-checkout-service.ts`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts`
  - `packages/backend/src/commerce/membership-commerce-repository.ts`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/class-order-projection.test.ts`
  - `packages/backend/tests/membership-commerce-repository.test.ts`
  - `packages/backend/tests/postgres-commerce-repository.test.ts`
  - `packages/backend/tests/postgres-schema-snapshot.test.ts`
  - `packages/backend/tests/postgres-schema.test.ts`
  - `packages/backend/tests/registration-change-repository.test.ts`
  - `packages/backend/tests/shopify-admin-api-client.test.ts`
  - `packages/common/tests/registration-drop-transfer.test.ts`
  - `tasks/issue-258-paid-line-correlation/code-review.md`
  - `tasks/issue-258-paid-line-correlation/spec.md`
- Citation candidates (verify before use):
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:11-23`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:27-29`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:31-33`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:36-47`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:52-54`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:56-58`
  - `database/migrations/20261004_issue_258_paid_line_identity.sql:7-9`
  - `database/postgres17-schema.sql:1083-1106`
  - `database/postgres17-schema.sql:109-109`
  - `database/postgres17-schema.sql:111-114`
  - `database/postgres17-schema.sql:117-117`
  - `database/postgres17-schema.sql:123-123`
  - `database/postgres17-schema.sql:128-128`
  - `database/postgres17-schema.sql:155-223`
  - `database/postgres17-schema.sql:1730-1848`
  - `database/postgres17-schema.sql:2484-2603`
  - `packages/backend/src/checkout/checkout-line-helpers.ts:23-32`
  - `packages/backend/src/checkout/checkout-line-helpers.ts:39-39`
  - `packages/backend/src/checkout/checkout-line-helpers.ts:41-41`
  - `packages/backend/src/checkout/checkout-line-helpers.ts:64-78`
  - `packages/backend/src/checkout/checkout-repository.ts:45-45`
  - `packages/backend/src/checkout/class-checkout-service.ts:16-20`
  - `packages/backend/src/checkout/class-checkout-service.ts:22-22`
  - `packages/backend/src/checkout/class-checkout-service.ts:24-24`
  - `packages/backend/src/checkout/class-checkout-service.ts:29-29`
  - `packages/backend/src/checkout/class-checkout-service.ts:541-541`
  - `packages/backend/src/checkout/class-checkout-service.ts:623-631`
  - `packages/backend/src/checkout/class-checkout-service.ts:634-634`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts:18-21`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts:9-9`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:43-73`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:662-663`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:666-674`
  - `packages/backend/src/commerce/membership-commerce-repository.ts:898-901`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:144-174`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:449-467`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:699-699`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:703-703`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:721-737`
  - `packages/backend/src/commerce/postgres-membership-commerce-repository.ts:740-764`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:16-16`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:213-213`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:696-700`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:773-789`
  - `packages/backend/src/commerce/shopify-order-projection-service.ts:8-11`
  - `packages/backend/tests/class-checkout-service.test.ts:1138-1144`
  - `packages/backend/tests/class-checkout-service.test.ts:1149-1149`
  - `packages/backend/tests/class-checkout-service.test.ts:1196-1213`
  - `packages/backend/tests/class-checkout-service.test.ts:1218-1218`
  - `packages/backend/tests/class-checkout-service.test.ts:1220-1220`
  - `packages/backend/tests/class-checkout-service.test.ts:16-16`
  - `packages/backend/tests/class-checkout-service.test.ts:22-22`
  - `packages/backend/tests/class-checkout-service.test.ts:9-14`
  - `packages/backend/tests/class-order-projection.test.ts:1000-1000`
  - `packages/backend/tests/class-order-projection.test.ts:1008-1152`
  - `packages/backend/tests/class-order-projection.test.ts:276-281`
  - `packages/backend/tests/class-order-projection.test.ts:389-418`
  - `packages/backend/tests/class-order-projection.test.ts:686-686`
  - `packages/backend/tests/class-order-projection.test.ts:779-779`
  - `packages/backend/tests/class-order-projection.test.ts:827-827`
  - `packages/backend/tests/class-order-projection.test.ts:833-833`
  - `packages/backend/tests/class-order-projection.test.ts:937-937`
  - `packages/backend/tests/class-order-projection.test.ts:951-951`
  - `packages/backend/tests/class-order-projection.test.ts:988-988`
  - `packages/backend/tests/membership-commerce-repository.test.ts:151-180`
  - `packages/backend/tests/postgres-commerce-repository.test.ts:147-197`
  - `packages/backend/tests/postgres-commerce-repository.test.ts:23-23`
  - `packages/backend/tests/postgres-commerce-repository.test.ts:40-41`
  - `packages/backend/tests/postgres-schema-snapshot.test.ts:10-20`
  - `packages/backend/tests/postgres-schema.test.ts:1-1`
  - `packages/backend/tests/postgres-schema.test.ts:3-3`
  - `packages/backend/tests/postgres-schema.test.ts:52-52`
  - `packages/backend/tests/postgres-schema.test.ts:78-81`
  - `packages/backend/tests/postgres-schema.test.ts:89-89`
  - `packages/backend/tests/registration-change-repository.test.ts:154-154`
  - `packages/backend/tests/shopify-admin-api-client.test.ts:1123-1125`
  - `packages/common/tests/registration-drop-transfer.test.ts:14-14`
  - `packages/common/tests/registration-drop-transfer.test.ts:6-6`
  - `tasks/issue-258-paid-line-correlation/spec.md:37-46`
  - `tasks/issue-258-paid-line-correlation/spec.md:57-64`

## Findings JSON
```json
[
  {
    "file": "packages/backend/src/registration/drop-transfer-service.ts",
    "line_range": "99-115",
    "severity": "medium",
    "explanation": "The newly introduced automatic-provider contract has no refund-event identifier or idempotency-key field, and its result has only an opaque ID. A future line-targeted provider using this contract cannot derive the required event-based idempotency key or have its order line/allocation response verified by this caller. Either keep automatic providers out of this interface until separately authorized, or extend the request/result contract and test the required idempotency and response validation."
  }
]
```

## Verdict
- Verdict: patch is incorrect
- Confidence: 0.96
- Justification: The exact UUID writer, Admin reads, order-independent bijection, historical gate, per-line allocation, schema constraints, and processing-only browser path are implemented and the focused tests pass. Paid-line conflicts now record the bounded `persistence` / `paid_line_conflict` diagnostic and remain reclaimable. PostgreSQL coverage now injects a second-line failure, verifies the complete rollback and persisted delivery diagnostic, retries, and races two replays against the configured local PostgreSQL instance. The new automatic-provider interface still cannot enforce the specified future-provider safeguards, and the production migration is only statically inspected locally.
