# S22 — Phase 1 Launch Playwright E2E Smoke Harness & `v0.4.2` Sign-Off

## Goal reference
- Locked goals: `goals/s22-phase1-playwright-e2e-smoke/goals.v0.md`
- Goal establishment record: `goals/s22-phase1-playwright-e2e-smoke/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 4 `v0.4.2` / Pre-`Dec 1`, `READY`, depends on `S21`, Decision `D7`)
- Bounded context architecture: `specs/bounded-contexts-2026.md` (cross-cutting E2E verification across `tenant-org`, `customer-identity`, `teacher-directory`, and `catalog-repertoire`)

## Scope

### In scope
- Playwright configuration & E2E test suite:
  - `playwright.config.ts`
  - `e2e/phase1/**` (Phase 1 Public, Phase 2 Authenticated Customer, Phase 3 Authenticated Admin specs, plus E2E-only seed/auth helpers and fixtures)
- Root scripts & dependencies:
  - `package.json` (`test:e2e`, `test:e2e:phase1`, Playwright devDependency) and lockfile (`bun.lock`)
- CI workflow integration:
  - `.github/workflows/pr-checks.yml` or `.github/workflows/e2e-phase1.yml`
- Test seed/auth helpers strictly for E2E execution
- Packet & release readiness artifacts:
  - `tasks/s22-phase1-playwright-e2e-smoke/spec.md`, `tasks/s22-phase1-playwright-e2e-smoke/code-review.md`, and `specs/pre-thanksgiving-program.md`

### Out of scope
- Application feature code changes outside minimal testability attributes (`data-testid` only if strictly needed)
- `database/migrations/**` (`0` DB migrations)
- Phase 2 class registration Playwright E2E (multi-child cart, waitlist handoff, 42-day edit cutoff, abandoned cart restart `#357`/`#410`, Shopify `429`/`5xx`, webhook replay — remains in December Week 3)
- Live production Shopify/Firebase secrets and cutover (`S05`/`S14 [G4]`, gated on `D4`)

## Approach
1. **Preflight & Isolated Branch**:
   - Confirm `S21` (`#335`, `#334`, `#329`) is merged on `origin/main` and validate `s22-phase1-playwright-e2e-smoke` via `validate-packet.ps1` (exit `0`).
   - Branch `feat/s22-phase1-playwright-e2e-smoke` off `origin/main` and keep edits strictly within `In scope` paths.
2. **Playwright Harness & Ephemeral Local Stack (`playwright.config.ts` & `e2e/phase1/`)**:
   - Add `@playwright/test` and root scripts (`test:e2e`, `test:e2e:phase1`) in `package.json`.
   - Configure `playwright.config.ts` for deterministic headless Chromium execution with trace/screenshot capture on failure, supporting both an ephemeral local Festival stack backed by Postgres 17 (default for local/CI) and an optional `PLAYWRIGHT_BASE_URL` override (e.g., `https://int.artsfestival.online`).
   - Implement E2E-scoped seed/auth helpers and global page listeners asserting `0` browser console errors and `0` HTTP `5xx` responses across all specs.
3. **Phase 1 Launch E2E Specs (`e2e/phase1/**`)**:
   - **Phase 1 (Public)**: Assert `#383` / PR `#447` `HomePage.tsx` (`{slug, name}` org tiles, organizer login, and footer disclaimer), `#384` landing page SVG banner, `#361`/`#416` Teacher/Accompanist public directory, and `$0` accompanist signup form rendering without `staffAccessConsent`.
   - **Phase 2 (Authenticated Customer)**: Assert `S16` zero unauthenticated flash on navigation, `#417` / PR `#447` `Current Memberships` heading and action-oriented role-colored acquisition buttons (`Annual Teacher` / `Annual Accompanist`), `#418` read-only Teacher division post-creation, and `#353` `<form method="POST">` logout with zero `403` responses.
   - **Phase 3 (Authenticated Admin)**: Assert `#334`/`#335` / PR `#446` `/org/:slug/admin/memberships` card layout, wrapping horizontal entitlement badges, and consolidated 6-column `AdminEntitlementTable` (including directory moderation toggle `approved`/`rejected` and `#418` Teacher single-division edit), Shopify reconciliation panel moved to `/org/:slug/admin/integrations`, `#359` Concerto Repertoire CSV export and dry-run preview, and direct admin subroute navigation (`/settings`, `/roster`, `/rooms`, `/volunteers`, `/integrations`).
4. **CI Integration (`.github/workflows/pr-checks.yml` or `.github/workflows/e2e-phase1.yml`)**:
   - Wire Phase 1 Playwright E2E with Postgres 17 service container and Chromium browser installation into GitHub Actions so every pre-`Dec 1` release (`v0.4.2` and any hotfix) runs repeatable automated browser verification.
5. **Full `v0.4.2` Verification Pass & Review**:
   - Execute full end-to-end verification ahead of `Dec 1` launch: unit tests, all 24 Postgres 17 integration suites, Phase 1 Playwright E2E (`bun run test:e2e:phase1`), `perf-test.yml` benchmark, and all standard quality gates (`verify:toolchain`, `format:check`, `lint`, `build`, frontend/backend `tsc`, `check:sql`), then complete independent subagent code review (`code-review.md`).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s22-phase1-playwright-e2e-smoke
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run check:sql
bun run test
bun run test:e2e:phase1
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s22-phase1-playwright-e2e-smoke -RequireCodeReview
```

## Delivery
- Delivered files:
  - `playwright.config.ts` — headless Chromium Playwright configuration with trace/screenshot capture on failure and single-worker deterministic execution.
  - `e2e/phase1/**` — Phase 1 Public, Phase 2 Authenticated Customer, and Phase 3 Authenticated Admin smoke specs, plus E2E-only seed/auth helpers, global console-error and HTTP `5xx` guards, and server bootstrap harness.
  - `package.json` & `bun.lock` — `@playwright/test` devDependency and root `test:e2e` / `test:e2e:phase1` scripts.
  - `.github/workflows/e2e-phase1.yml` — GitHub Actions workflow running Phase 1 Playwright E2E against a Postgres 17 service container with Chromium installation.
  - `tasks/s22-phase1-playwright-e2e-smoke/code-review.md` — independent subagent review record (`Findings status: none`, `Verdict: patch is correct`).
- Dual-mode E2E bootstrap:
  - `PLAYWRIGHT_BASE_URL` live read-safe mode for optional remote verification (e.g., `https://int.artsfestival.online`) without mutating remote state.
  - Postgres 17 `DATABASE_URL` CI/local mode launching an ephemeral local Festival stack backed by real Postgres 17 migrations and seed data.
  - Dockerless in-memory fallback when no `DATABASE_URL` is provided in local developer environments.

## Quality gate results
- Local Windows verification:
  - `biome check` / `biome lint` across packages: passed (`0` errors, `0` warnings).
  - TypeScript checks (`tsc --noEmit`) for `@festival/common`, `@festival/backend`, and `@festival/frontend`: passed.
  - Frontend production build (`vite build`): passed.
  - `bun run check:sql`: passed.
  - `playwright test e2e/phase1`: `10/10` passed (`0` console errors, `0` HTTP `5xx`).
  - `validate-packet.ps1 -TaskName s22-phase1-playwright-e2e-smoke -RequireCodeReview`: exit `0`.
- CI verification:
  - `Pull Request Checks / verify` and `e2e-phase1` (Postgres 17 + Chromium) gated on PR prior to merge.
