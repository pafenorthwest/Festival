# Phase 1 — Pull Request Workflow

## Objective
Create the GitHub Actions pull-request workflow and align the task-level command record with the exact CI command set.

## Code areas impacted
- `.github/workflows/*`
- `tasks/init-org-page/spec.md`

## Work items
- [ ] Add a workflow that triggers on pull requests targeting `main` and `release/v*`.
- [ ] Configure CI to install Bun and run `bun run lint`, `bun run build`, and `bun run test`.
- [ ] Keep the task spec verification section aligned with the workflow commands.

## Deliverables
- A new workflow file under `.github/workflows/`.
- Updated task spec command records matching the workflow.

## Gate (must pass before proceeding)
The workflow exists, targets the correct PR base branches, and uses the same pinned commands recorded in the task spec.
- [ ] Workflow trigger and command list match the locked goals.

## Verification steps
- [ ] Command: `sed -n '1,220p' .github/workflows/*.yml`
  - Expected: the workflow shows `pull_request` for `main` and `release/v*` and runs lint/build/test with Bun.
- [ ] Command: `sed -n '1,220p' tasks/init-org-page/spec.md`
  - Expected: the verification section lists the same commands as the workflow.

## Risks and mitigations
- Risk: GitHub branch-pattern syntax is mis-specified and misses `release/v*` PRs.
- Mitigation: keep the trigger explicit in the workflow YAML and verify the branch list in the file review.
