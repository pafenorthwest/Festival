# S14 — Hard Freeze, Modular DI Cleanup & Release `v0.4.0` Live Cutover (Wave 4)

## Goal reference
- Locked goals: `goals/s14-release-v0-4-0-freeze-and-cutover/goals.v0.md`
- Goal establishment record: `goals/s14-release-v0-4-0-freeze-and-cutover/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/backend/src/app.ts` (`638`L -> `<=500`L) and `packages/backend/src/composition/**` (or per-domain `domains/*/composition.ts` factories) — wire `tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, `commerce-projection`, and `volunteers-comms` directly and retire temporary Wave 3 compatibility shims.
- `packages/backend/tests/architecture-boundaries.test.ts` — remove any transitional Wave 3 legacy path exemptions so `<=500`L file ceilings and acyclic 7-domain import rules are strictly enforced across `packages/backend/src/**`.
- `package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, and `packages/shopify-confirmation/package.json` — lockstep version bump from `0.3.0` to `0.4.0`.
- `CHANGELOG.md` — comprehensive `v0.4.0` changelog entry summarizing Tracks 2–7 and PR `#358`.
- `specs/pre-thanksgiving-program.md` — record `S14` completion and check off the November 25 Pre-Thanksgiving production verification checklist.
- Git release promotion (`main` -> `release`, tag `v0.4.0`) and GitHub Actions `.github/workflows/deploy.yml` rollout onto `/opt/Festival` (executed strictly after explicit user confirmation).

### Out of scope
- Unmerged Wave 3 feature branches that missed the November 23, 5:00 PM Hard Refactor Freeze (held back cleanly for post-release evaluation).
- December (`Dec 1–31`) bug-fix, E2E browser matrix, and soak-testing scope (`#357`, `#362`, `#359`, `#327`–`#341`, Playwright CI suite, `v1.0.0`).

## Approach
1. **Nov 23 — Hard Freeze & `app.ts` DI Finalization**:
   - Replace flat 25-dependency instantiation in `packages/backend/src/app.ts` (`638`L) with concise domain composition builders (`createTenantOrgDomain`, `createCatalogRepertoireDomain`, `createCustomerIdentityDomain`, `createTeacherDirectoryDomain`, `createClassCheckoutDomain`, `createCommerceProjectionDomain`, `createVolunteersCommsDomain`), bringing `app.ts` well under `500` lines (`<=60`L/fn).
   - Remove temporary Wave 3 re-export facades in `packages/backend/src/{repo,services,customer,checkout,commerce,shopify,repertoire,registration}/` for all merged slices and tighten `packages/backend/tests/architecture-boundaries.test.ts` to zero exemptions.
2. **Full Deterministic Gate & 500-Parent Benchmark**:
   - Run the complete quality gate against PostgreSQL 17 (`POSTGRES_INTEGRATION_URL`) plus `perf:scenarios` (`500`-parent burst benchmark from `#358`/`S07`), confirming `<2s` burst latency, zero connection-pool saturation, and `0` warnings/errors.
3. **Nov 24 — Lockstep `v0.4.0` Release & Production Rollout** *(requires explicit user confirmation before tag/push/deploy)*:
   - Update `"version": "0.4.0"` across all 5 `package.json` manifests and document changes in `CHANGELOG.md`.
   - Open and merge the release PR (`main` -> `release`), verify `integration` environment checks, push annotated tag `v0.4.0`, and run `.github/workflows/deploy.yml` onto the live Ubuntu 24.04 production host (`orgs.schema_migrations` applied pre-cutover).
4. **Nov 25 — Pre-Thanksgiving Live Sign-Off Checklist**:
   - Verify `/healthz`, `/api/organizations/pafe/landing`, and `orgs.schema_migrations` ledger on live host.
   - Verify Firebase Admin sign-in, role custom claims, and claims reconciliation cron.
   - Verify Shopify Customer Account OAuth login and `<form method="POST">` logout (`200`/`302`, zero `403` CSRF errors).
   - Verify live Teacher Membership checkout -> `ORDERS_PAID` webhook projection -> `/org/pafe/directory` (`#361`) public listing and Admin visibility toggle.
   - Verify Shopify Checkout UI Extension (`shopify-confirmation`) return links on Thank-you and Order-status pages, then mark `S14` `DONE` in `specs/pre-thanksgiving-program.md`.

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s14-release-v0-4-0-freeze-and-cutover
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
bun run --cwd packages/backend perf:scenarios
```

## Delivery
- `[G1]` `DONE`: PR `#382` extracted per-domain DI composition modules under `packages/backend/src/composition/` (`auth.ts`, `tenant-org.ts`, `catalog-repertoire.ts`, `customer-identity.ts`, `teacher-directory.ts`, `commerce-projection.ts`, `class-checkout.ts`, `volunteers-comms.ts`, `runtime.ts`), reduced `packages/backend/src/app.ts` to `212` lines (`<=500`), updated `packages/backend/scripts/reap-class-checkout-recovery.ts`, retired 3 unreferenced Wave 3 checkout shims (`class-checkout-recovery.ts`, `postgres-class-checkout-execution.ts`, `postgres-registration-metadata-queries.ts`), and enforces 0-exemption boundaries via `architecture-boundaries.test.ts` + `file-size-ratchet.test.ts` (`11/11` pass).
- `[G2]` `DONE`: Fresh `2026-11-18` verification gate passed across all `852` Biome files, `528` SQL-checked backend files, `254` test files (`2,736` pass / `0` fail locally; `migrate-runner.test.ts` `9/9` pass on local Postgres 17.11; full Postgres 17 integration + schema-parity verified in GitHub Actions `Pull Request Checks / verify` Run `44416260584` and Run `44430999183`), and `perf:scenarios` exit 0 (plus PR `#382` 500-parent local Postgres 17 benchmark).
- `[G3]` `DONE`: All 5 `package.json` manifests are at `"0.4.0"` (`package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, `packages/shopify-confirmation/package.json`), `CHANGELOG.md` is updated to `## [0.4.0] - 2026-11-18` citing `#423` (`S20`), `#424` (`S18`), `#425` (`@festival/shopify-confirmation`), and `#427` (`S19`), and all 19 upstream code packets (`S00`–`S04`, `S06`–`S13`, `S15`–`S20`) + `#425` + `#426` are merged on `main`. Cutover artifacts:
  - Release Prep PR `#428` merged to `origin/main` (`a65c690fc23c089ba3eb5644e0bcf219ccf2f06d`); `Pull Request Checks / verify` Run `44416260584` `SUCCESS`.
  - Promotion PR `#429` (`main -> release`) merged to `origin/release` (`364e543bb5ceac1f2a9b2205f7145921f0da62fa`); `Pull Request Checks / verify` Run `44430999183` `SUCCESS`.
  - `Continuous Deployment` (`deploy.yml`) on `release`: Run `44431387848` (`success`, all 4 jobs `success`).
  - Annotated tag `v0.4.0`: tag object `c872d5577685e5853030bf96d3d93633ff9dff18` -> `364e543bb5ceac1f2a9b2205f7145921f0da62fa`.
  - GitHub Release `v0.4.0`: `https://github.com/pafenorthwest/Festival/releases/tag/v0.4.0`.
  - `Continuous Deployment` (`deploy.yml`) on `refs/tags/v0.4.0`: Run `44432128555` (`target_environment=production`, all 4 jobs `success`), publishing:
    - `ghcr.io/pafenorthwest/festival-backend:v0.4.0` + `:latest` (`sha256:9d4f955d9677e4ad1de195d316eae56ad9c60ce22294a044332c1eefd05ae3a2`)
    - `ghcr.io/pafenorthwest/festival-frontend:v0.4.0` + `:latest` (`sha256:c32bbd3266e2ecbe7b234f194eecfa98746cff9dc051f33b946778294ec6ac9d`)
- `[G4]` Ready for `S05` live bring-up (latest released artifact: `v0.4.1`): `Deploy to Target Host` and `Post-Deploy Health & Smoke Verification` on `refs/tags/v0.4.0` (Run `44432128555`) and `refs/tags/v0.4.1` (Run `44467580512`) skipped cleanly with `configured=false` because `production` environment secrets (`DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, `DEPLOY_PUBLIC_URL` / `D4`) are not yet configured.
- Integration UI walkthrough (`https://int.artsfestival.online`, `2026-11-18`):
  - Phases 1 (Public) & 2 (Authenticated Customer) PASS at SHA `8d0c5bb` after PR `#435` (`Integration Deployment` Run `44457776486`) shipped and verified live fixes closing Issues `#431`–`#434`.
  - Phase 3 (Authenticated Admin) PASS at `main` SHA `650ccac` after PR `#440` (`Integration Deployment` Run `44465072507`) closed Issues `#437`, `#438`, and `#439` (`0` console errors, `0` HTTP `5xx` errors):
    - Admin directory moderation (`approved`/`rejected` toggle, `#361`, `#416`): PASS (Teachers verified & reverted; `0` Accompanist listings in `pafe`).
    - Admin Teacher division editor (strictly 1 active division, `#418`): PASS (single-division enforcement + immediate card unlock after `#437` fix; reverted cleanly).
    - Admin Concerto Repertoire CSV (`#359`): PASS (template download, catalog export, dry-run diff preview). Note: Concerto typeahead (`#362`) is parent/customer-flow only (`FestivalPieceEditor`/`FestivalRepertoireModal`) with `0` works in catalog.
    - Modals (`FestivalClassModal` & `FestivalClassWaitlistModal`, `#336`): PASS (viewport-anchored Portal backdrop, zero clipping, single `Close` button after `#439` fix).
    - Direct admin subroute navigation (`/settings`, `/roster`, `/rooms`, `/volunteers`): PASS after `#438` fix.
  - `v0.4.1` Release Cutover (`2026-11-18`, latest released artifact ready for `S05` live production cutover):
    - Prep PR `#442` merged to `origin/main` (`d2fcee1`).
    - Promotion PR `#443` (`main -> release`) merged to `origin/release` (`b93edf96daaef6bf7cd009214205ad6111a7f4f7`).
    - Integration CD (`deploy.yml` on `release`): Run `44467055788` (`success`).
    - Annotated tag `v0.4.1` (`b93edf9`).
    - GitHub Release `v0.4.1`: `https://github.com/pafenorthwest/Festival/releases/tag/v0.4.1`.
    - Production / GHCR CD (`deploy.yml` on `refs/tags/v0.4.1`): Run `44467580512` (`success`), publishing `ghcr.io/pafenorthwest/festival-{backend,frontend}:v0.4.1` + `:latest`.

## Quality gate results
- `bun run verify:toolchain`: exit 0 (`Bun 1.4.2`, `TypeScript 5.9.3`)
- `bun run format:check`: exit 0 (`852` files)
- `bun run lint`: exit 0 (`852` files, 0 warnings/errors)
- `bun run build`: exit 0 (`common`, `backend`, `frontend`, `shopify-confirmation`)
- `bun run --cwd packages/frontend check:types`: exit 0
- `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: exit 0
- `bun run check:sql`: exit 0 (`528` backend TypeScript files)
- `bun test packages/backend/tests/architecture-boundaries.test.ts packages/backend/tests/file-size-ratchet.test.ts`: exit 0 (`11` pass, `0` fail)
- `bun run test` (local unit suite): exit 0 (`2,736` pass, `0` fail, `159` Postgres-gated skip across `254` files: `common` 382, `backend` 1750, `frontend` 583, `shopify-confirmation` 21)
- `bun test packages/backend/tests/migrate-runner.test.ts` (local Postgres 17.11): exit 0 (`9` pass, `0` fail, `0` skip)
- `bun run --cwd packages/backend perf:scenarios`: exit 0 (`0` 5xx errors; PR `#382` local Postgres 17 baseline 100% HTTP 2xx)
- GitHub Actions `Pull Request Checks / verify` (PostgreSQL 17 integration + schema parity):
  - Release Prep PR `#428` (`main`): Run `44416260584` `SUCCESS`
  - Promotion PR `#429` (`main -> release`): Run `44430999183` `SUCCESS`
  - Integration Walkthrough Fixes PR `#435` (`main`, `8d0c5bb`): Runs `44456521852`, `44457286532` `SUCCESS`
- GitHub Actions `Integration Deployment`:
  - `main` (`8d0c5bb`, PR `#435`): Run `44457776486` `success`
  - `main` (`650ccac`, PR `#440`): Run `44465072507` `success`
- GitHub Actions `Continuous Deployment` (`deploy.yml`):
  - `release` branch (`364e543bb5ceac1f2a9b2205f7145921f0da62fa`): Run `44431387848` `success` (all 4 jobs `success`)
  - `refs/tags/v0.4.0` (`target_environment=production`): Run `44432128555` `success` (all 4 jobs `success`; GHCR images published; host deploy/smoke skipped cleanly with `configured=false` pending `D4` secrets)
  - `release` branch (`b93edf96daaef6bf7cd009214205ad6111a7f4f7`, PR `#443`): Run `44467055788` `success`
  - `refs/tags/v0.4.1` (`target_environment=production`): Run `44467580512` `success` (`ghcr.io/pafenorthwest/festival-{backend,frontend}:v0.4.1` + `:latest` published; ready for `S05` live cutover pending `D4` secrets)
