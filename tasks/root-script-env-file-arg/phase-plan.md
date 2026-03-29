# Phase Plan
- Task name: root-script-env-file-arg
- Complexity: surgical
- Phase count: 1
- Active phases: 1..1
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Phase summary

### Phase 1
- Objective: update the root shell wrappers to accept an optional backend `--env-file=...` argument, fail fast on unsupported flags, and verify the new command flow plus canonical repo checks.
- Deliverables:
  - patched `scripts/run-dev.sh`
  - patched `scripts/run-prod.sh`
  - verification evidence recorded in task artifacts

## Complexity scoring details
- score=0; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/root-script-env-file-arg/complexity-signals.json
- Ranges: goals=1-3; phases=1-1
