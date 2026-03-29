# Goals Extract
- Task name: root-script-env-file-arg
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Update the root development launcher to accept an optional `--env-file=...` argument and forward it to the backend Bun command.
2. Update the root production launcher to accept an optional `--env-file=...` argument and forward it to the backend Bun command.
3. Preserve existing behavior when no `--env-file` argument is provided.
4. Keep frontend and nginx startup behavior unchanged except for any shell parsing needed to support the new backend option.


## Non-goals (explicit exclusions)

- Changing backend application code or adding custom env-file parsing inside TypeScript.
- Changing unrelated root scripts such as `dev:backend`, `prod:backend`, or workspace package scripts unless required for correctness.


## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] Running `bun run dev --env-file=/Users/eric/pafenorthwest/Festival/.env` causes the backend launcher to invoke Bun with the supplied `--env-file` argument.
- [G2] Running `bun run prod --env-file=/Users/eric/pafenorthwest/Festival/.env` causes the production backend launcher to invoke Bun with the supplied `--env-file` argument.
- [G3] Running the root scripts without `--env-file` still uses the prior command shape and does not require new arguments.
- [G4] Repo verification commands remain `bun run lint`, `bun run build`, and `bun run test`.

