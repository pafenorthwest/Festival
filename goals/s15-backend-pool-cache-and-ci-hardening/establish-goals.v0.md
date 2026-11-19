# Establish Goals
- Task name: s15-backend-pool-cache-and-ci-hardening
- Iteration: v0
- State: locked

## Status
Goals locked for post-`S14` backend token-refresh concurrency limiting, public organization cache invalidation, CI parity, and tiered file-size ratchet enforcement (`#407`, `#383`, `#216`), kept disjoint from PRs `#411`, `#412`, and `#413`.

## Request
Protect the Postgres pool during Shopify customer token refreshes using a bounded concurrency bulkhead and per-session coalescing before `sql.reserve()` without adding a database migration (`#407`), wire `TenantOrganizationService.publicOrganizationListCache` to `DomainCacheInvalidator` (`#383`), close `.github/workflows/pr-checks.yml` `push: [main]` and `.github/workflows/integration.yml` CI gaps, and add a tiered file-size ratchet (`<= 500` lines for new `.ts`/`.tsx` production files and `<= 2,000`-line initial grandfather ceiling for existing non-domain files) while leaving `__Host-` OAuth cookies in `customer-auth.routes.ts` and all PR `#411`/`#412`/`#413` files untouched.

## Blocking ambiguity
None.

## Assumptions
- `S06` (`orgs.schema_migrations` ledger + `check:schema-parity`), `S07` (`DomainCacheInvalidator`), `S10` (`domains/customer-identity`), and `S14` (`packages/backend/src/composition/`) are present on `main`.
- No database migration is needed in `S15`: `withSessionRefreshLock` keeps `pg_try_advisory_lock` and `encrypted_tokens` CAS while a process-local concurrency limiter with a retryable `503` acquire timeout before `await sql.reserve()` and unconditional per-session coalescing protect `DB_POOL_MAX` (`database/` stays untouched).
- The `__Host-` OAuth browser-binding cookie in `packages/backend/src/routes/customer-auth/customer-auth.routes.ts` remains unchanged (`customer-auth.routes.ts` is out of scope).
- Open PR `#411` (plan/docs), PR `#412` (`#336`), and PR `#413` (`#410` checkout restoration and `can_read_orders` / OAuth login-readiness decoupling) are active concurrently and must have zero file overlap with `S15`.

## Goals
1. Add a bounded token-refresh concurrency limiter (`packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts`) with a retryable `503` acquire timeout before `await sql.reserve()`, keep existing `pg_try_advisory_lock` and `encrypted_tokens` CAS in `packages/backend/src/domains/customer-identity/customer-session-repository.ts` (`withSessionRefreshLock`), always coalesce refreshes per `(ctx.sessions, session.sessionId)` in `packages/backend/src/domains/customer-identity/customer-token-refresh.ts`, defer any `refresh_locked_until` migration (`database/` untouched), and add unit (`packages/backend/tests/customer-token-refresh-concurrency.test.ts`) and PostgreSQL 17 integration tests (`packages/backend/tests/customer-token-refresh-concurrency.integration.test.ts`) proving slow refreshes stay bounded and leave DB pool capacity open for unrelated queries (`#407`).
2. Subscribe `TenantOrganizationService.publicOrganizationListCache` (`4`h TTL) in `packages/backend/src/domains/tenant-org/tenant-organization-service.ts` to `DomainCacheInvalidator` (`OrgUpdated` and `CachesCleared`) via `deleteWhere(() => true)`, emit `OrgUpdated` immediately after `tenants.createOrganization(...)` (before `createMembership` so partial failures still invalidate public org cache), and verify invalidation with unit tests in `packages/backend/tests/domains/tenant-org/tenant-org.test.ts` (`#383`).
3. Add `push: branches: [main]` to `.github/workflows/pr-checks.yml` and align `.github/workflows/integration.yml` with `postgres:17-alpine`, `POSTGRES_INTEGRATION_URL`, lint/type/SQL/schema-parity checks, and pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts` matching `.github/workflows/deploy.yml`.
4. Add `packages/backend/tests/file-size-ratchet.test.ts` and `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` enforcing `<= 500` lines on new `.ts`/`.tsx` production files (alongside `domains/**`, `app.ts`, `composition/**`), grandfathering existing non-domain `.ts`/`.tsx` files at an initial ceiling of `<= 2,000` lines, and explicitly grandfathering SQL and schema files (`database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts`), while keeping `customer-auth.routes.ts`, `customer-identity/types.ts`, `in-memory-customer-account-repository.ts`, `postgres-customer-account-repository.ts`, `composition/runtime.ts`, and all PR `#411`, `#412`, and `#413` files untouched (`#216`).

## Non-goals
- Adding `refresh_locked_until` or modifying any file under `database/`.
- Modifying `packages/backend/src/routes/customer-auth/customer-auth.routes.ts` (`__Host-` OAuth cookie preserved), `packages/backend/src/domains/customer-identity/types.ts`, `packages/backend/src/customer/in-memory-customer-account-repository.ts`, `packages/backend/src/customer/postgres-customer-account-repository.ts`, or `packages/backend/src/composition/runtime.ts`.
- Touching any path owned by PR `#411` (`specs/**`, `docs/**`, `goals/**`, `tasks/s16-*`), PR `#412` (`#336` admin classes popover files), PR `#413` (`#410` checkout restoration, `can_read_orders` / OAuth login-readiness decoupling, `CustomerIdentityContext.tsx`, `nginx/*.conf`, `docker/nginx.festival.conf`, `specs/pending-shopify-checkout-restoration.md`), or `S16` (`AppRoutes.tsx`, `CHANGELOG.md`).
- Splitting existing grandfathered non-domain `.ts`/`.tsx` files already under `<= 2,000` lines.

## Success criteria
- [G1] `packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts` bounds active refresh slots with a retryable `503` acquire timeout before `await sql.reserve()`; `withSessionRefreshLock` keeps `pg_try_advisory_lock` and `encrypted_tokens` CAS (`replaceSessionTokens` / `revokeSession`) with `database/` untouched; `customer-token-refresh.ts` always coalesces per `(ctx.sessions, session.sessionId)`; and `packages/backend/tests/customer-token-refresh-concurrency.test.ts` plus `packages/backend/tests/customer-token-refresh-concurrency.integration.test.ts` pass on PostgreSQL 17 showing slow refreshes stay bounded and leave DB pool capacity open for unrelated queries.
- [G2] `TenantOrganizationService` in `packages/backend/src/domains/tenant-org/tenant-organization-service.ts` subscribes `publicOrganizationListCache` (`4`h TTL) to `DomainCacheInvalidator` (`OrgUpdated` and `CachesCleared`) via `deleteWhere(() => true)`, emits `OrgUpdated` immediately after `tenants.createOrganization(...)` before `createMembership`, and passes unit tests in `packages/backend/tests/domains/tenant-org/tenant-org.test.ts`.
- [G3] `.github/workflows/pr-checks.yml` runs on `push` to `main` (in addition to `pull_request`), and `.github/workflows/integration.yml` runs `postgres:17-alpine`, `POSTGRES_INTEGRATION_URL`, lint/type/SQL/schema-parity checks, and pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts` matching `.github/workflows/deploy.yml`.
- [G4] `packages/backend/tests/file-size-ratchet.test.ts` and `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` enforce `<= 500` lines on new `.ts`/`.tsx` production files (alongside `domains/**`, `app.ts`, `composition/**`), grandfather existing non-domain `.ts`/`.tsx` files at `<= 2,000` lines, and explicitly grandfather `database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts`; zero out-of-scope or PR `#411`/`#412`/`#413` files are touched; and full verification (`verify:toolchain`, `format:check`, `lint`, `build`, frontend/backend `tsc --noEmit`, `check:sql`, `check:schema-parity`, `architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, and Postgres 17 `bun run test`) passes with `0` errors and `0` warnings.

## Next action
Execute `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md` on an isolated branch (`fix/s15-backend-pool-cache-and-ci-hardening`) off `origin/main`.
