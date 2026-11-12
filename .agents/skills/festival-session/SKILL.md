---
name: festival-session
description: >-
  Executes, reviews, and hands off stateless multi-session SDD packets (s00–s14)
  defined in specs/pre-thanksgiving-program.md. Activate this skill whenever
  starting, implementing, validating, reviewing, or handing off a packet in
  specs/pre-thanksgiving-program.md.
---

# Festival Multi-Session Packet Runbook

Execute pre-Thanksgiving program packets (`s00`–`s14`) deterministically with bounded context windows, strict scope isolation, and native Windows PowerShell (`pwsh`) tooling.

## Context-Hygiene Rules

- **1 Packet = 1 Fresh Conversation**: Execute a single packet (`s00`–`s14`) per conversation. End the session cleanly after Step 4 handoff so downstream packets start with zero context carryover.
- **Thin Coordinator + Subagents**: Keep the root conversation strictly as an orchestrator. Delegate codebase scans, scoped edits, verification commands, diff reviews, and git operations to bounded single-purpose subagents.
- **`AGENTS.md` Untouched**: Never edit `AGENTS.md`. Workflow mechanics live in this on-demand skill to avoid permanent prompt bloat.
- **`/compact` & `@` Safety Valves**: Recommend `/compact` if multi-round debugging expands context mid-packet. Read targeted line ranges (`StartLine`/`EndLine`) and reference exact `@` file paths instead of dumping full files or unconstrained logs.
- **Windows PowerShell (`pwsh`) Native Syntax Only**: Write all shell commands for `pwsh` (`$env:VAR = "val"`, `;` statement separators, native cmdlets). Never use Bash idioms (`export`, `$(...)`, POSIX flags) and never execute `.sh` scripts directly.

---

## Step 1: Preflight & Goal Lock

1. Read the program and architecture anchors (targeted sections only):
   - `specs/pre-thanksgiving-program.md` — verify packet scope and confirm all upstream dependencies are marked `DONE`.
   - `specs/bounded-contexts-2026.md` — confirm owning bounded context, permitted ports, and cross-context invariants.
   - `goals/<slug>/goals.vN.md` and `tasks/<slug>/spec.md` — review locked goals, success criteria, and path boundaries.
2. Enforce goal state before touching code:
   - **`State: locked`**: Required before any runtime or test file edits.
   - **`State: blocked`**: Halt immediately and escalate the blocking ambiguity to the user.
   - **`State: draft`**: Resolve open ambiguities with the user, lock `goals/<slug>/establish-goals.vN.md` and `goals/<slug>/goals.vN.md` (`State: locked`), and re-validate before proceeding.
3. Run the packet validator ([validate-packet.ps1](./scripts/validate-packet.ps1)):
   ```powershell
   pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName <slug>
   ```
   Pass `-Iteration <vN>` when validating an iteration above `v0`. Do not proceed unless exit code is `0`.

---

## Step 2: Branch & Scope Lock

1. Dispatch a git subagent to create or verify a dedicated packet branch using a conventional prefix (`chore/<slug>`, `fix/<slug>`, `feat/<slug>`, or `refactor/<slug>`).
2. Restrict edits strictly to paths listed under `### In scope` in `tasks/<slug>/spec.md` (plus `tasks/<slug>/` review/spec updates and the packet row in `specs/pre-thanksgiving-program.md` at handoff).
3. Never stage, modify, or delete unrelated `goals/` or `tasks/` directories or pre-existing untracked workspace files.

---

## Step 3: Red-Green Implementation & Verification Gate

1. **Red**: Dispatch a scoped subagent to write or update deterministic, hermetic tests reproducing the bug or specifying the target behavior, confirming the expected failure first.
2. **Green**: Dispatch a scoped implementation subagent to write the minimal surgical change needed to pass tests while preserving existing comments, formatting, and bounded-context boundaries.
3. **Structural Size Guardrails**:
   - Files: `<=500` lines (hard ceiling `600`)
   - Classes: `<=250` lines
   - Functions: `<=60` lines (target `<=40`, max 3 parameters, max cyclomatic complexity `10`)
   - If exceeding a limit is technically warranted, request explicit approval with rationale rather than forcing artificial splits.
4. **Verification Gate**: Dispatch a verification subagent to run all mandatory checks in `pwsh` (0 errors, 0 warnings):
   ```powershell
   bun run verify:toolchain
   bun run format:check
   bun run lint
   bun run build
   bun run --cwd packages/frontend check:types
   bun run test
   bun run check:sql
   ```

---

## Step 4: Independent Subagent Code Review & Ledger Handoff

1. Dispatch an independent review subagent to audit the diff against `goals/<slug>/goals.vN.md`, `tasks/<slug>/spec.md`, and `specs/bounded-contexts-2026.md`, writing `tasks/<slug>/code-review.md`.
2. Resolve any findings and re-review until `tasks/<slug>/code-review.md` records:
   - `- Findings status: none`
   - `## Findings JSON` containing `[]`
   - `## Verdict` containing `- Verdict: patch is correct`, `- Confidence:`, and `- Justification:`
3. Re-run the packet validator with `-RequireCodeReview`:
   ```powershell
   pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName <slug> -RequireCodeReview
   ```
4. Finalize `## Delivery` and `## Quality gate results` in `tasks/<slug>/spec.md`.
5. Dispatch a git subagent to stage **only** in-scope packet files, create a conventional commit, and mark the packet `DONE` in `specs/pre-thanksgiving-program.md`.
