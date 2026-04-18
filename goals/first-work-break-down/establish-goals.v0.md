# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): first-work-break-down

## Request restatement

- Read `specs/Multi-Tenant-Starter.md`, `specs/Phase1-Account-Memberships.md`, `specs/ROADMAP-2026.md`, `specs/SIDEQUESTS-2026.md`, and `specs/Style.md`.
- Produce a work breakdown organized by phase, splitting items into separate backend API and frontend UI tracks where that separation is justified by the specs.
- Deduplicate against existing GitHub issue `#16` ("User Identity Foundation") and issue `#17` ("Organization Onboarding UI (Frontend Scaffold)") so no new issue recreates that scope.
- Open a GitHub issue for each resulting work-breakdown item using `./.codex/scripts/gh-wrap.sh`, label every created issue with `help wanted`, and also label all Phase 0 issues with `good first issue`.

## Context considered

- Repo/rules/skills consulted:
  - `AGENTS.md`
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `.codex/codex-config.yaml`
- Relevant files (if any):
  - `specs/Multi-Tenant-Starter.md`
  - `specs/Phase1-Account-Memberships.md`
  - `specs/ROADMAP-2026.md`
  - `specs/SIDEQUESTS-2026.md`
  - `specs/Style.md`
  - User-provided descriptions for existing issues `#16` and `#17`
- Constraints (sandbox, commands, policy):
  - ACAC lifecycle order is mandatory and goal approval is required before downstream work.
  - GitHub write actions must use `./.codex/scripts/gh-wrap.sh` for issue creation.
  - `help wanted` is required on every created issue.
  - `good first issue` is required on every created Phase 0 issue.
  - Deduplication must preserve the scope already covered by issues `#16` and `#17`.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. The roadmap phases in `specs/ROADMAP-2026.md` are the primary phase structure for the work breakdown, and side quests from `specs/SIDEQUESTS-2026.md` should be represented as parallel workstreams rather than merged into the numbered roadmap phases.
2. Issue `#16` fully covers the backend identity/auth foundation slice described by the user, and issue `#17` fully covers the frontend organization onboarding scaffold described by the user.
3. When a work item clearly spans backend and frontend concerns, it should be split into separate issues only when the specs imply distinct deliverables, dependencies, or owners; otherwise it may remain a single issue.
4. `specs/Style.md` constrains only frontend/UI-oriented issues and does not require standalone backend issues unless product behavior depends on UI implementation.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. The requested output should include both a concise phased breakdown artifact in the repo task files and GitHub issues created from that breakdown.
2. Existing issues may be referenced in the breakdown as already-covered scope instead of being recreated or modified.
3. Labels already exist in the GitHub repository, or GitHub will return a clear failure if they do not.

## Goals (1-20, verifiable)

1. Derive a phase-ordered work breakdown from the provided spec set that covers the roadmap phases and the parallel side-quest workstreams described by the source documents.
2. Split work-breakdown items into backend API and frontend UI issues where the specs support meaningful separation of responsibilities or deliverables.
3. Exclude any new issue whose scope would materially duplicate existing issue `#16` or issue `#17`, while still accounting for those scopes in the phased breakdown as already covered.
4. Create one GitHub issue per resulting work-breakdown item using `./.codex/scripts/gh-wrap.sh issue create`.
5. Apply the `help wanted` label to every GitHub issue created for this task.
6. Apply the `good first issue` label to every created Phase 0 issue.
7. Write issue titles and bodies that are concrete enough to be actionable, phase-specific, and traceable back to the spec language that motivated them.
8. Produce a final summary that lists the created issues by phase/workstream and identifies where issue `#16` and issue `#17` absorbed requested scope.

## Non-goals (explicit exclusions)

- Implementing any product code, schema changes, UI, or API behavior described by the specs.
- Editing, relabeling, or rewriting existing issues `#16` and `#17` unless a later explicit request asks for that.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] A work breakdown exists that groups candidate work into roadmap phases and separate side-quest workstreams grounded in the provided specs.
- [G2] The breakdown explicitly marks which items are backend API, frontend UI, or combined work items.
- [G3] No newly created issue materially duplicates the identity foundation scope of issue `#16` or the onboarding UI scaffold scope of issue `#17`.
- [G4] Each non-deduplicated work-breakdown item results in a GitHub issue created through `./.codex/scripts/gh-wrap.sh issue create`.
- [G5] Every created issue has the `help wanted` label.
- [G6] Every created Phase 0 issue has both `help wanted` and `good first issue`.
- [G7] Each created issue body contains enough scope, deliverables, and outcome detail to be independently understandable without reopening the original prompt.
- [G8] The final report maps created issue numbers to phases/workstreams and notes where `#16` and `#17` were treated as existing coverage.

## Risks / tradeoffs

- The source specs overlap across onboarding, identity, and membership flows, so deduplication requires judgment about whether an item is a true duplicate or a downstream extension.
- Some roadmap items are intentionally broad; splitting too finely would create management overhead, while splitting too coarsely would weaken issue actionability.
- Issue creation can fail if required labels are missing or if GitHub auth changes, in which case downstream execution would stop blocked.

## Next action

- Goals locked. Handoff to `prepare-takeoff` for task scaffolding and scope recording.
