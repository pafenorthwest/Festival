# S04 — Cutover & Publish Release `v0.3.0` Baseline

## Goal reference
- Goal contract: `goals/s04-release-v0-3-0-cutover/goals.v0.md` (`establish-goals.v0.md`)
- Master program ledger: `specs/pre-thanksgiving-program.md` (Wave 1 Milestone Gate, depends on `S02` and `S03`)
- Strategic DDD context map: `specs/bounded-contexts-2026.md` (workspace-wide `v0.3.0` baseline across all bounded contexts)

## Scope

### In scope
- `package.json`
- `packages/common/package.json`
- `packages/backend/package.json`
- `packages/frontend/package.json`
- `packages/shopify-confirmation/package.json`
- `CHANGELOG.md`
- Git `release` branch promotion PR, annotated tag `v0.3.0`, and GitHub Release `v0.3.0`
- `tasks/s04-release-v0-3-0-cutover/spec.md` and `tasks/s04-release-v0-3-0-cutover/code-review.md`
- `specs/pre-thanksgiving-program.md` (status flip for `S04` upon release publication)

### Out of scope
- Any application source files under `packages/*/src/**`, `nginx/`, `docker/`, `cloud-setup/`, or `database/`
- Production host provisioning and credential setup (locked to `s05-live-prod-firebase-shopify-launch`)
- Wave 2 and Wave 3 refactor packets (`S06`–`S13`)

## Approach
1. **Lockstep Version Bump & Changelog**:
   - Update `"version": "0.3.0"` across `package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, and `packages/shopify-confirmation/package.json`.
   - Add `## [0.3.0]` release notes in `CHANGELOG.md` summarizing PR `#354` (registration redesign, `#355` checkout execution store, logout CSRF hardening closing `#353`/`#356`), PR `#360` (25 PAFE concertos bootstrap), Issue `#361` (Public Teacher Directory), and Track 1 CI/Postgres/`tsc`/`check:sql` gates (`S02`).
2. **Release PR to `main` & Full Verification**:
   - Run the full verification suite locally with `POSTGRES_INTEGRATION_URL` active, complete independent subagent `code-review.md`, and merge the version-bump PR into `main`.
3. **Promote `main` to `release` & Tag `v0.3.0`**:
   - Open and merge the release PR from `main` into `release` after CI checks pass.
   - Create annotated tag `v0.3.0` on `release`, push the tag (with explicit user confirmation prior to remote release/tag publication if required), and publish the GitHub Release.
4. **Verify GHCR Artifacts**:
   - Confirm the release workflow builds and pushes `v0.3.0` container images to GHCR cleanly, unblocking `S05` (`Live Prod Ops`) and Wave 2 (`S06`–`S08`).

## Verification commands
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s04-release-v0-3-0-cutover
$env:POSTGRES_INTEGRATION_URL = "postgres://postgres:postgres@127.0.0.1:5432/festival_test"
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- **`[G1]` Lockstep `0.3.0` Manifest Bump & Changelog (`48b7f4439de11d78e6038e5fc8507f805f912bd8`, PR `#369` -> `a92bf94d7ca19312b0022c62b4e0ddeff21a4f2e`)**: Bumped `"version"` to `"0.3.0"` across `package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, and `packages/shopify-confirmation/package.json`; added `## [0.3.0] - 2026-11-13` in `CHANGELOG.md` covering `#354` (`#353`, `#355`, `#356`), `#360`, `#361`, `#344`/`#348`/`#350`, and Track 1 CI/Postgres/`tsc`/`check:sql`/DDD boundary gates (`#363`–`#368`).
- **`[G2]` Local & CI Verification Gates**: Local verification (`Bun 1.4.2`, `TypeScript 5.9.3`, Biome `format:check` & `lint` across `529` files, workspace `build`, frontend `check:types`, backend/test `tsc --noEmit`, `2,428 pass / 0 fail / 0 skip` across `206` files with PostgreSQL `17.11`, `check:sql` across `280` files) and GitHub Actions `Pull Request Checks / verify` on PR `#369` (run `43190914904`) and PR `#370` (run `43317342310`) passed with exit `0`.
- **`[G3]` Promotion to `release`, Annotated Tag `v0.3.0` & GitHub Release**: Merged `main` into `release` via PR `#370` (`dc775ab23dd706c9ac4a05559dd1259421c254fe`), created and pushed annotated tag `v0.3.0` (`49fd615200f96e5a29c287de59c41bfbbbaa0261` -> `dc775ab23dd706c9ac4a05559dd1259421c254fe`), and published GitHub Release `v0.3.0` (`https://github.com/pafenorthwest/Festival/releases/tag/v0.3.0`).
- **`[G4]` Release & GHCR Container Workflows**: Verified `Continuous Deployment` (`deploy.yml`) green on `release` (run `43317692830`) and on `refs/tags/v0.3.0` (run `43320785687`, `target_environment=production`, all 4 jobs `success`), publishing `ghcr.io/pafenorthwest/festival-backend:v0.3.0` + `:latest` (`sha256:11647f1ee174e01a50eaa692cb28d39c4e2a8081de340e6deebf22b38a321204`) and `ghcr.io/pafenorthwest/festival-frontend:v0.3.0` + `:latest` (`sha256:8b50d4f80bb93ddc24984dc1d257023f7dfbae30cae5d43dc1b70c3a48677457`).
- **Exceptions**: None.
- **Deferred work**: Live Ubuntu 24.04, Firebase, and Shopify production provisioning remains scoped to `s05-live-prod-firebase-shopify-launch`; Wave 2–3 refactors remain scoped to `s06`–`s13` targeting `v0.4.0`.

## Quality gate results
- Packet validator (`validate-packet.ps1 -TaskName s04-release-v0-3-0-cutover -RequireCodeReview`): `PASS` — `PACKET VALID: task=s04-release-v0-3-0-cutover iteration=v0 state=locked goals=4 codeReview=valid(none)` (`exit=0`)
- `bun run verify:toolchain`: `PASS` — `Using Bun 1.4.2 and TypeScript 5.9.3.` (`exit=0`)
- `bun run format:check`: `PASS` — `Checked 529 files` (`No fixes applied.`, `exit=0`)
- `bun run lint`: `PASS` — `Checked 529 files` (`0` warnings, `0` errors, `exit=0`)
- `bun run build`: `PASS` — built `@festival/common`, `@festival/backend`, `@festival/frontend`, and `@festival/shopify-confirmation` (`exit=0`)
- `bun run --cwd packages/frontend check:types`: `PASS` — `tsc -p tsconfig.json --noEmit` clean (`exit=0`)
- `bun run test` (with `POSTGRES_INTEGRATION_URL` on PostgreSQL `17.11`): `PASS` — `2,428 pass, 0 fail, 0 skip` across `206` test files (`exit=0`), plus backend/test `tsc --noEmit` (`exit=0`)
- `bun run check:sql`: `PASS` — `Validated 280 backend TypeScript files.` (`exit=0`)
- GitHub Actions PR & Release Workflows: `PASS` — `Pull Request Checks / verify` on PR `#369` (run `43190914904`) and PR `#370` (run `43317342310`) exited `0`; `Continuous Deployment` (`deploy.yml`) succeeded on `release` (run `43317692830`) and `refs/tags/v0.3.0` (run `43320785687`, `target_environment=production`, all 4 jobs `success`), publishing `ghcr.io/pafenorthwest/festival-backend:v0.3.0` + `:latest` (`sha256:11647f1ee174e01a50eaa692cb28d39c4e2a8081de340e6deebf22b38a321204`) and `ghcr.io/pafenorthwest/festival-frontend:v0.3.0` + `:latest` (`sha256:8b50d4f80bb93ddc24984dc1d257023f7dfbae30cae5d43dc1b70c3a48677457`)
- Code review (`tasks/s04-release-v0-3-0-cutover/code-review.md`): `PASS` — `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`0.99` confidence)
