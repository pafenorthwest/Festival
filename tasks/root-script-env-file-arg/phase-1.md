# Phase 1 — Shell Wrapper Env-File Forwarding

## Objective

Add minimal argument parsing to the root dev/prod shell scripts so they accept `--env-file=...`, forward it only to the backend Bun process, and reject unsupported extra flags.

## Code areas impacted
- `scripts/run-dev.sh`
- `scripts/run-prod.sh`
- `tasks/root-script-env-file-arg/*` for lifecycle evidence only

## Work items
- [x] Parse an optional `--env-file=...` argument in `scripts/run-dev.sh`.
- [x] Parse an optional `--env-file=...` argument in `scripts/run-prod.sh`.
- [x] Keep frontend/nginx invocation unchanged except for explicit unsupported-argument handling.
- [x] Verify forwarded Bun command shapes with stubbed binaries and run root `lint`, `build`, and `test`.

## Deliverables
- Root dev/prod wrappers forward `--env-file=...` to backend Bun startup.
- Unsupported extra args fail fast with explicit error text.
- Verification evidence is captured in `final-phase.md`.

## Gate (must pass before proceeding)
- [x] Both scripts accept the requested env-file argument form without widening scope.
- [x] Existing no-argument behavior remains intact by inspection and verification.
- [x] Root verification commands pass.

## Verification steps
- [x] Command: `PATH="<stub-dir>:$PATH" ./scripts/run-dev.sh --env-file=/Users/eric/pafenorthwest/Festival/.env`
  - Expected: stubbed backend Bun invocation includes `--env-file=/Users/eric/pafenorthwest/Festival/.env` before `--cwd packages/backend dev`.
  - Observed: `bun run --env-file=/Users/eric/pafenorthwest/Festival/.env --cwd packages/backend dev`
- [x] Command: `PATH="<stub-dir>:$PATH" ./scripts/run-prod.sh --env-file=/Users/eric/pafenorthwest/Festival/.env`
  - Expected: stubbed backend Bun invocation includes `--env-file=/Users/eric/pafenorthwest/Festival/.env` before `./packages/backend/dist/index.js`.
  - Observed: `bun --env-file=/Users/eric/pafenorthwest/Festival/.env ./packages/backend/dist/index.js`
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
- Risk: shell argument handling accidentally forwards unsupported flags to frontend or nginx.
- Mitigation: accept only `--env-file=...` and exit non-zero for anything else.
