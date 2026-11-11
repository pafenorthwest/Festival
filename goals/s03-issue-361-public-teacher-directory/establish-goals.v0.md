# Establish Goals
- Task name: s03-issue-361-public-teacher-directory
- Iteration: v0
- State: locked

## Status
Locked (D1 resolved 2026-11-11: auto-create/auto-approve public directory profile immediately upon active paid Teacher Membership + opt-in)

## Request
Deliver Issue `#361` (Public Teacher Directory) for `v0.3.0` by connecting `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` and `packages/frontend/src/pages/PublicDirectoryPage.tsx` with customer Teacher Membership/Account opt-in controls (supporting both new and existing active teachers), a one-click Admin visibility/approval toggle, and full Postgres 17 integration test coverage.

## Blocking ambiguity
- None (`D1` resolved: active paid Teacher Membership + opt-in auto-creates/auto-approves public directory visibility immediately).

## Assumptions
- `S01` has merged to `main` before `S03` starts, and `S03` executes in parallel with `S02` across strictly disjoint files.
- Backend route scaffolding and `orgs.teacher_profiles` (`orgs.teacher_profile_divisions`, `orgs.accompanist_profiles`, `orgs.accompanist_profile_divisions`) persistence already exist in `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` and require UI wiring plus approval-policy alignment rather than new schema tables.
- Revoking or expiring a Teacher Membership automatically hides the profile from the public directory regardless of opt-in flag.

## Goals
1. Wire the public teacher directory backend contract in `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` (and backing participant profile service/repository logic) so an active paid Teacher Membership combined with opt-in auto-creates and auto-approves (`approved`) the public directory profile immediately without waiting in `pending`, while preserving Admin one-click hide/reinstate control.
2. Add a pre-selected public-directory visibility opt-in checkbox and profile management controls on the Teacher Membership and Customer Account views so both newly purchasing and existing active teacher members can opt in or opt out seamlessly.
3. Wire `packages/frontend/src/pages/PublicDirectoryPage.tsx` and the organization Admin directory management panel so public visitors view eligible opted-in teachers and staff can toggle teacher visibility/approval in one click.
4. Cover all customer opt-in/opt-out, membership-entitlement gating, public listing, and admin visibility-toggle paths with deterministic unit tests and real Postgres 17 integration tests.

## Non-goals
- Modifying `.github/workflows/pr-checks.yml`, `.github/workflows/deploy.yml`, `packages/backend/tsconfig.json`, or `scripts/check-sql.ts` (locked in parallel to `s02-ci-postgres-tsc-and-boundary-gates`).
- Decomposing `CustomerAccountService` or `PostgresMembershipCommerceRepository` into `domains/teacher-directory/**` (deferred to Wave 3 packet `s10`).
- Modifying class registration or class checkout flows introduced in PR `#354`.

## Success criteria
- [G1] `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` persists teacher opt-in state, enforces active paid Teacher Membership gating, and immediately auto-creates/auto-approves (`approved`) public directory visibility on opt-in without waiting in `pending`.
- [G2] Both new Teacher Membership purchasers and existing active teacher members see the pre-selected directory visibility opt-in control in the customer UI and can update or revoke their public listing without staff DB intervention.
- [G3] `packages/frontend/src/pages/PublicDirectoryPage.tsx` renders only active, opted-in, policy-approved teacher profiles for the tenant slug, and the Admin UI provides a working one-click visibility/approval toggle.
- [G4] Unit and Postgres 17 `*.integration.test.ts` suites pass with zero errors alongside `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, and `bun run check:sql`.

## Next action
Branch `feat/s03-issue-361-public-teacher-directory` from `main` once `S01` merges and execute `tasks/s03-issue-361-public-teacher-directory/spec.md`.
