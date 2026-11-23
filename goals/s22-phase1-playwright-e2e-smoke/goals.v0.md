# Goals Extract
- Task name: s22-phase1-playwright-e2e-smoke
- Iteration: v0
- State: locked

## Goals
1. Stand up a deterministic Playwright E2E harness (`playwright.config.ts` + `e2e/` test suite + root `package.json` scripts) that can run both locally and in CI against an ephemeral local Festival stack (with Postgres 17) and optionally against a live integration base URL (`https://int.artsfestival.online`).
2. Automate Phase 1 (`Dec 1` launch) browser E2E coverage across all 3 completed walkthrough phases:
   - Phase 1 (Public): org grid (`#383`), landing page (`#384`), Teacher/Accompanist public directory (`#361`/`#416`), and `$0` accompanist signup form.
   - Phase 2 (Authenticated Customer): zero unauthenticated flash (`S16`), `Acquire Memberships` button states (`#417`), read-only Teacher division (`#418`), and `<form method="POST">` logout (`#353`, zero `403`s).
   - Phase 3 (Authenticated Admin): `/org/:slug/admin/memberships` card layout and wrapping horizontal entitlement badges (`#334`/`#335`), directory moderation toggle, Teacher single-division edit (`#418`), Concerto Repertoire CSV export/dry-run (`#359`), direct admin subroute navigation (`/settings`, `/roster`, `/rooms`, `/volunteers`), zero browser console errors, and zero HTTP `5xx` responses.
3. Wire Phase 1 Playwright E2E into CI (`.github/workflows/pr-checks.yml` or dedicated `.github/workflows/e2e-phase1.yml` workflow) so every pre-`Dec 1` release (`v0.4.2` and any hotfix) has repeatable automated browser verification.
4. Execute a full end-to-end verification pass (unit + 24 Postgres 17 integration suites + Phase 1 Playwright E2E + `perf-test.yml` benchmark) on `v0.4.2` ahead of the `Dec 1` launch.

## Non-goals
- Phase 2 class registration Playwright E2E (multi-child cart, waitlist handoff, 42-day edit cutoff, abandoned cart restart `#357`/`#410`, Shopify `429`/`5xx`, webhook replay — remains in December Week 3).
- Live production Shopify/Firebase cutover (`S05`/`S14 [G4]`, gated on `D4`).
- Application feature code changes outside minimal testability attributes (`data-testid` only if strictly needed).
- Database schema migrations (`database/migrations/**`).

## Success criteria
- [G1] A deterministic Playwright E2E harness (`playwright.config.ts`, `e2e/phase1/**`, and root `package.json` `test:e2e` / `test:e2e:phase1` scripts) runs cleanly against an ephemeral local Festival stack with Postgres 17 and supports targeting an optional live integration base URL (`https://int.artsfestival.online`).
- [G2] Automated Playwright E2E specs verify all 3 Phase 1 walkthrough areas — Public (`#383`, `#384`, `#361`/`#416`, `$0` accompanist form), Authenticated Customer (`S16` zero unauthenticated flash, `#417` `Acquire Memberships` states, `#418` read-only Teacher division, `#353` `<form method="POST">` logout with zero `403`s), and Authenticated Admin (`#334`/`#335` `/org/:slug/admin/memberships` cards & wrapping entitlement badges, directory moderation toggle, `#418` Teacher single-division edit, `#359` Concerto Repertoire CSV export/dry-run, direct `/settings`, `/roster`, `/rooms`, `/volunteers` subroute navigation) — with zero browser console errors and zero HTTP `5xx` responses.
- [G3] Phase 1 Playwright E2E is wired into GitHub Actions CI (`.github/workflows/pr-checks.yml` or `.github/workflows/e2e-phase1.yml`) and executes deterministically on every pre-`Dec 1` release (`v0.4.2` and hotfixes).
- [G4] A full end-to-end verification pass on `v0.4.2` (unit + 24 Postgres 17 integration suites + Phase 1 Playwright E2E + `perf-test.yml` benchmark) and all standard quality gates (`validate-packet.ps1`, `verify:toolchain`, `format:check`, `lint`, frontend/backend typecheck, `build`, `check:sql`) pass with `0` errors and `0` warnings ahead of the `Dec 1` launch.
