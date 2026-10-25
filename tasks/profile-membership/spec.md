# Profile creation membership prerequisite

Locked goals: `goals/profile-membership/goals.v1.md`.

Scope: service creation authorization and focused regression tests; existing profile updates preserve opt-out access.

Base: `origin/feat/285-profiles-management` at `0b8b09da781db6048676a3b0834a8980264a808c`.
Head: `ericp/membership-requires-consent`.
Dirty-worktree decision: preserve and exclude pre-existing untracked `database.env`; stage explicit task paths only.

Pinned validation (PowerShell, stop on nonzero exit):
- Lint: `bunx biome check packages/backend/src/services/participant-profile-service.ts packages/backend/tests/participant-profile-membership.test.ts packages/backend/tests/participant-profile-test-harness.ts packages/backend/tests/participant-profile-routes-security.test.ts packages/backend/tests/participant-profile-routes.test.ts`
- Build: `bun run build:common`, then `bun run build:backend`.
- Tests: `bun test ./packages/common/tests/profile.test.ts ./packages/backend/tests/profile-repository.test.ts ./packages/backend/tests/participant-profile-membership.test.ts ./packages/backend/tests/participant-profile-routes.test.ts ./packages/backend/tests/participant-profile-routes-security.test.ts ./packages/backend/tests/postgres-schema-snapshot.test.ts`.

Workflow exception: bundled lifecycle helpers are Bash scripts without PowerShell equivalents. Follow repository PowerShell-only execution rules using native commands and equivalent explicit checks/artifacts.

Known limitation: active accompanist membership does not itself establish recorded staff-contact consent; this change enforces membership eligibility only.

Delivered: creation returns 403 `active_membership_required` without active matching-role membership. Existing profile reads, updates, and opt-out remain available after expiry/revocation. Route fixtures now seed memberships and the redundant directory-test grant setup is removed.

Validation: pinned 5-file Biome check passed without fixes; common and backend TypeScript builds passed; all 109 targeted tests passed (507 assertions, 6 files). `git diff --check` passed. Independent review found no remaining actionable findings (patch is correct, confidence 0.98).

READY TO LAND. No deferred implementation; membership-versus-consent limitation remains as documented above. PR base intentionally differs from main per user's follow-up.
