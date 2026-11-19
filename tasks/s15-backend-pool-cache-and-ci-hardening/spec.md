# S15 — Backend Pool Bulkhead, Cache Invalidation, CI Parity & File-Size Ratchet

## Goal reference
- Locked goals: `goals/s15-backend-pool-cache-and-ci-hardening/goals.v0.md`
- Goal establishment record: `goals/s15-backend-pool-cache-and-ci-hardening/establish-goals.v0.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md` (`customer-identity`, `tenant-org`, §5 Rule 4)

## Scope

### In scope
- `packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts` (new, `<= 500` lines) — bounded token-refresh concurrency limiter with a retryable `503` acquire timeout before `await sql.reserve()`.
- `packages/backend/src/domains/customer-identity/customer-session-repository.ts` (`withSessionRefreshLock`) and `packages/backend/src/domains/customer-identity/customer-token-refresh.ts` — acquire concurrency limiter permit ahead of `await sql.reserve()`, keep existing `pg_try_advisory_lock` and `encrypted_tokens` CAS (`replaceSessionTokens` / `revokeSession`), and always coalesce refreshes per `(ctx.sessions, session.sessionId)`.
- `packages/backend/tests/customer-token-refresh-concurrency.test.ts` and `packages/backend/tests/customer-token-refresh-concurrency.integration.test.ts` — unit and PostgreSQL 17 integration tests verifying bounded refresh concurrency, retryable `503` on acquire timeout, per-session coalescing, and open DB pool capacity for unrelated queries during slow refreshes.
- `packages/backend/src/domains/tenant-org/tenant-organization-service.ts` and `packages/backend/tests/domains/tenant-org/tenant-org.test.ts` — subscribe `publicOrganizationListCache` (`4`h TTL) to `DomainCacheInvalidator` (`OrgUpdated` and `CachesCleared`) via `deleteWhere(() => true)`, emit `OrgUpdated` immediately after `tenants.createOrganization(...)` before `createMembership`, and verify cache invalidation in unit tests.
- `.github/workflows/pr-checks.yml` and `.github/workflows/integration.yml` — add `push: branches: [main]` CI verification and align `integration.yml` with `postgres:17-alpine`, `POSTGRES_INTEGRATION_URL`, lint/type/SQL/schema-parity checks, and pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts` matching `.github/workflows/deploy.yml`.
- `packages/backend/tests/file-size-ratchet.test.ts` and `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` — enforce `<= 500` lines on new `.ts`/`.tsx` production files (alongside `domains/**`, `app.ts`, `composition/**`), grandfather existing non-domain `.ts`/`.tsx` files at an initial ceiling of `<= 2,000` lines, and explicitly grandfather SQL and schema files (`database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts`).
- Packet delivery and review tracking: `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md` and `tasks/s15-backend-pool-cache-and-ci-hardening/code-review.md`.

### Out of scope
- `database/**` (defer `refresh_locked_until` DB migration; zero SQL or schema changes in `S15`).
- `packages/backend/src/routes/customer-auth/customer-auth.routes.ts` (`__Host-` OAuth cookie preserved as-is) and `packages/backend/tests/customer-auth.routes.test.ts`.
- `packages/backend/src/domains/customer-identity/types.ts`, `packages/backend/src/customer/in-memory-customer-account-repository.ts`, `packages/backend/src/customer/postgres-customer-account-repository.ts`, and `packages/backend/src/composition/runtime.ts`.
- PR `#411` plan/docs files (`specs/pre-thanksgiving-program.md`, `docs/issue-pr-roadmap.md`, `goals/**`, `tasks/s16-post-410-session-scope-and-size-trim/**`, `CHANGELOG.md`).
- PR `#412` (`#336` admin classes popover) files:
  - `packages/frontend/src/styles.css`
  - `packages/frontend/src/components/FestivalClassModal.tsx`
  - `packages/frontend/src/pages/FestivalAdminClassesPage.tsx`
- PR `#413` (`#410` checkout restoration and `can_read_orders` / OAuth login-readiness decoupling) paths:
  - `packages/backend/src/domains/class-checkout/**`
  - `packages/backend/src/domains/commerce-projection/**`
  - `packages/frontend/src/lib/registrationCartState.ts`
  - `packages/frontend/src/domains/registration/**`
  - `packages/frontend/src/pages/useFestivalRegistrationPage.ts`
  - `packages/frontend/src/components/AppHeader.tsx`
  - `packages/frontend/src/domains/customer/CustomerIdentityContext.tsx`
  - `nginx/*.conf` and `docker/nginx.festival.conf`
  - `specs/pending-shopify-checkout-restoration.md`
  - Any other files touched by PR `#413` (`can_read_orders` / OAuth login-readiness decoupling and checkout restoration).
- `S16`-scoped files (`packages/frontend/src/app/AppRoutes.tsx`, `CHANGELOG.md`).
- Unrelated `packages/frontend/**`, `packages/common/**`, `packages/shopify-confirmation/**`, and other `tasks/**` directories.

## Approach
1. **Token Refresh Concurrency Bulkhead (`#407`)**:
   - Create `packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts` implementing a bounded async permit pool with a configurable acquire timeout that throws a retryable `AppError(..., 503)` when saturated.
   - Update `PostgresCustomerSessionRepository.withSessionRefreshLock` in `packages/backend/src/domains/customer-identity/customer-session-repository.ts` to acquire a limiter permit *before* calling `await sql.reserve()`, while retaining the existing PostgreSQL advisory lock (`pg_try_advisory_lock`) and `encrypted_tokens` CAS (`replaceSessionTokens` / `revokeSession`). Keep `database/` untouched (no `refresh_locked_until` migration).
   - Update `refreshSessionTokens` in `packages/backend/src/domains/customer-identity/customer-token-refresh.ts` to always coalesce concurrent refreshes per `(ctx.sessions, session.sessionId)` (via `withRepositoryRefreshLock` or equivalent in-flight coalescing keyed on `(ctx.sessions, session.sessionId)`) before entering `withSessionRefreshLock`, so same-session bursts do not reserve duplicate DB connections to wait on the advisory lock.
   - Add unit tests in `packages/backend/tests/customer-token-refresh-concurrency.test.ts` and PostgreSQL 17 integration tests in `packages/backend/tests/customer-token-refresh-concurrency.integration.test.ts` proving slow refreshes stay bounded, excess bursts fail fast with retryable `503` on acquire timeout, same-session calls coalesce, and unrelated queries still have open DB pool capacity.
2. **`TenantOrganizationService` Public Cache Invalidation (`#383`)**:
   - In `packages/backend/src/domains/tenant-org/tenant-organization-service.ts`, update `bindCacheInvalidator` to unsubscribe any previous listener and subscribe `publicOrganizationListCache` (`4`h TTL) to `DomainCacheInvalidator` for `OrgUpdated` and `CachesCleared` using `this.publicOrganizationListCache.deleteWhere(() => true)`.
   - Emit `OrgUpdated` immediately after `tenants.createOrganization(...)` (before `createMembership` so a failure creating the creator membership still invalidates public organization cache state).
   - Cover `OrgUpdated` and `CachesCleared` eviction plus create-time invalidation in `packages/backend/tests/domains/tenant-org/tenant-org.test.ts`.
3. **Post-Merge `main` & `integration.yml` CI Parity**:
   - Update `.github/workflows/pr-checks.yml` to run on `push: branches: [main]` as well as `pull_request`.
   - Align `.github/workflows/integration.yml` with `.github/workflows/deploy.yml`: add the `postgres:17-alpine` service container, `POSTGRES_INTEGRATION_URL`, lint, typecheck (`check:types` and backend `tsc --noEmit`), `check:sql`, and schema-parity checks in `verify`, plus pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts` in `deploy-integration`.
4. **Tiered File-Size Ratchet (`#216`)**:
   - Add `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` recording existing non-domain `.ts`/`.tsx` production files grandfathered above `500` lines (capped at an initial ceiling of `<= 2,000` lines) and explicitly exempting SQL and schema files (`database/**/*.sql`, `packages/backend/src/repo/postgres-schema.ts`, and existing `packages/common/src/*.ts`).
   - Add `packages/backend/tests/file-size-ratchet.test.ts` enforcing `<= 500` lines on all new `.ts`/`.tsx` production files (alongside `domains/**`, `app.ts`, `composition/**`) and verifying grandfathered files do not grow above their recorded baseline ceilings or `2,000` lines.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s15-backend-pool-cache-and-ci-hardening
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run check:sql
bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts
bun run test
```
Plus Linux/Docker PostgreSQL 17 integration and schema parity verification (`DATABASE_URL` / `POSTGRES_INTEGRATION_URL`, `bun run check:schema-parity`).

## Delivery
Merged in PR `#414` (merge commit `e55b67eee91e33b1c6b9730ac28879551ac735f0`, implementation commit `fdfa469`):
- **`RefreshConcurrencyLimiter` & Per-Session Coalescing (`#407`)**: Added `packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts` bounding active customer token-refresh permits with a retryable `503` acquire timeout ahead of `await sql.reserve()`, preserving `pg_try_advisory_lock` and `encrypted_tokens` CAS in `customer-session-repository.ts` (`0` DB migrations), and coalescing concurrent same-session refreshes via `withRepositoryRefreshLock` in `customer-token-refresh.ts` (verified by `customer-token-refresh-concurrency.test.ts` and `customer-token-refresh-concurrency.integration.test.ts`).
- **Public Organization Cache Invalidation (`#383`)**: Subscribed `TenantOrganizationService.publicOrganizationListCache` (`4`h TTL) in `packages/backend/src/domains/tenant-org/tenant-organization-service.ts` to `DomainCacheInvalidator` (`OrgUpdated`, `CachesCleared`) via `deleteWhere(() => true)` with immediate `OrgUpdated` emission after `tenants.createOrganization(...)` before `createMembership` (verified in `tenant-org.test.ts`).
- **CI Parity (`pr-checks.yml` & `integration.yml`)**: Added `push: branches: [main]` in `.github/workflows/pr-checks.yml` and aligned `.github/workflows/integration.yml` with `postgres:17-alpine`, `POSTGRES_INTEGRATION_URL`, lint/type/SQL/schema-parity gates, and pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts`.
- **Tiered File-Size Ratchet (`#216`)**: Added `packages/backend/tests/file-size-ratchet.test.ts` and `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` enforcing `<= 500` lines on new `.ts`/`.tsx` production files and strict domains/entrypoints and `<= 2,000` lines on grandfathered existing non-domain files.

## Quality gate results
- `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s15-backend-pool-cache-and-ci-hardening -RequireCodeReview`: PASS (exit `0`)
- `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`, `bun run check:sql`: PASS (`0` errors, `0` warnings)
- `bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts`: PASS (`0` errors, `0` warnings)
- PR `#414` (`e55b67eee91e33b1c6b9730ac28879551ac735f0`) GitHub Actions `Pull Request Checks / verify` (full unit + PostgreSQL 17 integration & schema parity suite): PASS (`0` errors, `0` warnings)
