# Phase Plan
- Task name: fix-dev-session-cors
- Complexity: surgical
- Phase count: 1
- Active phases: 1..1
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=4; recommended-goals=2; guardrails-all-true=true; signals=/Users/eric/.codex/worktrees/d201/Festival/tasks/fix-dev-session-cors/complexity-signals.json
- Ranges: goals=1-3; phases=1-1

## Phase mapping
- Phase 1 maps to G1, G2, and G3 by adding scoped CORS middleware and backend route coverage.
- Final verification maps to G4 through `bun run lint`, `bun run build`, and `bun run test`.
