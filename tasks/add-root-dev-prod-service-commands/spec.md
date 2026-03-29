# Add Root Dev/Prod Service Commands

## Overview

Add root workspace commands for running frontend and backend services separately in development, running both together in development, running the backend from built artifacts in production, and running the backend plus nginx-served frontend assets together in production.

## Goals

- Add root `dev:frontend` and `dev:backend` commands that delegate to the existing workspace development commands.
- Add a root `dev` command that starts both services together using only Bun/shell capabilities already available in the repository environment.
- Add a root `prod:backend` command that runs the backend from built artifacts rather than the watch-mode development entrypoint.
- Add a root `prod` command that prepares and runs the production backend together with nginx serving the built frontend `dist` assets via checked-in config.
- Document the new commands and nginx-based production frontend flow.
- Preserve the canonical verification commands: `bun run lint`, `bun run build`, `bun run test`.

## Non-goals

- Adding a new dependency solely to manage multiple long-running processes.
- Adding a standalone `prod:frontend` script.
- Implementing deployment automation, containerization, or broader production infrastructure beyond the nginx config needed to serve built frontend assets.
- Changing frontend or backend application behavior unrelated to startup/build/serve commands.

## Use cases / user stories

- As a developer, I can run only the frontend locally from the repository root.
- As a developer, I can run only the backend locally from the repository root.
- As a developer, I can run both services together from the repository root for local development.
- As an operator, I can start the production backend from compiled output with a root command.
- As an operator, I can start the production backend and nginx-served frontend assets together with a root command when nginx is installed.

## Current behavior
- Notes:
  - The root workspace currently exposes `lint`, `build`, and `test` only.
  - `packages/frontend` exposes `dev`, `lint`, `build`, and `test`.
  - `packages/backend` exposes `dev`, `lint`, `build`, and `test`.
  - README documents separate workspace `dev` commands rather than root orchestration commands.
- Key files:
  - `package.json`
  - `packages/frontend/package.json`
  - `packages/backend/package.json`
  - `packages/backend/src/index.ts`
  - `README.md`

## Proposed behavior
- Behavior changes:
  - Root scripts will expose single-service and combined-service startup flows for development and production.
  - Production frontend serving will be represented by nginx configuration plus root orchestration rather than a dedicated frontend workspace script.
  - Production backend startup will execute built output instead of watch-mode TypeScript execution.
- Edge cases:
  - Combined long-running scripts must handle process shutdown without an added process manager dependency.
  - The production flow must document that nginx must be installed and accessible on `PATH`.

## Technical design
### Architecture / modules impacted
- `package.json`
- `packages/backend/package.json` and/or backend runtime entry path usage if needed for built-output startup
- `README.md`
- new repo-local nginx config and any small helper scripts needed for orchestration

### API changes (if any)

None.

### UI/UX changes (if any)

None.

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: No schema or data-shape changes.
- Rollback: Remove the added scripts/config and restore prior README instructions.

## Security & privacy

- No new secrets should be introduced.
- nginx config should serve only the built frontend assets and preserve SPA fallback behavior.
- Production orchestration must not weaken existing backend environment-variable requirements.

## Observability (logs/metrics)

- Backend startup logging remains the existing Bun server log output.
- nginx access/error logging behavior should rely on default local nginx handling unless repo config explicitly needs overrides.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run lint`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: Rely on existing workspace test suites through `bun run test`.
- Integration: Validate script wiring through build/start command behavior where practical.
- E2E / UI (if applicable): Not in scope.

## Acceptance criteria checklist
- [ ] Root scripts exist for `dev`, `prod`, `dev:frontend`, `dev:backend`, and `prod:backend`.
- [ ] Production frontend serving is represented by checked-in nginx config and documented usage.
- [ ] Canonical verification commands remain unchanged and pass after implementation.

## IN SCOPE
- Root script additions in `package.json`.
- Directly related helper scripts/config needed to orchestrate backend/frontend startup.
- nginx config for serving built frontend assets from `dist`.
- README updates for the new local development and production command flows.
- Minimal task-artifact updates required by the lifecycle.

## OUT OF SCOPE
- New third-party process orchestration dependencies.
- Standalone `prod:frontend` command.
- Deployment manifests, Dockerfiles, reverse-proxy hardening beyond the required nginx serving config, or infrastructure automation.
- Application feature work in frontend/backend source unrelated to startup/build/serve flows.

## Goal lock assertion

- Locked goals approved by user from `goals/add-root-dev-prod-service-commands/goals.v0.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Non-blocking assumption retained for implementation: `nginx` is installed and available on `PATH` wherever the root `prod` command is executed.

## Governing context

- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `acac`
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
  - `land-the-plan`
- Sandbox and repo context:
  - Workspace-write filesystem sandbox.
  - Network access restricted.
  - Current branch is `main`; Stage 2 safety prep warned that this is a protected branch.
  - Existing unrelated untracked path `database/` must remain untouched.

## Execution posture lock

- Simplicity bias is locked for downstream stages.
- Changes must stay surgical and limited to script/config/documentation surfaces required by the approved goals.
- Fail-fast handling is required for missing tooling or invalid runtime assumptions.

## Change control

- Any change to goals, non-goals, success criteria, scope boundaries, or verification commands requires explicit relock.
- Override authority rests with the user via a new approval step.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L2 (focused)
- Complexity scoring details: score=6; recommended-goals=4; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/add-root-dev-prod-service-commands/complexity-signals.json
- Active phases: 1..3
- No new scope introduced: required
