# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): add-root-dev-prod-service-commands

## Request restatement

- Add root-level commands to run frontend and backend services separately for development, add production commands for the backend and for running the full app, and support production frontend serving from built `dist` assets via nginx rather than a `prod:frontend` script.

## Context considered

- Repo/rules/skills consulted:
  - `AGENTS.md`
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `.codex/project-structure.md`
  - `.codex/codex-config.yaml`
- Relevant files (if any):
  - `package.json`
  - `packages/frontend/package.json`
  - `packages/backend/package.json`
  - `packages/common/package.json`
  - `packages/backend/src/index.ts`
  - `README.md`
- Constraints (sandbox, commands, policy):
  - No source-code or config edits before goals are locked.
  - Root verification commands remain `bun run lint`, `bun run build`, and `bun run test`.
  - Use existing Bun/shell capabilities rather than adding a new process-runner dependency.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. Production scripts may assume an `nginx` binary is available on the local machine or deployment environment when the combined `prod` command is used.
2. The combined root `prod` command may build required artifacts before launching the backend service and nginx-backed frontend serving.

## Questions for user

1. Confirm the desired script names and the absence of `prod:frontend`.
2. Confirm whether `prod` should rely on existing shell/Bun capabilities and whether nginx config should be added for frontend serving.

## Assumptions (explicit; remove when confirmed)

1. Confirmed: the script set is `dev`, `prod`, `dev:frontend`, `dev:backend`, and `prod:backend`.
2. Confirmed: there is no `prod:frontend`; frontend production assets are served by nginx from `/dist`.
3. Confirmed: implementation should use existing shell/Bun capabilities rather than adding a dependency for concurrent process management.
4. Assumed and acceptable unless revised during approval: `nginx` is installed and available on `PATH` wherever the root `prod` command is executed.

## Goals (1-20, verifiable)

1. Add a root `dev:frontend` command that starts only the frontend development service using the existing frontend workspace tooling.
2. Add a root `dev:backend` command that starts only the backend development service using the existing backend workspace tooling.
3. Add a root `dev` command that starts both frontend and backend development services together using only Bun/shell capabilities already available in the repository environment.
4. Add a root `prod:backend` command that starts the backend in production mode from built backend artifacts rather than the watch-mode development entrypoint.
5. Add a root `prod` command that prepares and runs the production backend together with nginx serving the built frontend `dist` assets, using a checked-in nginx configuration.
6. Add the repository files and documentation needed to support the new commands, including any nginx config required for the production frontend serving path.
7. Preserve the existing canonical verification commands and keep the change surface limited to scripts, documentation, and directly related config.

## Non-goals (explicit exclusions)

- Adding a new dependency solely to manage multiple long-running processes.
- Adding a standalone `prod:frontend` script.
- Implementing containerization, deployment automation, or broader production infrastructure beyond the checked-in nginx config required to serve built frontend assets.
- Changing frontend or backend application behavior unrelated to startup/build/serve commands.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] `package.json` exposes a root `dev:frontend` script that delegates to the frontend workspace dev command.
- [G2] `package.json` exposes a root `dev:backend` script that delegates to the backend workspace dev command.
- [G3] `package.json` exposes a root `dev` script that launches both services together without adding a new dependency.
- [G4] `package.json` exposes a root `prod:backend` script that runs the backend from built output.
- [G5] `package.json` exposes a root `prod` script that starts the production backend and nginx-based frontend serving together, and the repository contains the nginx config it uses.
- [G6] `README.md` documents how to use the new commands and the nginx-based production frontend flow.
- [G7] Root verification commands remain `bun run lint`, `bun run build`, and `bun run test`, and the final implementation will validate them.

## Risks / tradeoffs

- Running two long-lived processes without an added process manager requires careful shell scripting and shutdown handling.
- The combined `prod` command depends on a system `nginx` binary and may require clear documentation around expected availability and config paths.

## Next action

- Present locked goals for user approval before running `prepare-takeoff`.
