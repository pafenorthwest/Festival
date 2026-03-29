# Phase 2 — Production Frontend Serving and Combined Prod Flow

## Objective
Add the nginx configuration and root production orchestration needed to serve built frontend assets together with the production backend.

## Code areas impacted
- `package.json`
- repo-local nginx config
- any helper script used by the root `prod` command
- `packages/frontend` build output assumptions
- `packages/backend` production runtime path assumptions

## Work items
- [x] Add checked-in nginx config that serves the frontend `dist` directory with SPA fallback.
- [x] Add or wire the root `prod` command to build required assets, start the backend production process, and launch nginx against the checked-in config.
- [x] Keep the flow aligned with the explicit non-goal that there is no `prod:frontend` script.
- [x] Make the production orchestration fail fast when `nginx` is missing or required build artifacts cannot be produced.

## Deliverables
- Repo-local nginx config for serving frontend build artifacts and proxying `/api` to the backend.
- Root `prod` startup path for backend plus nginx-served frontend.
- Clear runtime assumptions embedded in script/config behavior.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Repository contains an nginx config that serves `packages/frontend/dist` and proxies `/api` to the backend on port `3000`.
- [x] Root `prod` command starts the backend production runtime and validates/launches nginx-backed frontend serving together.
- [x] Production flow still requires no added dependency and no `prod:frontend` script.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run build`
  - Expected: frontend assets and backend artifacts are available for the production orchestration path. PASS
- [x] Command: `bun run prod`
  - Expected: command validates prerequisites and starts backend plus nginx serving flow when `nginx` is available. PASS for fail-fast behavior; command exited explicitly with `nginx is required for 'bun run prod' but was not found on PATH.`

## Risks and mitigations
- Risk:
  - nginx path assumptions or foreground/background behavior can make the combined production command brittle across environments.
- Mitigation:
  - Keep the config repo-local, use explicit command arguments, and document the required local `nginx` availability.
