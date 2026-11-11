# Goals Extract
- Task name: s00-sdd-bounded-context-harness
- Iteration: v0
- State: locked

## Goals

1. Author `specs/bounded-contexts-2026.md` defining the canonical 2026 bounded contexts, aggregate ownership rules, permitted cross-context integration ports, and anti-corruption invariants across `packages/common`, `packages/backend`, `packages/frontend`, `packages/shopify-confirmation`, and `database`.
2. Author `specs/pre-thanksgiving-program.md` defining the stateless multi-session execution ledger, dependency DAG, context-hygiene guardrails, verification gates, and packet table covering `s00` through `s14`.
3. Create `.agents/skills/festival-session/SKILL.md` (`<160` lines) and `.agents/skills/festival-session/scripts/validate-packet.ps1` (`<=250` lines, `<=60` lines per function) to enforce 1-packet-per-session execution, subagent delegation, native `pwsh` usage, goal-lock preflight, scope lock, verification gates, and `code-review.md` schema validation.
4. Scaffold deterministic, schema-valid goal (`establish-goals.v0.md`, `goals.v0.md`) and task (`spec.md`) packets for `s00-sdd-bounded-context-harness` and all downstream program packets (`s01`–`s14`) aligned with `specs/pre-thanksgiving-program.md` and `specs/bounded-contexts-2026.md`.
5. Keep `AGENTS.md` byte-identical and leave all runtime packages, SQL migrations, container configs, scripts, and unrelated `goals/` and `tasks/` directories untouched during `s00`.

## Non-goals

- Modifying runtime TypeScript, React, Hono, Shopify extension, Docker, Nginx, or PostgreSQL schema/migration files in `s00` (deferred to scoped packets `s01`–`s14`).
- Editing `AGENTS.md` or executing legacy Bash `.codex/scripts/*.sh` helpers on Windows.
- Modifying or deleting pre-existing `goals/*` or `tasks/*` directories outside the `s00`–`s14` program namespace.

## Success criteria

- [G1] `specs/bounded-contexts-2026.md` exists and documents each 2026 bounded context, its package/table ownership boundaries, and cross-context dependency rules.
- [G2] `specs/pre-thanksgiving-program.md` exists and enumerates packets `s00`–`s14` with dependencies, target bounded contexts, scope summaries, verification commands, and status tracking.
- [G3] `.agents/skills/festival-session/SKILL.md` (`<160` lines) has valid YAML frontmatter (`name: festival-session`) and `.agents/skills/festival-session/scripts/validate-packet.ps1` exits `0` on valid packets and `1` with actionable error output on malformed packets or missing required code reviews.
- [G4] Running `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName <slug>` exits `0` for `s00-sdd-bounded-context-harness` and every scaffolded `s01`–`s14` packet.
- [G5] `git diff -- AGENTS.md packages database docker nginx scripts package.json` produces empty output and existing repository toolchain/lint/SQL checks pass with zero warnings or errors.
