# Goals Extract
- Task name: default-dev-env-file-docs
- Iteration: v0
- State: locked

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

