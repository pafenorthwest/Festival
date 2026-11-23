# Code Review

- Task name: s15-backend-pool-cache-and-ci-hardening
- Reviewer: Independent Code Review Subagent
- Date: 2026-11-16
- Branch: `fix/s15-backend-pool-cache-and-ci-hardening`
- Findings status: none

## Context

Performed an independent code review and post-fix re-review of `S15` (`s15-backend-pool-cache-and-ci-hardening`) on branch `fix/s15-backend-pool-cache-and-ci-hardening` against the authoritative goals and specification in `origin/chore/reconcile-plan-post-409` (`goals/s15-backend-pool-cache-and-ci-hardening/goals.v0.md`, `tasks/s15-backend-pool-cache-and-ci-hardening/spec.md`) and `specs/bounded-contexts-2026.md`. Both initial review findings (`S15-REV-01` and `S15-REV-02`) were resolved and verified.

## Scope & Files Reviewed

Inspected `git status --untracked-files=all --short`, full `git diff origin/main`, and all 11 in-scope modified/untracked files:

- `.github/workflows/pr-checks.yml` (`92` lines, modified)
- `.github/workflows/integration.yml` (`154` lines, modified)
- `packages/backend/src/domains/customer-identity/refresh-concurrency-limiter.ts` (`98` lines, new; class `RefreshConcurrencyLimiter` `84` lines)
- `packages/backend/src/domains/customer-identity/customer-session-repository.ts` (`353` lines, modified; class `PostgresCustomerSessionRepository` `213` lines)
- `packages/backend/src/domains/customer-identity/customer-token-refresh.ts` (`188` lines, modified)
- `packages/backend/src/domains/tenant-org/tenant-organization-service.ts` (`319` lines, modified; class `TenantOrganizationService` `244` lines)
- `packages/backend/tests/customer-token-refresh-concurrency.test.ts` (`254` lines, new)
- `packages/backend/tests/customer-token-refresh-concurrency.integration.test.ts` (`252` lines, new)
- `packages/backend/tests/domains/tenant-org/tenant-org.test.ts` (`496` lines, modified)
- `packages/backend/tests/file-size-ratchet.test.ts` (`241` lines, new)
- `packages/backend/tests/fixtures/file-size-ratchet-baseline.ts` (`372` lines, new)

Verified strict out-of-scope adherence: zero edits to `database/**`, `packages/backend/src/routes/customer-auth/customer-auth.routes.ts`, `packages/backend/src/domains/customer-identity/types.ts`, `packages/backend/src/customer/in-memory-customer-account-repository.ts`, `packages/backend/src/customer/postgres-customer-account-repository.ts`, `packages/backend/src/composition/runtime.ts`, or any path owned by PR `#411`, PR `#412`, PR `#413`, or `S16`.

## Audit Summary

1. **`RefreshConcurrencyLimiter` (`refresh-concurrency-limiter.ts`)**: Slot counting, FIFO `waiters` queuing/draining, timeout waiter removal (`splice`) with `AppError(..., 503)`, `timer.unref()`, `async execute()` `finally` slot release covering synchronous and asynchronous throws, and promise chaining without unhandled rejections are verified.
2. **`withSessionRefreshLock` (`customer-session-repository.ts`, resolving `S15-REV-01`)**: `resolveDefaultRefreshConcurrency()` and `getDefaultRefreshLimiter()` now resolve dynamically inside `withSessionRefreshLock` (caching shared limiters in `defaultRefreshLimiters` keyed by resolved `maxConcurrent`), so repositories constructed before `resolveRuntimeEnv()` sets `sql.options.max = env.databasePoolMax` (`80`) pick up the `10`-slot limiter instead of staying clamped at `2` (verified by the new regression unit test in `customer-token-refresh-concurrency.test.ts`). `sql.reserve()` executes only after acquiring a limiter permit, `deadline` bounds both limiter wait and `pg_try_advisory_lock`, and `releaseRefreshConnection` preserves `pg_advisory_unlock` + `close({ timeout: 0 })` semantics across all 16 tests in `customer-token-refresh.integration.test.ts`.
3. **`withRepositoryRefreshLock` (`customer-token-refresh.ts`)**: `WeakMap<CustomerSessionRepository, Map<string, Promise<CustomerSessionRecord>>>` coalesces concurrent same-repository/same-session refreshes ahead of `withSessionRefreshLock`, keeps separate repository instances distinct for PostgreSQL advisory-lock serialization, cleans up map entries in `.finally()`, and propagates `AppError` / maps unexpected errors to `safeAuthError()` without deadlocks.
4. **`TenantOrganizationService` (`tenant-organization-service.ts`, resolving `S15-REV-02`)**: Extracting `subscribePublicOrganizationListInvalidator` and `loadPublicOrganizationList` reduced `class TenantOrganizationService` to `244` lines (`76`–`319`, `<= 250` lines) while preserving behavior: `bindCacheInvalidator` unsubscribes any prior listener before re-binding (including to a minimal `S09InvalidationSink`), evicts `publicOrganizationListCache` (`4`h TTL) via `deleteWhere(() => true)` on `OrgUpdated` and `CachesCleared`, and evicts + emits `OrgUpdated` immediately after `tenants.createOrganization(...)` before `memberships.createMembership(...)`.
5. **CI Parity (`.github/workflows/pr-checks.yml`, `.github/workflows/integration.yml`)**: `pr-checks.yml` adds `push: branches: [main]`. `integration.yml` aligns with `pr-checks.yml` and `deploy.yml` with `postgres:17-alpine`, `POSTGRES_INTEGRATION_URL`, lint, typechecks, `check:sql`, schema parity check/cleanup, and pre-startup `oven/bun:1.4.2 bun run scripts/migrate.ts` in `deploy-integration`.
6. **File-Size Ratchet (`file-size-ratchet.test.ts`, `file-size-ratchet-baseline.ts`)**: Enforces `<= 500` lines on new `.ts`/`.tsx` source files and strict domains/entrypoints, grandfathers existing non-domain `.ts`/`.tsx` files at `<= 2,000` lines, and exempts `database/**/*.sql`, `postgres-schema.ts`, and existing `packages/common/src/*.ts` with zero false failures against PR `#412` and PR `#413`.
7. **Size Ceilings & Verification**: AST audit confirmed all 11 files are `<= 500` lines (max `496` lines in `tenant-org.test.ts`), all classes are `<= 250` lines (`84`, `213`, `244`), all functions/methods across new/modified code and S15 tests are `<= 60` lines (new unit tests in `tenant-org.test.ts` are `32`, `53`, and `32` lines; pre-existing `describe`/`it` blocks on `origin/main` were unchanged), and zero `console.*`/`debugger` calls were added. Executed checks after final fixes:
   - `bun run verify:toolchain` (Bun `1.4.2`, TypeScript `5.9.3`), `bun run format:check` (`819` files), `bun run lint` (`819` files), `bun run check:sql` (`510` files): all passed (`0` errors, `0` warnings).
   - `bun run build`, `bun run --cwd packages/frontend check:types`, `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: all passed (`0` errors).
   - Targeted unit + PostgreSQL 17 suite (`architecture-boundaries.test.ts`, `file-size-ratchet.test.ts`, `customer-token-refresh-concurrency.test.ts`, `customer-token-refresh-concurrency.integration.test.ts`, `customer-token-refresh.integration.test.ts`, `domains/tenant-org/tenant-org.test.ts` against `postgres://postgres:postgres@127.0.0.1:5432/festival_test`): `41` pass, `0` fail, `201` `expect()` calls.
   - Unit-only `bun run test` (`POSTGRES_INTEGRATION_URL` unset): `common` `365` pass (`23` files), `backend` `1,611` pass / `145` Postgres integration tests skipped (`157` files), `frontend` `522` pass (`60` files), `shopify-confirmation` `20` pass (`1` file); `0` failures. Full PostgreSQL 17 integration matrix runs in Linux CI (`pr-checks.yml` / `integration.yml`).

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: Both `S15-REV-01` (dynamic `getDefaultRefreshLimiter()` resolution after `sql.options.max` updates) and `S15-REV-02` (`TenantOrganizationService` class at `244` lines `<= 250`) are resolved cleanly; all 11 files satisfy size, AST, SQL, typecheck, format, lint, boundary, and out-of-scope rules; and unit plus targeted PostgreSQL 17 integration suites pass with zero failures.
