# Phase 1 — Build Markdown SolidJS Reference

## Objective
Produce concise, source-backed SolidJS reference Markdown files for Core, Router, SolidStart, and Solid Meta, including opinionated adoption boundaries and TypeScript-first examples.

## Code areas impacted
- `reference/solidjs/README.md`
- `reference/solidjs/core.md`
- `reference/solidjs/router.md`
- `reference/solidjs/solid-start.md`
- `reference/solidjs/solid-meta.md`

## Work items
- [x] Crawl official Solid docs pages for current guidance.
- [x] Draft concise coverage sections with 3-4 line TypeScript examples.
- [x] Add explicit "when to use / when not to use" guidance for Router, SolidStart, and Solid Meta.
- [x] Cross-check examples for browser relevance (desktop + mobile).
- [x] Run pinned verification commands and record outcomes in `final-phase.md`.

## Deliverables
- Markdown reference files under `reference/solidjs/`.
- Source links/last-checked notes in the guide.
- Updated `final-phase.md` implementation evidence.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] All required sections/files exist and are concise.
- [x] Each required domain contains short 3-4 line examples.
- [x] Opinionated "use / avoid" guidance exists for Router/Start/Meta.
- [x] Verification outcomes are recorded in `final-phase.md`.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: `PASS`; Actual: `PASS` (`lint: no targets`)
- [x] Command: `bun run build`
  - Expected: `PASS`; Actual: `PASS` (`build: no targets`)
- [x] Command: `bun run test`
  - Expected: `PASS`; Actual: `PASS` (`test: no targets`)

## Risks and mitigations
- Risk: Upstream docs changed recently and examples drift from current guidance.
- Mitigation: Use only current official docs and include explicit source links with last-checked date.
