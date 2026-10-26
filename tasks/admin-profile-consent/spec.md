# Admin profile contact consent and audit

Locked goals: `goals/admin-profile-consent/goals.v1.md`.

Authorization: The user explicitly approved the proposed Admin response consent and audit fix, regression tests, a new branch, and a PR into `feat/97-public-directory`. Goal locking records that approval rather than requesting it again.

Base: `feat/97-public-directory` at `356a721d6695978f95ee3a24606b5c7d70d15be0`.
Head: `codex/admin-profile-consent`.
PR target: explicitly `feat/97-public-directory`, overriding stale default-base configuration.
Dirty-worktree decision: preserve and exclude the pre-existing untracked `tasks/review-pr-307/` artifacts; stage only task-owned paths.

## Scope and behavior

The Teacher and Accompanist Admin list endpoints and their two approval-update endpoints currently return protected profile records directly. Project private contacts into those responses only when the existing Customer Account repository confirms current-version staff-access consent for the same organization and customer. Reuse the existing privacy-notice version and audit recorder; await the audit using the authenticated actor UID before allowing contact disclosure. Audit failures fail closed.

When consent is missing or stale, retain profile identity, divisions, display/moderation fields, and approval operations while omitting `phone`, `email`, and `zip_code`. Preserve customer-own profile access and the allowlisted public directory responses. Preserve the existing Admin customer-profile method's 404 behavior when consent is unavailable.

Production write scope is exactly:

- `packages/backend/src/customer/customer-account-service.ts`
- `packages/backend/src/services/participant-profile-service.ts`
- `packages/backend/src/routes/participant-profile/participant-profile.routes.ts`

Regression write scope is:

- `packages/backend/tests/customer-account-service.test.ts`
- `packages/backend/tests/participant-profile-test-harness.ts`
- `packages/backend/tests/participant-profile-admin-consent.test.ts` (new)

No schema, migration, consent-capture, membership, or public-directory change is included.

## Pinned validation

Run terminal commands in native PowerShell and stop after any nonzero exit. Do not execute `.sh` lifecycle helpers. Use equivalent PowerShell preflight, explicit scope inspection, goal checks, review artifact validation, and Git checks.

1. Explicit-file formatting/lint check:

   `bun x biome check packages/backend/src/customer/customer-account-service.ts packages/backend/src/services/participant-profile-service.ts packages/backend/src/routes/participant-profile/participant-profile.routes.ts packages/backend/tests/customer-account-service.test.ts packages/backend/tests/participant-profile-test-harness.ts packages/backend/tests/participant-profile-admin-consent.test.ts`

2. Build common, then backend:

   `bun run build:common`

   `bun run build:backend`

3. Focused consent/profile/customer-account regressions:

   `bun test ./packages/backend/tests/participant-profile-admin-consent.test.ts ./packages/backend/tests/customer-account-service.test.ts ./packages/backend/tests/customer-account-repository.test.ts ./packages/backend/tests/customer-account-routes.test.ts ./packages/backend/tests/participant-profile-routes.test.ts ./packages/backend/tests/participant-profile-routes-security.test.ts ./packages/backend/tests/participant-profile-membership.test.ts ./packages/backend/tests/profile-repository.test.ts`

   Existing public-directory behavior is exercised in `participant-profile-routes.test.ts`, `participant-profile-routes-security.test.ts`, and `profile-repository.test.ts`; there is no separately named public-directory backend test file on this base.

4. Full backend suite when practical:

   `bun run test:backend`

5. Whitespace/scope and final review:

   `git diff --check`

   Inspect the final diff, validate exact finding citations and a final verdict in `tasks/admin-profile-consent/code-review.md`, and verify the intended PR base before pushing and creating the PR. Preserve unrelated untracked files.

## Required evidence

Tests must show that all four Admin responses redact absent/stale consent, disclose contacts for current-version consent only after successful audit, and prevent disclosure on audit failure. Assert organization and customer scope, actor UID, existing nonconsented Admin customer-profile 404 behavior, and unchanged own-profile/public responses. Record command outcomes, review results, and any remaining limitations before declaring completion.

## Final verification evidence

- Explicit six-file Biome check passed without fixes; the locally installed `./node_modules/.bin/biome` was invoked directly to avoid network package resolution.
- `bun run build:common` and `bun run build:backend` passed.
- The pinned eight-file focused suite passed: 154 tests, 0 failures, 753 assertions.
- `bun run test:backend` passed: 1295 tests, 26 opt-in PostgreSQL integration skips, 0 failures, 4790 assertions across 113 files. `POSTGRES_INTEGRATION_URL` was unconfigured; no external database was accessed.
- Meaningful regression proof: the two absent-consent tests fail against an isolated archive of base `356a721d6695978f95ee3a24606b5c7d70d15be0`, exposing Teacher postal code and Accompanist phone. The same cases pass with the fix. Only copied tests/harness were added to that disposable snapshot; the shared checkout was never reverted.
- Independent production and test review found no actionable introduced defects (`patch is correct`, confidence 0.98); the parent also inspected the integrated diff.
- Native PowerShell equivalents cover the Bash-only lifecycle helpers: scoped status/conflict/upstream checks, explicit-path intent-to-add/staging, staged and unstaged diff inspection, sensitive-path screening, ff-only synchronization, and non-mutating mergeability checks. The user explicitly selected `feat/97-public-directory` as the PR target, overriding stale configuration.
- Pre-existing `tasks/review-pr-307/` remains excluded; no schema, dependency, lockfile, environment, or build output is included.

Status: READY TO LAND
