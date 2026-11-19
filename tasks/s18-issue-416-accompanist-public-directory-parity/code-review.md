# Code Review

- Task name: s18-issue-416-accompanist-public-directory-parity
- Reviewer: Independent Code Review Subagent
- Date: 2026-11-18
- Branch: `feat/s18-issue-416-accompanist-public-directory-parity`
- Findings status: none

## Context

Performed an independent adversarial code review and post-fix re-review of packet `S18` (`s18-issue-416-accompanist-public-directory-parity`, Issue `#416`) on branch `feat/s18-issue-416-accompanist-public-directory-parity` against `origin/main` (`621f09a`), locked goals (`goals/s18-issue-416-accompanist-public-directory-parity/goals.v0.md` and `goals/s18-issue-416-accompanist-public-directory-parity/establish-goals.v0.md`), packet specification (`tasks/s18-issue-416-accompanist-public-directory-parity/spec.md`), and bounded-context guardrails (`specs/bounded-contexts-2026.md` §2, §4.4, §5, §6). Confirmed upstream dependency `S17` (`#417` / PR `#422`) is merged and marked `DONE` on `origin/main`. All three initial review findings (`S18-REV-01`, `S18-REV-02`, and `S18-REV-03`) have been cleanly resolved and verified against live PostgreSQL 17 and full frontend/backend suites.

## Scope & Files Reviewed

Inspected `git status --untracked-files=all --short`, full `git diff origin/main`, all 40 modified packet files, and read-only compatibility anchors (`packages/frontend/tests/browser/account-return.tsx`, `packages/frontend/src/lib/api.ts`, `packages/frontend/src/pages/MembershipPage.tsx`, `packages/backend/src/repo/postgres-profile-directory-delegate.ts`, `packages/backend/src/routes/participant-profile/participant-profile.routes.ts`):

- Shared contracts (`@festival/common`):
  - `packages/common/src/commerce.ts` (`224` lines), `packages/common/src/directory.ts` (`58` lines), `packages/common/tests/schemas.test.ts` (`694` lines)
- Backend (`teacher-directory`, `infra`, `repo`, `routes`):
  - `packages/backend/src/domains/teacher-directory/membership-entitlement-helpers.ts` (`389` lines)
  - `packages/backend/src/domains/teacher-directory/membership-entitlement-repository.ts` (`190` lines)
  - `packages/backend/src/domains/teacher-directory/participant-directory-service.ts` (`389` lines)
  - `packages/backend/src/domains/teacher-directory/teacher-directory-queries.ts` (`245` lines)
  - `packages/backend/src/domains/teacher-directory/teacher-directory-repository.ts` (`283` lines)
  - `packages/backend/src/infra/s10-infra.ts` (`129` lines)
  - `packages/backend/src/repo/profile-moderation.ts` (`48` lines)
  - `packages/backend/src/repo/postgres-membership-grant-delegate.ts` (`311` lines)
  - `packages/backend/src/repo/postgres-profile-directory-helpers.ts` (`309` lines)
  - `packages/backend/src/repo/in-memory-org-profiles.ts` (`333` lines)
  - `packages/backend/src/repo/in-memory-org-state.ts` (`213` lines)
  - `packages/backend/src/routes/customer/customer-membership.routes.ts` (`367` lines)
  - Backend unit & PostgreSQL 17 integration suites: `teacher-directory.test.ts`, `accompanist-membership-service.test.ts`, `customer-membership.routes.test.ts`, `participant-profile-membership.test.ts`, `participant-profile-routes.test.ts`, `postgres-organization-repository.test.ts`, `profile-repository.test.ts`, `public-teacher-directory.integration.test.ts`, `shopify-order-projection.test.ts`
- Frontend (`lib/api`, `pages`, `tests`):
  - `packages/frontend/src/lib/api/commerce.ts` (`492` lines), `packages/frontend/src/lib/api/directory.ts` (`202` lines), `packages/frontend/src/lib/api.ts` (`121` lines, untouched `<= 200`L barrel)
  - `packages/frontend/src/pages/AccompanistMembershipPage.tsx` (`297` lines)
  - `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` (`414` lines)
  - `packages/frontend/src/pages/CustomerTeacherDirectoryCard.tsx` (`326` lines)
  - `packages/frontend/src/pages/AdminTeacherDirectoryPanel.tsx` (`270` lines)
  - `packages/frontend/src/pages/adminTeacherDirectoryHelpers.ts` (`124` lines)
  - `packages/frontend/src/pages/publicDirectoryHelpers.ts` (`98` lines)
  - `packages/frontend/src/pages/teacherDirectoryHelpers.ts` (`230` lines)
  - Frontend suites: `api-clients.test.ts`, `accompanist-membership.test.ts`, `public-directory.test.ts`, `teacher-directory-management.test.ts`, `customer-account.test.ts`, and read-only `browser/account-return.tsx`
- Packet & release metadata:
  - `CHANGELOG.md`, `tasks/s18-issue-416-accompanist-public-directory-parity/spec.md`

Confirmed strict scope isolation: `0` SQL migrations (`database/**` untouched) and zero edits to `MembershipPage.tsx`, `CustomerMembershipCheckoutPayloadSchema`, or `postMembershipCheckoutHandler`.

## Audit Summary

1. **`[G1]` `$0` Accompanist `staffAccessConsent` Removal & Security Preservation**:
   - Removed copy-pasted Shopify contact-sharing consent checkbox, Privacy Policy paragraph, and `staffAccessConsent` schema/route/service gates across `AccompanistMembershipPage.tsx`, `AcquireAccompanistMembershipPayloadSchema`, `AcquireAccompanistMembershipRouteBodySchema`, `acquireAccompanistMembership`, `membership-entitlement-helpers.ts`, and `customer-membership.routes.ts` (including removal of `recordCheckoutStaffAccessConsent` on `$0` accompanist acquisition).
   - Preserved `CUSTOMER_SESSION_COOKIE`, `assertNoBearerPrincipal`, `X-CSRF-Token` + `resolveRequestOrigin` (`formAccess`), `assertAllowedFields` (rejecting deprecated `staffAccessConsent` and unexpected fields with `400`), `verifiedShopifyIdentityEmail` (`422`), paid Teacher `staffAccessConsent`, and `0` DB migrations.
2. **`[G2]` Registration Public Directory Opt-In, Renewal Preservation & Recovery**:
   - `AccompanistMembershipPage.tsx` loads `getCustomerAccompanistProfile(props.slug)` inside `loadAfterCustomerSession` (never firing for anonymous sessions), pre-checks Public Directory opt-in (`true`) when `existingProfile === null`, preserves saved `existingProfile.public_directory_opt_in` (`true` or `false`) on renewals without resetting opt-outs, submits `acquireAccompanistMembership` followed by `upsertCustomerAccompanistProfile` before redirecting to `/org/:slug/account/memberships`, and tracks `membershipActivated` so post-activation profile upsert failures surface actionable recovery messaging without re-submitting grant creation (`409`) on retry.
3. **`[G3]` Typed Directory RPCs, Self-Service Account Card & Admin Moderation (resolving `S18-REV-02`)**:
   - `packages/frontend/src/lib/api/directory.ts` (re-exported via `api.ts` at `121` lines `<= 200`L) exports `getCustomerAccompanistProfile` (`404 -> null`), `upsertCustomerAccompanistProfile`, `listAdminAccompanistProfiles`, and `updateAdminAccompanistProfileApproval`.
   - `CustomerAccountMembershipsPage.tsx` renders a role-parameterized `CustomerTeacherDirectoryCard` (`role="accompanist"`) for active `accompanist_membership` holders while preserving `S17`'s direct-child `<h1>Acquire Memberships</h1>` hierarchy, primary `Annual Teacher` / `Annual Accompanist` buttons, and exact `"Public Teacher Directory"` Teacher card heading (`browser/account-return.tsx`).
   - Resolving `S18-REV-02`, `resolveActiveGrantDivisionIdsByClass` (`teacherDirectoryHelpers.ts:121-147`) splits comma-delimited `accompanist_membership` `divisionName` strings (`"Piano, Strings"`) while retaining full-string exact matching, covered by regression assertions in `teacher-directory-management.test.ts`.
   - `AdminTeacherDirectoryPanel.tsx` + `adminTeacherDirectoryHelpers.ts` loads and moderates both Teacher and Accompanist profiles (`approved <-> rejected`, `pending -> approved`) with role badges and composite `${role}:${id}` keys preventing cross-role ID collisions.
4. **`[G4]` Auto-Approval, Sticky `'rejected'`, Superseded/Inactive Gating & Structural Guardrails (resolving `S18-REV-01` & `S18-REV-03`)**:
   - Opted-in active accompanists auto-approve (`'approved'`) and sticky Admin `'rejected'` status is preserved across customer upserts, edits, and renewals in `teacher-directory-queries.ts`, `teacher-directory-repository.ts`, `postgres-profile-directory-helpers.ts`, `postgres-profile-directory-delegate.ts`, and `in-memory-org-profiles.ts`. `domains/teacher-directory/*` imports `resolveParticipantProfileApprovalStatus` strictly via `infra/s10-infra.ts` (`architecture-boundaries.test.ts` passes).
   - Resolving `S18-REV-01`, `findCurrentAccompanistMembershipGrant` and `listAccompanistMembershipGrants` in both `membership-entitlement-repository.ts` and `postgres-membership-grant-delegate.ts` enforce `(e.superseded_on IS NULL OR e.superseded_on > (NOW() AT TIME ZONE o.timezone)::date)` and `'superseded'` status derivation, and `withAccompanistLifecycle` (`in-memory-org-state.ts`) honors `state.entitlementSupersededOn`. Inactive, expired, revoked, and superseded accompanists are excluded from public directory listings (`queryPublicDirectoryAccompanists`, `in-memory-org-profiles.ts`, `publicDirectoryHelpers.ts`, `isActiveMember === true`) and blocked from opting in via `ParticipantDirectoryService.upsertAccompanistProfile` (`403 active_membership_required`) while permitted to opt out (`200`), verified against live PostgreSQL 17 in `public-teacher-directory.integration.test.ts`.
   - Resolving `S18-REV-03`, `CustomerTeacherDirectoryCard.tsx` extracted `upsertRoleDirectoryProfile` and `saveCardDraft` (`34`L), reducing `createTeacherCardController` to `39` lines. AST and file-hygiene verification confirmed all 23 modified production `.ts`/`.tsx` files are `<= 500` lines with LF line endings (`0` CRLF), all classes are `<= 250` lines (`PostgresMembershipEntitlementRepository` `162`L, `ParticipantDirectoryService` `238`L, `PostgresTeacherDirectoryRepository` `246`L, `PostgresAccompanistGrantDelegate` `104`L, `PostgresMembershipGrantDelegate` `178`L), all new/modified helper and method functions are `<= 60` lines (pre-existing `AccompanistMembershipPage` component function is `278`L), zero private fields leak on `/api/org-info/:orgSlug/directory/profiles`, and zero `console.*`, `debugger`, or credentials exist.
5. **Independent Toolchain & Live PostgreSQL 17 Verification (`pwsh`)**:
   - `bun run format:check`: PASS (`850` files, `0` issues)
   - `bun run lint`: PASS (`850` files, `0` issues)
   - `bun run build`: PASS (`0` errors across `common`, `backend`, `frontend`, `shopify-confirmation`)
   - `bun run --cwd packages/frontend check:types`: PASS (`0` errors)
   - `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: PASS (`0` errors)
   - `bun run check:sql`: PASS (`527` backend TypeScript files validated)
   - `bun run test:common`, `bun run test:confirmation`, `bun run test:frontend`: PASS (`577` pass, `0` fail in frontend; `0` fail in common & confirmation)
   - Live PostgreSQL 17 (`127.0.0.1:5432/festival_test`) backend unit, boundary, security & integration suites (`teacher-directory.test.ts`, `profile-repository.test.ts`, `public-teacher-directory.integration.test.ts`, `postgres-organization-repository.test.ts`, `participant-profile-membership.test.ts`, `participant-profile-routes.test.ts`, `accompanist-membership-service.test.ts`, `customer-membership.routes.test.ts`, `shopify-order-projection.test.ts`, `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, `route-security.test.ts`, `nginx-security.test.ts`): PASS (`178` pass, `0` fail, `0` skip, `1,944` `expect()` calls)

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: Initial review findings `S18-REV-01`, `S18-REV-02`, and `S18-REV-03` are cleanly resolved with deterministic unit and live PostgreSQL 17 integration regression coverage, and all `[G1]`–`[G4]` functional, security, DOM hierarchy, bounded-context DAG, structural size, formatting, linting, typechecking, and SQL guardrails pass with zero defects.
