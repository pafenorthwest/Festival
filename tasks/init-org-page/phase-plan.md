# Phase Plan
- Task name: init-org-page
- Complexity: scored:L3 (multi-surface)
- Phase count: 6
- Active phases: 1..6
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=12; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/d85b/Festival/tasks/init-org-page/complexity-signals.json
- Ranges: goals=5-8; phases=4-6

## Phase ordering
1. Phase 1: Establish shared organization contracts and schema-aware PostgreSQL persistence foundations.
2. Phase 2: Integrate Firebase authentication and backend authorization/bootstrap APIs.
3. Phase 3: Build no-org landing and sign-in entry flows in the SolidJS frontend.
4. Phase 4: Implement organization creation, slug validation, and creator-admin assignment.
5. Phase 5: Implement role-based invites, invite acceptance, and first-visit welcome behavior.
6. Phase 6: Finalize organization landing routing, returning-user bootstrap, and full verification coverage.

## Traceability map
- Goals 1 and 6 map to Phases 1 and 2.
- Goals 2 and 7 map to Phases 2 and 3.
- Goal 3 maps to Phase 4.
- Goal 4 maps to Phase 5.
- Goal 5 maps to Phases 5 and 6.
- Goal 8 maps to Phase 6.
