# Goals Extract
- Task name: s09-split-tenant-org-and-catalog-repertoire
- Iteration: v0
- State: locked

## Goals
1. Extract the `tenant-org` bounded context (`packages/backend/src/domains/tenant-org/**`) owning `orgs.organizations`, `orgs.registration_age_configurations`, `orgs.users`, `orgs.app_user`, `orgs.user_login_event`, `orgs.memberships`, `orgs.invites`, `orgs.rooms`, and `orgs.room_piano_configurations` from `postgres-organization-repository.ts` (`3,636`L) and `organization-service.ts` (`1,416`L), emitting `OrgUpdated` and `RegistrationAgeConfigUpdated` domain events.
2. Extract the `catalog-repertoire` bounded context (`packages/backend/src/domains/catalog-repertoire/**`) owning `orgs.organization_divisions`, `orgs.festivals`, `orgs.registration_catalog_values`, `orgs.festival_class_subtypes`, `orgs.festival_class_configurations`, `orgs.festival_class_capacity_audit_logs`, and `orgs.repertoire_*` from `postgres-organization-repository.ts` (`3,636`L), `organization-service.ts` (`1,416`L), and `postgres-repertoire-repository.ts` (`908`L), emitting `FestivalCatalogUpdated` and `RepertoireUpdated` domain events.
3. Enforce strict modular size and dependency boundaries across all extracted files (`<=500` lines/file, `<=250` lines/class, `<=60` lines/function, acyclic `tenant-org` <- `catalog-repertoire` imports) while keeping thin compatibility re-exports for `app.ts` so parallel Wave 3 worktrees merge with zero conflicts.
4. Retire `tenant-org` and `catalog-repertoire` SQL-emulator slices inside `InMemoryOrganizationRepository` (`2,333`L), `InMemoryAppUserRepository`, `InMemoryRoomRepository`, and `InMemoryRepertoireRepository` in favor of transactional Postgres 17 integration tests and minimal unit stubs.

## Non-goals
- Extracting `customer-identity` or `teacher-directory` repositories/services (locked by parallel Wave 3 packet `S10`).
- Extracting `class-checkout` or `commerce-projection` repositories/services (locked by parallel Wave 3 packet `S11`).
- Rewriting `@festival/common` DTO schemas, `route-security.ts`, frontend API clients (`S12`), frontend SolidJS state (`S13`), or final `packages/backend/src/app.ts` DI cleanup (`S14`).

## Success criteria
- [G1] `packages/backend/src/domains/tenant-org/**` implements `TenantRepository`, `AppUserMembershipRepository`, `RoomRepository`, and focused tenant/staff/age-config services against owned `orgs.*` tables, publishing `OrgUpdated` and `RegistrationAgeConfigUpdated` events verified by Postgres 17 integration tests.
- [G2] `packages/backend/src/domains/catalog-repertoire/**` implements `DivisionFestivalRepository`, `RegistrationCatalogRepository`, and modularized repertoire repositories/services (`#360` concertos compatible), publishing `FestivalCatalogUpdated` and `RepertoireUpdated` events verified by Postgres 17 integration tests.
- [G3] Every file in `domains/tenant-org/**`, `domains/catalog-repertoire/**`, and touched legacy facades satisfies `<=500` lines/file, `<=250` lines/class, and `<=60` lines/function, and `packages/backend/tests/architecture-boundaries.test.ts` passes with zero cross-domain cycle violations.
- [G4] Duplicate `InMemory*` SQL-emulator methods for `tenant-org` and `catalog-repertoire` are deleted, migrated test suites pass against real Postgres 17 (`POSTGRES_INTEGRATION_URL`) plus lightweight interface stubs, and zero out-of-scope Wave 3 sibling files are modified.
