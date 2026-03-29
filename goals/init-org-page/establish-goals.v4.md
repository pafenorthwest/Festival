# establish-goals

## Status

- Iteration: v4
- State: locked
- Task name (proposed, kebab-case): init-org-page

## Request restatement

- Relock `init-org-page` to add CI/pinned-command follow-up work after the org onboarding implementation: add a GitHub Actions workflow for pull requests targeting `main` or `release/v*`, include only the canonical verification commands that are safe in an isolated CI environment, and update `README.md` so it reflects the current Firebase + PostgreSQL multi-tenant starter instead of the old Shopify/Stripe description.

## Context considered

- Repo/rules/skills consulted:
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/AGENTS.md`
- Relevant files (if any):
  - `/Users/eric/.codex/worktrees/d85b/Festival/tasks/init-org-page/spec.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/README.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/.codex/project-structure.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/.codex/codex-config.yaml`
  - `/Users/eric/.codex/worktrees/d85b/Festival/package.json`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/backend/tests/organization-routes.test.ts`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/backend/src/app.ts`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/backend/src/config/env.ts`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/frontend/tests/routes.test.ts`
- Constraints (sandbox, commands, policy):
  - Follow ACAC stage order; this scope change requires relock before implementation.
  - Use the current canonical root commands from `package.json`.
  - Include `bun run test` in CI only if the existing suite can run without a live database or Firebase services.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. The requested workflow should trigger on `pull_request` events for base branches `main` and `release/v*`.
2. Updating pinned commands means touching the repo-level canonical command records as well as the task spec if the selected command set changes.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. `bun run lint` and `bun run build` remain mandatory canonical verification commands for this repo.
2. `bun run test` is eligible for isolated CI because the inspected backend tests inject an in-memory repository and fake auth verifier, while the common and frontend tests are pure Bun tests with no required external services.

## Goals (1-20, verifiable)

1. Add a GitHub Actions workflow that runs on pull requests targeting `main` and `release/v*`.
2. Configure that workflow to run the repo's pinned verification commands for pull requests, including `bun run test` only because the current test suite is isolated from live PostgreSQL and Firebase dependencies.
3. Update the repo metadata in `.codex/project-structure.md` so it accurately describes the current monorepo purpose, architecture, and canonical verification commands.
4. Update the canonical pinned-command records in the task spec and repo metadata to match the selected verification commands for this repo and this task.
5. Refresh `README.md` so it accurately describes the current SolidJS + Hono multi-tenant starter, local commands, and environment requirements for Firebase and PostgreSQL.
6. Keep the follow-up scope limited to CI/workflow, canonical command metadata, and README accuracy without changing the already-implemented org onboarding behavior.

## Non-goals (explicit exclusions)

- Changing the implemented org onboarding feature behavior, routes, roles, or persistence model.
- Adding deployment infrastructure beyond the requested pull-request workflow.

## Success criteria

- [G1] A workflow file exists under `.github/workflows/` and triggers on pull requests whose base branch is `main` or matches `release/v*`.
- [G2] The workflow installs dependencies and runs the pinned verification commands, and it includes `bun run test` because the existing test suite can run without a live DB or Firebase project.
- [G3] `/Users/eric/.codex/worktrees/d85b/Festival/.codex/project-structure.md` no longer describes the old Shopify/Stripe app and instead reflects the current monorepo purpose, workspace layout, and canonical verification commands.
- [G4] `/Users/eric/.codex/worktrees/d85b/Festival/tasks/init-org-page/spec.md` and `/Users/eric/.codex/worktrees/d85b/Festival/.codex/project-structure.md` reflect the same canonical verification commands used by the workflow.
- [G5] `/Users/eric/.codex/worktrees/d85b/Festival/README.md` no longer describes Shopify/Stripe setup and instead documents the current workspace purpose, local run commands, and required env vars for Firebase and PostgreSQL, including the operator-managed non-`public` schema requirement.
- [G6] `bun run lint`, `bun run build`, and `bun run test` still pass after the documentation and workflow updates.

## Risks / tradeoffs

- The repo metadata is materially outdated; keeping the workflow, spec, and README aligned is necessary to avoid drifting command records again.
- If a hidden test dependency on external services exists, CI could fail unexpectedly; current inspected tests indicate isolation, but verification must confirm it.

## Next action

- Ready to lock after user confirmation.
