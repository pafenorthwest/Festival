# Build SolidJS Reference Guide

## Overview
Create a concise, opinionated SolidJS reference in Markdown using current official documentation for Core, Router, SolidStart, and Solid Meta.

## Goals
1. Use current official Solid documentation as primary source input.
2. Produce Markdown-only deliverables.
3. Cover Core with concise explanations and short examples.
4. Cover Router with concise explanations and short examples.
5. Provide explicit Router use vs do-not-use guidance.
6. Cover SolidStart with concise explanations and short examples.
7. Provide explicit SolidStart use vs do-not-use guidance.
8. Cover Solid Meta with concise explanations and short examples.
9. Provide explicit Solid Meta use vs do-not-use guidance.
10. Keep examples TypeScript-first and simple.
11. Keep recommendations browser-focused for desktop and mobile.

## Non-goals
- Build or run a production Solid app.
- Duplicate full upstream docs/API references.
- Add coverage of unrelated third-party Solid libraries.

## Use cases / user stories
- As a frontend engineer, I want a short SolidJS reference so I can decide quickly between Core-only, Router, or SolidStart.
- As a product engineer, I want examples that are easy to paste and adapt in TypeScript.
- As a mobile-web engineer, I want browser-specific notes that still apply on desktop.

## Current behavior
- Notes: `reference/` has no SolidJS reference docs yet.
- Key files:
  - `reference/`
  - `goals/build-solidjs-reference/goals.v0.md`

## Proposed behavior
- Behavior changes:
  - Add a concise SolidJS reference set under `reference/solidjs/` in Markdown.
  - Include short (3-4 line) examples for each required area.
  - Include opinionated adoption guidance for Router, SolidStart, and Solid Meta.
  - Include source links and "last checked" date in guide content.
- Edge cases:
  - If docs guidance differs across pages, prefer stable/recommended baseline patterns.
  - If a feature is niche, keep it out unless needed for required sections.

## Technical design
### Architecture / modules impacted
- `reference/solidjs/*.md` (new docs only)
- `tasks/build-solidjs-reference/*` (stage artifacts)

### API changes (if any)
None.

### UI/UX changes (if any)
None (documentation-only task).

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: Not applicable.
- Rollback: Delete added docs if required.

## Security & privacy
No secrets or PII. Content sourced from public docs and local task artifacts.

## Observability (logs/metrics)
Not applicable for documentation-only change.

## Governing context
- Rules: `.codex/rules/expand-task-spec.rules`, `.codex/rules/git-safe.rules`
- Skills used in lifecycle: `acac`, `establish-goals`, `prepare-takeoff`, `prepare-phased-impl`, `implement`, `land-the-plan`
- Sandbox constraints: workspace-write, network-restricted shell, web research via browsing tool

## Goal lock assertion
Locked goals source: `goals/build-solidjs-reference/goals.v0.md` (state: `locked`).
No reinterpretation/expansion permitted without relock.

## Ambiguity check
No blocking ambiguity remains for Stage 2.
Non-blocking assumptions are captured in `goals/build-solidjs-reference/establish-goals.v0.md`.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: Not required for pure-doc updates.
- Integration: Not required for pure-doc updates.
- E2E / UI (if applicable): Not required for pure-doc updates.
- Stage verification contract still requires running pinned lint/build/test commands.

## Acceptance criteria checklist
- [ ] Core section contains concise coverage with at least two 3-4 line examples.
- [ ] Router section contains concise coverage with at least two 3-4 line examples.
- [ ] Router includes explicit "use / do not use" guidance.
- [ ] SolidStart section contains concise coverage with at least two 3-4 line examples.
- [ ] SolidStart includes explicit "use / do not use" guidance.
- [ ] Solid Meta section contains concise coverage with at least two 3-4 line examples.
- [ ] Solid Meta includes explicit "use / do not use" guidance.
- [ ] Guide content includes source references and last-checked date.
- [ ] All output deliverables are Markdown.

## IN SCOPE
- Create/update Markdown docs in `reference/solidjs/`.
- Use official Solid docs pages supplied by user as primary references.
- Add concise examples and opinionated usage boundaries for Core/Router/Start/Meta.

## OUT OF SCOPE
- Application runtime code changes under `packages/`.
- CI, deployment, or infra updates.
- Non-Markdown output artifacts.

## Execution posture lock
- Simplicity bias locked.
- Surgical changes only, limited to task surfaces.
- Fail-fast behavior required for uncertain or blocked states.

## Change control
- Goal/constraint/success-criteria changes require relock through `establish-goals`.
- Verification contract (`lint`, `build`, `test`) cannot be weakened or bypassed.

## Stage 2 verdict
READY FOR PLANNING

## Implementation phase strategy
- Complexity: surgical
- Complexity scoring details: score=0; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/build-solidjs-reference/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
