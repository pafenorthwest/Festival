# Atomic class and capacity audit persistence

Locked goals: goals/fix-class-capacity-audit-atomic/goals.v1.md (v1, explicitly approved by user request, 2026-10-18).

## Scope
Class creation and capacity update persistence, capacity audit records, minimal repository/service contract changes, regression tests including PostgreSQL audit failure rollback and retry.

## Non-goals
Unrelated refactoring, frontend correction, optional performance benchmark, deployment. Subsequent explicit user authorization on 2026-10-18 adds branch creation, commit, push to origin, and pull request delivery.

## Preflight and worktree
Repository: /Users/eric/pafenorthwest/Festival. Branch main, starting HEAD 5c8dd582d18861926956f46bc376b0345fc4855e. Initial dirty status only untracked tasks/review-be77c731-to-head/ from the previous requested review. Continue in the current checkout; preserve those reports. No unresolved conflicts. Bun available at /Users/eric/.bun/bin/bun. Repository uses Bun 1.4.2 and TypeScript 5.9.3. Prior validation notes one existing frontend csrfToken type failure and configured-schema initialization side effects. This task does not change those behaviors.

Read repository goals extraction/validation scripts and global implementation bootstrap/preflight/task-scaffold scripts. Equivalent PowerShell scaffolding and checks used because project requires PowerShell and forbids directly executing .sh scripts. Do not modify global Codex bootstrap configuration.

## Validation commands
All executed through /usr/local/bin/pwsh with login:false from repository root:
- bun run test (load ~/.festival.env without printing secrets; assign DATABASE_URL and POSTGRES_INTEGRATION_URL from DB_CONNECTION; clear conflicting PGDATABASE/PGHOST/PGPORT/PGUSER/PGPASSWORD/PGSERVICE/PGSERVICEFILE/PGOPTIONS variables).
- bun run --cwd packages/backend build (final delivery gate: passed 2026-10-18)
- bun run --cwd packages/backend lint
- bun run --cwd packages/frontend lint
- bun run check:sql
- bun run lint
- bun run format:check
- git diff --check

Environment assignments are parsed as data, quoted values unwrapped and references to prior assignments expanded without executing the file. PostgreSQL test schemas are isolated by the integration harness. Full suite may initialize supplementary tables in the configured schema, as observed during the preceding review.

## Approach
Use repository-owned atomic operations for the class/audit pair. Ensure the PostgreSQL path shares a transaction, and the in-memory path has equivalent failure semantics. Preserve existing service responsibilities and Shopify compensation. Run focused regression tests before complete validation. Independent review examines only task changes and project structure.

## Results
Delivered atomic repository operations for class creation/audit and capacity update/audit, including in-memory rollback and PostgreSQL transaction/row locking. Services delegate audit persistence to those operations. Added service and real PostgreSQL audit-failure rollback/retry regression tests. Full PostgreSQL-enabled suite: 1,693 passed, zero failed/skipped. Backend types, SQL validation, lint, formatting and diff checks passed. Frontend types retain the previously documented unrelated csrfToken error. Dedicated suite schema and capacity_atomic_ schemas cleaned up; configured schema table count 66 before/after. See validation.md for evidence. Independent correctness and project structure review: no actionable findings, patch correct (confidence 0.94); see code-review.md. Deferred work: none in scope.



## Delivery readiness
READY TO LAND. Final backend build passed. Existing frontend TS2339 is an acknowledged pre-existing exception: frontend source is unchanged and the full test suite passed. No deferred work in scope. Native PowerShell equivalents of inspected Git/GitHub safety helpers are used because AGENTS.md prohibits executing .sh scripts. Only task changes and task documentation are staged; prior review reports remain local.

PR base: main, the remote default and starting HEAD. Configured ericp/exp-long-running-agent is an ancestor 231 commits behind main; using it would include unrelated commits. GitHub connector handles PR delivery because the configured CLI owner token is unavailable.
