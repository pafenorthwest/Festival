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
Pending execution.

## Quality gate results
Pending execution.
