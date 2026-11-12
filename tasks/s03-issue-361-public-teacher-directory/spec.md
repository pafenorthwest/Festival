# S03 — Issue #361: Public Teacher Directory Opt-In, Public Listing, and Admin Toggle

## Goal reference
- Goal contract: `goals/s03-issue-361-public-teacher-directory/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 1, Group W1-B parallel with `S02`, depends on `S01`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (`teacher-directory` bounded context: `orgs.teacher_profiles`, `orgs.teacher_profile_divisions`, `orgs.accompanist_profiles`, `orgs.accompanist_profile_divisions`, `orgs.products`, `orgs.membership_entitlements`, `orgs.membership_entitlement_revocations`)

## Scope

### In scope
- `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` (and directly owned participant-profile service/repository helpers)
- `packages/frontend/src/pages/PublicDirectoryPage.tsx`
- Customer Teacher Membership / Account opt-in UI components under `packages/frontend/src/`
- Admin participant/teacher directory visibility toggle UI components under `packages/frontend/src/`
- Targeted frontend API helpers in `packages/frontend/src/lib/api.ts` strictly for participant-profile endpoints
- Unit and Postgres integration test files for participant profiles and `PublicDirectoryPage` under `packages/backend/tests/` and `packages/frontend/tests/`
- `tasks/s03-issue-361-public-teacher-directory/spec.md` and `tasks/s03-issue-361-public-teacher-directory/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S03` upon merge)

### Out of scope
- `.github/workflows/pr-checks.yml`, `.github/workflows/deploy.yml`, `packages/backend/tsconfig.json`, `scripts/check-sql.ts`, `packages/backend/tests/architecture-boundaries.test.ts` (locked in parallel to `s02-ci-postgres-tsc-and-boundary-gates`)
- `package.json` version bumps and `CHANGELOG.md` (locked to `s04-release-v0-3-0-cutover`)
- Class checkout, repertoire, and nginx/CSRF files touched in `s01-pr354-logout-csrf-and-pr360-merge`

## Approach
1. **Verify Locked `D1` Contract & Branch**: Confirm `goals.v0.md` + `establish-goals.v0.md` are in `State: locked` under resolved `D1` (active paid Teacher Membership + checked opt-in box auto-creates/auto-approves `approved` public directory visibility immediately without waiting in `pending`), and branch `feat/s03-issue-361-public-teacher-directory` from `main` after `S01` merges.
2. **Backend Red-Green Tests & Route Alignment**:
   - Write failing unit and Postgres 17 integration tests verifying: (a) non-members cannot appear publicly, (b) new and existing active paid teacher members opting in auto-create/auto-approve directly into `approved` status immediately without waiting in `pending`, (c) opting out or membership revocation hides the listing immediately, and (d) organization admins can hide or reinstate profile visibility in one request.
   - Update `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` and backing profile logic to satisfy all cases within `<=60`L function and `<=500`L file limits.
3. **Customer Opt-In & Public Directory UI**:
   - Add a pre-selected public-directory visibility checkbox on the Teacher Membership flow and an editable visibility toggle/profile card on the Customer Account view for existing active teacher members.
   - Complete `packages/frontend/src/pages/PublicDirectoryPage.tsx` to display active approved teacher entries with clean loading, empty, and filter states.
4. **Admin Toggle & Verification**:
   - Add a one-click visibility/approval toggle in the Admin directory management UI with optimistic/deterministic state refresh and frontend unit tests.
   - Run full repo quality gates including Postgres integration suites and frontend `check:types`, complete independent subagent `code-review.md`, and merge to `main` closing `#361`.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s03-issue-361-public-teacher-directory
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s03-issue-361-public-teacher-directory -RequireCodeReview
$env:POSTGRES_INTEGRATION_URL = "postgres://postgres:postgres@127.0.0.1:5432/festival_test"
$env:DATABASE_URL = $env:POSTGRES_INTEGRATION_URL
$env:POSTGRES_APPLICATION_CATALOG_VERIFIED = "1"
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- **`[G1]` Backend Teacher Directory Auto-Approval, Entitlement Gating & Moderation (`81ff7ee74b5130d61a880ebe9c77aeff5285b8b5`)**:
  - Updated `packages/backend/src/repo/profile-moderation.ts`, `packages/backend/src/services/participant-profile-service.ts`, `packages/backend/src/repo/postgres-organization-repository.ts`, and `packages/backend/src/repo/in-memory-organization-repository.ts` so active paid `teacher_membership` holders opting in (`publicDirectoryOptIn: true`) immediately auto-create/auto-approve (`approved`) public directory visibility without waiting in `pending` (per locked decision `D1`), preserve `approved` across display-name and division edits, and cannot self-override an Admin `rejected` state.
  - Enforced active paid `teacher_membership` gating on public directory listings (`getPublicDirectoryProfiles`) and customer opt-in while allowing immediate hiding on customer opt-out (`publicDirectoryOptIn: false`), membership expiry, or entitlement revocation, and preserved Admin one-click hide (`rejected`) / reinstate (`approved`) moderation via `PATCH /api/admin/orgs/:orgSlug/profiles/teachers/:profileId/approval`.
  - Added `Cache-Control: no-store` on `GET /api/org-info/:orgSlug/directory/profiles` in `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` so opt-out, revocation, and Admin moderation changes reflect immediately without stale HTTP caching, and fixed `PostgresOrganizationRepository.assertValidDivisionIds` to pass `sql.array(uniqueIds, "text")` for `ANY($2::text[])`.
- **`[G2]` Customer Checkout & Account Opt-In Controls (`81ff7ee74b5130d61a880ebe9c77aeff5285b8b5`)**:
  - Added typed participant-profile helpers (`getCustomerTeacherProfile`, `upsertCustomerTeacherProfile`, `listAdminTeacherProfiles`, `updateAdminTeacherProfileApproval`) in `packages/frontend/src/lib/api.ts`.
  - Added a pre-selected (`true`) Public Teacher Directory opt-in checkbox on `packages/frontend/src/pages/MembershipPage.tsx` backed by `packages/frontend/src/pages/teacherDirectoryHelpers.ts`, preserving `entitlementClass` across OAuth `?purchase=` handoff so post-login checkout resumption retains and persists the selected directory preference.
  - Added `packages/frontend/src/pages/CustomerTeacherDirectoryCard.tsx` on `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` so newly returning purchasers auto-apply pending checkout opt-in preferences and existing active teacher members can edit display name, divisions, or opt-in/opt-out visibility directly.
- **`[G3]` Public Directory Listing & Admin One-Click Moderation UI (`81ff7ee74b5130d61a880ebe9c77aeff5285b8b5`)**:
  - Updated `packages/frontend/src/pages/PublicDirectoryPage.tsx` and `packages/frontend/src/pages/publicDirectoryHelpers.ts` with search and division filters, defense-in-depth `isActiveMember` filtering, and deterministic loading, empty, and error states.
  - Added `packages/frontend/src/pages/AdminTeacherDirectoryPanel.tsx` and `packages/frontend/src/pages/adminTeacherDirectoryHelpers.ts` on `packages/frontend/src/pages/AdminMembershipProductsPage.tsx` providing one-click teacher directory visibility moderation (`approved` <-> `rejected`, `pending` -> `approved`) with in-flight request locking and deterministic sorting.
- **`[G4]` Unit, Browser & PostgreSQL 17 Integration Coverage (`81ff7ee74b5130d61a880ebe9c77aeff5285b8b5`)**:
  - Added and updated deterministic backend/frontend unit, browser, and real PostgreSQL 17 integration suites across `packages/backend/tests/public-teacher-directory.integration.test.ts`, `packages/backend/tests/participant-profile-membership.test.ts`, `packages/backend/tests/participant-profile-routes.test.ts`, `packages/backend/tests/profile-repository.test.ts`, `packages/frontend/tests/public-directory.test.ts`, `packages/frontend/tests/teacher-directory-management.test.ts`, and `packages/frontend/tests/browser/account-return.tsx`.
- **Exceptions**: None.
- **Deferred work**: Domain folder extraction into `packages/backend/src/domains/teacher-directory/**` and typed RPC/schema consolidation remain scheduled for Wave 3 packets `s10` and `s12` per `specs/pre-thanksgiving-program.md`.

## Quality gate results
- Packet validator (`validate-packet.ps1 -TaskName s03-issue-361-public-teacher-directory -RequireCodeReview`): `PASS` — `PACKET VALID: task=s03-issue-361-public-teacher-directory iteration=v0 state=locked goals=4 codeReview=valid(none)` (`exit=0`)
- `bun run verify:toolchain`: `PASS` — `Using Bun 1.4.2 and TypeScript 5.9.3.` (`exit=0`)
- `bun run format:check`: `PASS` — `Checked 526 files` (`No fixes applied.`, `exit=0`)
- `bun run lint`: `PASS` — `Checked 526 files` (`0` warnings, `0` errors, `exit=0`)
- `bun run build`: `PASS` — built `@festival/common`, `@festival/backend`, `@festival/frontend`, and `@festival/shopify-confirmation` (`exit=0`)
- `bun run --cwd packages/frontend check:types`: `PASS` — `tsc -p tsconfig.json --noEmit` clean (`exit=0`)
- `bun run test`: `PASS` — `2,414 pass, 0 fail, 0 skip` across `204` test files (`common`: `353 pass`; `backend`: `1,586 pass` including live PostgreSQL 17 integration suites; `frontend`: `455 pass`; `shopify-confirmation`: `20 pass`; `exit=0`), plus browser harnesses `membership-purchase.html` (`19/19` passed) and `account-return.html` (`10/10` passed)
- `bun run check:sql`: `PASS` — `Validated 278 backend TypeScript files.` (`exit=0`)
- Code review (`tasks/s03-issue-361-public-teacher-directory/code-review.md`): `PASS` — `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`0.98` confidence)
