# Verified paid-order registration completion (#147)

## Goal reference

- `goals/verified-paid-order-147/goals.v2.md` (locked v2, user-approved literal unknown instrument follow-up; v0/v1 remain immutable history).
- Issue: https://github.com/pafenorthwest/Festival/issues/147

## Scope

### In scope

- Audit #147 acceptance coverage and minimally complete confirmed registration snapshots and any proven gaps in the verified paid-order projection path.
- Shared registration types, migrations/schema/repositories, checkout metadata and paid projection where needed; meaningful tests of historical interpretation, payment authority, correlation, concurrency/replay/retry, placement and sensitive-data handling.
- Preserve completed #145/#28/#284 contracts.
- Add optional tenant-catalog `instrumentId` capture in the checkout API and a frontend selection when instruments are configured. Freeze selected instrument ID/name; preserve old clients and legacy rows as explicitly unknown rather than fabricating values.
- Follow-up: snapshot `instrument` is `{ id, name } | "unknown"`. Write the literal sentinel for unselected instruments and normalize null/missing instrument fields in prior existing snapshots. Preserve entirely absent/null historical snapshots; do not fabricate the remaining historical data.

### Out of scope

- #283 free waitlist, #29 parent UI, promotions, scheduling, performance work and unrelated refactors.
- Git commits/push/PR, publication/deployment, external bootstrap/config changes, shared manifest rewrites, unrelated worktree housekeeping.

## Approach

- Audit existing behavior first. Existing paid projection already creates confirmed entitlements; checkout metadata already captures repertoire and membership references. Reuse those paths and close demonstrated gaps.
- Separate immutable historical facts from mutable live selections and placement/lifecycle state, following existing repository conventions.

## Acceptance audit matrix

| Criterion | Existing evidence | Remaining gap / implementation | Final verification |
| --- | --- | --- | --- |
| Only verified payment, valid correlated tenant/customer/child intent lines create registrations | Existing verified Shopify read and tenant-scoped durable-line correlation in `shopify-order-projection-service.ts`; unpaid, missing payment timestamp, expired intent, customer, product/price/currency and malformed line rejection tests in `class-order-projection.test.ts:761` onward | Added explicit cross-tenant correlated-intent regression (`class-order-projection.test.ts:512`); payment validation remains unchanged | PASS: focused checks and final full root suite |
| Exactly one confirmed registration and placed outcome per purchased line; replay/reconciliation idempotency | Existing duplicate/concurrent/reconciliation tests (`class-order-projection.test.ts:673`, `703`, `735`), reordered/duplicate-variant multi-line correlation (`1117`, `1292`), plus `shopify-order-projection-service.test.ts:232` | Added paid-line snapshot-link test through replay/reconciliation (`class-order-projection.test.ts:316`); no new allocation algorithm | PASS: focused checks and final full root suite |
| Trusted attached carts paid above threshold remain placed; no paid-waitlisted allocation | Existing attached-cart above-capacity test (`class-order-projection.test.ts:1554`) and unattached-intent rejection (`1699`) | Preserved existing capacity/allocation context and confirmed result; no production placement changes | PASS: existing focused checks and final full root suite |
| Historical class/configuration, teacher, division, instrument, repertoire with optional movement/variation and accompanist selection remain interpretable | Existing metadata retained repertoire/membership references, but class/configuration and contact names were mutable joins and instrument was absent | Added versioned nullable `registration_snapshot`; trusted pre-checkout capture; optional tenant-catalog instrument selection; frozen IDs/names/configuration/repertoire; existing metadata edits cannot replace historical snapshot; entirely absent legacy snapshots remain NULL; instrument unknown is explicit | Checkout tests verify source edits, multi-line separation, malformed/inactive/foreign instrument rejection and return-value mutation isolation. Latest PostgreSQL 17 integration verifies standalone migration, runtime upgrade, legacy NULL, tenant reads, raw JSONB object storage, safe unknown backfill and insert/read/update preservation: 5 tests/35 assertions pass |
| Failure/retry and sensitive-data redaction | Existing safe decision/delivery diagnostics and retry handling | Added canary tests for upstream order-read and projection persistence failure, redaction, retry and replay (`class-order-projection.test.ts:568`); stored snapshot excludes tokens/email/phone | PASS: focused checks and final full root suite |

Instrument capture decision: the user explicitly confirmed, "Add instrument selection and snapshot it." This confirms the existing v1 scope, which initially proceeded under the original finish-#147 authorization and the stated implementation assumption; no semantic goal revision is needed. Accept optional `instrumentId`, expose selection when instruments are configured, validate tenant/catalog membership, and freeze selected ID/name. Old clients and legacy rows remain supported with explicit unknown values. No separate instrument blocker remains.

Approved v2 follow-up: the user requested a firm literal `"unknown"` instrument representation. Known instruments remain frozen ID/name objects. An existing snapshot's null or missing instrument field normalizes to this sentinel; the absence of an entire historical snapshot remains absent/null. This request is approval for the bounded representation change. Earlier uncommitted implementation changes on the same branch are intentional and must be preserved.

| Follow-up criterion | Implementation | Verification |
| --- | --- | --- |
| Required instrument union: known object or literal `"unknown"`; new unselected capture uses sentinel | Shared snapshot type requires the union; checkout initializes unselected instrument to the sentinel | PASS: capture regressions and full root suite |
| Prior null/missing instrument in existing snapshots normalizes; known values and other historical facts remain unchanged | Shared normalizer used by in-memory insert/read/update and PostgreSQL hydration; sequential SQL migration updates only null/missing instrument fields in snapshot objects | PASS: normalization compatibility tests and actual PostgreSQL migration tests; known objects and other fields remain unchanged |
| Entire absent/null legacy snapshots remain absent/null | Preserved existing legacy boundary; no reconstruction of missing historical facts | PASS: normalization/PG tests preserve whole NULL snapshot |
| PostgreSQL snapshot is a JSONB object; recover prior encoded objects safely | Bind snapshot object directly, avoiding Bun's string-to-JSONB string encoding. Migration unwraps only valid representable encoded JSON objects before sentinel backfill; unrelated invalid strings/scalars remain unchanged | PASS: raw jsonb_typeof/storage assertions, standalone idempotent migration, malformed/scalar-preservation tests and 5-test PG integration run |

## Verification commands

Run from `/Users/eric/pafenorthwest/Festival` using `/opt/homebrew/bin/pwsh`.

- Toolchain: `bun run verify:toolchain`
- Lint: `bun run lint`
- Format check: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`
- SQL checks, required if SQL/schema/migrations change: `bun run check:sql`
- Focused baseline regression: `bun test packages/backend/tests/class-order-projection.test.ts packages/backend/tests/shopify-order-projection-service.test.ts packages/backend/tests/class-checkout-service.test.ts`
- PostgreSQL snapshot/schema integration, with both `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` set to the disposable local test connection: `bun test packages/backend/tests/postgres-registration-snapshot.integration.test.ts packages/backend/tests/postgres-schema.integration.test.ts`
- Workflow/goal validation and read-only preflight: `& ./tasks/verified-paid-order-147/workflow.ps1`

These exact package scripts come from the repository package.json. Focused tests accelerate feedback and do not replace the pinned full checks. No direct .sh execution is required.

## Delivery

- Delivered: Immutable original selection snapshots for new registration checkouts linked to verified paid lines; optional tenant-catalog instrument selection through public options/UI/cart/API; nullable migration and independent runtime schema upgrade; literal `"unknown"` instrument contract with legacy read normalization and safe sequential SQL backfill; corrected direct-object binding for raw JSONB snapshot storage; targeted snapshot/correlation/redaction regression coverage. Existing payment-authority, idempotency and grandfathered-placement production behavior is preserved.
- Exceptions: PowerShell equivalent resolves and validates templates/goals/preflight. User's task-only mutation boundary overrides shell bootstrap/config sync, shared goal manifest rebuild and git worktree prune.
- Deferred work: Out-of-scope issues listed above.
- Dirty-worktree decision: continue on existing `ericp/verified-paid-order`; no tracked changes at initial preflight. Existing untracked directories under database/test-data, goals and tasks are unrelated and remain untouched and unstaged. New owned files are this task's artifacts, two timestamped snapshot/instrument migrations, PostgreSQL snapshot and normalization tests, and cohesive performance-options component. Application/test changes stay within the acceptance scope; no git staging/commit/push occurred.

## Prior v1 verification baseline

- Goal extraction/validation: v0 and v1 passed PowerShell workflow; each has 4 locked goals and 4 mapped criteria. v0 remains immutable. v1 covers optional tenant-catalog instrument capture under the original authorized issue scope.
- Branch/conflicts preflight: passed PowerShell workflow; expected branch `ericp/verified-paid-order`, no unresolved conflicts. Only unrelated existing untracked artifacts plus newly owned task artifacts were listed.
- Lint: passed final `bun run lint` (408 files).
- Format: passed final `bun run format:check` (408 files).
- Build: passed `bun run build`; frontend bundle-size advisory only.
- Tests: final `bun run test` PASS: common 281, backend 1159, frontend 332, confirmation 20 (1792 passed; 20 integration skips; zero failures). Recovery: updated exact public-response contract to include instruments and extracted cohesive performance controls to retain the unchanged page-under-500-lines rule. PostgreSQL 17 snapshot/schema integrations separately passed 4 tests/19 assertions against a fresh disposable loopback-only cluster; no existing DB used.
- SQL: passed `bun run check:sql` (217 backend TypeScript files).
- Code review: `patch is correct`, confidence 0.93, no findings; PowerShell review validation passed.
- Diff/scope: `git diff --check` passed. Unrelated untracked artifacts preserved. Validation logs at `/private/tmp/verified-paid-order-147-validation/`.
- Disposable PostgreSQL: stopped and removed only this task's unique temporary cluster after all checks passed; validation logs retained separately.
- Prior completion: locked v1 goals satisfied with final verification evidence before the approved v2 follow-up. No commit, push, PR, deployment or unrelated cleanup performed.

## Current v2 quality gate results

- Goal extraction/validation: PASS, `workflow.ps1 -Iteration v2` emits GOALS LOCKED (4 goals/4 criteria) and IMPLEMENT PREFLIGHT READY.
- Branch/worktree: expected `ericp/verified-paid-order`, no conflicts. Existing intentional in-scope changes and unrelated untracked artifacts preserved; no staging/commit/push.
- Focused capture/normalization tests: core's 98 focused tests and full root run pass. New compatibility cases cover missing/null/sentinel/known instruments, object/string reads, in-memory insert/read/update and absent whole snapshots.
- Lint/format: PASS, pinned `bun run lint` and `bun run format:check` (409 files).
- Build: PASS, `bun run build`; frontend chunk-size advisory only.
- Root tests: PASS, `bun run test`: common 281, backend 1170, frontend 332, confirmation 20; total 1803 passed/21 integration skips/zero failures.
- SQL: PASS, `bun run check:sql` (218 backend TypeScript files).
- PostgreSQL 17: PASS, snapshot/schema integrations 5 tests/35 assertions against a fresh disposable loopback-only cluster. New raw-storage assertion exposed the original encoded JSONB string binding; direct-object binding and safe legacy object recovery are now verified by actual SQL execution. No existing DB or .env credentials used.
- Independent code review: reviewer-owned final artifact reports `patch is correct`, confidence 0.95, no actionable findings. `git diff --check` PASS.
- Logs: `/private/tmp/verified-paid-order-147-v2-validation/`.
- Disposable PostgreSQL: after verification and independent review passed, stopped and removed only this task's unique v2 cluster and marker; validation logs retained separately.
- Completion: locked v2 implementation, pinned verification, independent review and isolated cluster cleanup complete. No commit, push, PR, deployment or unrelated cleanup performed.
