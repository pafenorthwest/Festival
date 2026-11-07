# Fix availability JSONB persistence

## Goal reference

- `goals/fix-availability-jsonb/goals.v0.md`, locked by the user's explicit fix and PostgreSQL suite request.
- Subsequent explicit user authorization expanded the task to inspect the selected database's application schema, apply missing reviewed migrations, and validate availability against the actual upgraded schema. That request supersedes the original v0 exclusion of application-schema writes only for the bounded maintenance documented below; immutable goal history is retained.

## Scope and baseline

- In scope: availability JSONB write binding and targeted raw-storage/round-trip tests; complete PostgreSQL-gated suite validation on `FESTIVAL_DB` loaded privately from `database.env`; subsequently authorized inspection and three reviewed additive migrations in the actual `orgs` application schema plus rollback-only validation there.
- Out of scope: unreviewed application data changes, baseline replay or blanket runtime initialization, changes to other schemas, unrelated refactors, a disposable database, env edits/staging, commits/push/PR/deployments, and external bootstrap configuration.
- Branch: `ericp/verified-paid-order`, baseline local commit `87bf320`.
- Dirty-worktree decision: continue; preserve pre-existing `.gitignore` modification and unrelated untracked `database/test-data`, goals and tasks directories. Do not stage or modify them.

## Database configuration and safety audit

- `database.env` exists and contains a single simple `FESTIVAL_DB` assignment. Use Bun's explicit env-file loader inside a fresh subprocess; hide connection values and sanitize diagnostics before console/log output.
- `run-postgres-tests.ps1` prevents caller `FESTIVAL_DB` from shadowing the selected file and restores its local process environment afterward. The TypeScript runner derives only test-child `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` from the selected value.
- Audited existing PostgreSQL integration files: capacity-atomic, capacity-cutoff, targeted-entitlement-filters, schema and registration-snapshot. Each uses fresh `randomUUID()` schema names, passes them to repositories/schema initialization, and drops only its generated schemas. Migration SQL is rewritten to the generated schema before execution. Catalog/lock inspection queries are read-only; test advisory locks/transactions are released.
- Complete gating also includes `postgres-commerce-repository.test.ts`, `repertoire-repository.test.ts`, and `festival-class-bulk-lookup.test.ts`; these integration blocks similarly use UUID schemas and cleanup. No test writes to existing application schemas. Audit any newly added availability integration test before executing it.
- Discovery is based on every backend `**/*.test.ts` containing `POSTGRES_INTEGRATION_URL`, not just filenames ending `.integration.test.ts`. Current audited inventory:
  - `packages/backend/tests/festival-class-bulk-lookup.test.ts`
  - `packages/backend/tests/postgres-class-capacity-atomic.integration.test.ts`
  - `packages/backend/tests/postgres-class-capacity-cutoff.integration.test.ts`
  - `packages/backend/tests/postgres-commerce-repository.test.ts`
  - `packages/backend/tests/postgres-customer-availability.integration.test.ts`
  - `packages/backend/tests/postgres-registration-snapshot.integration.test.ts`
  - `packages/backend/tests/postgres-schema.integration.test.ts`
  - `packages/backend/tests/postgres-targeted-entitlement-filters.integration.test.ts`
  - `packages/backend/tests/repertoire-repository.test.ts`
- The runner records its exact discovered inventory in sanitized test output. Any new gated availability test joins this inventory and receives the same UUID-schema safety review before execution.
- New availability test audited: `availability_<UUID>` schema only, scoped repository/fixture SQL, raw `jsonb_typeof` and array-constraint assertions, and `finally` drops only that generated schema. The selected connection authorizes these isolated test-schema writes; no existing application data is targeted.
- Execution uses a separate 60-second-bounded Bun child for each discovered file, preserving each exit status and all assertions. Initial execution exposed a lazy Bun SQL thenable passed directly to a rejection assertion; awaiting the same query inside a native async promise fixed the test while retaining the PostgreSQL CHECK error assertion. No force-exit option or assertion weakening was used.
- No connection credentials or selected connection string are stored in task artifacts. No separate PostgreSQL cluster is created.

## Pinned verification commands

Run from repository root using `/opt/homebrew/bin/pwsh`:

- Task goals/preflight: `& ./tasks/fix-availability-jsonb/workflow.ps1 -Iteration v0`
- Configuration readiness without connection: `& ./tasks/fix-availability-jsonb/run-postgres-tests.ps1 -CheckConfig`
- Complete PostgreSQL-gated suite: `& ./tasks/fix-availability-jsonb/run-postgres-tests.ps1`
- Toolchain: `bun run verify:toolchain`
- Lint: `bun run lint`
- Format: `bun run format:check`
- SQL: `bun run check:sql`
- Build, sequential: `bun run build:common`, then `bun run build:backend`
- Focused unit/service/route regressions without private DB env: `bun test packages/backend/tests/customer-availability-repository.test.ts packages/backend/tests/customer-availability.test.ts`

These checks are proportional to the bounded backend binding fix; frontend and confirmation sources are unchanged. The PostgreSQL wrapper discovers all nine currently gated files, including the new raw-storage regression and non-integration-named gated blocks.

## Delivery and results

- Configuration existence/shape and loader readiness: PASS; `database.env` loaded with Bun, selected value validated as a PostgreSQL URL without output or connection. Caller environment is restored by the PowerShell wrapper.
- Goals/preflight: PASS; GOALS LOCKED (3 goals/3 criteria), expected branch and no conflicts.
- Implementation: core frozen; availability writes bind the normalized array directly, with existing mock expectations updated and a real PostgreSQL raw-array/round-trip regression added.
- New test safety review: PASS; only generated UUID schema ownership and cleanup, no existing application writes.
- PostgreSQL suite: PASS, all nine dynamically discovered gated files against privately loaded `FESTIVAL_DB`: 34 tests/259 assertions, zero failures, zero skips, every child exit zero. This includes 22 PostgreSQL-enabled integration cases and 12 unit cases in the mixed files. New availability integration passes one test/14 assertions covering raw JSONB arrays, empty/nonempty saves, normalized updates, batching, tenant/customer isolation, ownership guard and the original CHECK rejection.
- Toolchain: PASS, Bun 1.4.2 and TypeScript 5.9.3.
- Lint/format: PASS, 410 package files.
- SQL: PASS, 219 backend TypeScript files.
- Build: PASS, common then backend TypeScript builds.
- Focused unit/service/route tests: PASS, 14 tests/115 assertions across two files.
- Cleanup: final successful run left no new test schemas. Two exact availability UUID schemas from the earlier timed-out test runs were independently identified, then rechecked for owner and exact fixture rows in one cleanup transaction before dropping only those names. A scalar-bound query verifies both absent; the final matching UUID test-schema inventory is zero. Existing application data/schemas were not modified.
- Branch/diff/scope: expected `ericp/verified-paid-order`, no conflicts, `git diff --check` PASS. Intentional work consists of the small availability binding fix, focused test expectation update, new isolated PostgreSQL availability test and task artifacts. The pre-existing `.gitignore` change and unrelated untracked files remain untouched and unstaged. No commit, push or env-file change occurred.
- Independent review: PASS, no findings, `patch is correct`, confidence 0.98. Final reviewer rechecked the native async SQL rejection assertion; the invalid JSONB-string update and PostgreSQL `23514` CHECK assertion remain unchanged.
- Logs: sanitized `/private/tmp/fix-availability-jsonb-validation/` output contains no connection URL/password. No separate PostgreSQL database was created.
- Completion: initial fix goals and subsequent authorized application maintenance satisfied; implementation, proportional validation, complete PostgreSQL-gated suite, independent review, exact fixture cleanup, targeted application upgrade and actual-table rollback validation are complete. No commit, push, env-file change or unrelated cleanup performed.

## Authorized application-schema maintenance

- Target identified read-only: configured `DB_SCHEMA=orgs` in repository env configuration; selected PostgreSQL server 17.11. Private `FESTIVAL_DB` value was never printed or copied into reports. No migration ledger/version table exists, so initial status was established from actual catalog definitions.
- Initial compatibility: room tables/FKs/indexes already satisfied `20261007154800_admin_rooms`; enabled statement-level cutoff triggers and function already satisfied `20261018120000_soft_capacity_cutoff`. These migrations were skipped. The obsolete `registration_metadata_checkout_intent_id_unique` index was explicitly verified absent. All 17 runtime-ALTER column requirements were checked; only `registration_snapshot` was missing.
- Actual outstanding objects: `orgs.registration_metadata.registration_snapshot` JSONB column; entire `orgs.customer_festival_availability` table; its customer lookup index. Required parent composite uniqueness and ownership/create permissions were verified. Existing metadata row count was one.
- Approved migrations applied and committed together:
  - `20261023010000_registration_selection_snapshot.sql`
  - `20261023020000_unknown_registration_instrument.sql`
  - `20261023030000_customer_festival_availability.sql`
- The availability migration was compared to the canonical table/index SQL before execution. Only each file's outer BEGIN/COMMIT was stripped; all three bodies ran through the same explicit transaction with `lock_timeout=5s`, `statement_timeout=30s`, and the schema advisory lock `hashtextextended('orgs',0)`. Missing-object drift and obsolete-index absence were rechecked before applying. No baseline, runtime initializer, satisfied migration replay, schema reset or migration ledger creation occurred.
- Commit postconditions: new nullable snapshot column is JSONB; the one prior metadata row and all its old fields remain unchanged, with its new snapshot SQL NULL. Sentinel backfill changed zero rows. Availability table has eight expected non-null columns, the exact primary key, four validated FKs, subject/hour CHECK constraints, and valid `(organization_id, festival_id, customer_id)` lookup index; it is empty.
- Data preservation: row counts and aggregate row fingerprints for all 66 pre-existing application tables matched before/after the migration transaction, excluding only the new metadata snapshot field. No individual application row content or fingerprint values were logged.
- Actual upgraded `orgs` validation: 13 checks passed using the exact production upsert SQL extracted from source and `normalizeAvailableHours` parameters routed only through the explicit transaction executor. No global repository SQL calls or `ensureReady()` ran in that validation transaction. UUID organization/festival/customer fixtures exercised raw JSONB array storage, empty/nonempty normalized updates, batching, tenant/customer-scoped reads and ownership guards. An invalid JSONB string produced the expected PostgreSQL `23514` CHECK failure under a savepoint; the savepoint was rolled back and validation continued.
- A private sentinel forced rollback of the complete fixture transaction. Outside it, every fixture organization/festival/customer/availability row was verified absent. Aggregate counts/fingerprints for all 67 current application tables matched before/after validation. There are zero persistent synthetic records.
- Final status: targeted application schema upgrade is committed in PostgreSQL and availability is validated against it. Existing source changes and the user's pre-existing `.gitignore` edit remain uncommitted and preserved; no git mutation was performed during maintenance.
