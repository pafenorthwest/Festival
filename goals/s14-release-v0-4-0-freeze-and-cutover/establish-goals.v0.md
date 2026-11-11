# Establish Goals
- Task name: s14-release-v0-4-0-freeze-and-cutover
- Iteration: v0
- State: locked

## Status
Goals locked for Wave 4 (`Nov 23–25`, Milestone Gate: Hard Refactor Freeze, Release `v0.4.0` Cutover & Pre-Thanksgiving Live Sign-Off).

## Request
Finalize modular DI wiring in `packages/backend/src/app.ts` (`<=500`L), enforce full `architecture-boundaries.test.ts` pass, run 500-parent `perf:scenarios` validation, bump 5 `package.json` versions to `0.4.0` + `CHANGELOG.md`, merge `main` to `release`, tag `v0.4.0`, deploy via `deploy.yml` onto the live production site, and complete the Pre-Thanksgiving sign-off checklist.

## Blocking ambiguity
None.

## Assumptions
- Live production infrastructure (`S05`: Ubuntu 24.04 `/opt/Festival`, UFW `#95`, TLS, Live Firebase, Live Shopify, `shopify-confirmation`, PAFE 25 concertos) is already running stably on `v0.3.0`.
- Green Wave 2 (`S06`–`S08`) and Wave 3 (`S09`–`S13`) PRs have merged to `main` prior to the November 23, 5:00 PM Hard Refactor Freeze; any unmerged Wave 3 slice hits the circuit-breaker and stays on its feature branch so `v0.4.0` never risks live site stability.
- Explicit user confirmation is obtained in standard prose before irreversible release tagging (`v0.4.0`), pushing to `release`, or triggering live production deployment (`deploy.yml`).

## Goals
1. Enforce the November 23 Hard Refactor Freeze by removing temporary Wave 3 compatibility facades, finalizing modular per-domain dependency injection in `packages/backend/src/app.ts` (`<=500`L, down from `638`L), and passing strict `packages/backend/tests/architecture-boundaries.test.ts` with zero exemptions.
2. Execute full-workspace deterministic verification plus the 500-parent concurrent `perf:scenarios` benchmark against PostgreSQL 17, confirming zero regressions, zero connection-pool exhaustion, and `100%` scenario pass rate.
3. Bump lockstep package versions to `"0.4.0"` across all 5 `package.json` manifests (`package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, `packages/shopify-confirmation/package.json`), author `CHANGELOG.md` `v0.4.0` notes, promote `main` to `release`, and tag `v0.4.0`.
4. Deploy `v0.4.0` onto the live Ubuntu 24.04 production host via `.github/workflows/deploy.yml` (including pre-deploy `orgs.schema_migrations` execution) and complete every item in the November 25 Pre-Thanksgiving live production sign-off checklist in `specs/pre-thanksgiving-program.md`.

## Non-goals
- Starting any unmerged or incomplete structural refactor after the November 23, 5:00 PM Hard Freeze (incomplete branches pause cleanly via circuit-breaker).
- Implementing December QA functional backlog items (`#357`, `#362`, `#359`, `#327`–`#341`) scheduled for `Dec 1–31` (`v1.0.0`).

## Success criteria
- [G1] `packages/backend/src/app.ts` is `<=500` lines with per-domain DI composition helpers, temporary Wave 3 legacy re-export shims are removed where safe, and `packages/backend/tests/architecture-boundaries.test.ts` enforces acyclic imports and `<=500`L ceilings across all 7 bounded contexts with zero exemptions.
- [G2] Full local/CI verification (`verify:toolchain`, `format:check`, `lint`, `build`, frontend/backend/test `tsc --noEmit`, unit + Postgres 17 integration suites, `check:sql`) and the 500-parent `perf:scenarios` benchmark pass with `0` errors and `0` warnings.
- [G3] All 5 `package.json` files report `"version": "0.4.0"`, `CHANGELOG.md` documents `v0.4.0`, `main` merges cleanly to `release`, and annotated tag `v0.4.0` triggers green GHCR image builds.
- [G4] `deploy.yml` rolls out `v0.4.0` to production (`orgs.schema_migrations` up to date), live smoke checks pass (`/healthz`, `/api/organizations/pafe/landing`, Firebase Admin + claims cron, Shopify OAuth login + `<form>` POST logout with zero `403`, live Teacher Membership `ORDERS_PAID` -> `/org/pafe/directory` `#361` + Admin toggle, Checkout UI Extension return flow), and `specs/pre-thanksgiving-program.md` marks `S14` `DONE`.

## Next action
Execute `tasks/s14-release-v0-4-0-freeze-and-cutover/spec.md` starting at the November 23 Hard Refactor Freeze gate.
