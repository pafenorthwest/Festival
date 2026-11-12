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
Pending execution.

## Quality gate results
Pending execution.
