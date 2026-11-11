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
$env:POSTGRES_INTEGRATION_URL = "postgres://postgres:postgres@127.0.0.1:5432/festival_test"
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
Pending execution.

## Quality gate results
Pending execution.
