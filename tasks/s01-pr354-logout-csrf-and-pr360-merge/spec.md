# S01 — Patch PR #354 Logout CSRF & Origin Guards and Merge PR #354 + PR #360

## Goal reference
- Goal contract: `goals/s01-pr354-logout-csrf-and-pr360-merge/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 1, Group W1-A, depends on `S00`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (`customer-identity`, `class-checkout`, `catalog-repertoire`, and edge reverse-proxy configuration)

## Scope

### In scope
- `nginx/festival.conf`
- `docker/nginx.festival.conf`
- `packages/backend/src/routes/shared/csrf-guard.ts`
- `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts`
- `packages/backend/src/routes/api-router.ts` (`publicOrigin` wiring)
- `packages/backend/src/app.ts` (`publicOrigin` wiring)
- `packages/backend/tests/` (targeted CSRF guard and admin recovery origin tests)
- `cloud-setup/02-validate-env.sh`
- `tasks/festival-registration-ui/validation/browser-*results.json` (strip 5 files, `+8,592` lines, on PR `#354` per decision `D3`)
- Merging PR `#354` (`ericp/registration-flow-redesign` into `main`, `--no-ff`) and PR `#360` (`codex/pafe-concerto-migration` into `main`)
- `tasks/s01-pr354-logout-csrf-and-pr360-merge/spec.md` and `tasks/s01-pr354-logout-csrf-and-pr360-merge/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S01` upon merge)

### Out of scope
- `.github/workflows/pr-checks.yml`, `.github/workflows/deploy.yml`, `packages/backend/tsconfig.json`, `scripts/check-sql.ts`, `packages/backend/tests/architecture-boundaries.test.ts` (locked to `s02-ci-postgres-tsc-and-boundary-gates`)
- `packages/backend/src/routes/participant-profile/participant-profile.routes.ts` and `packages/frontend/src/pages/PublicDirectoryPage.tsx` (locked to `s03-issue-361-public-teacher-directory`)
- `package.json` version bumps and `CHANGELOG.md` (locked to `s04-release-v0-3-0-cutover`)
- `database/postgres17-schema.sql` migration runner and `packages/backend/src/repo/postgres-schema.ts` boot DDL removal (locked to `s06-schema-migrations-ledger-runner`)
- PR `#358` cache invalidation and read-model SQL joins (locked to `s07-pr358-cache-invalidation-and-read-models`)

## Approach
1. **Confirm Gate Decisions (`D2`, `D3`)**: Locked `D2` (defer `#357` checkout edge cases `B1`/`B2` to the December Week 1 bug-fix sprint) and `D3` (strip the 5 `tasks/festival-registration-ui/validation/browser-*results.json` files, `+8,592` lines, from PR `#354` before merge) in `goals.v0.md` and `establish-goals.v0.md`.
2. **Red-Green CSRF & Origin Guard Tests**: Check out `ericp/registration-flow-redesign` in an isolated worktree and add failing unit/route tests proving:
   - `resolveRequestOrigin` rejects requests lacking both `Origin` and `Referer` instead of falling back to `Host` or unguarded `X-Forwarded-Host` / `X-Forwarded-Proto`.
   - `resolveRequestOrigin` rejects literal `Origin: "null"`.
   - Admin checkout recovery POST routes in `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts` reject cross-origin requests where `resolveRequestOrigin(c) !== publicOrigin`.
3. **Edge & Backend Fixes**:
   - Update `Referrer-Policy` from `no-referrer` to `same-origin` in `nginx/festival.conf` and `docker/nginx.festival.conf` so `<form method="POST">` customer logout (`logoutCustomer` in `packages/frontend/src/lib/api.ts`) transmits valid same-origin referrer/origin metadata.
   - Remove the `Host` / `X-Forwarded-Host` fallback in `packages/backend/src/routes/shared/csrf-guard.ts`.
   - Enforce `resolveRequestOrigin(c) === publicOrigin` in `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts` (wired via `packages/backend/src/routes/api-router.ts` and `packages/backend/src/app.ts`).
   - Update the base64 validation regex in `cloud-setup/02-validate-env.sh` to permit `+`, `/`, and `=`.
   - Strip the 5 `tasks/festival-registration-ui/validation/browser-*results.json` files (`+8,592` lines) from PR `#354` per locked decision `D3`.
4. **Full Verification & Sequential Merges**:
   - Run the full local verification suite including `bun run --cwd packages/frontend check:types`.
   - Merge PR `#354` into `main` with `--no-ff` (preserving `ef8e23c` ancestry so PR `#353` and Issue `#356` close cleanly; avoid squash-merging `#353` separately).
   - Merge PR `#360` (`database/bootstrap/pafe-concertos.csv` + `database/migrations/20261109000000_load_pafe_concertos.sql`) into `main` and re-run the full verification gate on `main`.

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s01-pr354-logout-csrf-and-pr360-merge
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s01-pr354-logout-csrf-and-pr360-merge -RequireCodeReview
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- **Goal Lock & Gate Decisions (`7f35f935a6e2ff73eef2e068581866518e57ccf7`)**: Locked `goals/s01-pr354-logout-csrf-and-pr360-merge/goals.v0.md` and `establish-goals.v0.md` (`State: locked`) with resolved user decisions `D2` (deferring Issue `#357` checkout recovery edge cases `B1`/`B2` to the December Week 1 bug-fix sprint) and `D3` (stripping the 5 QA browser result JSON dumps prior to merging PR `#354`), and updated `specs/pre-thanksgiving-program.md` (`D2`, `D3`, and `S01` -> `DONE`).
- **`[G1]` Edge Referrer-Policy & Strict CSRF / Origin Guards (`4d1c0c68c63da9b9dfaaac0528e1b820657a38ee`)**:
  - Updated `Referrer-Policy` from `"no-referrer"` to `"same-origin"` across both server and `/healthz` blocks in `nginx/festival.conf` and `docker/nginx.festival.conf`, allowing browser `<form method="POST">` customer logout submissions to supply valid same-origin referrer/origin metadata without leaking cross-origin referrers.
  - Hardened `resolveRequestOrigin` in `packages/backend/src/routes/shared/csrf-guard.ts` (`29` lines) to parse `Origin` and `Referer` via `new URL(...).origin`, reject literal `"null"`, opaque schemes, malformed URLs, and missing origin/referrer headers with `403`, and remove the unguarded `Host` / `X-Forwarded-Host` / `X-Forwarded-Proto` fallback (`TRUST_PROXY_HEADERS` boundary in `SECURITY.md`).
  - Enforced fail-closed `Boolean(publicOrigin) && resolveRequestOrigin(c) === publicOrigin` equality on admin checkout recovery POST endpoints in `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts` (`155` lines), wired with `publicOrigin` through `packages/backend/src/routes/api-router.ts` and `packages/backend/src/app.ts`.
  - Added deterministic unit and route test coverage across `packages/backend/tests/customer-logout-csrf.test.ts`, `packages/backend/tests/csrf-guard.test.ts`, `packages/backend/tests/admin-class-checkout-recovery.test.ts`, `packages/backend/tests/customer-account-routes.test.ts`, and `packages/backend/tests/nginx-security.test.ts` (`65` passing tests across the 5 suites).
- **`[G2]` Env Secret Validation & QA Dump Cleanup (`4d1c0c68c63da9b9dfaaac0528e1b820657a38ee`)**:
  - Relaxed the `FESTIVAL_RECONCILIATION_TOKEN` regex in `cloud-setup/02-validate-env.sh` to `r"[A-Za-z0-9_+=/-]{32,}"` so standard base64 (`+`, `/`, `=`) and base64url tokens validate cleanly.
  - Removed all 5 `tasks/festival-registration-ui/validation/browser-*results.json` QA dump files (`-8,796` lines across 5 files) from `ericp/registration-flow-redesign` prior to merging PR `#354` per decision `D3`.
- **`[G3]` & `[G4]` Sequential `--no-ff` Merges into `origin/main`**:
  - Merged patched PR `#354` (`ericp/registration-flow-redesign`, head `4d1c0c68c63da9b9dfaaac0528e1b820657a38ee`) into `origin/main` via `--no-ff` merge commit `95d2dd07fde287af2f288629b47f8dcebecc08b8`, preserving commit `ef8e23cf767f57128c917da0e92634e87303b802` ancestry and automatically closing PR `#353` and Issue `#356`.
  - Merged PR `#360` (`codex/pafe-concerto-migration`, commit `47bb4b3783ce618254358015774b3b0ca7ef4419` — `database/bootstrap/pafe-concertos.csv`, `database/migrations/20261109000000_load_pafe_concertos.sql`, and `database/migrations/README.md`) cleanly into `origin/main` via `--no-ff` merge commit `b00d1bd56c9dd92fe684451d70801f1281a6b498`.
- **Exceptions**: None.
- **Deferred work**: Issue `#357` checkout recovery edge cases (`B1` pre-dispatch rejection key retirement and `B2` cross-festival blocker unfreeze) remain scheduled for the December Week 1 bug-fix sprint per locked decision `D2`.

## Quality gate results
- Packet validator (`validate-packet.ps1 -TaskName s01-pr354-logout-csrf-and-pr360-merge -RequireCodeReview`): `PASS` — `PACKET VALID: task=s01-pr354-logout-csrf-and-pr360-merge iteration=v0 state=locked goals=4 codeReview=valid(none)` (`exit=0`)
- `bun run verify:toolchain`: `PASS` — `Using Bun 1.4.2 and TypeScript 5.9.3.` (`exit=0`)
- `bun run format:check`: `PASS` — `Checked 520 files` (`No fixes applied.`, `exit=0`)
- `bun run lint`: `PASS` — `Checked 520 files` (`0` warnings, `0` errors, `exit=0`)
- `bun run build`: `PASS` — built `@festival/common`, `@festival/backend`, `@festival/frontend` (`173` modules), and `@festival/shopify-confirmation` (`exit=0`)
- `bun run --cwd packages/frontend check:types`: `PASS` — `tsc -p tsconfig.json --noEmit` clean (`exit=0`)
- `bun run test`: `PASS` — `2342 pass, 54 skip, 0 fail` across `202` test files (`common`: `353 pass` / `22` files; `backend`: `1527 pass, 54 skip` / `129` files; `frontend`: `442 pass` / `50` files; `shopify-confirmation`: `20 pass` / `1` file; `exit=0`)
- `bun run check:sql`: `PASS` — `Validated 277 backend TypeScript files.` (`exit=0`)
- Code review (`tasks/s01-pr354-logout-csrf-and-pr360-merge/code-review.md`): `PASS` — `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`0.98` confidence)
