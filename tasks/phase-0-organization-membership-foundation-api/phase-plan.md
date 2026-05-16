# Phase Plan
- Task name: phase-0-organization-membership-foundation-api
- Complexity: multi-surface
- Phase count: 5
- Active phases: 1..5
- Verdict: READY TO LAND

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED

## Complexity scoring details
- score=10; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/b904/Festival/tasks/phase-0-organization-membership-foundation-api/complexity-signals.json
- Ranges: goals=5-8; phases=4-6

## Phase sequence
1. Contract and current-surface alignment: map locked goals to shared contracts, route contracts, and existing backend behavior before code changes.
2. Persistence and uniqueness foundation: close durable Postgres/in-memory repository gaps for organization, membership, and invite constraints.
3. Organization and membership APIs: implement authenticated org creation and current-membership listing behavior.
4. Invite primitives: implement Admin invite creation, token lookup, and invite acceptance behavior.
5. Verification and hardening: complete focused tests and run pinned lint/build/test verification.

## Goal mapping
- G1: phases 1 and 5.
- G2-G4: phases 2 and 5.
- G5-G6: phases 3 and 5.
- G7-G9: phases 4 and 5.
- G10: all phases, finalized in phase 5.

## Drift controls
- Do not alter `## IN SCOPE` or `## OUT OF SCOPE` in `spec.md`.
- Stop if issue #21 tenant middleware scope or issue #22 frontend scope becomes necessary.
- Stop if verification command requirements are weakened or bypassed.
