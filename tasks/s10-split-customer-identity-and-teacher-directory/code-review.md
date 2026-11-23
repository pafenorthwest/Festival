# Code Review
- Task name: s10-split-customer-identity-and-teacher-directory

## Context
Independent review of Wave 3 packet S10 (`s10-split-customer-identity-and-teacher-directory`) against `goals/s10-split-customer-identity-and-teacher-directory/goals.v0.md`, `tasks/s10-split-customer-identity-and-teacher-directory/spec.md`, and `specs/bounded-contexts-2026.md`.

- **Scope lock**: Inspected `git status --short`, `git diff --stat origin/main`, and untracked files under `packages/backend/{src,tests}/`. Only S10-owned files were added, modified, or deleted: `packages/backend/src/infra/s10-infra.ts`, `packages/backend/src/domains/customer-identity/**`, `packages/backend/src/domains/teacher-directory/**`, legacy facades/helpers in `packages/backend/src/customer/{customer-account-repository,customer-account-service,customer-registration-legacy-helper,customer-registration-legacy-mappers,postgres-customer-account-repository}.ts` (with `postgres-customer-account-{mappers,queries}.ts` removed), `packages/backend/src/services/{participant-profile-service,accompanist-membership-service}.ts`, `packages/backend/src/commerce/membership-status-service.ts`, `packages/backend/src/shopify/public-membership-product-service.ts`, `packages/backend/tests/domains/{customer-identity,teacher-directory}/**`, six migrated test files (`accompanist-membership-service.test.ts`, `customer-account-repository.test.ts`, `membership-status-service.test.ts`, `product-repository.test.ts`, `profile-repository.test.ts`, `public-membership-product-service.test.ts`), and `tasks/s10-split-customer-identity-and-teacher-directory/spec.md`. Zero changes were made to `AGENTS.md`, `app.ts`, `repo/*`, `routes/*`, `packages/common/**`, `packages/frontend/**`, or S09/S11-owned files.
- **Bounded-context & modularity compliance**: TypeScript AST inspection across all 36 created/modified `src/**/*.ts` files confirmed zero files over 500 lines (max 490 lines in `customer-registration-legacy-helper.ts`, max 467 lines in `domains/customer-identity/customer-oauth-flow.ts`, max 434 lines in `domains/teacher-directory/membership-entitlement-queries.ts`), zero classes over 250 lines, zero functions/methods over 60 lines, zero `InMemory*` classes in `domains/`, `AppError` imported exclusively from `@festival/common`, and zero imports from unmerged `tenant-org` or `catalog-repertoire` contexts. `domains/teacher-directory/types.ts` imports types only from `../customer-identity/index.js`.
- **Functional & security invariants**: Verified Shopify Customer Account OAuth/PKCE, CSRF/origin/redirect-target validation, fail-closed session/token checks, staff consent gating and profile-access audit logging, `#361` active-membership opt-in and admin hide/reinstate toggles, parameterized SQL queries, ISO-8601 `to_char` CTE projection in `PostgresChildProfileRepository.createChildWithAgeSnapshot`, `S10DomainEvent` emission (`CustomerIntegrationRotated`, `ChildUpdated`, `TeacherDirectoryChanged`, `MembershipChanged`), and zero `InMemory*` references in migrated/new S10 tests.
- **Observed verification results**:
  - `bun run verify:toolchain`: passed (Bun 1.4.2, TypeScript 5.9.3).
  - `bun run format:check`: passed (`Checked 603 files in 523ms. No fixes applied.`).
  - `bun run lint`: passed (`Checked 603 files in 414ms. No fixes applied.`).
  - `bun run check:sql`: passed (`Validated 324 backend TypeScript files.`).
  - `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: passed (exit 0).
  - `bun test packages/backend/tests/architecture-boundaries.test.ts`: passed (6 pass, 0 fail, 9 expect() calls).
  - S10 domain & migrated suite with Postgres 17 (`POSTGRES_INTEGRATION_URL` set, `DATABASE_URL` unset, 10 files): passed (110 pass, 0 fail, 482 expect() calls).
  - Customer, profile, directory, and Postgres 17 integration suite (19 files): passed (221 pass, 0 fail, 1377 expect() calls).

- Findings status: none

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: high
- Justification: All S10 bounded-context extractions (`customer-identity` and `teacher-directory`), thin legacy facades, modular size limits, security/consent/SQL invariants, architecture boundary checks, and Postgres 17 integration suites passed with zero out-of-scope edits and zero findings.
