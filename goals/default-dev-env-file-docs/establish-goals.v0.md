# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): default-dev-env-file-docs

## Request restatement

- Make backend development commands use a repository-root env file by default, and update `README.md` plus review/update `.codex/project-structure.md` so the documented local-development flow matches that behavior.

## Context considered

- Repo/rules/skills consulted: repository `AGENTS.md`; `.codex/project-structure.md`; `establish-goals`; `prepare-takeoff`; prior root env-file wrapper change context
- Relevant files (if any): `README.md`; `.codex/project-structure.md`; `package.json`; `scripts/run-dev.sh`; `packages/backend/package.json`
- Constraints (sandbox, commands, policy): lifecycle stages must be followed before source/doc edits; keep changes minimal; preserve pinned verification commands

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. The intended env file path is the repo-root `.env` file, even though the user’s example omitted the leading dot.
2. The defaulting requirement applies to root development flows that start the backend (`dev:backend` and combined `dev`), not production commands.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. `bun run dev:backend` should work from the repository root without the caller supplying `--env-file`.
2. `bun run dev` should likewise start the backend with the repo-root `.env` by default while still allowing an explicit override.

## Goals (1-20, verifiable)

1. Update the default root backend development command so it passes the repository-root `.env` file to Bun automatically.
2. Update the combined root development launcher so its backend process defaults to the repository-root `.env` file when no explicit `--env-file` argument is supplied.
3. Keep support for explicit `--env-file=...` overrides in the combined root development launcher.
4. Update `README.md` so local development instructions accurately describe the default backend env-file behavior.
5. Review and update `.codex/project-structure.md` so repository metadata stays synchronized with the command behavior and documentation.

## Non-goals (explicit exclusions)

- Changing backend production startup defaults.
- Changing backend TypeScript env parsing logic or frontend runtime behavior.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] `bun run dev:backend` resolves the backend dev command with the repo-root `.env` supplied by default.
- [G2] `bun run dev` starts the backend with the repo-root `.env` by default when no explicit `--env-file` is given.
- [G3] `bun run dev -- --env-file=/custom/path/.env` still forwards the explicit override to the backend process.
- [G4] `README.md` documents the default backend env-file behavior accurately.
- [G5] `.codex/project-structure.md` remains consistent with the repo’s command behavior and canonical verification metadata.

## Risks / tradeoffs

- Defaulting to a root `.env` increases convenience for local development but assumes that file exists in the normal developer workflow.

## Next action

- Goals locked. `prepare-takeoff` owns task scaffolding and `spec.md` readiness content.
