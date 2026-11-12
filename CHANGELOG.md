# Changelog

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
