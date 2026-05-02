# Self-Improvement Incident

## Incident
- Source repo: `pafenorthwest/Festival`
- Task: `database-auth-foundation`
- Skill or stage: `land-the-plan` / `revalidate-code-review.sh`
- Incident type: `bug`
- Severity: medium

## Observation
- What happened: `revalidate-code-review.sh database-auth-foundation main` generated review context from `git diff`, which omitted new untracked implementation files during the required pre-commit review gate.
- Expected: The review readiness context should include untracked files or otherwise run after secure file tracking so newly added implementation files are reviewed.
- Can work continue safely: yes, with a manual full changed-file review recorded in the task review artifact before rerunning the validator.

## Evidence
- Repro or minimal steps: In a pre-commit worktree with new untracked files, run `./.codex/scripts/revalidate-code-review.sh database-auth-foundation main`; review context lists only tracked modified files and not new files under `packages/backend/src/repo`, `packages/backend/src/routes`, or `packages/backend/tests`.
- Relevant files/artifacts: `tasks/database-auth-foundation/revalidate-code-review.md`
- Workaround used: manually review the complete tracked and untracked changes, update the review artifact with `Findings status: none` and `patch is correct`, then rerun the validator.

## Routing
- GitHub MCP attempt to create `ericpassmore/prompts` child issue failed with `403 Resource not accessible by personal access token`.
