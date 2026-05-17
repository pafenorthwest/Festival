# Phase 5 — Full Verification and Closeout

## Objective
Run the pinned verification suite and update task artifacts with pass/fail evidence before landing.

## Code areas impacted
- `tasks/tenant-context-role-authorization/final-phase.md`
- No source areas beyond fixes required by failed verification within locked scope

## Work items
- [x] Run `bun run format:check`.
- [x] Run `bun run build`.
- [x] Run `bun run test`.
- [x] Record verification results and any explicit blockers in task artifacts.
- [x] Ensure no unrelated dirty-worktree changes are included in task handoff.

## Deliverables
- Verification evidence is current and mapped to implemented changes.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Pinned lint, build, and test commands pass or exact blockers are documented.
- [x] Task artifacts reflect final implementation and verification state.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run format:check`
  - Expected: PASS.
- [x] Command: `bun run build`
  - Expected: PASS.
- [x] Command: `bun run test`
  - Expected: PASS.

## Risks and mitigations
- Risk: Full repo verification exposes unrelated pre-existing failures.
- Mitigation: Document exact blocker output and distinguish unrelated failures from task regressions.
