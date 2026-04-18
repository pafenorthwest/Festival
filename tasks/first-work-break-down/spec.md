# First Work Break Down

## Overview

Create a phased execution backlog from the festival roadmap and supporting specs, then publish that backlog as GitHub issues through `./.codex/scripts/gh-wrap.sh`. The backlog must respect the existing Phase 0 identity and onboarding issues already represented by issue `#16` and issue `#17`, and it must separate backend API and frontend UI work where the specs suggest genuinely distinct deliverables.

## Goals
1. Produce a phase-ordered work breakdown across the roadmap phases and side-quest workstreams described in the provided specs.
2. Split backlog items into backend API and frontend UI issues where that separation is materially useful.
3. Deduplicate against issue `#16` and issue `#17` while still accounting for their covered scope in the plan.
4. Create one GitHub issue per resulting work item using `./.codex/scripts/gh-wrap.sh issue create`.
5. Apply `help wanted` to every created issue.
6. Apply `good first issue` to every created Phase 0 issue.
7. Make each issue body actionable and traceable to the source specs.
8. Return a phase/workstream summary mapping created issues and deduplicated existing coverage.

## Non-goals
- Implementing any application code, schema, or UI from the roadmap.
- Editing or relabeling existing issue `#16` or issue `#17`.
- Rewriting the product roadmap itself.

## Use cases / user stories
- As a maintainer, I can see the roadmap broken into phase-scoped GitHub issues that are ready for contributors to pick up.
- As a contributor, I can distinguish backend API work from frontend UI work where separate ownership makes sense.
- As a planner, I can see which parts of Phase 0 are already covered by issue `#16` and issue `#17` without duplicate tickets.

## Current behavior
- Notes:
  - The repository has roadmap and specification documents but no corresponding full backlog of phase-by-phase GitHub issues.
  - The user identifies issue `#16` as already covering the user identity foundation slice and issue `#17` as already covering the onboarding UI scaffold.
  - No task-local phased breakdown artifact exists yet for this work item.
- Key files:
  - `specs/Multi-Tenant-Starter.md`
  - `specs/Phase1-Account-Memberships.md`
  - `specs/ROADMAP-2026.md`
  - `specs/SIDEQUESTS-2026.md`
  - `specs/Style.md`
  - `goals/first-work-break-down/goals.v0.md`

## Proposed behavior
- Behavior changes:
  - Create a task-local planning artifact that breaks the roadmap into numbered phases and side-quest workstreams.
  - Mark Phase 0 identity and onboarding scaffold work as already covered by issue `#16` and issue `#17`.
  - Create GitHub issues for the remaining work items with labels matching the user request.
- Edge cases:
  - Avoid splitting a work item into backend and frontend tickets when the spec language describes a single tightly-coupled deliverable.
  - Avoid creating labels manually unless issue creation proves they are missing and the user asks to add them.
  - If a proposed item partially overlaps issue `#16` or `#17`, trim the new issue to the downstream extension only.

## Technical design
### Architecture / modules impacted
- `tasks/first-work-break-down/spec.md`
- `tasks/first-work-break-down/phase-plan.md`
- `tasks/first-work-break-down/phase-1.md`
- `tasks/first-work-break-down/phase-2.md`
- `tasks/first-work-break-down/final-phase.md`
- `goals/first-work-break-down/*`
- GitHub issue tracker for `pafenorthwest/Festival`

### API changes (if any)

None in product code. The only external write actions are GitHub issue creation calls through `./.codex/scripts/gh-wrap.sh`.

### UI/UX changes (if any)

None in product code. UI-oriented work is represented only as backlog items and issue descriptions.

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: Not applicable.
- Rollback: Remove or revise the created planning artifacts; close or adjust GitHub issues manually if needed.

## Security & privacy

- Issue creation must use the repository wrapper so the correct GitHub token mapping is applied from `.codex/codex-config.yaml`.
- No application secrets or private user data should be copied from specs into issue bodies.

## Observability (logs/metrics)

- Command output from `gh-wrap.sh` provides issue creation confirmation and issue URLs.
- Task artifacts record the planned breakdown and verification evidence for later audit.

## Governing context
- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `acac`
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
  - `land-the-plan`
- Sandbox and repo context:
  - Workspace-write filesystem sandbox.
  - Network-restricted shell; GitHub write operations require escalated execution through the wrapper.
  - Current branch is `ericp/roadmap`.

## Goal lock assertion

Locked goals source: `goals/first-work-break-down/goals.v0.md` (state: `locked`).
No reinterpretation or expansion is allowed without relock.

## Ambiguity check

- Blocking ambiguity: none.
- Non-blocking assumptions remain the ones captured in `goals/first-work-break-down/establish-goals.v0.md`, especially the use of roadmap phases as the primary phase structure and the full dedup coverage of issue `#16` and issue `#17`.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit:
  - Not applicable for product logic; validation is through planning artifacts and repository verification commands.
- Integration:
  - Verify GitHub issue creation and labeling through `gh-wrap.sh` command results.
- E2E / UI (if applicable):
  - Not applicable.

## Acceptance criteria checklist
- [ ] A phase/workstream breakdown exists in the task artifacts.
- [ ] The breakdown marks backend API, frontend UI, or combined ownership for each work item.
- [ ] No new issue duplicates the scope of issue `#16` or issue `#17`.
- [ ] Every created issue is opened via `./.codex/scripts/gh-wrap.sh issue create`.
- [ ] Every created issue has `help wanted`.
- [ ] Every created Phase 0 issue has `good first issue`.
- [ ] Final reporting maps issue numbers to roadmap phases and side quests.

## IN SCOPE
- Creating and updating task planning artifacts for `first-work-break-down`.
- Translating the provided specs into a phased backlog.
- Deduplicating against issue `#16` and issue `#17`.
- Creating and labeling new GitHub issues for the resulting backlog items.

## OUT OF SCOPE
- Any product implementation work in `packages/*`.
- Altering existing roadmap/spec source documents unless needed for task-artifact references.
- Editing or relabeling existing issues `#16` and `#17`.
- Creating milestones, projects, or pull request automation unrelated to the requested backlog issues.

## Execution posture lock
- Simplicity bias is locked for downstream stages.
- Changes must stay surgical and limited to task artifacts plus the requested GitHub issues.
- Fail-fast handling is required for auth, missing labels, or dedup ambiguity that would create duplicate scope.

## Change control
- Goal, scope, success criteria, and verification changes require relock through `establish-goals`.
- The verification contract (`bun run format:check`, `bun run build`, `bun run test`) cannot be weakened or bypassed.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: 2
- Complexity scoring details: score=8; recommended-goals=4; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/first-work-break-down/complexity-signals.json
- Active phases: 1..2
- No new scope introduced: required
