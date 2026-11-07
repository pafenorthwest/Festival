# Code Review
- Task name: schema-parity-integration
- Findings status: none

## Context

- Base: HEAD; review covers assigned task changes in the uncommitted diff plus new files, after explicit author freeze of the revised actual-application rollback harness.
- The user-selected mixed target (locked goals v4) uses upgraded actual `orgs` with rolled-back ordinary fixtures and all eleven genuine multi-session/fault cases in three explicitly approved disposable current-schema namespaces. The user approved that exception; no target/coverage approval remains pending. Earlier isolated-only and ordinary-only executions are historical. Final task acceptance still requires the complete approved mixed-target execution and preservation gates.
- Diff command: `git diff HEAD -- <assigned production/test paths>`; untracked helpers/tests/migration/verification files read directly. Prior availability code was context only. User .gitignore, database/test-data and unrelated task/goal artifacts were excluded.
- Instructions: root [AGENTS.md](/Users/eric/pafenorthwest/Festival/AGENTS.md:1) (only discovered AGENTS), user-provided core principles, [code-review skill](/Users/eric/.codex/skills/code-review/SKILL.md:1), and [goals.v4.md](/Users/eric/pafenorthwest/Festival/goals/schema-parity-integration/goals.v4.md:1).
- Preparation/validation used native PowerShell equivalents of `/Users/eric/.codex/scripts/code-review-validate.sh`, read rather than executed because AGENTS requires native PowerShell. This reviewer wrote only this report, with no DB/test execution, git/app/test-file/environment mutation or credential-file reads.

## Findings JSON
```json
[]
```

## Revised harness evidence

- [postgres-application-fixture.ts:31](/Users/eric/pafenorthwest/Festival/packages/backend/tests/postgres-application-fixture.ts:31) captures real begin/unsafe before spies. Actual catalog preflight is required before fixture DML; helper also independently reads required current columns/validated checks. One real transaction sets local lock/statement timeouts. Global unsafe and callback unsafe forward original SQL and bound values to that transaction. Repository begin becomes a real savepoint; reserve throws. Only explicitly registered repository instances suppress ensureReady, preventing application runtime schema initialization without modifying production code or fabricating query rows.
- Every reviewed ordinary case awaits its operations. [postgres-application-fixture.ts:90](/Users/eric/pafenorthwest/Festival/packages/backend/tests/postgres-application-fixture.ts:90) restores spies in finally, then throws a unique sentinel so successful fixtures also roll back. Only the identical sentinel is suppressed. An independent query outside the completed transaction checks both the generated organization prefix and explicitly tracked auto-created organization IDs. Other callback errors propagate after rollback/absence verification.
- Review initially found transaction-control bypasses in the proposed regex and lexer guards: block-comment-prefixed COMMIT, dollar signs in SQL identifiers hiding COMMIT, and CR line endings. They were reported before any actual fixture DML and fixed. Current [postgres-application-sql-guard.ts:4](/Users/eric/pafenorthwest/Festival/packages/backend/tests/postgres-application-sql-guard.ts:4) conservatively splits original SQL on every semicolon and allowlists each nonempty fragment's first verb. It does not skip comments/quoted text or rewrite forwarded SQL. Current fixed queries need no leading comments/literal semicolons; conservative false rejection is intentional. [postgres-application-sql-guard.test.ts:4](/Users/eric/pafenorthwest/Festival/packages/backend/tests/postgres-application-sql-guard.test.ts:4) includes the bypass regressions. No actionable guard finding remains.
- Seven converted files contain eight ordinary PostgreSQL behavioral cases. Reviewed raw reads/writes/counts are restricted to UUID-owned organizations/record IDs; globally unique product/variant IDs are UUID-derived. Snapshot renaming affects only fixture organizations; cart count and consent/availability reads are scoped. The global empty-string checkout-line PK fixture was removed from application tests while memory empty-line coverage remains. Expected raw CHECK failures execute in savepoints so the enclosing fixture can continue. Repository uniqueness failures already occur in repository savepoints.
- [postgres-application-catalog.integration.test.ts:10](/Users/eric/pafenorthwest/Festival/packages/backend/tests/postgres-application-catalog.integration.test.ts:10) creates one generated empty reference namespace for canonical catalog comparison only; actual application catalog access remains SELECT-only. Required table/column/default/nullability/type, constraints, indexes and trigger signatures must match; extra restrictive constraints/unique indexes are rejected. Reference cleanup remains namespace-owned.
- [run-postgres-tests.ts:31](/Users/eric/pafenorthwest/Festival/tasks/fix-availability-jsonb/run-postgres-tests.ts:31) requires/runs catalog preflight first, passes the verified marker only after success, and stops if preflight fails. Its default now includes every discovered gated file, including the three approved disposable current-schema concurrency/fault files. Read-only discovery confirms eleven full-suite files; optional `-ApplicationOnly` forwards `--application-only` and selects the eight-file ordinary subset. Logs identify the mode, redact configured credentials/connection URLs, and report actual passed/failed/not-run processes, initialization markers, rollback markers and wall time. Child processes remain bounded. Full-suite default is the final acceptance mode.
- [verify-application.ts:16](/Users/eric/pafenorthwest/Festival/tasks/schema-parity-integration/verify-application.ts:16) reads three measured-round logs and fails closed if any lacks rollback evidence. READ ONLY repeatable-read transactions compare all application table counts/private fingerprints, probe logged UUID organization prefixes using bound values, and require zero remaining generated namespaces. Bulk auto-created organization IDs also receive immediate independent helper probes. This reviewer did not execute preservation checks.

## Production and regression evidence

- Native JSONB values replace stringification for checkout repertoire insert/update, mailing addresses, registration audit states and communication template/event writes. Real raw JSONB type, extraction and containment checks accompany round-trip assertions.
- [checkout-repository.ts:323](/Users/eric/pafenorthwest/Festival/packages/backend/src/checkout/checkout-repository.ts:323) matches the SQL organization guard. [checkout-repository.ts:446](/Users/eric/pafenorthwest/Festival/packages/backend/src/checkout/checkout-repository.ts:446) rejects duplicate metadata IDs/non-null line IDs, including empty text in memory, matching primary-key/partial-uniqueness semantics without replacing existing records. [in-memory-customer-account-repository.ts:226](/Users/eric/pafenorthwest/Festival/packages/backend/src/customer/in-memory-customer-account-repository.ts:226) matches SQL LEAST for earliest consent per notice.
- [class-order-projection.test.ts:1564](/Users/eric/pafenorthwest/Festival/packages/backend/tests/class-order-projection.test.ts:1564) and line 1621 supply the correct organization/customer for the two preexisting grandfathering fixture attachments exposed by the new tenant guard. Assertions and production guard are retained.
- Independently reviewed [20261023040000_webhook_failure_checks.sql:1](/Users/eric/pafenorthwest/Festival/database/migrations/20261023040000_webhook_failure_checks.sql:1) before the separately authorized application. It adds exactly two canonical nullable CHECKs, with table/name existence guards and explicit validation in one transaction; predicates match initializer lines 534/535 and baseline dump lines 1141/1142. No DML/destructive statements. Execution preflight/timeouts/fingerprint evidence belongs to the verifier.
- Legacy reconstruction, upgrade/backfill/reapply cases were intentionally retired. Current snapshot/security/scoping checks remain; all eleven unchanged multi-session race/fault cases are retained and approved in disposable current-schema namespaces. Source inventory reductions retain identifier/no-row-mutation and portable dump guards.
- Before the final runner mode change, parent reported three successful ordinary actual-orgs rounds: eight files, 21 cases including nine PostgreSQL cases, one catalog-reference initialization and eight actual application rollback markers per round. Parent also reported 1171 backend tests and quality checks passed. These are historical partial-suite results. Final acceptance requires three full eleven-file/32-case rounds, 67-table preservation, rollback identifier absence and zero generated namespaces, all verifier-owned.
- `git diff --check` passed at final runner freeze. Comparison against all 31 prior reviewed SHA256 fingerprints confirmed only the two authorized runner files changed; production, ordinary actual rollback code and the three previously reviewed isolated race/fault files are unchanged. Reviewed both exact runner deltas and final locked v4 goals before notifying parent/verifier PASS for full execution. This reviewer did not execute DB operations or tests.

## Verdict
- Verdict: patch is correct
- Confidence: 0.92
- Justification: No unresolved actionable introduced defects remain in reviewed frozen production changes, actual-orgs rollback conversions, guard, catalog preflight, full-suite runner or bounded webhook CHECK migration. Reported guard defects were fixed and re-reviewed before actual DML. The user explicitly approved all eleven retained race/fault cases in three disposable current-schema namespaces. Final code review clears the complete mixed-target runner; task completion remains dependent on the verifier full-suite execution and application-preservation gates.

## Reviewed file fingerprints
- `packages/backend/src/checkout/checkout-repository.ts` SHA256 `f1af8957d06f5d161d6de6e551bdd1fe82f863f618812df6aa38dc6f32487163`
- `packages/backend/src/checkout/postgres-checkout-repository.ts` SHA256 `be7b1a518de32764266ebdd2790eeec476270e12021d017a482b138550f6236e`
- `packages/backend/src/customer/in-memory-customer-account-repository.ts` SHA256 `7fa15849f1e91013500616c2a479f8d36e14b739aac9404625086972f81ba185`
- `packages/backend/src/customer/postgres-customer-account-repository.ts` SHA256 `5edd23f6ebb058a3e53ab711ef03d86c28ca35b5c198ba3ed276e046ba41a52d`
- `packages/backend/src/registration/registration-change-repository.ts` SHA256 `a37bc97d402c6bbd1cfab15c5d8c8577a37935b3251a426979f70b658a9dfaa7`
- `packages/backend/src/communication/postgres-communication-repository.ts` SHA256 `19fe469754a6ec2648585aa65c94b864d12c53219d0c1ac3f4e4fef8353368c6`
- `packages/backend/tests/checkout-repository.test.ts` SHA256 `0a516407a91bf21410558aad18daa9f0bf7a642363a8393a5b360827c606a770`
- `packages/backend/tests/customer-account-repository.test.ts` SHA256 `2a57595b2084d1e1b3b4bc6dd2c34e6e0877c6bf71da4ec48ec9c18391cd7ae2`
- `packages/backend/tests/class-order-projection.test.ts` SHA256 `1eebc454fb622eeda52dfdc62587f43b95c7f48090ce0fb80f7bc57b58bcd39e`
- `packages/backend/tests/festival-class-bulk-lookup.test.ts` SHA256 `882223b68a6b43331664fea2d01c3f4d93d43d981734b4c334fca0cd4d73b517`
- `packages/backend/tests/postgres-class-capacity-atomic.integration.test.ts` SHA256 `7680479c2aa14ff1986ceb35e11b9aabccaa9fe156475372ebeffb860e288899`
- `packages/backend/tests/postgres-class-capacity-cutoff.integration.test.ts` SHA256 `ccf3ada7ef2bb6ad3b95cbddcccfee26ccc2faabf50957e8e4101b73d59605de`
- `packages/backend/tests/postgres-commerce-repository.test.ts` SHA256 `c426184435d53289bc688a7aef6c010bb148942b25e464cc73f1c60f36e48b6e`
- `packages/backend/tests/postgres-customer-availability.integration.test.ts` SHA256 `4af204d00954b6541e238ba1897f440e63cc7b8af94811ff1d6f70523b08ddad`
- `packages/backend/tests/postgres-registration-snapshot.integration.test.ts` SHA256 `2a795cedeac60e31c2f865b6dea2e83d0b7d01e98a6604e7d7af28997b75d198`
- `packages/backend/tests/postgres-schema.integration.test.ts` SHA256 `09bf4858b783a2726b2cb53a6d993701d871c5a5988fafbefa9b05e35f7715ad`
- `packages/backend/tests/postgres-targeted-entitlement-filters.integration.test.ts` SHA256 `3f9d0b6e20bb620b96072edefbe98428f609f37ef8382fda062d3d0d0fff53bb`
- `packages/backend/tests/repertoire-repository.test.ts` SHA256 `452c807d177df955b0cef0eabd46349cf721cd5b746c9c18a0aa979f8108abbb`
- `packages/backend/tests/postgres-jsonb-contract.integration.test.ts` SHA256 `a7cc43ff701503dc66137da16c3eedf9a8df695b9ce3be586ffe48973964a7c2`
- `packages/backend/tests/postgres-test-fixture.ts` SHA256 `344aac7cd85351e108142b9866d93064bd02e40798c30195027b0655a9295965`
- `packages/backend/tests/postgres-catalog-contract.ts` SHA256 `7ccbd4d36b30432d326104938f642d0ab9b99fd423b26d82346c0dee0a87586d`
- `packages/backend/tests/postgres-schema.test.ts` SHA256 `3a97d9900c3b715ec5be8ffcc45e4e4d2a86ea126578df82fbc719c0a7efdca8`
- `packages/backend/tests/postgres-schema-snapshot.test.ts` SHA256 `ac0db7eb8954f46b96eb0e82bed15935d43c849ba403cbaee14c14dc20ea8afe`
- `packages/backend/tests/postgres-application-fixture.ts` SHA256 `6af536de009b869b86d1f36e415896f9acfc563e6a3a9655a34ad43d232701fd`
- `packages/backend/tests/postgres-application-sql-guard.ts` SHA256 `0c3bea680cfed20d660fd0ba71ddfe3d63ff88cce7020255ce60f79c493aac57`
- `packages/backend/tests/postgres-application-sql-guard.test.ts` SHA256 `d0047e945a4e17bbdecdeb6f5e593ea978858a393c8b108d60c45e943060de28`
- `packages/backend/tests/postgres-application-catalog.integration.test.ts` SHA256 `aaa2d2e3d2584533a54c11a64e2e6ca89768389f8d0f45e703074bc1e81f71b9`
- `database/migrations/20261023040000_webhook_failure_checks.sql` SHA256 `b0a131a3ae3de160bdd965b4090afafceae21956e4ee2ccf2b0f7a2dab65daca`
- `tasks/fix-availability-jsonb/run-postgres-tests.ts` SHA256 `10bffc803f8edd2920082d28891a7e53f494bd1218a1cc40815beba42d7a3318`
- `tasks/fix-availability-jsonb/run-postgres-tests.ps1` SHA256 `2cb46a376aa62954f1c69b64af8e7e628bb0f6f7efdbef574b04b4dbe0cc00a3`
- `tasks/schema-parity-integration/verify-application.ts` SHA256 `9cca00ea3f738a88950741d13f387f912c83f15f0ca05425d3708a8dde56d9fc`
