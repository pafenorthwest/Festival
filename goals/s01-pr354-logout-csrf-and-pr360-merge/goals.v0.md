# Goals Extract
- Task name: s01-pr354-logout-csrf-and-pr360-merge
- Iteration: v0
- State: locked

## Goals
1. Eliminate customer POST logout CSRF `403` failures and proxy-header spoofing by setting `Referrer-Policy: same-origin` in `nginx/festival.conf` and `docker/nginx.festival.conf`, removing the unguarded `Host`/`X-Forwarded-Host` fallback in `packages/backend/src/routes/shared/csrf-guard.ts`, and enforcing strict `resolveRequestOrigin(c) === publicOrigin` equality in `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts`.
2. Relax base64 secret validation in `cloud-setup/02-validate-env.sh` to accept standard `+/=` characters and strip the 5 `tasks/festival-registration-ui/validation/browser-*results.json` files (`+8,592` lines) from PR `#354` before merge (`D3`).
3. Verify zero TypeScript, Biome, SQL, and test regressions across the combined PR `#354` branch, including `bun run --cwd packages/frontend check:types`.
4. Merge PR `#354` (`ericp/registration-flow-redesign`) into `main` using `--no-ff` to preserve commit `ef8e23c` ancestry (auto-closing PR `#353` and Issue `#356`), and merge PR `#360` (`codex/pafe-concerto-migration`) cleanly into `main`.

## Non-goals
- Implementing `#357` checkout edge-case fixes (`B1` pre-dispatch rejection key retirement and `B2` cross-festival blocker unfreeze), deferred to the December Week 1 bug-fix sprint per decision `D2`.
- Modifying `#362` concerto combobox UI (`LIMIT 20` / manual entry) or `#359` admin concerto CSV import/export.
- Enabling CI Postgres 17 services or modifying `.github/workflows/*` (owned by `s02-ci-postgres-tsc-and-boundary-gates`).
- Implementing `#361` Public Teacher Directory UI flows (owned by `s03-issue-361-public-teacher-directory`).

## Success criteria
- [G1] `nginx/festival.conf` and `docker/nginx.festival.conf` emit `Referrer-Policy: same-origin`; `resolveRequestOrigin` in `packages/backend/src/routes/shared/csrf-guard.ts` rejects missing `Origin`/`Referer` and untrusted forwarded headers; `packages/backend/src/routes/admin-class-checkout-recovery.routes.ts` requires `resolveRequestOrigin(c) === publicOrigin`; deterministic tests cover same-origin POST logout (`200`/`302`), `Origin: "null"` rejection (`403`), and forged `X-Forwarded-Host` rejection (`403`).
- [G2] `cloud-setup/02-validate-env.sh` accepts valid base64 strings containing `+`, `/`, and `=`, and the 5 `tasks/festival-registration-ui/validation/browser-*results.json` files (`+8,592` lines) are stripped from PR `#354` before merge per locked decision `D3`.
- [G3] `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bun run test`, and `bun run check:sql` all exit `0` with zero warnings or errors.
- [G4] PR `#354` is merged into `main` with `--no-ff` (closing `#353` and `#356`), PR `#360` (`database/bootstrap/pafe-concertos.csv` and `database/migrations/20261109000000_load_pafe_concertos.sql`) is merged into `main` with zero conflicts, and `main` passes all verification checks.
