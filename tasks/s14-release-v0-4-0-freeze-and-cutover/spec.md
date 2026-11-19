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
- `[G1]`: PR `#382` extracted per-domain DI composition modules under `packages/backend/src/composition/` (`auth.ts`, `tenant-org.ts`, `catalog-repertoire.ts`, `customer-identity.ts`, `teacher-directory.ts`, `commerce-projection.ts`, `class-checkout.ts`, `volunteers-comms.ts`, `runtime.ts`), reduced `packages/backend/src/app.ts` to `212` lines (`<=500`), updated `packages/backend/scripts/reap-class-checkout-recovery.ts`, retired 3 unreferenced Wave 3 checkout shims (`class-checkout-recovery.ts`, `postgres-class-checkout-execution.ts`, `postgres-registration-metadata-queries.ts`), and enforces 0-exemption boundaries via `architecture-boundaries.test.ts` + `file-size-ratchet.test.ts` (`11/11` pass).
- `[G2]`: Fresh `2026-11-18` verification gate passed across all `852` Biome files, `528` SQL-checked backend files, `254` test files (`2,736` pass / `0` fail locally; `migrate-runner.test.ts` `9/9` pass on local Postgres 17.11; full Postgres 17 integration + schema-parity verified in GitHub Actions `Pull Request Checks / verify`), and `perf:scenarios` exit 0 (plus PR `#382` 500-parent local Postgres 17 benchmark).
- `[G3]`: All 5 `package.json` manifests are at `"0.4.0"` (`package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, `packages/shopify-confirmation/package.json`), `CHANGELOG.md` is updated to `## [0.4.0] - 2026-11-18` citing `#423` (`S20`), `#424` (`S18`), `#425` (`@festival/shopify-confirmation`), and `#427` (`S19`), and all 19 upstream code packets (`S00`–`S04`, `S06`–`S13`, `S15`–`S20`) + `#425` + `#426` are merged on `main`. `main -> release` promotion, annotated tag `v0.4.0`, and GitHub Release `v0.4.0` are queued behind the explicit user confirmation gate.
- `[G4]`: Live production host deployment remains pending `S05` (`BLOCKED (D4)` unless `production` GitHub Environment secrets `DEPLOY_HOST`, `DEPLOY_SSH_PRIVATE_KEY`, and `DEPLOY_PUBLIC_URL` are configured).

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
- GitHub Actions `Pull Request Checks / verify` (PostgreSQL 17 integration + schema parity): pending release prep PR check.
