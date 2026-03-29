# Init Org Page

## Overview
Apply a follow-up maintenance pass to the completed multi-tenant starter so the repository metadata and pull-request automation match the shipped SolidJS + Hono, Firebase, and PostgreSQL onboarding stack. This scope is limited to a pull-request GitHub Actions workflow, canonical command metadata, and README accuracy.

## Goals
1. Add a GitHub Actions workflow that runs on pull requests targeting `main` and `release/v*`.
2. Configure that workflow to run the repo's pinned verification commands for pull requests, including `bun run test` because the current test suite is isolated from live PostgreSQL and Firebase dependencies.
3. Update the repo metadata in `.codex/project-structure.md` so it accurately describes the current monorepo purpose, architecture, and canonical verification commands.
4. Update the canonical pinned-command records in the task spec and repo metadata to match the selected verification commands for this repo and this task.
5. Refresh `README.md` so it accurately describes the current SolidJS + Hono multi-tenant starter, local commands, and environment requirements for Firebase and PostgreSQL.
6. Keep the follow-up scope limited to CI/workflow, canonical command metadata, and README accuracy without changing the already-implemented org onboarding behavior.

## Non-goals
- Changing the implemented org onboarding feature behavior, routes, roles, or persistence model.
- Adding deployment infrastructure beyond the requested pull-request workflow.

## Use cases / user stories
- As a reviewer opening a PR into `main` or `release/v*`, I get automated verification for the canonical Bun commands.
- As a contributor, I can rely on the repo metadata and README to describe the current multi-tenant starter instead of the retired Shopify/Stripe app description.
- As a maintainer, I can see that CI runs only commands that are safe without a live database or Firebase environment.

## Current behavior
- The multi-tenant starter implementation is present, but there is no `.github/workflows/` pull-request workflow.
- [`README.md`](/Users/eric/.codex/worktrees/d85b/Festival/README.md) still describes a Shopify/Stripe registration app and obsolete env vars.
- [`.codex/project-structure.md`](/Users/eric/.codex/worktrees/d85b/Festival/.codex/project-structure.md) still describes the old app shape and stale verification commands.
- The current root commands in [`package.json`](/Users/eric/.codex/worktrees/d85b/Festival/package.json) are `bun run format:check`, `bun run build`, and `bun run test`.
- The inspected test surfaces are isolated from external services:
  - backend org-route tests use `InMemoryOrganizationRepository` and `FakeAuthVerifier`
  - common and frontend tests are local Bun tests

## Proposed behavior
- Add a PR workflow under `.github/workflows/` that runs for base branches `main` and `release/v*`.
- Install Bun in CI and run the canonical verification commands `bun run format:check`, `bun run build`, and `bun run test`.
- Update repo metadata and README text so the current architecture, local commands, and env requirements are documented consistently.
- Leave application runtime behavior unchanged.

## Technical design
### Architecture / modules impacted
- `.github/workflows/*` for pull-request verification automation.
- `.codex/project-structure.md` for canonical repo metadata and verification records.
- `tasks/init-org-page/spec.md` for task-local pinned verification commands.
- `README.md` for contributor-facing setup and architecture documentation.

### CI behavior
- Trigger: `pull_request`
- Base branches:
  - `main`
  - `release/v*`
- Steps:
  - checkout
  - install Bun
  - `bun install --frozen-lockfile`
  - `bun run format:check`
  - `bun run build`
  - `bun run test`

### Verification rationale
- `bun run test` stays in the pinned command set because the current suite does not require a live PostgreSQL instance or Firebase project:
  - backend tests inject in-memory doubles instead of loading runtime env or connecting to Postgres
  - frontend/common tests execute locally with Bun only

## Security & privacy
- CI must not require committed secrets.
- Documentation must continue to direct users to environment variables rather than in-repo credentials.

## Observability
- GitHub Actions logs provide PR verification visibility for the pinned commands.

## Governing context
- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `acac`
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
  - `land-the-plan`
- Sandbox constraints:
  - workspace-write filesystem
  - network-restricted shell

## Goal lock assertion
Locked goals source: `goals/init-org-page/goals.v4.md` (state: `locked`).
No reinterpretation or scope expansion is permitted without relock.

## Ambiguity check
No blocking ambiguity remains for Stage 2.
Resolved contract items include the pull-request base branches, the requirement to update `.codex/project-structure.md`, and the decision to keep `bun run test` in CI because the current suite is isolated from live DB/Firebase services.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./.codex/project-structure.md` and `./.codex/codex-config.yaml` if canonical command records change).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit:
  - keep command-record and documentation changes aligned with the existing isolated test suite
- Integration:
  - verify the GitHub Actions workflow runs the same pinned commands recorded in repo metadata
- Documentation:
  - ensure README and `.codex/project-structure.md` reflect the current multi-tenant starter and env requirements

## Acceptance criteria checklist
- [ ] A workflow file exists under `.github/workflows/` and triggers on pull requests whose base branch is `main` or matches `release/v*`.
- [ ] The workflow installs dependencies and runs `bun run format:check`, `bun run build`, and `bun run test`.
- [ ] `.codex/project-structure.md` no longer describes the old Shopify/Stripe app and instead reflects the current monorepo purpose, workspace layout, and canonical verification commands.
- [ ] This spec and `.codex/project-structure.md` reflect the same canonical verification commands used by the workflow.
- [ ] `README.md` documents the current workspace purpose, local run commands, and Firebase/PostgreSQL env vars, including the operator-managed non-`public` schema requirement.
- [ ] Root `bun run format:check`, `bun run build`, and `bun run test` pass after the updates.

## IN SCOPE
- Pull-request workflow creation for `main` and `release/v*`.
- Repo metadata updates in `.codex/project-structure.md`.
- Task verification-command record updates in this spec.
- README refresh for the current multi-tenant starter.

## OUT OF SCOPE
- Changes to frontend, backend, shared-domain, or persistence behavior for org onboarding.
- Deployment automation beyond the requested PR workflow.
- New runtime tests or feature work unrelated to the metadata/workflow follow-up.

## Execution posture lock
- Simplicity bias locked.
- Surgical changes only, limited to workflow and documentation/metadata surfaces.
- Fail-fast behavior required for uncertain, unauthorized, or blocked states.

## Change control
- Goal, constraint, and success-criteria changes require relock through `establish-goals`.
- Verification contract (`lint`, `build`, `test`) cannot be weakened or bypassed.
- CI command selection must remain aligned with the verified isolated test capability.

## Stage 2 verdict
READY FOR PLANNING

## Implementation phase strategy
- Complexity: focused
- Complexity scoring details: score=6; recommended-goals=4; guardrails-all-true=true; signals=/Users/eric/.codex/worktrees/d85b/Festival/tasks/init-org-page/complexity-signals.json
- Active phases: 1..3
- No new scope introduced: required
