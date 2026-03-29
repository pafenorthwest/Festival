# Support Env File Argument In Root Dev/Prod Scripts

## Overview

Allow the repository-root `dev` and `prod` commands to accept an optional `--env-file=...` argument and pass that option to the backend Bun invocation. This makes the root wrappers work with a root-level env file even though the backend runs with `--cwd packages/backend`.

## Goals

- Update `scripts/run-dev.sh` to accept and forward an optional `--env-file=...` backend argument.
- Update `scripts/run-prod.sh` to accept and forward an optional `--env-file=...` backend argument.
- Preserve current behavior when the argument is omitted.
- Keep canonical verification commands unchanged: `bun run lint`, `bun run build`, and `bun run test`.

## Non-goals

- Changing backend TypeScript env loading logic.
- Changing frontend startup behavior.
- Broadening root script argument parsing beyond the requested env-file option.

## Use cases / user stories

- As a developer, I can run `bun run dev --env-file=/Users/eric/pafenorthwest/Festival/.env` from the repo root and have the backend see that env file.
- As an operator, I can run `bun run prod --env-file=/Users/eric/pafenorthwest/Festival/.env` from the repo root and have the production backend process use that env file.
- As an existing user of `bun run dev` or `bun run prod`, I can omit the flag and keep the prior behavior.

## Current behavior
- Notes:
  - `scripts/run-dev.sh` starts the backend with `bun run --cwd packages/backend dev` and does not forward user-supplied args.
  - `scripts/run-prod.sh` starts the backend with `PORT=3000 NODE_ENV=production bun ./packages/backend/dist/index.js` and does not forward user-supplied args.
  - The repository contains a root `.env`, but launching the backend with `--cwd packages/backend` does not read it automatically.
- Key files:
  - `package.json`
  - `scripts/run-dev.sh`
  - `scripts/run-prod.sh`
  - `packages/backend/package.json`
  - `packages/backend/src/config/env.ts`

## Proposed behavior
- Behavior changes:
  - The root dev/prod shell wrappers will parse a single optional `--env-file=...` argument and pass it through to the backend Bun command.
  - Unsupported extra flags will fail fast rather than silently changing frontend or nginx behavior.
- Edge cases:
  - Relative or absolute env file paths should be forwarded as provided.
  - When the option is absent, the scripts should produce the same backend startup command shape as before.

## Technical design
### Architecture / modules impacted
- `scripts/run-dev.sh`
- `scripts/run-prod.sh`

### API changes (if any)

None.

### UI/UX changes (if any)

None.

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: No schema or runtime data-shape changes.
- Rollback: Remove the shell argument parsing and restore the original backend launch commands.

## Security & privacy

- Secrets remain in env files or process environment only.
- The new shell parsing must not echo env file contents or widen argument forwarding to unrelated processes.

## Observability (logs/metrics)

- Existing backend/stdout logging remains unchanged.
- Script-level errors should be explicit for unsupported arguments.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run lint`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: Covered indirectly by existing workspace suites through the root test command.
- Integration: Validate that the root shell scripts accept `--env-file=...` and forward it to the backend command shape.
- E2E / UI (if applicable): Not in scope.

## Acceptance criteria checklist
- [ ] Root `dev` accepts `--env-file=...` and forwards it to the backend Bun command only.
- [ ] Root `prod` accepts `--env-file=...` and forwards it to the backend Bun command only.
- [ ] Running the scripts without `--env-file` preserves existing behavior.
- [ ] Canonical verification commands remain unchanged and pass.

## IN SCOPE
- Shell changes in `scripts/run-dev.sh` and `scripts/run-prod.sh`.
- Minimal task-artifact updates required by the lifecycle.
- Validation of the root verification commands.

## OUT OF SCOPE
- Backend application source changes.
- Frontend script behavior changes.
- New CLI flags beyond the optional `--env-file=...` passthrough.

## Goal lock assertion

- Locked goals approved from `goals/root-script-env-file-arg/goals.v0.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Non-blocking assumption retained for implementation: only the backend process should receive the env-file option.

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
- Changes must stay surgical and limited to the root shell scripts required by the approved goals.
- Fail-fast handling is required for unsupported arguments or invalid runtime assumptions.

## Change control

- Any change to goals, non-goals, success criteria, scope boundaries, or verification commands requires explicit relock.
- Override authority rests with the user.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: surgical
- Complexity scoring details: score=0; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/root-script-env-file-arg/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
