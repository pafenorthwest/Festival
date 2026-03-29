# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): root-script-env-file-arg

## Request restatement

- Update the root `dev` and `prod` scripts so they accept an optional `--env-file=<absolute-or-relative-path>` argument and pass it through to the backend process, enabling commands such as `bun run dev --env-file=/Users/eric/pafenorthwest/Festival/.env`.

## Context considered

- Repo/rules/skills consulted: repository `AGENTS.md`; `establish-goals` and `prepare-takeoff` skills; `.codex/project-structure.md`; `.codex/codex-config.yaml`
- Relevant files (if any): `package.json`; `scripts/run-dev.sh`; `scripts/run-prod.sh`; `packages/backend/package.json`; `packages/backend/src/config/env.ts`
- Constraints (sandbox, commands, policy): follow lifecycle order before code edits; keep changes surgical; preserve canonical lint/build/test verification commands from repo metadata

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. The requested argument applies to the root `dev` and `prod` scripts, not necessarily to `dev:backend` or `prod:backend`.
2. Forwarding only `--env-file=...` to the backend is sufficient; unrelated extra CLI arguments remain out of scope.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. `bun run dev --env-file=...` and `bun run prod --env-file=...` should remain valid entrypoints from the repository root.
2. Frontend startup behavior should remain unchanged while backend receives the env-file option.

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

## Risks / tradeoffs

- Shell argument parsing must reject or ignore unsupported flags carefully so the new option does not accidentally get forwarded to the frontend or nginx process.

## Next action

- Goals locked. `prepare-takeoff` owns task scaffolding and `spec.md` readiness content.
