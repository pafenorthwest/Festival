# Establish Goals
- Task name: s01-pr354-logout-csrf-and-pr360-merge
- Iteration: v0
- State: draft

## Status
Draft contract awaiting resolution of `D2` (`#357` `B1`/`B2` scheduling) and `D3` (`#354` browser QA JSON artifact retention) before locking to `State: locked`.

## Request
Patch the logout CSRF `403` and origin-validation defects on PR `#354` (`ericp/registration-flow-redesign`), cherry-pick the base64 `+/=` regex fix in `cloud-setup/02-validate-env.sh`, verify frontend TypeScript compilation alongside the full repo quality gate, merge PR `#354` (`--no-ff`, auto-closing `#353` and `#356`), and merge PR `#360` (`codex/pafe-concerto-migration`) into `main`.

## Blocking ambiguity
- `D2` (`#357` Checkout Edge Cases `B1`/`B2` timing): Confirm whether `B1` (pre-dispatch rejection `idempotencyKey` retirement) and `B2` (cross-festival blocker cart release) stay deferred to December Week 1 QA or fold into Wave 2 (`S01` assumes deferred out of Wave 1).
- `D3` (`#354` QA Dump Cleanup): Confirm whether to strip `+8,592` lines of `tasks/festival-registration-ui/validation/browser-*results.json` from `ericp/registration-flow-redesign` prior to merging `#354`, or retain them.

## Assumptions
- PR `#353` (`fix/issue-338-registration-auth-return-and-logout`) sole commit `ef8e23c` is already contained inside PR `#354` (`1d8be9b`, widened `returnTo` regex `/(?:register(?:/cart)?|cart)$`) and will auto-close when `#354` merges with `--no-ff`.
- PR `#360` (`codex/pafe-concerto-migration`) has zero file overlap with `#354` and introduces migration `20261109000000_load_pafe_concertos.sql` sequenced cleanly after `#354` migrations `20261108000000_class_checkout_execution_recovery.sql` and `20261108010000_class_checkout_storefront_binding.sql`.
- Forwarded headers remain untrusted unless `TRUST_PROXY_HEADERS` is explicitly enabled per `SECURITY.md`.

## Goals
1. Eliminate customer POST logout CSRF `403` failures and proxy-header spoofing by setting `Referrer-Policy: same-origin` in `nginx/festival.conf` and `docker/nginx.festival.conf`, removing the unguarded `Host`/`X-Forwarded-Host` fallback in `packages/backend/src/routes/shared/csrf-guard.ts`, and enforcing strict `resolveRequestOrigin(c) === publicOrigin` equality in `packages/backend/src/routes/checkout/admin-class-checkout-recovery.routes.ts`.
2. Relax base64 secret validation in `cloud-setup/02-validate-env.sh` to accept standard `+/=` characters and apply the agreed retention decision (`D3`) to `tasks/festival-registration-ui/validation/browser-*results.json` on the PR `#354` branch.
3. Verify zero TypeScript, Biome, SQL, and test regressions across the combined PR `#354` branch, including `bun run --cwd packages/frontend check:types`.
4. Merge PR `#354` (`ericp/registration-flow-redesign`) into `main` using `--no-ff` to preserve commit `ef8e23c` ancestry (auto-closing PR `#353` and Issue `#356`), and merge PR `#360` (`codex/pafe-concerto-migration`) cleanly into `main`.

## Non-goals
- Implementing `#357` checkout edge-case fixes (`B1` pre-dispatch rejection key retirement and `B2` cross-festival blocker unfreeze) unless explicitly pulled into scope by decision `D2`.
- Modifying `#362` concerto combobox UI (`LIMIT 20` / manual entry) or `#359` admin concerto CSV import/export.
- Enabling CI Postgres 17 services or modifying `.github/workflows/*` (owned by `s02-ci-postgres-tsc-and-boundary-gates`).
- Implementing `#361` Public Teacher Directory UI flows (owned by `s03-issue-361-public-teacher-directory`).

## Success criteria
- [G1] `nginx/festival.conf` and `docker/nginx.festival.conf` emit `Referrer-Policy: same-origin`; `resolveRequestOrigin` in `packages/backend/src/routes/shared/csrf-guard.ts` rejects missing `Origin`/`Referer` and untrusted forwarded headers; `packages/backend/src/routes/checkout/admin-class-checkout-recovery.routes.ts` requires `resolveRequestOrigin(c) === publicOrigin`; deterministic tests cover same-origin POST logout (`200`/`302`), `Origin: "null"` rejection (`403`), and forged `X-Forwarded-Host` rejection (`403`).
- [G2] `cloud-setup/02-validate-env.sh` accepts valid base64 strings containing `+`, `/`, and `=`, and `tasks/festival-registration-ui/validation/browser-*results.json` matches the locked `D3` decision.
- [G3] `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bun run test`, and `bun run check:sql` all exit `0` with zero warnings or errors.
- [G4] PR `#354` is merged into `main` with `--no-ff` (closing `#353` and `#356`), PR `#360` (`database/bootstrap/pafe-concertos.csv` and `database/migrations/20261109000000_load_pafe_concertos.sql`) is merged into `main` with zero conflicts, and `main` passes all verification checks.

## Next action
Confirm decisions `D2` and `D3` with the user, transition `State` from `draft` to `locked` in `establish-goals.v0.md` and `goals.v0.md`, and execute `tasks/s01-pr354-logout-csrf-and-pr360-merge/spec.md`.
