# Code Review
- Task name: verified-paid-order-147
- Findings status: none

## Context
- Base: HEAD plus current staged/unstaged changes and in-scope untracked code/migration files.
- Diff command: `git diff HEAD; inspect listed untracked files`
- Changed files:
  - `database/migrations/20261023010000_registration_selection_snapshot.sql`
  - `database/migrations/20261023020000_unknown_registration_instrument.sql`
  - `packages/backend/src/checkout/checkout-repository.ts`
  - `packages/backend/src/checkout/class-checkout-service.ts`
  - `packages/backend/src/checkout/postgres-checkout-helpers.ts`
  - `packages/backend/src/checkout/postgres-checkout-repository.ts`
  - `packages/backend/src/repo/postgres-schema.ts`
  - `packages/backend/src/routes/customer/customer-registration.routes.ts`
  - `packages/backend/src/services/organization-service.ts`
  - `packages/backend/tests/class-checkout-service.test.ts`
  - `packages/backend/tests/class-order-projection.test.ts`
  - `packages/backend/tests/customer-registration.routes.test.ts`
  - `packages/backend/tests/org-info-routes.test.ts`
  - `packages/backend/tests/organization-configuration.test.ts`
  - `packages/backend/tests/postgres-registration-snapshot.integration.test.ts`
  - `packages/backend/tests/registration-snapshot-normalization.test.ts`
  - `packages/common/src/organization.ts`
  - `packages/common/src/purchase-eligibility.ts`
  - `packages/common/src/registration.ts`
  - `packages/frontend/src/components/FestivalRegistrationCartCard.tsx`
  - `packages/frontend/src/components/FestivalRegistrationCartView.tsx`
  - `packages/frontend/src/components/FestivalRegistrationPerformanceOptions.tsx`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/pages/FestivalClassRegistrationPage.tsx`
  - `packages/frontend/src/pages/festivalRegistrationHelpers.ts`
  - `packages/frontend/src/pages/registrationCartState.ts`
  - `packages/frontend/tests/festival-class-registration.test.ts`
  - `packages/frontend/tests/registrationCartState.test.ts`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.95
- Justification: Reviewed the frozen v2 follow-up against the previously reviewed snapshot implementation. The strict unknown sentinel is confined to stored/emitted instrument snapshots; catalog input validation, known historical selections, and wholly absent legacy snapshots remain intact. New snapshot writes bind JSON objects directly, and the bounded migration safely recovers valid encoded objects before normalizing null/missing instrument fields. No actionable introduced regression found.

## Verified evidence and scope

- New unselected captures use literal `"unknown"` at `packages/backend/src/checkout/class-checkout-service.ts:666`; supplied instrument IDs still pass the existing active tenant catalog validation at lines 667-693. `class-checkout-service.test.ts:459` explicitly rejects `instrumentId: "unknown"`.
- `packages/common/src/registration.ts:86` declares `{ id, name } | "unknown"`; normalization at lines 97-103 changes only a null/missing instrument on an existing snapshot. It preserves known ID/name objects and keeps a wholly absent historical snapshot null.
- Every metadata emitter covers legacy instruments: in-memory insertion at `checkout-repository.ts:458`, reads at line 534, updates at line 567; PostgreSQL mapping at `postgres-checkout-helpers.ts:224`. In-memory returned values remain deep cloned; current registration edits do not replace original snapshot fields.
- PostgreSQL insertion binds the snapshot object at `postgres-checkout-repository.ts:421`, avoiding Bun JSONB string double encoding. The raw database read in `postgres-registration-snapshot.integration.test.ts:134` checks the stored object directly rather than relying on mapper decoding. Repertoire storage is unchanged.
- `database/migrations/20261023020000_unknown_registration_instrument.sql:5` decodes only representable JSON objects stored as strings. Its second update at line 16 changes only missing/JSON-null instrument fields on JSON objects. The repeated migration test at `postgres-registration-snapshot.integration.test.ts:207` preserves known and partial-known objects, whole SQL-null history, invalid strings, encoded scalars/arrays, and raw scalars.
- Reviewer verification: `bun test packages/backend/tests/registration-snapshot-normalization.test.ts` passed 10 tests/28 assertions; `git diff --check` passed. Frozen v2 final verification supplied by the independent verifier: lint/format 409 files, SQL checker 218 backend TypeScript files, build passed, root suite 1803 passed/21 skipped/zero failures, and fresh PostgreSQL 17 snapshot/schema integration 5 passed/35 assertions. Reviewer inspected the final PostgreSQL log. Current logs: `/private/tmp/verified-paid-order-147-v2-validation/`.
- Preparation and validation use the task's PowerShell `review.ps1` equivalent to the code-review skill's shell workflow. No production, test, git, goals or spec edits were made during this final review.
