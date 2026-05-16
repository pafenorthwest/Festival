## Incident
- Source repo: pafenorthwest/Festival
- Task: phase-0-organization-membership-foundation-api
- Skill or stage: prepare-phased-impl
- Incident type: bug
- Severity: low

## Observation
- What happened: `prepare-phased-impl-scaffold.sh phase-0-organization-membership-foundation-api multi-surface` aborted because `tasks/phase-0-organization-membership-foundation-api/complexity-signals.json` was missing.
- Expected: The `prepare-phased-impl` skill states that when task-local complexity signals are missing, the scaffold script materializes them from `.codex/tasks/_templates/complexity-signals.template.json` before scoring.
- Can work continue safely: yes, by adding the task-local signals file from the template and preserving the locked scope.

## Evidence
- Repro or minimal steps: run `./.codex/scripts/prepare-phased-impl-scaffold.sh phase-0-organization-membership-foundation-api multi-surface` after scope lock with no task-local complexity-signals file.
- Relevant files/artifacts: `/Users/eric/.codex/worktrees/b904/Festival/tasks/phase-0-organization-membership-foundation-api/spec.md`; `/Users/eric/.codex/worktrees/b904/Festival/.codex/tasks/_templates/complexity-signals.template.json`.
- Workaround used (if any): create `tasks/phase-0-organization-membership-foundation-api/complexity-signals.json` from the template with task-appropriate scores, then re-run the scaffold.
