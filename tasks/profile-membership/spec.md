# Profile creation membership prerequisite

Locked goals: `goals/profile-membership/goals.v1.md` and `goals/profile-membership/goals.v2.md`.

Scope: service creation authorization and focused regression tests; existing profile updates preserve opt-out access.

Base: `origin/feat/285-profiles-management` at `0b8b09da781db6048676a3b0834a8980264a808c`.
Head: `ericp/membership-requires-consent`.
Dirty-worktree decision: preserve and exclude pre-existing untracked `database.env`; stage explicit task paths only.

Pinned validation (PowerShell, stop on nonzero exit):
- Lint: `bunx biome check packages/backend/src/services/participant-profile-service.ts packages/backend/tests/participant-profile-membership.test.ts packages/backend/tests/participant-profile-test-harness.ts packages/backend/tests/participant-profile-routes-security.test.ts packages/backend/tests/participant-profile-routes.test.ts`
- Build: `bun run build:common`, then `bun run build:backend`.
- Tests: `bun test ./packages/common/tests/profile.test.ts ./packages/backend/tests/profile-repository.test.ts ./packages/backend/tests/participant-profile-membership.test.ts ./packages/backend/tests/participant-profile-routes.test.ts ./packages/backend/tests/participant-profile-routes-security.test.ts ./packages/backend/tests/postgres-schema-snapshot.test.ts`.

Workflow exception: bundled lifecycle helpers are Bash scripts without PowerShell equivalents. Follow repository PowerShell-only execution rules using native commands and equivalent explicit checks/artifacts.

Follow-up: require affirmative sharing consent during accompanist enrollment, persist the existing versioned consent using session-derived ownership before grant creation, and add the required frontend checkbox. Existing grants are not retroactively assigned consent.

Delivered: creation returns 403 `active_membership_required` without active matching-role membership. Existing profile reads, updates, and opt-out remain available after expiry/revocation. Route fixtures now seed memberships and the redundant directory-test grant setup is removed.

Validation: pinned 5-file Biome check passed without fixes; common and backend TypeScript builds passed; all 109 targeted tests passed (507 assertions, 6 files). `git diff --check` passed. Independent review found no remaining actionable findings (patch is correct, confidence 0.98).

Follow-up delivered and READY TO LAND. PR base intentionally differs from main per user's follow-up.

## Accompanist consent follow-up validation

Pinned commands (PowerShell, stop on nonzero exit):
- Backend lint: `bunx biome check packages/backend/src/customer/customer-account-service.ts packages/backend/src/routes/customer/customer-membership.routes.ts packages/backend/src/services/accompanist-membership-service.ts packages/backend/tests/accompanist-membership-service.test.ts packages/backend/tests/customer-membership.routes.test.ts packages/backend/tests/shopify-order-projection.test.ts`.
- Frontend lint: `bunx biome check packages/frontend/src/lib/api.ts packages/frontend/src/pages/AccompanistMembershipPage.tsx packages/frontend/tests/accompanist-membership.test.ts`; `bun run --cwd packages/frontend lint`.
- Builds: `bun run build:common`; `bun run build:backend`; `bun run build:frontend`.
- Backend tests: `bun test ./packages/backend/tests/accompanist-membership-service.test.ts ./packages/backend/tests/customer-membership.routes.test.ts ./packages/backend/tests/shopify-order-projection.test.ts ./packages/backend/tests/customer-account-service.test.ts ./packages/backend/tests/customer-account-repository.test.ts ./packages/backend/tests/staff-routes.test.ts ./packages/backend/tests/participant-profile-membership.test.ts ./packages/backend/tests/participant-profile-routes.test.ts ./packages/backend/tests/participant-profile-routes-security.test.ts`.
- Focused frontend test: `bun test ./packages/frontend/tests/accompanist-membership.test.ts`.
- Broader frontend comparison: `bun run --cwd packages/frontend test`, also run at pre-follow-up commit `3c9653e` to classify existing failures.
- Diff whitespace: `git diff --check`.

Delivered behavior: unchecked required consent checkbox, strict boolean acquisition contract, and versioned consent saved through the existing recorder with authenticated customer/organization before membership issuance. Recording failure prevents acquisition. Existing consent is not fabricated for older grants.

Follow-up verification: all 148 tests in the nine pinned backend files pass (564 assertions); common/backend builds and six-file backend Biome pass. Focused frontend tests pass (8 tests, 36 assertions); frontend typecheck, production build, three-file Biome, and whitespace checks pass. Independent review: no actionable findings, patch is correct, confidence 0.97.

Canonical full frontend suite passes all 330 tests in 33 files using `bun run --cwd packages/frontend test`; pre-change commit `3c9653e` passes 328. An initial invocation from repository root produced working-directory/JSX configuration errors that also reproduced on the baseline; using the package's intended test command resolves them. No outstanding failed validation or deferred implementation.
