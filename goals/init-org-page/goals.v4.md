# Goals Extract
- Task name: init-org-page
- Iteration: v4
- State: locked

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
