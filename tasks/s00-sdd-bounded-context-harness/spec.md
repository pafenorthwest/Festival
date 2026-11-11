# S00: SDD Bounded-Context Architecture & Multi-Session Harness

## Goal reference

- `goals/s00-sdd-bounded-context-harness/goals.v0.md` (locked)

## Scope

### In scope

- `specs/bounded-contexts-2026.md` — canonical 2026 bounded-context map, ownership boundaries, and cross-context invariants.
- `specs/pre-thanksgiving-program.md` — stateless multi-session execution ledger and dependency order for packets `s00`–`s14`.
- `.agents/skills/festival-session/SKILL.md` — progressive-disclosure Antigravity workspace skill for packet execution, verification, review, and handoff.
- `.agents/skills/festival-session/scripts/validate-packet.ps1` — deterministic Windows PowerShell (`pwsh`) validator for goal, spec, and code-review artifacts.
- `goals/s00-sdd-bounded-context-harness/establish-goals.v0.md`, `goals/s00-sdd-bounded-context-harness/goals.v0.md`, `tasks/s00-sdd-bounded-context-harness/spec.md`, and `tasks/s00-sdd-bounded-context-harness/code-review.md`.
- Pre-scaffolded goal (`goals/s01-*/` through `goals/s14-*/`) and task (`tasks/s01-*/spec.md` through `tasks/s14-*/spec.md`) packets for downstream sessions `s01`–`s14`.

### Out of scope

- `AGENTS.md` (must remain untouched).
- Runtime application source and tests under `packages/common`, `packages/backend`, `packages/frontend`, and `packages/shopify-confirmation`.
- Database schema and migration files under `database/`.
- Infrastructure, container, and root build scripts (`docker/`, `nginx/`, `scripts/`, `package.json`).
- Existing `goals/*` and `tasks/*` directories outside the `s00`–`s14` packet series.

## Approach

- Capture the 2026 bounded-context domain map and stateless 15-packet (`s00`–`s14`) execution plan under `specs/` so each future conversation loads only a small, deterministic slice of context.
- Package the multi-session workflow as an on-demand Antigravity skill (`.agents/skills/festival-session/SKILL.md`) paired with a native `pwsh` structural validator (`.agents/skills/festival-session/scripts/validate-packet.ps1`) that replaces Bash-only `.codex/scripts/goals-validate.sh` checks on Windows without altering `AGENTS.md`.
- Pre-scaffold locked/draft goal extracts and scoped task specs for `s00`–`s14`, then verify every packet and an independent subagent code review through `validate-packet.ps1`.

## Verification commands

- Packet validation (`s00`): `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s00-sdd-bounded-context-harness`
- Packet validation with review (`s00`): `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s00-sdd-bounded-context-harness -RequireCodeReview`
- Program-wide packet sweep (`s00`–`s14`): `Get-ChildItem -Directory -Path 'goals/s[0-9][0-9]-*' | Sort-Object Name | ForEach-Object { pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName $_.Name; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }`
- Scope invariance check: `git diff -- AGENTS.md packages database docker nginx scripts package.json`
- Toolchain & static gates: `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run check:sql`

## Delivery

- Delivered: `50` in-scope `S00` artifacts (`0` CRLF, `0` UTF-8 BOM, all `<= 500` lines):
  - `[G1]` `specs/bounded-contexts-2026.md` (`233` lines) — canonical 2026 bounded-context map (`tenant-org`, `catalog-repertoire`, `customer-identity`, `teacher-directory`, `class-checkout`, `commerce-projection`, `volunteers-comms`), `orgs.*` PostgreSQL 17 table ownership boundaries, and acyclic DAG import invariants.
  - `[G2]` `specs/pre-thanksgiving-program.md` (`214` lines) — stateless 15-session execution ledger (`S00`–`S14`), wave dependency DAG, open decisions `D1`–`D4`, and PR/issue audit, with `S00` marked `DONE`.
  - `[G3]` `.agents/skills/festival-session/SKILL.md` (`84` lines `< 160` lines) and `.agents/skills/festival-session/scripts/validate-packet.ps1` (`224` lines `<= 250` lines, max function `36` lines `<= 60` lines) — native `pwsh` multi-session SDD runbook and deterministic structural validator.
  - `[G4]` `goals/s00-*/` through `goals/s14-*/` (`establish-goals.v0.md`, `goals.v0.md` — `30` files) and `tasks/s00-*/spec.md` through `tasks/s14-*/spec.md` (`15` files) plus `tasks/s00-sdd-bounded-context-harness/code-review.md` (`1` file).
  - `[G5]` Scope invariance preserved — `AGENTS.md`, `packages/**`, `database/**`, `docker/**`, `nginx/**`, `scripts/**`, `package.json`, and pre-existing `goals/*` / `tasks/*` directories remain byte-identical.
- Exceptions: None
- Deferred work: Runtime implementation packets `s01`–`s14` execute in dedicated downstream sessions per `specs/pre-thanksgiving-program.md`.

## Quality gate results

- Packet validator (`s00` with `-RequireCodeReview`): `PASS` — `PACKET VALID: task=s00-sdd-bounded-context-harness iteration=v0 state=locked goals=5 codeReview=valid(none)` (`exit=0`)
- Packet sweep (`s00`–`s14`): `15/15 PASS` (`s00`, `s02`, `s04`, `s06`–`s14` `state=locked`; `s01` `state=draft`; `s03`, `s05` `state=blocked`; `exit=0`)
- Toolchain / Format / Lint / Build / Types / Test / SQL: `PASS` — `bun run verify:toolchain` (`PASS`), `bun run format:check` (`PASS`), `bun run lint` (`PASS`), `bun run build` (`PASS`), `bun run --cwd packages/frontend check:types` (`PASS`), `bun run test` (`PASS`, `2213 pass, 0 fail`), `bun run check:sql` (`PASS`)
- Scope invariance check: `PASS` — `git diff -- AGENTS.md packages database docker nginx scripts package.json` empty (`0` bytes)
- Code review (`tasks/s00-sdd-bounded-context-harness/code-review.md`): `PASS` — `Findings status: none`, `Findings JSON: []`, `Verdict: patch is correct` (`0.98` confidence)
