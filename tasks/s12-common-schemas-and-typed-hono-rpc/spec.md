# S12 — Shared Runtime Schemas (`@festival/common`) & Typed Hono RPC (Track 6)

## Goal reference
- Locked goals: `goals/s12-common-schemas-and-typed-hono-rpc/goals.v0.md`
- Goal establishment record: `goals/s12-common-schemas-and-typed-hono-rpc/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/common/package.json`, root `bun.lock`, `packages/common/src/{tenant,catalog,customer,directory,registration,registration-validation,room,commerce,volunteers,schema-utils,index}.ts`, and `packages/common/tests/**` — shared `valibot` runtime schemas and inferred DTO types consolidating all 33 drifted DTOs.
- `packages/backend/src/routes/**` (including `packages/backend/src/routes/route-security.ts`, `route-groups.ts`, `route-group-options.ts`, `commerce-group.routes.ts`, split `*.routes.ts` modules, `packages/backend/src/routes/shared/{route-security-metadata,schema-validator}.ts`) — typed Hono method-chained route groups exporting `AppType` types (`hc<AppType>`), `@festival/common` schema validation middleware, and co-located route-builder security metadata replacing the static tuple list.
- `packages/frontend/src/lib/api.ts` and `packages/frontend/src/lib/api/**` (`client.ts`, `auth.ts`, `org-admin.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`) — typed `hc<AppType>` / shared-transport domain API clients (`<=500`L/file, `<=60`L/fn) plus compatibility barrel re-exports in `packages/frontend/src/lib/api.ts` (`<=200`L).
- `packages/backend/tests/route-security.test.ts`, `packages/frontend/tests/api/**`, and source-scanning test path updates in `packages/frontend/tests/{admin-festivals,admin-rooms,admin-roster,admin-volunteer-roles,customer-account,festival-admin-classes,onboarding-integration}.test.ts` — route security fail-closed verification and typed client contract tests.

### Out of scope
- `packages/backend/src/domains/**`, `packages/backend/src/repo/**`, `packages/backend/src/services/**`, `packages/backend/src/customer/**`, `packages/backend/src/checkout/**`, `packages/backend/src/commerce/**`, `packages/backend/src/shopify/**`, `packages/backend/src/repertoire/**`, and `packages/backend/src/registration/**` (locked by Wave 3 packets `S09`–`S11`).
- `packages/frontend/src/app/**`, `packages/frontend/src/lib/routes.ts`, `packages/frontend/src/pages/**`, and `packages/frontend/src/components/**` (locked by parallel Wave 3 packet `S13`).
- `packages/backend/src/app.ts` DI wiring and release files (locked by Wave 4 packet `S14`).

## Approach
1. **Author `@festival/common` Domain Schemas**: Add pinned `valibot` (lightweight tree-shakeable runtime validator, or `zod` if already present) to `@festival/common`. Group the 33 duplicated frontend/backend DTOs into the 7 bounded-context schema files (`tenant.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`), each `<=500`L, exporting both runtime schemas and `InferOutput`/`InferInput` TypeScript types.
2. **Co-Located Route Security Metadata**: Introduce a lightweight route-registration helper in `packages/backend/src/routes/shared/` that attaches `{ authClass, csrfRequired, browserAllowed }` metadata at route definition time. Migrate all routers off the 919-line static tuple array in `packages/backend/src/routes/route-security.ts` while keeping `assertRouteSecurityInventory(app.routes)` fail-closed at startup if any route lacks explicit metadata or violates security invariants.
3. **Typed Hono Route Groups (`hc<AppType>`)**: Chain route definitions per bounded-context router (`new Hono().get(...).post(...)`) using `@festival/common` schema validators and export route-group types (`OrgAdminRoutesType`, `CatalogRoutesType`, `CustomerRoutesType`, `DirectoryRoutesType`, `RegistrationRoutesType`, `CommerceRoutesType`, `VolunteersRoutesType`, `AuthRoutesType`) without runtime side effects on frontend bundles (`import type`).
4. **Split `packages/frontend/src/lib/api.ts` (`2,783`L)**: Extract shared HTTP/CSRF/auth-header transport helpers into `packages/frontend/src/lib/api/client.ts` (preserving `logoutCustomer` form POST behavior) and split domain calls into `org-admin.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`, and `auth.ts` backed by `hc<...>` types and `@festival/common` DTOs. Keep `packages/frontend/src/lib/api.ts` as a thin re-export barrel so `S13` requires zero merge conflict resolution.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s12-common-schemas-and-typed-hono-rpc
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- Consolidated 33 duplicated DTOs and added pinned `valibot` runtime schemas across `packages/common/src/{tenant,catalog,customer,directory,registration,registration-validation,commerce,volunteers,schema-utils,index}.ts` (with compatibility re-exports in `room.ts`), covered by `packages/common/tests/schemas.test.ts`.
- Extracted co-located route security metadata (`packages/backend/src/routes/shared/route-security-metadata.ts`) and shared Valibot validation middleware (`packages/backend/src/routes/shared/schema-validator.ts`) across all backend route groups (`OrgAdminRoutesType`, `CatalogRoutesType`, `CustomerRoutesType`, `DirectoryRoutesType`, `RegistrationRoutesType`, `CommerceRoutesType`, `VolunteersRoutesType`, `AuthRoutesType`, `ApiRoutesType`), shrinking `packages/backend/src/routes/route-security.ts` from 948 lines to 144 lines while preserving `assertRouteSecurityInventory` across all 171 mounted routes (`packages/backend/tests/route-security.test.ts`).
- Split `packages/frontend/src/lib/api.ts` into a 120-line compatibility barrel and 9 typed Hono `hc` client modules under `packages/frontend/src/lib/api/{client,auth,org-admin,catalog,customer,directory,registration,commerce,volunteers}.ts` (preserving `logoutCustomer` HTML form POST, URL parameter encoding, empty-query omission, and canonical header casing), updated affected frontend source-scanning tests, and added `packages/frontend/tests/api/api-clients.test.ts`.
- Independent code review completed in `tasks/s12-common-schemas-and-typed-hono-rpc/code-review.md` with `Findings status: none` and `Verdict: patch is correct`.

## Quality gate results
- Toolchain & static checks (`verify:toolchain`, `format:check` across 792 files, `lint` across 792 files, `build`, `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`, `bun run --cwd packages/frontend check:types`, `check:sql` across 495 backend TypeScript files): passed (exit code 0).
- Common, frontend, and confirmation suites (`POSTGRES_INTEGRATION_URL` set): `test:common` passed (`360 pass, 0 fail` across 23 files), `test:frontend` passed (`476 pass, 0 fail` across 54 files), `test:confirmation` passed (`20 pass, 0 fail` across 1 file).
- Backend test suite (`POSTGRES_INTEGRATION_URL` / `DATABASE_URL` set to Postgres 17 `festival_test`): passed across all 152 backend test files (`1624 pass, 0 fail` total), executed cleanly in Windows Bun 1.4.2 non-contending batches (`tests/migrate-runner.test.ts`: `9 pass`; `tests/read-models-query-count.integration.test.ts`: `3 pass`; 105 root test files before `read-models-query-count`: `1240 pass`; 34 root test files after `read-models-query-count`: `337 pass`; `tests/domains` across 11 files: `35 pass`).
- Packet validation and independent code review: verified via `validate-packet.ps1` (`-RequireCodeReview`) and `tasks/s12-common-schemas-and-typed-hono-rpc/code-review.md`.
