# Default Root Dev Env File And Docs

## Overview

Make the root backend development flows use the repository-root `.env` file by default, while keeping explicit `--env-file=...` overrides available for the combined dev wrapper. Update repo documentation and project metadata so the documented local-development commands match the actual behavior.

## Goals

- Default `bun run dev:backend` to the repository-root `.env`.
- Default the backend portion of `bun run dev` to the repository-root `.env` when no override is supplied.
- Preserve explicit `--env-file=...` override support for the combined root dev script.
- Update `README.md` to describe the default backend env-file behavior accurately.
- Update `.codex/project-structure.md` so repo metadata remains synchronized with the command behavior.

## Non-goals

- Changing production startup defaults.
- Changing backend TypeScript env parsing logic.
- Changing frontend runtime configuration behavior.

## Use cases / user stories

- As a developer, I can run `bun run dev:backend` from the repo root and have the backend load `/Users/eric/pafenorthwest/Festival/.env` automatically.
- As a developer, I can run `bun run dev` without extra flags and have the backend receive the default root `.env`.
- As a developer, I can still override the default by running `bun run dev -- --env-file=/custom/path/.env`.

## Current behavior
- Notes:
  - `dev:backend` currently starts the backend with `bun run --cwd packages/backend dev` and relies on Bun’s current working directory for env loading.
  - `scripts/run-dev.sh` currently accepts an optional `--env-file=...` but does not inject a default env file when the flag is omitted.
  - `README.md` documents backend dev commands without stating that the repo-root `.env` is required or automatically forwarded.
  - `.codex/project-structure.md` does not mention the root `.env` assumption for backend development flows.
- Key files:
  - `package.json`
  - `scripts/run-dev.sh`
  - `README.md`
  - `.codex/project-structure.md`

## Proposed behavior
- Behavior changes:
  - `dev:backend` will call Bun with the repo-root `.env` by default.
  - The combined root dev wrapper will inject the repo-root `.env` when no explicit `--env-file=...` is provided.
  - Docs will describe the default `.env` requirement and the optional override form.
- Edge cases:
  - An explicit `--env-file=...` passed to `scripts/run-dev.sh` must override the default rather than stacking multiple defaults.
  - The default path should remain rooted to the repository, not the caller’s current shell location after `cd`.

## Technical design
### Architecture / modules impacted
- `package.json`
- `scripts/run-dev.sh`
- `README.md`
- `.codex/project-structure.md`

### API changes (if any)

None.

### UI/UX changes (if any)

None.

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: No schema or data-shape changes.
- Rollback: Restore the previous root dev commands and documentation.

## Security & privacy

- Secrets remain in the repo-root `.env` or explicit env-file override only.
- The shell wrapper must continue forwarding env-file options only to the backend process.

## Observability (logs/metrics)

- Existing backend/frontend logs remain unchanged.
- Script-level error output remains the primary signal for unsupported arguments.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: Covered indirectly by existing workspace test suites.
- Integration: Verify command shapes for `dev:backend` and `run-dev.sh` with a stubbed `bun` binary.
- E2E / UI (if applicable): Not in scope.

## Acceptance criteria checklist
- [ ] `bun run dev:backend` uses the repo-root `.env` by default.
- [ ] `bun run dev` defaults the backend process to the repo-root `.env`.
- [ ] `bun run dev -- --env-file=/custom/path/.env` still uses the explicit override.
- [ ] `README.md` and `.codex/project-structure.md` accurately describe the behavior.
- [ ] Canonical verification commands remain synchronized and pass.

## IN SCOPE
- Root development command changes in `package.json` and `scripts/run-dev.sh`.
- Documentation updates in `README.md`.
- Metadata updates in `.codex/project-structure.md`.
- Minimal lifecycle artifact updates required by the repository contract.

## OUT OF SCOPE
- Production command behavior.
- Backend application source changes.
- Frontend runtime changes.
- New flags beyond the existing `--env-file=...` support.

## Goal lock assertion

- Locked goals approved from `goals/default-dev-env-file-docs/goals.v0.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Non-blocking assumption retained for implementation: the default path should be the repo-root `.env` file.

## Governing context

- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
- Sandbox and repo context:
  - Workspace-write filesystem sandbox.
  - Network access restricted.
  - Current branch is `main`; Stage 2 safety prep warned that this is a protected branch.

## Execution posture lock

- Simplicity bias is locked for downstream stages.
- Changes must stay surgical and limited to the root development commands and the requested documentation surfaces.
- Fail-fast handling remains required for unsupported arguments.

## Change control

- Any change to goals, non-goals, success criteria, scope boundaries, or verification commands requires explicit relock.
- Override authority rests with the user.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: surgical
- Complexity scoring details: score=2; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/default-dev-env-file-docs/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
