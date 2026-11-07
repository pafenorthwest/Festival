# Validation: atomic class and capacity audits

2026-10-18, final working tree after regression test typing cleanup, based on HEAD 5c8dd582d18861926956f46bc376b0345fc4855e.

## Full PostgreSQL-enabled suite

Command: `bun run test`, through `/usr/local/bin/pwsh` with login disabled. Parsed `~/.festival.env` as assignment data without emitting secrets; set `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` from `DB_CONNECTION`. Removed conflicting PostgreSQL client variables. Network access required approved sandbox escalation.

**1,693 passed, 0 failed, 0 skipped.**

| Suite | Passed | Files | Reported test time |
| --- | ---: | ---: | --- |
| Common | 235 | 13 | 45 ms |
| Backend, PostgreSQL enabled | 1,126 | 96 | 3.62 s |
| Frontend | 312 | 32 | 439 ms |
| Shopify confirmation | 20 | 1 | 4 ms |

The new PostgreSQL test `PostgreSQL rolls back class mutations when auditing fails and serializes capacity history` passed against the database. Service regressions cover creation failure compensation, capacity rollback/retry, and fallback OrganizationService behavior. The root suite verified the pinned toolchain and rebuilt common.

## Database isolation and cleanup

For application startup, overrode `DB_SCHEMA` with dedicated random `suite_e977df5c281c4a26a2ff701676dfad1d`; integration tests also own random schemas. The runner dropped its dedicated schema in `finally` after the test process exited. Cleanup succeeded, zero dedicated schema remnants, and zero `capacity_atomic_%` schema remnants remained. Configured schema table count was 66 before and 66 afterward. Table counts do not prove that all configured-schema data was unchanged; application startup used the isolated schema.

An earlier full run also passed before nonbehavioral test typing cleanup. Initial runner preflights failed on an empty PGSERVICEFILE and denied sandbox network; corrected environment removal and approved network access resolved both before tests ran.

## Other validation

- `bun run --cwd packages/backend lint`: passed.
- `bun run check:sql`: passed, 207 backend TypeScript files.
- `bun run lint`: passed, 385 files.
- `bun run format:check`: passed, 385 files.
- `git diff --check`: passed.
- `bun run --cwd packages/frontend lint`: existing failure at `FestivalClassRegistrationPage.tsx:52`, TS2339 accessing `csrfToken` on `CustomerSessionProfile | { authenticated: false }`. Same failure documented in previous review; frontend source unchanged by this task.

No build outputs committed; no commit, push, or deployment performed. Full local output: `/tmp/festival-audit-full-tests.log`; database summary: `/tmp/festival-audit-db-summary.log`.

Independent correctness and project structure review completed with no actionable findings; verdict patch correct, confidence 0.94. See code-review.md. All locked success criteria are satisfied; the existing frontend type failure remains outside scope.

Final delivery gate (2026-10-18): bun run --cwd packages/backend build passed. Source remains unchanged since the full PostgreSQL suite and independent review. User subsequently authorized branch, commit, push, and PR delivery; build outputs remain ignored.
