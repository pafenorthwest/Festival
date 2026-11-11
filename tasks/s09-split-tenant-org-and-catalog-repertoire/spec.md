# S09 — Split `tenant-org` & `catalog-repertoire` Bounded Contexts (Track 5A/5B Slice 1)

## Goal reference
- Locked goals: `goals/s09-split-tenant-org-and-catalog-repertoire/goals.v0.md`
- Goal establishment record: `goals/s09-split-tenant-org-and-catalog-repertoire/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/backend/src/domains/tenant-org/**` — `TenantRepository`, `AppUserMembershipRepository`, `RoomRepository`, `TenantOrganizationService`, `OrganizationStaffInviteService`, `OrganizationAgeConfigService`, and public `index.ts` barrel (`OrgUpdated`, `RegistrationAgeConfigUpdated` invalidation events).
- `packages/backend/src/domains/catalog-repertoire/**` — `DivisionFestivalRepository`, `RegistrationCatalogRepository`, split repertoire repositories (`repertoire-catalog-repository.ts`, `repertoire-submission-repository.ts`), `DivisionFestivalService`, `RegistrationCatalogService`, and `RepertoireService` (`FestivalCatalogUpdated`, `RepertoireUpdated` events).
- `packages/backend/src/repo/postgres-organization-repository.ts` (`3,636`L), `packages/backend/src/repo/organization-repository.ts`, and `packages/backend/src/repo/in-memory-organization-repository.ts` (`2,333`L) — extract `tenant-org` and `catalog-repertoire` methods into `domains/tenant-org/**` and `domains/catalog-repertoire/**`, retire `InMemory*` SQL-emulator clones, and retain a thin delegating compatibility adapter (`<=500`L) for unmigrated callers until `S14`.
- `packages/backend/src/repo/app-user-repository.ts`, `packages/backend/src/repo/postgres-app-user-repository.ts`, `packages/backend/src/repo/in-memory-app-user-repository.ts`, and `packages/backend/src/rooms/**` — move concrete implementations under `domains/tenant-org/**` with thin re-exports.
- `packages/backend/src/services/organization-service.ts` (`1,416`L) — decompose into `domains/tenant-org/**` and `domains/catalog-repertoire/**` services (`<=500`L/file, `<=250`L/class, `<=60`L/fn) behind a thin delegating facade.
- `packages/backend/src/repertoire/**` (`postgres-repertoire-repository.ts` `908`L and `in-memory-repertoire-repository.ts`) — split into `domains/catalog-repertoire/**` (`<=500`L/file) and retire `InMemoryRepertoireRepository` SQL emulation.
- `packages/backend/tests/domains/tenant-org/**`, `packages/backend/tests/domains/catalog-repertoire/**`, and existing org/catalog/repertoire backend test files migrated from `InMemory*` to Postgres 17 integration suites or thin unit stubs.

### Out of scope
- `packages/backend/src/domains/customer-identity/**`, `packages/backend/src/domains/teacher-directory/**`, `packages/backend/src/customer/**`, `packages/backend/src/participant-profile/**`, and `packages/backend/src/shopify/public-membership-product-service.ts` (locked by parallel Wave 3 packet `S10`).
- `packages/backend/src/domains/class-checkout/**`, `packages/backend/src/domains/commerce-projection/**`, `packages/backend/src/checkout/**`, `packages/backend/src/commerce/**`, `packages/backend/src/shopify/admin-api-client.ts`, `packages/backend/src/registration/**`, and `packages/backend/src/billing/**` (locked by parallel Wave 3 packet `S11`).
- `packages/common/src/**`, `packages/backend/src/routes/route-security.ts`, `packages/frontend/src/lib/api.ts`, and `packages/frontend/src/lib/api/**` (locked by Wave 3 packet `S12`).
- `packages/frontend/src/app/**`, `packages/frontend/src/lib/routes.ts`, `packages/frontend/src/pages/**`, and `packages/frontend/src/components/**` (locked by parallel Wave 3 packet `S13`).
- `packages/backend/src/app.ts` — keep existing import paths and constructor signatures intact via thin facades; final `app.ts` DI cleanup is locked for `S14`.

## Approach
1. **Boundary & Contract Setup**: Create `packages/backend/src/domains/tenant-org/` and `packages/backend/src/domains/catalog-repertoire/` respecting the acyclic dependency rule (`catalog-repertoire` may depend only on `tenant-org` public exports and `@festival/common`; `tenant-org` depends on zero sibling domains).
2. **Repository Decomposition (`<=500`L/file, `<=250`L/class, `<=60`L/fn)**:
   - Partition `PostgresOrganizationRepository` (`3,636`L) into `PostgresTenantRepository` (`orgs.organizations`, `orgs.registration_age_configurations` — timezone and registration age cutoff), `PostgresAppUserMembershipRepository` (`orgs.users`, `orgs.app_user`, `orgs.user_login_event`, `orgs.memberships`, `orgs.invites`, Firebase claim lock helpers), `PostgresRoomRepository` (`orgs.rooms`, `orgs.room_piano_configurations`), `PostgresDivisionFestivalRepository` (`orgs.organization_divisions`, `orgs.festivals`), and `PostgresRegistrationCatalogRepository` (`orgs.registration_catalog_values`, `orgs.festival_class_subtypes`, `orgs.festival_class_configurations`, `orgs.festival_class_capacity_audit_logs`).
   - Split `PostgresRepertoireRepository` (`908`L) into focused catalog/work query and piece-submission modules under `domains/catalog-repertoire/`.
3. **Service Decomposition & Event Wiring**: Split `OrganizationService` (`1,416`L) into cohesive domain services under `domains/tenant-org/` and `domains/catalog-repertoire/`, wiring `OrgUpdated`, `RegistrationAgeConfigUpdated`, `FestivalCatalogUpdated`, and `RepertoireUpdated` onto the Wave 2 (`S07`) invalidation bus. Keep thin delegating facades at legacy paths so `app.ts` and sibling domains compile untouched.
4. **Retire `InMemory*` Clones**: Replace `InMemoryOrganizationRepository` (`2,333`L) and `InMemoryRepertoireRepository` usages in org/catalog/repertoire tests with transactional Postgres 17 integration tests (`POSTGRES_INTEGRATION_URL`) for SQL behavior and concise `vi.fn()`/`mock()` interface stubs for pure service unit tests.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s09-split-tenant-org-and-catalog-repertoire
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
