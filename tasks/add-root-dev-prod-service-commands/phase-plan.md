# Phase Plan
- Task name: add-root-dev-prod-service-commands
- Complexity: scored:L2 (focused)
- Phase count: 3
- Active phases: 1..3
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=6; recommended-goals=4; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/add-root-dev-prod-service-commands/complexity-signals.json
- Ranges: goals=3-5; phases=2-4

## Phase ordering
1. Phase 1: Add root service scripts and any small helper surfaces needed for development and backend production startup.
2. Phase 2: Add nginx-backed production frontend serving flow and wire the combined production command.
3. Phase 3: Update README usage guidance and complete full repository verification evidence.

## Traceability map
- Goals 1-4 map to Phase 1.
- Goals 5-6 map to Phase 2.
- Goals 6-7 map to Phase 3.
