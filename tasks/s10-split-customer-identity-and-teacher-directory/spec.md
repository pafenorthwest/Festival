# S10 — Split `customer-identity` & `teacher-directory` Bounded Contexts (Track 5A/5B Slice 2)

## Goal reference
- Locked goals: `goals/s10-split-customer-identity-and-teacher-directory/goals.v0.md`
- Goal establishment record: `goals/s10-split-customer-identity-and-teacher-directory/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/backend/src/domains/customer-identity/**` — `CustomerOAuthSessionService` (`customer-oauth-session-service.ts` — Shopify Customer Account OAuth/PKCE/OIDC, session rotation, logout), `CustomerProfileService` (`customer-profile-service.ts` — customer contact profile provenance, staff consent & access audit), `CustomerChildProfileService` (`customer-child-profile-service.ts` — children CRUD, 90-day age snapshots), and split Postgres repositories (`customer-integration-repository.ts`, `customer-session-repository.ts`, `customer-profile-repository.ts`, `child-profile-repository.ts`). Cross-domain imports in `domains/customer-identity/**` are restricted strictly to `domains/tenant-org`.
- `packages/backend/src/domains/teacher-directory/**` — `TeacherDirectoryRepository` (`teacher-directory-repository.ts`), `MembershipProductRepository` (`membership-product-repository.ts`), `MembershipEntitlementRepository` (`membership-entitlement-repository.ts`), `ParticipantDirectoryService` (`participant-directory-service.ts` — `#361` opt-in & staff visibility/approval), `MembershipEntitlementService` (`membership-entitlement-service.ts`, including membership status & accompanist cohort logic), and `PublicMembershipProductService` (`public-membership-product-service.ts`), emitting `TeacherDirectoryChanged` and `MembershipChanged` events. Cross-domain imports in `domains/teacher-directory/**` are permitted only from `domains/tenant-org`, `domains/catalog-repertoire`, and `domains/customer-identity`.
- `packages/backend/src/customer/customer-account-service.ts` (`2,122`L), `packages/backend/src/customer/postgres-customer-account-repository.ts` (`885`L), `packages/backend/src/customer/customer-account-repository.ts`, and `packages/backend/src/customer/in-memory-customer-account-repository.ts` — replace monolith bodies with `<=500`L delegating facades (retaining thin legacy compatibility pass-throughs for registration query callers until `S14` wires `S11`'s `CustomerRegistrationQueryService`) and retire `InMemoryCustomerAccountRepository` SQL emulation.
- `packages/backend/src/participant-profile/**`, `packages/backend/src/commerce/membership-status-service.ts`, `packages/backend/src/commerce/accompanist-membership-service.ts`, and `packages/backend/src/shopify/public-membership-product-service.ts` — relocate core logic into `domains/teacher-directory/**` with thin re-exports.
- `packages/backend/tests/domains/customer-identity/**`, `packages/backend/tests/domains/teacher-directory/**`, and existing customer/directory backend test files migrated from `InMemory*` to Postgres 17 integration tests and unit stubs.

### Out of scope
- `packages/backend/src/domains/tenant-org/**`, `packages/backend/src/domains/catalog-repertoire/**`, `packages/backend/src/repo/**`, `packages/backend/src/services/organization-service.ts`, `packages/backend/src/repertoire/**`, and `packages/backend/src/rooms/**` (locked by parallel Wave 3 packet `S09`).
- `packages/backend/src/domains/class-checkout/**` (including `customer-registration-query-service.ts` — `listRegistrationEligibleClasses` and `listClassRegistrations`), `packages/backend/src/domains/commerce-projection/**`, `packages/backend/src/checkout/**`, `packages/backend/src/commerce/shopify-order-projection-service.ts`, `packages/backend/src/commerce/shopify-webhook-service.ts`, `packages/backend/src/commerce/postgres-membership-commerce-repository.ts`, `packages/backend/src/shopify/admin-api-client.ts`, `packages/backend/src/registration/**`, and `packages/backend/src/billing/**` (locked by parallel Wave 3 packet `S11`).
- `packages/common/src/**`, `packages/backend/src/routes/route-security.ts`, `packages/frontend/src/lib/api.ts`, and `packages/frontend/src/lib/api/**` (locked by Wave 3 packet `S12`).
- `packages/frontend/src/app/**`, `packages/frontend/src/lib/routes.ts`, `packages/frontend/src/pages/**`, and `packages/frontend/src/components/**` (locked by parallel Wave 3 packet `S13`).
- `packages/backend/src/app.ts` — keep existing `CustomerAccountService` / `ParticipantProfileService` constructor signatures working via thin facades until `S14`.

## Approach
1. **Decompose `CustomerAccountService` (`2,122`L) & `PostgresCustomerAccountRepository` (`885`L) into `domains/customer-identity/`**:
   - Split `customer-identity` SQL persistence into `customer-integration-repository.ts` (`orgs.shopify_customer_account_integrations`), `customer-session-repository.ts` (`orgs.shopify_customer_oauth_states`, `orgs.shopify_customer_sessions`), `customer-profile-repository.ts` (`orgs.festival_customers`, `orgs.festival_customer_staff_consents`, `orgs.festival_customer_profile_access_audit`), and `child-profile-repository.ts` (`orgs.festival_children`, `orgs.festival_child_age_snapshots` CTE with strict ISO string formatting). Ensure every method stays `<=60` lines and every file `<=500` lines.
   - Split `customer-identity` domain logic into `CustomerOAuthSessionService`, `CustomerProfileService`, and `CustomerChildProfileService` (restricting cross-domain imports strictly to `domains/tenant-org`), while keeping a thin `<=500`L delegating `CustomerAccountService` facade at `packages/backend/src/customer/customer-account-service.ts` for `app.ts` compatibility (`CustomerRegistrationQueryService` is extracted into `domains/class-checkout/` by `S11` and wired in `S14`).
2. **Extract `teacher-directory` (`#361` & Memberships)**:
   - Move participant profile/directory repositories and services plus `MembershipStatusService`, `AccompanistMembershipService`, and `PublicMembershipProductService` into `packages/backend/src/domains/teacher-directory/**`, implementing `PostgresTeacherDirectoryRepository` (`orgs.teacher_profiles`, `orgs.teacher_profile_divisions`, `orgs.accompanist_profiles`, `orgs.accompanist_profile_divisions`), `PostgresMembershipProductRepository` (`orgs.products`, `orgs.membership_division_policies`, `orgs.membership_division_policy_history`), and `PostgresMembershipEntitlementRepository` (`orgs.membership_entitlements`, `orgs.membership_entitlement_divisions`, `orgs.membership_entitlement_cohorts`, `orgs.membership_entitlement_revocations`, `orgs.membership_identity_emails`, `orgs.teacher_membership_entitlement_details`, `orgs.accompanist_membership_entitlement_details`), permitting cross-domain imports only from `domains/tenant-org`, `domains/catalog-repertoire`, and `domains/customer-identity`.
   - Emit `CustomerIntegrationRotated`, `ChildUpdated`, `TeacherDirectoryChanged`, and `MembershipChanged` on the shared invalidation bus.
3. **Retire `InMemoryCustomerAccountRepository` & Verify**: Delete SQL-emulating in-memory repository implementations, migrate customer OAuth/profile/children/directory test suites to transactional Postgres 17 tests (`POSTGRES_INTEGRATION_URL`) plus thin unit stubs, and verify `architecture-boundaries.test.ts` passes.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s10-split-customer-identity-and-teacher-directory
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
