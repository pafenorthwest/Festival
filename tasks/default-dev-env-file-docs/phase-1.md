# Phase 1 — Default Dev Env File And Docs

## Objective

Make the root backend development commands use the repo-root `.env` by default while preserving explicit env-file override support for the combined dev wrapper, then update the relevant docs/metadata to match.

## Code areas impacted
- `package.json`
- `scripts/run-dev.sh`
- `README.md`
- `.codex/project-structure.md`
- `tasks/default-dev-env-file-docs/*` for lifecycle evidence only

## Work items
- [x] Update `dev:backend` to pass the repo-root `.env` by default.
- [x] Update `scripts/run-dev.sh` so the backend process defaults to the repo-root `.env` unless an explicit `--env-file=...` is provided.
- [x] Update `README.md` local-development guidance to describe the default env-file behavior and the override form.
- [x] Review and update `.codex/project-structure.md` so repo metadata matches the command behavior.
- [x] Verify command shapes with stubbed `bun` execution and run root `lint`, `build`, and `test`.

## Deliverables
- Root backend development flows default to the repo-root `.env`.
- Combined root dev still supports explicit `--env-file=...` overrides.
- Documentation and project metadata reflect the current behavior.

## Gate (must pass before proceeding)
- [x] `dev:backend` defaults to the repo-root `.env`.
- [x] Combined root `dev` defaults to the repo-root `.env` and still honors explicit overrides.
- [x] README/project metadata accurately describe the behavior.
- [x] Root verification commands pass.

## Verification steps
- [x] Command: `PATH="<stub-dir>:$PATH" bun run dev:backend`
  - Expected: stubbed backend Bun invocation includes `--env-file=$(pwd)/.env`.
  - Observed: `stub bun run --env-file=/Users/eric/pafenorthwest/Festival/.env --cwd packages/backend dev`
- [x] Command: `PATH="<stub-dir>:$PATH" ./scripts/run-dev.sh`
  - Expected: stubbed backend Bun invocation includes `--env-file=/Users/eric/pafenorthwest/Festival/.env`.
  - Observed: `stub bun run --env-file=/Users/eric/pafenorthwest/Festival/.env --cwd packages/backend dev`
- [x] Command: `PATH="<stub-dir>:$PATH" ./scripts/run-dev.sh --env-file=/custom/.env`
  - Expected: stubbed backend Bun invocation uses `/custom/.env` instead of the default path.
  - Observed: `stub bun run --env-file=/custom/.env --cwd packages/backend dev`
- [x] Command: `bun run lint`
  - Expected: PASS.
  - Observed: PASS.
- [x] Command: `bun run build`
  - Expected: PASS.
  - Observed: PASS.
- [x] Command: `bun run test`
  - Expected: PASS.
  - Observed: PASS.

## Risks and mitigations
- Risk: the default env-file path could conflict with explicit overrides or drift from the documented examples.
- Mitigation: initialize the wrapper with the repo-root default, replace it when an explicit `--env-file=...` is supplied, and update docs in the same change.
