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
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
Pending execution.

## Quality gate results
Pending execution.
