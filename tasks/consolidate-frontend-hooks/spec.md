# Consolidate frontend hooks

## Locked goals

- `goals/consolidate-frontend-hooks/goals.v0.md` (locked from the user's explicit 2026-10-23 instruction).

## Scope

- Eligibility hook shared lifecycle and focused tests.
- Rooms and Volunteer Roles selected-festival fallback, auth subscription, shared selector UI, and focused tests.
- Production build and exact minified/gzip comparison.
- Excludes API refactors, route splitting, other resource loaders, dependencies, backend work, and Git mutations.

## Environment and dirty-worktree decision

- Repository: `/Users/eric/pafenorthwest/Festival`.
- Branch: `ericp/verified-paid-order`; HEAD: `8754bb990d0f935b9c093dfb2291c1003bf057db`.
- Bun 1.4.2, TypeScript 5.9.3 (verified by `bun run verify:toolchain`), Node v24.8.0, installed Vite 7.3.1.
- No unresolved merge conflicts. Continue in the existing checkout; preserve unrelated work and stage nothing.
- Pre-existing tracked change: `.gitignore`.
- Pre-existing untracked paths: `database/test-data/`; goals folders `fix-263-registration-window`, `integration-workflow`, `test-organization-data`; tasks folders `fix-263-registration-window`, `integration-workflow`, `review-263-registration-window`, `review-289-account-availability`, `review-be77c731-to-head`, `review-integration-workflow`, `review-pr298-comments`, `review-pr303-current`, `review-test-organization-schema`; `tasks/schema-parity-integration/apply-webhook-checks.ps1` and `.ts`.

## Setup adaptation

- Read the repository goals extraction/validation scripts and global implementation bootstrap/preflight/task-scaffold scripts.
- User instructions require native PowerShell and forbid executing `.sh` directly. Used PowerShell equivalents for directory/file creation, locked-goal extraction validation, repository/branch/conflict checks, and toolchain checks.
- Did not run shell bootstrap mutations to Codex config/task manifest or `git worktree prune`; they are outside this bounded task and unnecessary for the verified environment.

## Verification commands

Run from the repository root using `/usr/local/bin/pwsh`:

```powershell
bun run verify:toolchain
bun run --cwd packages/frontend test
bun run --cwd packages/frontend lint
bun run --cwd packages/frontend build
```

- Scoped formatting/lint command:

```powershell
bun x biome check packages/frontend/src/pages/AdminRoomsPage.tsx packages/frontend/src/pages/VolunteerRolesPage.tsx packages/frontend/src/pages/useCartEligibility.ts packages/frontend/src/pages/useClassOptionEligibility.ts packages/frontend/src/components/FestivalSelector.tsx packages/frontend/src/pages/createEligibilityEvaluation.ts packages/frontend/src/pages/useAdminFestivalSelection.ts packages/frontend/tests/admin-volunteer-roles.test.ts packages/frontend/tests/festival-volunteers.test.ts packages/frontend/tests/admin-festival-selection.test.ts packages/frontend/tests/createEligibilityEvaluation.test.ts
```
- Existing frontend `bunfig.toml` preloads client Solid for hook tests; eligibility regression tests must use that client runtime.
- Focused checks may run from `packages/frontend` with `bun test tests/cartEligibility.test.ts tests/classOptionEligibility.test.ts tests/admin-rooms.test.ts tests/admin-volunteer-roles.test.ts` plus new focused test files.
- Measure the actual built JS using Node `Buffer.byteLength` and `node:zlib` `gzipSync`, matching the prior measurement methodology.
- Baseline: `index-BHxDwYqT.js`, minified 502,122 bytes, Node gzip 138,605 bytes. A default Vite warning triggers above 500,000 minified bytes.

## Execution and completion

- Eligibility and admin selection edits have disjoint write owners; parent owns integration, final checks, and size comparison.
- Delivered shared `createEligibilityEvaluation` lifecycle used by both eligibility hooks, with each hook retaining its own inputs, empty-state conditions, result keys, candidate mapping, and fallback error message.
- Delivered shared `useAdminFestivalSelection` and `FestivalSelector`, retaining selected/primary/first fallback, reactive festival updates, auth cleanup, and each page's existing resource guards.
- Updated two source-level admin assertions to follow the extracted wiring; added focused eligibility lifecycle and admin selection regression tests.

## Final validation

- [G1] Eligibility tests and new shared lifecycle regressions passed as part of the complete frontend suite, including stale responses, cleanup, empty inputs, and mapping behavior.
- [G2] Admin Rooms/Volunteer Roles tests and shared selection fallback/reactivity/auth cleanup regressions passed. Shared selector wiring is covered by source assertions.
- [G3] `bun run --cwd packages/frontend test`: **338 passed, 0 failed**, 1,941 assertions across 35 files.
- [G3] `bun run --cwd packages/frontend lint`: passed TypeScript `--noEmit`.
- [G3] Scoped Biome command: passed all 11 changed/new TypeScript/TSX files, no fixes applied.
- [G3] `bun run --cwd packages/frontend build`: passed with Vite 7.3.1; 154 transformed modules; output `index-TypDwPDW.js`.
- `git diff --check`: passed. Changed paths are restricted to the four refactored pages/hooks, three new shared source files, four test files, and this task's goal/spec artifacts. Pre-existing `.gitignore` and unrelated untracked work were preserved; no Git mutations performed.
- An initial full-test run found one source-text assertion still looking for a moved local variable. Its owner updated the assertion to verify shared hook/selector wiring; the complete suite then passed. No source changes occurred after the successful build/type check; the subsequent change was test-only.

## Measured size comparison

| Measure | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Minified JavaScript bytes | 502,122 | 501,552 | 570 (0.1135%) |
| Node gzip JavaScript bytes | 138,605 | 138,596 | 9 (0.00649%) |

- The 500,000-byte warning remains: the final chunk is 1,552 bytes above it.
- CSS remains `index-Ct35Ilx8.css`, 35,541 bytes; there are no route splitting or dependency changes.
- Measurements use Node v24.8.0 `node:zlib` `gzipSync` defaults against actual emitted assets, matching the baseline methodology.
- Full command logs and measurement script: `/private/tmp/festival-consolidation-validation/`.
- Durable evidence: `/Users/eric/.codex/visualizations/2026/10/23/01a16a21-3a7c-7850-bf83-f6e2bbf3fbbd/consolidation-validation-summary.json`, `consolidation-size-comparison.json`, and `consolidation-*.log`.
- All locked success criteria are satisfied. No additional implementation, dependency updates, commits, or pull requests were required.
