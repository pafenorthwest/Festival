# Establish Goals
- Task name: s10-split-customer-identity-and-teacher-directory
- Iteration: v0
- State: locked

## Status
Goals locked for Wave 3 (`Nov 18–21`, Parallel Group W3, Track 5A/5B Slice 2: `customer-identity` & `teacher-directory` Decomposition).

## Request
Extract `packages/backend/src/domains/customer-identity/**` (`CustomerOAuthSessionService`, `CustomerProfileService`, `CustomerChildProfileService`) and `packages/backend/src/domains/teacher-directory/**` from `customer-account-service.ts` (`2,122`L), `postgres-customer-account-repository.ts` (`885`L), and directory/membership slices; enforce `<=500`L/file, `<=60`L/fn; and retire `InMemoryCustomerAccountRepository` SQL clones behind Postgres 17 tests.

## Blocking ambiguity
None.

## Assumptions
- Baseline `v0.3.0` (including `#354` registration queries and `#361` public teacher directory) and Wave 2 (`S06`–`S08`, including `#358` cache invalidation bus) are merged to `main`.
- Per `specs/bounded-contexts-2026.md` Sections 4.3 and 4.5, `CustomerRegistrationQueryService` (`customer-registration-query-service.ts` — `listRegistrationEligibleClasses`, `listClassRegistrations`) belongs to `domains/class-checkout/**` in parallel packet `S11`, not `domains/customer-identity/**`. `postgres-membership-commerce-repository.ts` (`1,309`L) is also locked by `S11`; `S10` defines clean `MembershipEntitlementRepository`, `MembershipProductRepository`, and `TeacherDirectoryRepository` contracts/queries inside `domains/teacher-directory/**` without editing `postgres-membership-commerce-repository.ts` directly (cross-wiring in `app.ts` finalizes in `S14`).
- Thin compatibility facades remain at `packages/backend/src/customer/customer-account-service.ts` and `packages/backend/src/participant-profile/**` so `app.ts` and existing routers require zero merge-conflicting edits during Wave 3.

## Goals
1. Extract the `customer-identity` bounded context (`packages/backend/src/domains/customer-identity/**`) owning `orgs.shopify_customer_account_integrations`, `orgs.shopify_customer_oauth_states`, `orgs.shopify_customer_sessions`, `orgs.festival_customers`, `orgs.festival_customer_staff_consents`, `orgs.festival_customer_profile_access_audit`, `orgs.festival_children`, and `orgs.festival_child_age_snapshots` by decomposing OAuth/session, customer profile/consent, and child/age-snapshot slices out of `customer-account-service.ts` (`2,122`L) into `CustomerOAuthSessionService`, `CustomerProfileService`, and `CustomerChildProfileService` and splitting `postgres-customer-account-repository.ts` (`885`L).
2. Extract the `teacher-directory` bounded context (`packages/backend/src/domains/teacher-directory/**`) owning `orgs.teacher_profiles`, `orgs.teacher_profile_divisions`, `orgs.accompanist_profiles`, `orgs.accompanist_profile_divisions`, `orgs.products`, `orgs.membership_division_policies`, `orgs.membership_division_policy_history`, `orgs.membership_entitlements`, `orgs.membership_entitlement_divisions`, `orgs.membership_entitlement_cohorts`, `orgs.membership_entitlement_revocations`, `orgs.membership_identity_emails`, `orgs.teacher_membership_entitlement_details`, and `orgs.accompanist_membership_entitlement_details` (including `#361` public teacher directory visibility/opt-in, membership status, and cohort services), emitting `TeacherDirectoryChanged` and `MembershipChanged` domain events.
3. Enforce strict repository and service modularity (`<=500` lines/file, `<=250` lines/class, `<=60` lines/function) and `specs/bounded-contexts-2026.md` DAG import rules (`domains/customer-identity/**` cross-domain imports restricted strictly to `domains/tenant-org`; `domains/teacher-directory/**` cross-domain imports permitted only from `domains/tenant-org`, `domains/catalog-repertoire`, and `domains/customer-identity`) while preserving thin legacy facades so `app.ts` and parallel Wave 3 worktrees merge cleanly.
4. Retire `InMemoryCustomerAccountRepository` and duplicate in-memory directory/membership SQL emulators in favor of transactional Postgres 17 integration tests and minimal unit-test interface stubs.

## Non-goals
- Modifying `tenant-org` or `catalog-repertoire` files (`postgres-organization-repository.ts`, `organization-service.ts`, `repertoire/**`) owned by parallel Wave 3 packet `S09`.
- Extracting `CustomerRegistrationQueryService` (`customer-registration-query-service.ts` — `listRegistrationEligibleClasses`, `listClassRegistrations`) or modifying `class-checkout` / `commerce-projection` files (`domains/class-checkout/**`, `class-checkout-service.ts`, `shopify/admin-api-client.ts`, `shopify-order-projection-service.ts`, `postgres-membership-commerce-repository.ts`, `drop-transfer-service.ts`) owned by parallel Wave 3 packet `S11`.
- Modifying `@festival/common` DTO schemas, `route-security.ts`, frontend API clients (`S12`), frontend SolidJS state (`S13`), or final `packages/backend/src/app.ts` DI cleanup (`S14`).

## Success criteria
- [G1] `packages/backend/src/domains/customer-identity/**` isolates `CustomerOAuthSessionService`, `CustomerProfileService`, `CustomerChildProfileService`, and split Postgres repositories (`customer-integration-repository.ts`, `customer-session-repository.ts`, `customer-profile-repository.ts`, `child-profile-repository.ts` — `<=500`L/file, `<=60`L/fn), preserving `#358` cache invalidation (`CustomerIntegrationRotated`, `ChildUpdated`) with cross-domain imports strictly limited to `domains/tenant-org`.
- [G2] `packages/backend/src/domains/teacher-directory/**` isolates `TeacherDirectoryRepository`, `MembershipProductRepository`, `MembershipEntitlementRepository`, and directory/membership services (`#361` opt-in + admin toggle intact), publishing `TeacherDirectoryChanged` and `MembershipChanged` events and importing cross-domain only from `domains/tenant-org`, `domains/catalog-repertoire`, and `domains/customer-identity`.
- [G3] Every created or modified file in `S10` complies with `<=500` lines/file, `<=250` lines/class, and `<=60` lines/function, and `packages/backend/tests/architecture-boundaries.test.ts` passes with zero boundary violations.
- [G4] `InMemoryCustomerAccountRepository` SQL-emulator clones are retired, customer/directory integration suites pass against real Postgres 17 (`POSTGRES_INTEGRATION_URL`), and zero files owned by `S09`, `S11`, `S12`, `S13`, or `S14` are modified.

## Next action
Execute `tasks/s10-split-customer-identity-and-teacher-directory/spec.md` in an isolated Wave 3 git worktree (`refactor/s10-split-customer-identity-and-teacher-directory`).
