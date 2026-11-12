# Establish Goals
- Task name: s04-release-v0-3-0-cutover
- Iteration: v0
- State: locked

## Status
Locked milestone gate ready to execute on `Nov 13 PM` immediately after both `S02` and `S03` merge to `main`.

## Request
Cut the `v0.3.0` feature-baseline release by bumping all 5 `package.json` manifests to `0.3.0`, updating `CHANGELOG.md`, promoting `main` to `release`, tagging `v0.3.0` with a published GitHub Release, and verifying GHCR container image publication.

## Blocking ambiguity
None.

## Assumptions
- `S01`, `S02`, and `S03` are merged to `main` and green on CI (including the real Postgres 17 service container from `S02`) before `S04` begins.
- Cutting `v0.3.0` decouples the Parallel Live Infrastructure Track (`S05`, `Nov 14–20`) from the Wave 2–3 Full Refactor Sprint (`S06`–`S13` -> `v0.4.0`).

## Goals
1. Bump `"version"` in lockstep to `"0.3.0"` across all 5 workspace manifests (`package.json`, `packages/common/package.json`, `packages/backend/package.json`, `packages/frontend/package.json`, and `packages/shopify-confirmation/package.json`) and document the `v0.3.0` release in `CHANGELOG.md`.
2. Verify the release candidate on `main` passes the complete local and CI gate (including Track 1 real Postgres 17 integration suites, frontend/backend `tsc`, Biome, and `check:sql`).
3. Merge `main` into `release` via pull request, create annotated tag `v0.3.0`, and publish the `v0.3.0` GitHub Release.
4. Confirm GHCR container image builds and release workflows succeed for `v0.3.0` so the Parallel Live Ops Track (`S05`) deploys immutable `v0.3.0` artifacts.

## Non-goals
- Provisioning live Ubuntu 24.04 hosts, Firebase projects, or Shopify stores (owned by `s05-live-prod-firebase-shopify-launch`).
- Introducing Wave 2 or Wave 3 structural refactors (`S06`–`S13`, targeted for `v0.4.0`).
- Modifying runtime application behavior during the version bump and release cutover.

## Success criteria
- [G1] All 5 `package.json` files report `"version": "0.3.0"` and `CHANGELOG.md` contains an accurate `## [0.3.0] - 2026-11-13` section covering `#354` (`#353`, `#355`, `#356`), `#360`, `#361`, and Track 1 CI hardening.
- [G2] `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bun run test` (with `POSTGRES_INTEGRATION_URL`), and `bun run check:sql` exit `0`.
- [G3] `main` is merged cleanly into `release`, annotated tag `v0.3.0` points to the `release` commit, and the GitHub Release `v0.3.0` is published.
- [G4] GitHub Actions release/GHCR image workflows complete green and publish `v0.3.0`-tagged container images.

## Next action
Once `S02` and `S03` are `DONE` in `specs/pre-thanksgiving-program.md`, branch `chore/s04-release-v0-3-0-cutover` from `main` and execute `tasks/s04-release-v0-3-0-cutover/spec.md`.
