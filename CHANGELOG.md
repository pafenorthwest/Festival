# Changelog

## [0.4.0] - 2026-11-13

### Added

- Deterministic pre-deploy migration runner (`scripts/migrate.ts`) backed by `orgs.schema_migrations` ledger and `pg_dump --schema-only` parity gate against `database/postgres17-schema.sql` (`S06`).
- Shared event-driven `DomainCacheInvalidator` replacing isolated `BoundedAsyncCache` silos and `compose.yml` `max_connections=200` (`S07`, `#358`).
- Graceful `SIGTERM`/`SIGINT` webhook worker drain (`shopifyWebhookService.drain()`), `PeriodicLeaseReaper` using `FOR UPDATE SKIP LOCKED` to reclaim stale webhook, checkout execution, and OAuth/session leases, and partial index `20261115010000_idx_class_checkout_executions_running.sql` (`S08`).
- Shared `@festival/common` runtime validation schemas, typed Hono RPC (`hc<AppType>`) domain API clients, and declarative route-security metadata (`S12`).
- Modular per-domain DI composition under `packages/backend/src/composition/` (`S14`).

### Changed

- Bounded-context domain decomposition across `tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, and `commerce-projection`, splitting monolithic repositories, `CustomerAccountService`, `ShopifyAdminApiClient`, `OrganizationService`, `ClassCheckoutService`, and `ShopifyOrderProjectionService` into `<=500`-line modules and retiring `InMemory*` SQL emulators (`S09`–`S11`).
- Split `api.ts` into typed Hono RPC domain clients and replaced the static `route-security.ts` array with declarative route-security metadata (`S12`).
- Decomposed `createFestivalAppState` and `createFestivalActions` into route-scoped SolidJS contexts, unified `@solidjs/router` routing, and modularized registration, volunteer, and repertoire UI components (`S13`).
- Reduced `packages/backend/src/app.ts` to `<=500` lines via `packages/backend/src/composition/` modules, removed obsolete Wave 3 checkout shims, and bumped root and all four workspace package versions (`@festival/common`, `@festival/backend`, `@festival/frontend`, and `@festival/shopify-confirmation`) in lockstep to `0.4.0` (`S14`).

### Fixed

- Removed boot-time DDL from `initializePostgresSchema` and `/api/internal/ready` (`S06`).
- Removed 5-minute `null` caching and replaced hot-path N+1 queries (`listRegistrationEligibleClasses`, `listClassRegistrations`, `evaluateEligibility`, `PublicMembershipProductService.list`) with SQL joins and batching (`S07`, `#358`).

## [0.3.0] - 2026-11-13

### Added

- Deterministic class checkout execution store and recovery ledger (`orgs.class_checkout_executions` and `orgs.class_checkout_execution_events`) with Shopify Storefront cart binding, unissued cart restart, expired pre-dispatch cart release, and original-festival recovery routing (`#355`, `#354`, `#366`).
- Qualifying 25-work PAFE concertos bootstrap catalog (`database/bootstrap/pafe-concertos.csv`) and idempotent SQL migration loader (`20261109000000_load_pafe_concertos.sql`) (`#360`, `#366`).
- Public Teacher Directory self-service opt-in across Membership purchase and Account Memberships UI for active paid teacher members, public directory search and division filters with `Cache-Control: no-store`, and one-click Admin `approved`/`rejected` moderation toggle (`#361`, `#368`).
- Track 1 CI and quality gate hardening (`S02`, `#367`): real PostgreSQL 17 service containers in `pr-checks.yml` and `deploy.yml` executing all `*.integration.test.ts` suites with zero skips, blocking frontend (`check:types`) and backend/test `tsc --noEmit`, blocking `bun run check:sql` extended to `tx.unsafe(...)`, and DDD architecture boundary enforcement (`architecture-boundaries.test.ts`, `#363`, `#364`, `#365`).
- 500-parent class registration concurrency benchmark harness (`#344`, `#348`, `#350`).

### Changed

- Redesigned the parent festival class registration navigation and checkout workspace with a paginated repertoire selection modal, cart idempotency key persistence, sold-out cart row waitlist offers, and non-blocking purchase history loading (`#354`, `#366`).
- Bumped root and all four workspace package versions (`@festival/common`, `@festival/backend`, `@festival/frontend`, and `@festival/shopify-confirmation`) in lockstep to `0.3.0`.

### Fixed

- Preserved `returnTo` navigation targets across `/register` and `/register/cart` authentication redirects (`#338`, `#354`, `#366`).
- Fixed base64 token validation in `cloud-setup/02-validate-env.sh` (`#354`, `#366`).

### Security

- Enforced `Referrer-Policy: same-origin` in Nginx reverse-proxy configurations (`nginx/festival.conf` and `docker/nginx.festival.conf`) and fail-closed `resolveRequestOrigin` CSRF origin verification in `csrf-guard.ts` and `admin-class-checkout-recovery.routes.ts`, removing `Host`/`X-Forwarded-Host` header fallback (`#353`, `#356`, `#354`, `#366`).

## 0.2.0

- Rebuilt the disposable PostgreSQL test environment as `festival_sepv2_db` on
  PostgreSQL 17.
- This is a clean-slate operational break: existing user and application data
  is intentionally not migrated, backfilled, or preserved.
- Root and workspace packages are versioned together at `0.2.0`.
