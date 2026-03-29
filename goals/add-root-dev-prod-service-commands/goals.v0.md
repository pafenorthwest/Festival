# Goals Extract
- Task name: add-root-dev-prod-service-commands
- Iteration: v0
- State: locked

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

