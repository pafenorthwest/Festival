# establish-goals

## Status

- Iteration: v0
- State: locked
- Task name (proposed, kebab-case): build-solidjs-reference

## Request restatement

- Produce a concise, opinionated SolidJS reference guide as Markdown files using the latest official docs, with short examples and clear usage boundaries for Core, Router, SolidStart, and Meta.

## Context considered

- Repo/rules/skills consulted: `AGENTS.md`, `/Users/eric/.codex/skills/acac/SKILL.md`, `/Users/eric/.codex/skills/establish-goals/SKILL.md`
- Relevant files (if any): `goals/build-solidjs-reference/establish-goals.v0.md`, `goals/build-solidjs-reference/goals.v0.md`
- Constraints (sandbox, commands, policy): no implementation before goal lock; lifecycle order is mandatory; web crawl required for latest docs; keep changes minimal and verifiable.

## Ambiguities

### Blocking (must resolve)

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. "All files in markdown" means every new deliverable in this task is `.md` only.
2. "Core commands" refers to core SolidJS concepts/APIs in official docs, not every API entry.
3. "Conscie/concisce" is interpreted as "concise."
4. TypeScript bias is interpreted as TypeScript-first code snippets, only using SolidJS-specific syntax/extensions when needed.

## Questions for user

1. None required for goal lock.

## Assumptions (explicit; remove when confirmed)

1. The guide may be split into multiple Markdown files under a dedicated reference folder.
2. Each required section should include multiple short snippets, each 3-4 lines.
3. Official Solid docs pages provided by the user are the primary source of truth.

## Goals (1-20, verifiable)

1. Crawl current official SolidJS documentation pages and use that research as the basis for the guide content.
2. Create/update only Markdown deliverables for this task (no non-Markdown output artifacts).
3. Provide concise Core SolidJS coverage with short 3-4 line examples.
4. Provide concise Solid Router coverage with short 3-4 line examples.
5. Provide a concise opinionated guide describing when to use Router and when not to use Router.
6. Provide concise SolidStart coverage with short 3-4 line examples.
7. Provide a concise opinionated guide describing when to use SolidStart and when not to use SolidStart.
8. Provide concise Solid Meta coverage with short 3-4 line examples.
9. Provide a concise opinionated guide describing when to use Solid Meta and when not to use Solid Meta.
10. Keep guidance biased toward simple implementations and TypeScript-first examples that transpile to browser JavaScript, using SolidJS extensions only where necessary.
11. Ensure examples and recommendations target browser execution on both desktop and mobile contexts.

## Non-goals (explicit exclusions)

- Building or running a full Solid app in this task.
- Reproducing full official documentation verbatim or exhaustively covering every API.
- Covering third-party Solid ecosystem libraries outside Core/Router/Start/Meta unless needed for clarity.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] At least one verifiable citation/source note from current official docs is captured in the produced guide files.
- [G2] All new deliverables created by this task have `.md` extension.
- [G3] Core section exists and includes concise text plus at least two 3-4 line examples.
- [G4] Router section exists and includes concise text plus at least two 3-4 line examples.
- [G5] Router opinionated "use / do not use" guidance exists and is explicit.
- [G6] SolidStart section exists and includes concise text plus at least two 3-4 line examples.
- [G7] SolidStart opinionated "use / do not use" guidance exists and is explicit.
- [G8] Solid Meta section exists and includes concise text plus at least two 3-4 line examples.
- [G9] Solid Meta opinionated "use / do not use" guidance exists and is explicit.
- [G10] Examples are TypeScript-first and avoid unnecessary Solid-specific extensions.
- [G11] Guide includes explicit notes for desktop and mobile browser relevance.

## Risks / tradeoffs

- "Concise" scope may omit edge cases; this is intentional for quick-reference usability.
- Solid docs evolve; snapshots are accurate to crawl time and may need later refresh.

## Next action

- GOALS LOCKED. Handoff: `prepare-takeoff` owns task scaffolding and `spec.md` readiness content.
