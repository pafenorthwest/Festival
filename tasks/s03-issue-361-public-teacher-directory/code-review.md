# Code Review
- Task name: s03-issue-361-public-teacher-directory
- Findings status: none

## Context
Independent two-pass adversarial audit of packet `s03-issue-361-public-teacher-directory` against `goals/s03-issue-361-public-teacher-directory/goals.v0.md` (`[G1]`–`[G4]` and Non-goals), `goals/s03-issue-361-public-teacher-directory/establish-goals.v0.md` (`State: locked`, resolved decision `D1`), `tasks/s03-issue-361-public-teacher-directory/spec.md` (`### In scope` and `### Out of scope`), and `specs/bounded-contexts-2026.md` (§2 Anti-Overkill Policy and §4.4 `teacher-directory`).

Audited scope and verification summary (`17` modified files, `6` newly created code/test files, plus `code-review.md` — all strictly inside `### In scope` of `spec.md`):
- **Scope & Disjoint Lock**: Zero modifications to `.github/workflows/pr-checks.yml`, `.github/workflows/deploy.yml`, `packages/backend/tsconfig.json`, `scripts/check-sql.ts`, `packages/backend/tests/architecture-boundaries.test.ts`, `packages/backend/src/routes/route-security.ts`, `package.json`, `CHANGELOG.md`, or `AGENTS.md`. Zero `console.*` debug statements, zero leaked credentials, and LF-only line endings (`hasCR=False`) across all `24` packet files.
- **`[G1]` Backend Moderation & Entitlement Security**:
  - `PUT /api/customer/orgs/:orgSlug/profiles/teacher` in `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` (`249`L) and `packages/backend/src/services/participant-profile-service.ts` (`339`L; class `246`L `<= 250`L) enforces `assertNoBearerPrincipal`, `Cache-Control: no-store`, `resolveRequestOrigin`, and `CustomerAccountService.formAccess` (`X-CSRF-Token`); requires an active `teacher_membership` entitlement on creation and opt-in (`publicDirectoryOptIn: true`); permits privacy opt-out (`publicDirectoryOptIn: false`) after membership expiry or revocation; immediately auto-approves (`approved`) opted-in active teachers (`resolveTeacherProfileApprovalStatus` in `packages/backend/src/repo/profile-moderation.ts`, `45`L) and preserves `approved` across display-name and division edits; and blocks customer bypass when `approval_status === 'rejected'`.
  - `getPublicDirectoryProfiles` in both `PostgresOrganizationRepository` and `InMemoryOrganizationRepository` strictly filters out non-members, expired memberships, and revoked memberships (`revoked_at IS NOT NULL`) and validates output via `validatePublicDirectoryProfileDto` so private contact fields (`email`, `phone`, `zip_code`, `customer_id`) never leak.
  - Admin `GET /api/admin/orgs/:orgSlug/profiles/teachers` and `PATCH /api/admin/orgs/:orgSlug/profiles/teachers/:profileId/approval` enforce `requireAuth`, `requireTenant`, `requireTenantRole(["Admin"])`, and staff-consent `zip_code` redaction.
- **`[G2]` Customer Checkout & Account Opt-In UI**:
  - `packages/frontend/src/pages/MembershipPage.tsx` (`489`L) pre-selects (`true`) the Public Teacher Directory opt-in checkbox, persists pending preference per `orgSlug` (`teacherDirectoryHelpers.ts`, `179`L), retains `entitlementClass` across `preparePurchase` / `startOfferingPurchase` so post-OAuth `?purchase=<offeringId>` resume deterministically renders and saves opt-in even before `getMembershipProducts` resolves (`F1` resolved), and orders `2. Agree to sharing data` before the optional directory section so step numbering and `tests/browser/membership-purchase.tsx` remain intact (`F2` resolved).
  - `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` (`317`L) and `packages/frontend/src/pages/CustomerTeacherDirectoryCard.tsx` (`253`L) render directory visibility controls for both newly returning purchasers (auto-saving pending checkout preference when `displayName` is available and clearing pending storage) and existing active teacher members, with `tests/browser/account-return.tsx` (`147`L) covering `/profiles/teacher` and `/divisions` (`F2` resolved).
- **`[G3]` Public Directory & Admin Moderation UI**:
  - `packages/frontend/src/pages/PublicDirectoryPage.tsx` (`230`L) and `packages/frontend/src/pages/publicDirectoryHelpers.ts` (`99`L) render active opted-in approved teachers with defense-in-depth `isActiveMember` filtering, search and division filters, and loading/error/empty states.
  - `packages/frontend/src/pages/AdminTeacherDirectoryPanel.tsx` (`238`L) and `packages/frontend/src/pages/adminTeacherDirectoryHelpers.ts` (`77`L), mounted in `AdminMembershipProductsPage.tsx` (`459`L), provide a one-click visibility/approval toggle (`approved` <-> `rejected`, `pending` -> `approved`) with concurrency locking and deterministic sorting.
- **`[G4]` Structural Ceilings & Automated Verification**:
  - All `4` Pass-1 findings (`F1`–`F4`) verified resolved by AST and test execution: `updateAdminTeacherProfileApproval` reduced to `3` parameters (`idToken`, `orgSlug`, `input`), `PostgresOrganizationRepository.upsertTeacherProfile` (`32`L + `48`L `persistTeacherProfile`), `InMemoryOrganizationRepository.getPublicDirectoryProfiles` (`8`L + `36`L/`30`L helpers), and `teacher-directory-management.test.ts` (`438`L; all callbacks `<= 55`L).
  - `public-teacher-directory.integration.test.ts` (`453`L) populates `process.env.DATABASE_URL` from `POSTGRES_INTEGRATION_URL` when unset and passes standalone (`6 pass, 0 fail` with `DATABASE_URL` unset) as well as inside the full PostgreSQL 17 suite (`F3` resolved).
  - Full verification gates executed in `pwsh`: `biome check packages` (`526` files, `exit 0`), `biome lint packages` (`526` files, `exit 0`), `build` across `common`/`backend`/`frontend`/`shopify-confirmation` (`exit 0`), `packages/frontend check:types` (`exit 0`), `bun run check:sql` (`278` backend files, `exit 0`), and `2,414` passing unit + PostgreSQL 17 integration tests (`353` common + `1,586` backend + `455` frontend + `20` shopify-confirmation, `0` failures).

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.98
- Justification: All `[G1]`–`[G4]` goals, Non-goals, `D1` immediate auto-approval semantics, CSRF/session/RBAC/redaction security invariants, `specs/bounded-contexts-2026.md` §2/§4.4 structural ceilings (`<=500`L files, `<=250`L classes, `<=60`L / `<=3`-param functions), and all four Pass-1 review findings (`F1`–`F4`) are resolved and independently verified against real PostgreSQL 17 and full workspace build/type/lint/test gates (`2,414 pass, 0 fail`).
