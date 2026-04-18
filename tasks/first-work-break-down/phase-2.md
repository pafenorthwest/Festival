# Phase 2 — GitHub Issue Publication and Verification

## Objective
Create the deduplicated backlog issues in GitHub via `./.codex/scripts/gh-wrap.sh`, apply the required labels, and record the final mapping from phases/workstreams to issue numbers.

## Code areas impacted
- `tasks/first-work-break-down/phase-2.md`
- `tasks/first-work-break-down/final-phase.md`
- GitHub issues for `pafenorthwest/Festival`

## Work items
- [x] Verify prerequisite labels exist for `help wanted` and `good first issue`.
- [x] Create one issue per approved backlog item using `./.codex/scripts/gh-wrap.sh issue create`.
- [x] Apply `help wanted` to every created issue and `good first issue` to every created Phase 0 issue.
- [x] Record the resulting issue numbers and URLs by phase/workstream.

## Deliverables
- A GitHub issue set covering the deduplicated roadmap backlog.
- A task-local issue inventory with issue numbers grouped by phase/workstream.
- Final reporting that calls out existing issue coverage (`#16`, `#17`) alongside newly created work.
- Created issue range: `#20` through `#37`

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Every planned issue is created successfully.
- [x] Verified samples confirm required labels on Phase 0 and non-Phase 0 issues.
- [x] Final inventory maps every created issue to its phase/workstream.

## Verification steps
List exact commands and expected results.
- [x] Command: `./.codex/scripts/gh-wrap.sh issue create ...`
  - Expected: each invocation returns a GitHub issue URL for the intended work item. PASS (`#20`-`#37`)
- [x] Command: `bun run format:check && bun run build && bun run test`
  - Expected: repository verification commands pass after task artifact updates. PASS

## Risks and mitigations
- Risk:
  - Issue creation can fail due to missing labels or GitHub auth state.
- Mitigation:
  - Check labels before creation and stop immediately with the exact failing command if GitHub rejects a write.

## Execution evidence
- Label verification:
  - `help wanted` exists in `pafenorthwest/Festival`
  - `good first issue` exists in `pafenorthwest/Festival`
- Sample issue verification:
  - `#20` has `help wanted` + `good first issue`
  - `#22` has `help wanted` + `good first issue`
  - `#37` has `help wanted`
