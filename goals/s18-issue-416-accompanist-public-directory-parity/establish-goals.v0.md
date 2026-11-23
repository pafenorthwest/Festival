# Establish Goals
- Task name: s18-issue-416-accompanist-public-directory-parity
- Iteration: v0
- State: locked

## Status
Locked for Wave 4D execution (`#416`) under resolved decision `D5` (`2026-11-16`). Sequenced strictly after `S17` (`s17-issue-417-account-membership-acquisition-buttons`) merges to `origin/main` due to shared ownership of `CustomerAccountMembershipsPage.tsx` and customer account membership tests.

## Request
Deliver full `#361`-grade Public Directory parity and form cleanup for `$0` Accompanist Membership ahead of the December 1, 2026 Phase 1 Live Launch (`#416`, `D5`): remove the copy-pasted Shopify contact-sharing consent checkbox, Privacy Policy note, and `staffAccessConsent` gate across `AccompanistMembershipPage.tsx`, `@festival/common`, frontend RPC client, and backend accompanist membership route/helper while keeping `CUSTOMER_SESSION_COOKIE` sign-in (`0` DB migrations); add an explicit Public Directory opt-in checkbox on `AccompanistMembershipPage.tsx` (pre-checked `true` for new records, initialized from saved `public_directory_opt_in` on renewals without resetting existing opt-outs) that upserts the accompanist directory profile after `acquireAccompanistMembership`; add typed accompanist directory RPC helpers, an account self-service directory card for active `accompanist_membership` holders, and an Admin one-click visibility toggle; auto-approve (`'approved'`) opted-in active accompanists while never clearing Admin `'rejected'` hides; and enforce active non-superseded `accompanist_membership` (`isActiveMember === true`) across backend queries, `ParticipantDirectoryService.upsertAccompanistProfile`, and frontend `publicDirectoryHelpers.ts`.

## Blocking ambiguity
None.

## Assumptions
- Preflight gate: `S17` (`s17-issue-417-account-membership-acquisition-buttons`) MUST be marked `DONE` on `origin/main` before branching or editing code for `S18`.
- Paid Accompanist Shopify checkout (`#133`) is deferred to summer per `D5`; December 1 launches `$0` unpaid Accompanist registration with `0` database migrations (`database/` untouched).
- Customer authentication via `CUSTOMER_SESSION_COOKIE` (`loadAfterCustomerSession`, `formAccess`, CSRF validation, and `verifiedShopifyIdentityEmail`) remains mandatory on `/org/:slug/accompanist-membership` and `/api/customer/orgs/:orgSlug/profiles/accompanist`.
- Paid Teacher Membership (`MembershipPage.tsx`, `CustomerMembershipCheckoutPayloadSchema`, `postMembershipCheckoutHandler`) retains its existing `staffAccessConsent` requirement untouched.

## Goals
1. Remove the copy-pasted Shopify contact-sharing consent checkbox, Privacy Policy note, and `staffAccessConsent` payload/route gate across `packages/frontend/src/pages/AccompanistMembershipPage.tsx`, `packages/common/src/commerce.ts` (`AcquireAccompanistMembershipPayloadSchema` & `AcquireAccompanistMembershipRouteBodySchema`), `packages/frontend/src/lib/api/commerce.ts` (`acquireAccompanistMembership`), `packages/backend/src/domains/teacher-directory/membership-entitlement-helpers.ts`, and `packages/backend/src/routes/customer/customer-membership.routes.ts`, while preserving `CUSTOMER_SESSION_COOKIE` sign-in, CSRF validation, and `0` database migrations (`#416`, `D5`).
2. Add an explicit Public Directory opt-in checkbox on `packages/frontend/src/pages/AccompanistMembershipPage.tsx`—pre-checked `true` when no accompanist profile exists (`existingProfile === null`) and initialized from `existingProfile.public_directory_opt_in` on renewals so existing opt-outs are never reset—and upsert the customer accompanist directory profile immediately after `acquireAccompanistMembership` succeeds (`#416`, `D5`).
3. Add typed accompanist profile Hono RPC helpers (`getCustomerAccompanistProfile`, `upsertCustomerAccompanistProfile`, `listAdminAccompanistProfiles`, `updateAdminAccompanistProfileApproval`) in `packages/frontend/src/lib/api/directory.ts` (re-exported via `api.ts`), render a self-service Public Directory management card on `packages/frontend/src/pages/CustomerAccountMembershipsPage.tsx` for active `accompanist_membership` holders (`CustomerTeacherDirectoryCard.tsx` / `teacherDirectoryHelpers.ts`), and add one-click Admin accompanist visibility moderation (`approved <-> rejected`, `pending -> approved`) in `packages/frontend/src/pages/AdminTeacherDirectoryPanel.tsx` and `adminTeacherDirectoryHelpers.ts` (`#416`, `D5`).
4. Align backend and frontend accompanist directory moderation and eligibility with `#361`: auto-approve (`'approved'`) opted-in active accompanists instead of stranding in `'pending'`, never clear Admin `'rejected'` hides on customer upserts, edits, or renewals (`profile-moderation.ts`, `teacher-directory-queries.ts`, `teacher-directory-repository.ts`, `postgres-profile-directory-helpers.ts`, `postgres-profile-directory-delegate.ts`, `in-memory-org-profiles.ts`), require an active non-superseded `accompanist_membership` to appear in `queryPublicDirectoryAccompanists` (`isActiveMember === true`), `publicDirectoryHelpers.ts`, or opt in via `ParticipantDirectoryService.upsertAccompanistProfile` (while allowing expired/revoked members with an existing profile to opt out), and pass full unit + PostgreSQL 17 integration verification with all files `<= 500` lines (`#416`).

## Non-goals
- Starting `S18` before `S17` (`#417`) merges to `origin/main`.
- Implementing paid Accompanist Shopify checkout or order projection (`#133`, deferred to summer).
- Modifying `database/` migrations, `database/postgres17-schema.sql`, or paid Teacher Membership `staffAccessConsent` (`MembershipPage.tsx` / `postMembershipCheckoutHandler`).
- Exposing private accompanist contact fields (`email`, `phone`, `zip_code`) on `/api/org-info/:orgSlug/directory/profiles`.

## Success criteria
- [G1] `AccompanistMembershipPage.tsx`, `AcquireAccompanistMembershipPayloadSchema`, `AcquireAccompanistMembershipRouteBodySchema`, `acquireAccompanistMembership`, `membership-entitlement-helpers.ts`, and `customer-membership.routes.ts` accept and submit `$0` accompanist registration without `staffAccessConsent` or the copy-pasted Privacy Policy consent block, while rejecting unauthenticated/CSRF-invalid requests and requiring `0` DB migrations.
- [G2] `AccompanistMembershipPage.tsx` renders an explicit Public Directory opt-in checkbox defaulting to `true` for new accompanists and preserving saved `public_directory_opt_in` (`true` or `false`) for existing profiles on renewal, and persists the profile via `upsertCustomerAccompanistProfile` after `acquireAccompanistMembership`.
- [G3] `packages/frontend/src/lib/api/directory.ts` (and `api.ts`) exports typed customer/admin accompanist directory RPC helpers; active `accompanist_membership` holders can edit display name, divisions, and directory opt-in/opt-out from `CustomerAccountMembershipsPage.tsx`; and Organization Admins can hide (`rejected`) or reinstate (`approved`) accompanist profiles in one click from `AdminTeacherDirectoryPanel.tsx`.
- [G4] Opted-in active accompanists auto-approve (`'approved'`) without stranding in `'pending'`; Admin `'rejected'` hides are preserved across customer upserts, edits, and renewals; inactive/expired/revoked/superseded accompanists are excluded from public directory listings (`queryPublicDirectoryAccompanists` + `in-memory-org-profiles.ts` + `publicDirectoryHelpers.ts`, `isActiveMember === true`) and blocked from opting in via `ParticipantDirectoryService.upsertAccompanistProfile` while still permitted to opt out; all modified production files stay `<= 500` lines; and full unit + PostgreSQL 17 integration verification passes with `0` errors and `0` warnings.

## Next action
After `S17` is `DONE` on `origin/main`, execute `tasks/s18-issue-416-accompanist-public-directory-parity/spec.md` on an isolated branch (`feat/s18-issue-416-accompanist-public-directory-parity`) off `origin/main`, then hand off to `S14` for final `v0.4.0` release cutover ahead of `Dec 1`.
