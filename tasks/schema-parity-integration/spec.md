# Schema parity and current-schema integration

## Final target approval — v4

The user approved all 11 genuine multi-session/fault cases in three disposable namespaces containing only the current schema. Locked `goals/schema-parity-integration/goals.v4.md` resolves the v3 exception: ordinary fixtures use actual `orgs` rollback transactions; the three race/fault files use isolated current namespaces; catalog preflight uses one separate current reference namespace. No historical reconstruction/migration replay, further application DDL, env edit or persistent fixture data is permitted. The two-file runner delta froze and passed independent review before execution. All final goals are satisfied by the completed full-suite evidence below.

The default final runner executed all 11 files/32 cases in three successful rounds, each with four actual current-schema initializations and eight application rollback markers. Optional application-only execution is a named subset. Prior ordinary-only v3 logs/metrics/private aggregate evidence are preserved under `/private/tmp/schema-parity-integration-validation/application-only-v3/`; historical v2 evidence remains under `isolated-v2/`. The final delta changed only two runner files, so prior global/backend verification remains valid.

## Historical target override — v3 (exception resolved by v4)

The user explicitly selected actual `orgs` with rollback-only fixtures. Locked `goals/schema-parity-integration/goals.v3.md` superseded the earlier isolated-target selection for ordinary behavior tests. Every fixture DML statement routes through the explicit transaction executor; global repository SQL does not automatically enlist. Complete rollback and fixture absence/private application fingerprints are verified. No runtime initializer or test trigger runs on application tables. The genuine multi-session/fault exception was pending at v3 and is explicitly approved/resolved by v4 above.

The v2 migration and successful isolated-run evidence below remain accurate historical results. Their target is superseded for ordinary final acceptance. The v3 ordinary harness was independently reviewed before fixture DML and passed three actual-schema rollback rounds, detailed below. Its pending-exception limitation was resolved in v4; final full coverage is recorded at the end.

## Prior v2 authorization and target record (superseded for ordinary tests)

The user requested an audit of in-memory/PostgreSQL contract alignment, current upgraded-schema integration coverage, and efficient tests with low-value duplication removed. This approves bounded fixes and validation. Locked concrete goals are in `goals/schema-parity-integration/goals.v2.md`; v0/v1 retain the initial scope history. Independent audit established that actual-application rollback cannot safely enclose global SQL calls, multiple sessions and fault triggers. The safe default is one isolated current-schema namespace per file where safe, preserving real race tests. Actual `orgs` receives read-only behavior/preflight and only the targeted two-CHECK maintenance described below. The prior explicit user maintenance request and current alignment request authorize that narrow missing-object correction without repeated approval.

Write ownership covers these task goals/spec and verification infrastructure; parent assigns app/test changes. Preserve previous task history, the uncommitted availability repository/test/new migration, the user's `.gitignore` edit, unrelated `database/test-data` and all other existing artifacts. No env edit, migration application beyond the reviewed two-CHECK correction, persistent application-row change, commit or push is in scope.

## Preflight baseline

- Branch: `ericp/verified-paid-order`; no branch/index mutation requested.
- Existing tracked modifications: `.gitignore`, `packages/backend/src/customer/customer-availability-repository.ts`, `packages/backend/tests/customer-availability-repository.test.ts`.
- Existing in-scope untracked availability artifacts include `database/migrations/20261023030000_customer_festival_availability.sql` and `packages/backend/tests/postgres-customer-availability.integration.test.ts`; retain these and prior task directories.
- At task start, preceding maintenance had verified PostgreSQL 17.11 application schema `orgs`, 67 tables, targeted migrations committed, prior data preserved and rollback fixtures absent. Later discovery/correction of two missing webhook CHECKs and this task's reviewed rollback validation are recorded below.
- The private loader convention uses Bun `--env-file=./database.env`, avoids inherited `FESTIVAL_DB` shadowing, maps the value only into test-process database environment variables, and sanitizes captured output. Reuse that convention after target selection; do not invoke the prior legacy-test runner unmodified.

## Concrete audit scope

- Four proved native JSONB-binding paths: checkout repertoire, customer mailing address, registration-change prior/new state, and communication variables/payload.
- Three proved in-memory parity defects: cart organization guard, metadata unique ID/line rejection, and earliest consent selection.
- Integration cleanup removes legacy schema reconstruction, upgrade/backfill and migration-reapply cases. Preserve raw JSONB shape, immutable snapshot round trips, identity/scoping/security contracts, ownership guards, genuine multi-session capacity races and fault-trigger regressions.
- Reuse one current-schema namespace per file where fixture isolation permits. Namespace creation uses canonical current schema setup once, not historical migration replay. Only generated task-owned namespaces may be written/dropped; actual application `orgs` is read-only.
- Historical suite results are sufficient for the runtime baseline; collect structural before/after setup counts without rerunning legacy migration cases. Report the workload difference explicitly rather than claim a strictly identical runtime workload.

## Observable-contract audit matrix

| Contract area | Audit outcome | Verification boundary |
| --- | --- | --- |
| Customer availability | Normalized arrays and observable ownership/scoping behavior aligned after the prior JSONB fix | Retain raw JSONB shape, empty/nonempty/update/batch and scoped behavior checks |
| Registration snapshots | Immutable history and known/unknown instrument behavior aligned after prior work | Retain current-schema raw object storage and snapshot round-trip behavior; retire historical reconstruction/backfill cases |
| Checkout repertoire | PostgreSQL JSONB string encoding corrected to native values | Focused unit and actual PostgreSQL raw-value/round-trip coverage passed |
| Customer mailing address | PostgreSQL JSONB string encoding corrected to native values | Focused unit and actual PostgreSQL raw-value/round-trip coverage passed |
| Registration-change prior/new state | PostgreSQL JSONB string encoding corrected to native values | Focused unit and actual PostgreSQL raw-value/round-trip coverage passed |
| Communication variables/payload | PostgreSQL JSONB string encoding corrected to native values | Focused unit and actual PostgreSQL raw-value/round-trip coverage passed |
| In-memory cart ownership | Missing organization guard corrected | Cross-organization rejection regression passed; existing grandfathered-cart fixture supplied its required tenant/customer context |
| In-memory registration metadata uniqueness | Unique ID/line rejection corrected to match PostgreSQL | Duplicate ID and populated/empty line rejection regressions passed |
| In-memory consent ordering | Earliest consent selection corrected to match PostgreSQL | Focused unit and actual PostgreSQL per-notice earliest-consent checks passed |
| Relational integrity and concurrency | PostgreSQL foreign keys and locks implement required database guarantees | These mechanisms are intentionally relational; an in-memory store need not literally reproduce database tables/locks. Preserve observable safety and genuine PostgreSQL race coverage |
| Remaining uncertainty | Timestamp mapping and expired-intent behavior are not exhaustively established by this audit | Do not claim universal repository parity or comprehensive equivalence beyond the audited paths |

## PostgreSQL-gated inventory

All backend test files containing `POSTGRES_INTEGRATION_URL` are included, including mixed unit/integration files whose names do not end in `.integration.test.ts`:

| File under packages/backend/tests | Lines | UUID schema sites | Direct initializer awaits | Migration file reads |
| --- | ---: | ---: | ---: | ---: |
| festival-class-bulk-lookup.test.ts | 155 | 1 | 0 | 0 |
| postgres-class-capacity-atomic.integration.test.ts | 171 | 1 | 1 | 0 |
| postgres-class-capacity-cutoff.integration.test.ts | 503 | 1 | 1 | 1 |
| postgres-commerce-repository.test.ts | 294 | 1 | 1 | 0 |
| postgres-customer-availability.integration.test.ts | 131 | 1 | 0 | 0 |
| postgres-registration-snapshot.integration.test.ts | 276 | 2 | 1 | 2 |
| postgres-schema.integration.test.ts | 208 | 3 | 4 | 0 |
| postgres-targeted-entitlement-filters.integration.test.ts | 151 | 1 | 1 | 0 |
| repertoire-repository.test.ts | 611 | 1 | 0 | 0 |

These are read-only source counts, not measurements of executed setup calls: helpers can repeat and repository `ensureReady()` can initialize indirectly. Source inspection of the prior 22 PostgreSQL cases establishes 22 namespace fixtures (including one minimal instrument-table namespace); the other cases initialize canonical schema directly or via repository readiness. Preserve this distinction when comparing final full-schema setup counts. Audit upgrade/backfill cases in schema, snapshot and cutoff files before consolidating; retain meaningful current round-trip, identity, isolation and concurrency checks.

The preceding successful suite is a historical baseline: nine bounded Bun processes, 34 tests/259 assertions (22 PostgreSQL cases and 12 mixed-file unit cases), zero failures/skips. Reported per-process durations were 206, 150, 1135, 161, 140, 183, 373, 255 and 150 milliseconds, totaling 2753 milliseconds. They are not a fresh comparable benchmark for the pending target. Measure comparable before/after setup counts and elapsed runtime once target/harness/workload are pinned.

## Verification plan

Run commands from the repository root through native PowerShell. No direct `.sh` execution or external bootstrap/config changes.

- Goal/preflight: `& ./tasks/schema-parity-integration/workflow.ps1 -Iteration v4`
- Toolchain: `bun run verify:toolchain`
- Lint: `bun run lint`
- Format: `bun run format:check`
- SQL: `bun run check:sql`
- Build sequentially: `bun run build:common`, then `bun run build:backend`
- Focused contract regressions without private DB env: `bun test packages/backend/tests/checkout-repository.test.ts packages/backend/tests/postgres-checkout-repository.test.ts packages/backend/tests/customer-account-repository.test.ts packages/backend/tests/communication-repository.test.ts packages/backend/tests/registration-change-repository.test.ts packages/backend/tests/customer-availability-repository.test.ts packages/backend/tests/customer-availability.test.ts`
- Full current-schema PostgreSQL suite: `& ./tasks/fix-availability-jsonb/run-postgres-tests.ps1` (default all 11 files; ordinary actual-orgs rollback plus approved current-only disposable race/fault namespaces). Optional `-ApplicationOnly` is the eight-file subset. No legacy upgrade tests or further migrations.
- Application preservation: `& ./tasks/schema-parity-integration/verify-application.ps1 -Phase before` and the same command with `-Phase after`; read-only repeatable-read transactions capture/compare private aggregate row counts and fingerprints for every `orgs` table, with no row/hash output. Final verification requires zero namespaces matching the helper's exact `^it_[a-z_]{1,24}_[a-f0-9]{32}$` pattern. These helpers never mutate the database.
- Under v3, final `after` verification also requires actual-application rollback UUID markers in all three measured-round logs and uses scalar-bound read-only queries outside those test transactions to confirm zero matching organization fixtures. No rollback evidence is a failure, so the superseded isolated logs cannot accidentally satisfy final target acceptance. Reviewer checked this SELECT-only verifier extension and found no actionable issue.
- Measured full PostgreSQL rounds: `& ./tasks/schema-parity-integration/measure-postgres.ps1 -Runner ./tasks/fix-availability-jsonb/run-postgres-tests.ps1 -Rounds 3`, after the owner freezes the reviewed full default runner. Historical v2/v3 rounds are archived separately.
- Final scope/whitespace: `git diff --check`, branch/status and changed-path inventory.

## Acceptance and evidence

| Goal | Evidence required | Status |
| --- | --- | --- |
| G1 parity | Paired observable-contract audit and focused regressions for proved drift | Four JSONB paths and three memory defects corrected; 72 focused tests/341 assertions passed |
| G2 current schema | User-selected target and final current-only gated inventory | PASS: all 11 files/32 cases, actual ordinary rollback plus all approved current-only race/fault cases, three complete rounds |
| G3 efficiency | Meaningful assertions preserved; measured setup/runtime and cleanup | PASS: four measured current namespace builds/eight actual rollbacks each round, all fixtures absent and application aggregates unchanged |
| G4 validation | Private selected-DB suite, proportional checks and preserved scope | PASS: complete suite three times, reviewed runner, prior global/full-backend checks valid, all scope/preservation checks passed |

No legacy suite was rerun. The only application DDL was the independently reviewed narrow two-CHECK correction below. Final v4 scope and validation are complete; no target question or required check remains pending.

## Historical validation timeline

- Frozen-production prechecks PASS: toolchain Bun 1.4.2/TypeScript 5.9.3; common then backend TypeScript builds; focused seven-file contract/availability suite 72 pass, zero failures, 341 assertions (Bun-reported 118 ms). Private `POSTGRES_INTEGRATION_URL`, `FESTIVAL_DB` and `DATABASE_URL` variables were removed from these test processes.
- Prior isolated-target checks passed: lint/format 413 package files; SQL 222 backend TypeScript files; `git diff --check` clean. Three isolated PostgreSQL rounds each passed all ten gated files, 32 tests/290 assertions, zero failures/skips and exactly ten actual current-schema initializer markers. This comprises 20 PostgreSQL cases and 12 ordinary mixed-file cases. Actual `orgs` catalog comparison passed after the reviewed CHECK correction.
- Prior isolated timing: runner wall 2818/2743/2700 ms; wrapper wall 3255.9/3089.8/3045.0 ms (includes fresh PowerShell). The matching historical sum-of-child-Bun-runtime metric was 2753 ms versus 2706/2647/2580 ms now (mean 2644 ms). Historical baseline has one run and changed workload, so this is descriptive evidence, not a controlled speedup claim. Namespace allocations fell from 22 (21 full-schema namespaces plus one minimal instrument fixture) to ten; current initializer markers prove ten actual current-schema initializations. Tests/assertions changed 34/259 to 32/290, preserving behavioral assertions and adding raw JSONB/catalog coverage.
- Full backend initially reported 1168 pass/20 skip/1 fail (4158 assertions): existing `class-order-projection` grandfathering fixture omitted required organization/customer context at two cart attachment calls, exposed by the corrected tenant guard. Owner supplied those fixture fields without weakening assertions. Independent focused rerun passed 24 tests/117 assertions, and full backend recovery passed 1169 tests/4162 assertions across 104 files (20 PostgreSQL-gated skips, zero failures, 2.01 s). Private DB environment variables were removed. Production guard remains intact; original failure and final recovery logs are retained separately.
- The verification timing wrapper `measure-postgres.ps1` is PowerShell-parser validated and records sanitized logs, per-round wall milliseconds and actual child exit codes; it does not load credentials or bypass the reviewed runner.
- Sanitized validation logs: `/private/tmp/schema-parity-integration-validation/`.
- Read-only private preservation baseline captured for all 67 application tables before final measured runs. One concurrent integration-owner fixture namespace existed at capture; final verification still requires zero matching namespaces. No application rows or fingerprint values were printed.
- After the three prior isolated rounds: read-only verification passed, all 67 application table counts/private fingerprints unchanged, zero matching isolated namespaces and zero new residual namespaces. Baseline remains retained for the user-selected final target.

## Narrow application CHECK maintenance

The substantive catalog comparison found only two missing canonical signatures in actual `orgs`: `shopify_webhook_deliveries.failure_stage` and `failure_code` CHECK constraints. All other required current catalog signatures matched, and no extra restrictive constraint/unique index was found. This supersedes v0/v1's no-DDL boundary only for those two absent CHECKs under existing user maintenance authorization.

Applied `20261023040000_webhook_failure_checks.sql` after parent and independent reviewer approved the exact canonical SQL. The guarded helper pins its SHA256, strips only the outer BEGIN/COMMIT, rechecks both CHECK names absent under schema advisory lock, enforces `lock_timeout=5s`/`statement_timeout=30s`, and refuses nonzero invalid stage/code counts. Both aggregate counts were zero. One transaction committed exactly the two validated canonical CHECKs; all 67 application-table counts/private fingerprints matched before/after. No row DML, runtime initializer, baseline replay or other migration ran. Post-migration actual catalog comparison passed in all three prior isolated suite rounds. Final target change does not undo this separately authorized completed maintenance.

## v3 actual-application ordinary subset results

- Independently reviewed and cleared before fixture DML: dedicated read-only actual catalog comparison first; seven ordinary files use real explicit outer transactions, guarded/scoped forwarding, savepoints, disabled readiness only after verified current schema, unconditional rollback, and outside-transaction UUID absence checks. No runtime initializer or test trigger ran on application tables. The canonical reference namespace is separate and dropped.
- All three rounds passed eight files, 21 tests/230 assertions, zero failures/skips: nine PostgreSQL-enabled cases (one catalog plus eight actual rollback cases) and 12 ordinary mixed-file cases. Each round emitted exactly one canonical reference initialization and eight completed real application rollback markers.
- Per-round runner wall: 608/407/407 ms. Sum of Bun-reported child durations: 562/368/367 ms. Fresh PowerShell wrapper wall: 989.1/712.7/711.2 ms. This is the actual ordinary subset, with concurrency/fault cases intentionally pending; it is not comparable to the complete historical 34-case suite as a controlled speedup benchmark. Ordinary application schema builds are zero; only the one read-only catalog reference schema is built per run.
- Independent SELECT-only verification outside test transactions checked all 24 logged rollback UUID prefixes, including any additional bulk-lookup organization IDs: zero organization fixture rows remain. All 67 application table counts/private fingerprints equal the original pre-test baseline. Zero matching isolated reference/exception namespaces remain; no row contents, hashes or credentials were logged.
- Final global quality: lint/format PASS for 417 package files; SQL PASS for 226 backend TypeScript files. Toolchain/common/backend builds remain passed with unchanged production sources. Full backend PASS: 1171 tests/4177 assertions across 106 files, 20 PostgreSQL-gated skips, zero failures (1.91 s), including the two SQL-guard regressions and corrected grandfathered-cart fixture.
- Expected branch `ericp/verified-paid-order`, no conflicts, `git diff --check` and v3 workflow validation PASS. User `.gitignore`, prior availability source/test/migration and unrelated artifacts preserved; no env edit, commit or push.
- Final independent review: zero actionable findings, `patch is correct`, confidence 0.92. Reviewed actual harness cleared before fixture DML; final evidence includes SQL guards, required tenant fixture correction and the read-only preservation verifier.
- Current logs/measurements: `/private/tmp/schema-parity-integration-validation/`. Superseded v2 isolated logs/measurements and aggregate verification artifacts are retained under its `isolated-v2/` subdirectory.
- At v3, `postgres-class-capacity-atomic.integration.test.ts`, `postgres-class-capacity-cutoff.integration.test.ts` and `postgres-commerce-repository.test.ts` (11 genuine multi-session/fault cases) were excluded pending the user's exception decision. V4 explicitly approved these current-schema disposable namespaces; none of the cases were retired, and all passed in the final full rounds below.

## Completed v4 full-suite verification

- Default runner: all 11 PostgreSQL-gated files, 32 tests/288 assertions in each of three rounds; zero failures, zero skips, zero not-run files. This includes all 11 approved race/fault cases, eight actual-application rollback cases, one read-only catalog case and 12 ordinary mixed-file cases. Application-only mode remains optional and clearly labeled.
- Every round recorded exactly four actual current-schema initializations (one catalog reference and three race/fault namespaces) and eight completed actual-application rollback transactions. No old-schema reconstruction, historical migration replay, application initializer or application-table fault trigger was used.
- Runner wall times: 1677/1480/1717 ms. Sum of Bun-reported child durations: 1606/1416/1644 ms. Fresh PowerShell wrapper wall times: 2118.5/1791.2/2029.5 ms. Historical setup used 22 namespace fixtures; final setup uses four, with ordinary schema construction eliminated. Workload and target changed and historical baseline has only one run, so no controlled speedup percentage is claimed.
- Independent read-only verification after all rounds: all 24 rollback UUID prefixes absent, including extra bulk-lookup organizations; all 67 application table row counts/private fingerprints unchanged from the original baseline; zero matching task-owned namespaces remain. No credential, row content or fingerprint value was logged.
- Final runner delta independently reviewed before execution: no findings, full/default inventory correct, optional subset correct, catalog fail-closed behavior/redaction/time bounds preserved. Integrated review verdict remains `patch is correct`, confidence 0.92. Reviewer confirmed all other reviewed production/test fingerprints unchanged when only the two runner files changed.
- Applicable prior quality checks remain PASS: Bun 1.4.2/TypeScript 5.9.3; common/backend builds; lint/format 417 package files; SQL 226 backend TypeScript files; focused production regressions; full backend 1171 pass/4177 assertions across 106 files (20 PostgreSQL-gated skips, zero failures). No redundant global/package rerun was performed for the runner-only delta.
- Final branch/status: `ericp/verified-paid-order`, no conflicts, `git diff --check` PASS. Existing user `.gitignore`, prior availability fix/new migration and unrelated untracked artifacts remain preserved and unstaged. No commit, push, env edit or further application DDL occurred.
- Goals v4 G1–G4 satisfied within the qualified observable-contract audit. Timestamp mapping/expired-intent behavior remains explicitly outside an exhaustive parity claim. No required work or exception decision remains pending.
