# Goals Extract
- Task name: first-work-break-down
- Iteration: v0
- State: locked

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

