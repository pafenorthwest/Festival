# S12 — Shared Runtime Schemas (`@festival/common`) & Typed Hono RPC (Track 6)

## Goal reference
- Locked goals: `goals/s12-common-schemas-and-typed-hono-rpc/goals.v0.md`
- Goal establishment record: `goals/s12-common-schemas-and-typed-hono-rpc/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/common/package.json`, root `bun.lock`, `packages/common/src/tenant.ts`, `packages/common/src/catalog.ts`, `packages/common/src/customer.ts`, `packages/common/src/directory.ts`, `packages/common/src/registration.ts`, `packages/common/src/commerce.ts`, `packages/common/src/volunteers.ts`, `packages/common/src/index.ts`, and `packages/common/tests/**` — shared `valibot` (or `zod`) runtime schemas and inferred DTO types consolidating all 33 drifted DTOs.
- `packages/backend/src/routes/**` (including `packages/backend/src/routes/route-security.ts` `919`L and `packages/backend/src/routes/shared/**`) — typed Hono method-chained route groups exporting `AppType` types (`hc<AppType>`), schema validation middleware, and co-located route-builder security metadata replacing the static 919-line tuple list.
- `packages/frontend/src/lib/api.ts` (`2,783`L) and `packages/frontend/src/lib/api/**` (`client.ts`, `auth.ts`, `org-admin.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`) — typed `hc<AppType>` / shared-transport domain API clients (`<=500`L/file, `<=60`L/fn) plus compatibility barrel re-exports in `packages/frontend/src/lib/api.ts`.
- `packages/backend/tests/route-security.test.ts` and `packages/frontend/tests/api/**` — route security fail-closed verification and typed client contract tests.

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
Pending execution.

## Quality gate results
Pending execution.
