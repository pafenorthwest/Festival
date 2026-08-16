# Code Review
- Task name: organization-divisions-timezone-api
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `goals/organization-divisions-timezone-api/establish-goals.v0.md`
  - `goals/organization-divisions-timezone-api/establish-goals.v1.md`
  - `goals/organization-divisions-timezone-api/goals.v0.md`
  - `goals/organization-divisions-timezone-api/goals.v1.md`
  - `goals/task-manifest.csv`
  - `packages/backend/src/repo/in-memory-organization-repository.ts`
  - `packages/backend/src/repo/organization-repository.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/src/services/organization-service.ts`
  - `packages/backend/tests/organization-configuration.test.ts`
  - `packages/common/src/organization.ts`
  - `packages/common/tests/organization.test.ts`
  - `tasks/festival-customer-identity-account-foundation/skill-friction-retrospective.md`
  - `tasks/organization-divisions-timezone-api/code-review.md`
  - `tasks/organization-divisions-timezone-api/spec.md`
- Citation candidates (verify before use):
  - `goals/task-manifest.csv:12-12`
  - `packages/backend/src/repo/in-memory-organization-repository.ts:184-184`
  - `packages/backend/src/repo/in-memory-organization-repository.ts:197-321`
  - `packages/backend/src/repo/in-memory-organization-repository.ts:49-52`
  - `packages/backend/src/repo/in-memory-organization-repository.ts:7-7`
  - `packages/backend/src/repo/organization-repository.ts:149-173`
  - `packages/backend/src/repo/organization-repository.ts:7-7`
  - `packages/backend/src/repo/postgres-organization-repository.ts:1021-1022`
  - `packages/backend/src/repo/postgres-organization-repository.ts:155-155`
  - `packages/backend/src/repo/postgres-organization-repository.ts:161-172`
  - `packages/backend/src/repo/postgres-organization-repository.ts:174-174`
  - `packages/backend/src/repo/postgres-organization-repository.ts:272-272`
  - `packages/backend/src/repo/postgres-organization-repository.ts:294-294`
  - `packages/backend/src/repo/postgres-organization-repository.ts:321-321`
  - `packages/backend/src/repo/postgres-organization-repository.ts:325-335`
  - `packages/backend/src/repo/postgres-organization-repository.ts:428-436`
  - `packages/backend/src/repo/postgres-organization-repository.ts:45-45`
  - `packages/backend/src/repo/postgres-organization-repository.ts:60-60`
  - `packages/backend/src/repo/postgres-organization-repository.ts:632-633`
  - `packages/backend/src/repo/postgres-organization-repository.ts:662-663`
  - `packages/backend/src/repo/postgres-organization-repository.ts:682-682`
  - `packages/backend/src/repo/postgres-organization-repository.ts:691-691`
  - `packages/backend/src/repo/postgres-organization-repository.ts:704-704`
  - `packages/backend/src/repo/postgres-organization-repository.ts:713-713`
  - `packages/backend/src/repo/postgres-organization-repository.ts:729-729`
  - `packages/backend/src/repo/postgres-organization-repository.ts:73-82`
  - `packages/backend/src/repo/postgres-organization-repository.ts:735-735`
  - `packages/backend/src/repo/postgres-organization-repository.ts:742-900`
  - `packages/backend/src/repo/postgres-organization-repository.ts:8-8`
  - `packages/backend/src/routes/api-router.ts:355-496`
  - `packages/backend/src/routes/api-router.ts:56-73`
  - `packages/backend/src/routes/route-security.ts:132-166`
  - `packages/backend/src/services/organization-service.ts:10-10`
  - `packages/backend/src/services/organization-service.ts:15-15`
  - `packages/backend/src/services/organization-service.ts:192-381`
  - `packages/backend/src/services/organization-service.ts:20-20`
  - `packages/backend/src/services/organization-service.ts:22-22`
  - `packages/backend/src/services/organization-service.ts:29-29`
  - `packages/backend/src/services/organization-service.ts:32-34`
  - `packages/common/src/organization.ts:21-21`
  - `packages/common/src/organization.ts:25-100`
  - `packages/common/tests/organization.test.ts:4-6`
  - `packages/common/tests/organization.test.ts:60-66`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: The API and persistence changes satisfy the locked tenant, normalization, ordering, activation, timezone, and DTO requirements. Per-Organization transactional advisory locking now serializes PostgreSQL create and reorder operations, the in-memory implementation assigns order synchronously, and focused concurrency coverage plus the full pinned suite pass. The unrelated pre-existing retrospective listed in context is excluded from this patch.
