# Phase 1 — Backlog Derivation and Dedup Lock

## Objective
Translate the provided roadmap/spec set into a concrete backlog, assign each item to a roadmap phase or side-quest workstream, split backend API and frontend UI items where justified, and explicitly record how issue `#16` and issue `#17` absorb overlapping scope.

## Code areas impacted
- `tasks/first-work-break-down/spec.md`
- `tasks/first-work-break-down/phase-plan.md`
- `tasks/first-work-break-down/phase-1.md`
- `tasks/first-work-break-down/phase-2.md`
- `goals/first-work-break-down/*`

## Work items
- [x] Extract candidate work items from `specs/ROADMAP-2026.md`, `specs/Phase1-Account-Memberships.md`, `specs/Multi-Tenant-Starter.md`, and `specs/SIDEQUESTS-2026.md`.
- [x] Classify each candidate as backend API, frontend UI, or combined work.
- [x] Deduplicate Phase 0 scope against issue `#16` and the matching onboarding scaffold issue (`#15`; the user-referenced `#17` is actually a closed PR).
- [x] Finalize the set of new issues to create and the labels each requires.

## Deliverables
- A documented phased backlog inventory that identifies:
  - roadmap phase or side-quest workstream
  - ownership class (`backend API`, `frontend UI`, or `combined`)
  - dedup status versus issue `#16` and issue `#17`
- A ready-to-run issue creation list for Phase 2.
- Final inventory: `tasks/first-work-break-down/issue-inventory.md`

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Every new issue candidate is mapped to a phase or side quest.
- [x] Every issue candidate has an ownership class.
- [x] No issue candidate materially duplicates issue `#16`; onboarding scaffold dedup is applied to issue `#15`, which matches the user-described `#17` scope.

## Verification steps
List exact commands and expected results.
- [x] Command: `sed -n '1,260p' specs/ROADMAP-2026.md`
  - Expected: phase boundaries and side-quest dependencies remain consistent with the final backlog. PASS
- [x] Command: `sed -n '1,260p' specs/Phase1-Account-Memberships.md`
  - Expected: membership, division, and registration requirements support the Phase 1 and later issue scopes. PASS

## Risks and mitigations
- Risk:
  - Spec overlap could produce duplicate or overly broad issues.
- Mitigation:
  - Keep a written dedup note for issue `#16` and issue `#17` and trim any downstream issue to the uncovered behavior only.

## Execution evidence
- `issue-inventory.md` records the final backlog cut and the Phase 0 dedup correction (`#15` instead of the user-referenced `#17`).
