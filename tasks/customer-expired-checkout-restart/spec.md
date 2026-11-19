# Customer restart after unpaid checkout expiry

## Goal reference

- `goals/customer-expired-checkout-restart/goals.v0.md` (locked).
- The user approved the six goals with "Approve and implement" on 2026-11-15. The establish-goals artifact records that approval; extraction and validation returned `GOALS LOCKED`.

## Scope

### In scope

- An explicit customer action restores saved registrations from an eligible expired, unpaid checkout with a known attached Shopify cart, scoped to its authenticated owner, organization, and festival, without silently discarding current edits or unrelated cart items.
- One durable, atomic, idempotent replacement identity per source checkout, with current checkout validation before Shopify handoff and recovery after navigation or reload.
- Preserve original creation, expiration, recovery-recording, and existing execution-event timestamps. Append new restart audit evidence and a durable source-to-replacement link; give each replacement its own identity and timestamps.
- Reject unsafe ownership/festival, payment, entitlement, review, unknown-create, and running/recovery states.
- Late verified payment on a superseded source remains recorded for review/reconciliation without duplicate grants or capacity allocation across linked replacements, including edited/merged carts and repeated restart chains.
- Customer-facing expired/review messages, saved-item review, explicit restart, and checkout handoff, with targeted regression coverage.

### Out of scope

- Automatic refunds, Shopify order cancellation, or payment mutation.
- Extending/replacing original expiry or rewriting historical timestamps/events.
- General persistence for unrelated draft carts, pricing or capacity-policy changes, unrelated checkout refactors.
- Deployment, live checkout corrections, commits, or pushes during implementation bootstrap.
- Pre-existing user edits in `AGENTS.md` and `bun.lock`.

## Approach

- Reuse the current checkout execution, recovery, and payment guards. Carry replacement lineage durably so payment safety does not depend only on unchanged cart content or request keys.
- Serialize edits to tightly coupled checkout files. Parent owns integration and final verification; independent bounded implementation/review/test tracks follow repository delegation instructions.
- Existing checkout is reused at `/Users/eric/pafenorthwest/Festival`, branch `main`, initial HEAD `981bc94` (merge of auth-checkout-boundaries PR #408). No new branch or worktree was required or created for bootstrap.
- Initial dirty entries were `AGENTS.md` and `bun.lock`. Continue with those unrelated user changes preserved and excluded from task ownership. Goal documents and a single new manifest row are task-owned changes.

## Verification commands

Run from `/Users/eric/pafenorthwest/Festival` using `/opt/homebrew/bin/bash`, Bun 1.4.2, and TypeScript 5.9.3, unless an explicit working directory is stated. The pinned gates below completed. Integration verification used a separate PostgreSQL 17.11 cluster under `/private/tmp`, never the diagnosed business database. Bun automatic environment loading was disabled for the full integration run.

```bash
bun run verify:toolchain
bun run format:check
bun run lint
bunx --bun tsc -p packages/backend/tsconfig.json --noEmit
bun run --cwd packages/frontend check:types
bun run check:sql
bun run build:common
bun run build:backend
bun run build:frontend
bun run build:confirmation
```

The parent's exact final backend test invocation, with working directory `/Users/eric/pafenorthwest/Festival/packages/backend`, was:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp DATABASE_URL='postgresql://festival_test@127.0.0.1:59640/festival_test?sslmode=disable' POSTGRES_INTEGRATION_URL='postgresql://festival_test@127.0.0.1:59640/festival_test?sslmode=disable' bun --no-env-file test > /private/tmp/festival-expired-backend-full-final.log 2>&1
```

Equivalent reproducible isolated invocations for the other reported package suites are below; use each package as the working directory. The exact final backend command above is retained verbatim rather than reconstructed.

```bash
# Working directory: packages/common
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp bun --no-env-file run test
# Working directory: packages/frontend
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp bun --no-env-file test
# Working directory: packages/shopify-confirmation
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp bun --no-env-file run test
```

That URL identifies only the disposable trust-authenticated test cluster; it contains no production credential. The integration fixtures provision randomized owned `it_*` schemas, guard resets to owned schemas, and drop their schemas on completion. No migration or persistent schema change was needed, so schema-parity regeneration was not applicable. The parent stopped the scratch PostgreSQL cluster cleanly after final verification.

## Locked-goal evidence

| Goal | Delivered behavior and passing evidence |
|---|---|
| G1 | Explicit customer restart restores saved registrations for review and reruns current eligibility before Shopify handoff. `class-checkout-service.test.ts`: "discovers and concurrently restarts an expired two-line checkout without rewriting its history". Frontend hook scenarios `expired-current` and `expired-merged` verify explicit action, preserved edits/unrelated items, no handoff during restore, and eligibility recheck before checkout. |
| G2 | The source's appended audit event persists its replacement UUID; repeated/concurrent restart requests reuse it. `postgres-class-checkout-recovery.integration.test.ts`: "expired attached customer restart preserves original history and converges concurrent requests". `class-checkout-service.test.ts`: "restores canonical edited replacement snapshots after reload and resumes one intent across renewed owner sessions", "restores all frozen replacement selections in order even after partial metadata persistence", and "keeps an audited expiry restart discoverable after a lost restart response and status refresh". Frontend `expired-submitted-reload` verifies exact submitted payload/key restoration in a new application instance. |
| G3 | Restart supersedes the old intent, rejects its execution, and appends its replacement link without rewriting original creation, expiry, recovery-recording, or pre-existing event timestamps. The PostgreSQL history/concurrent-restart test and all three `postgres-expired-checkout-restart-payment.integration.test.ts` cases compare those immutable records before/after restart and payment. |
| G4 | Owner, organization, festival, expiry, active execution, uncertain-create, payment, and review guards remain enforced. Service test "exposes expiry restart in status and preflight but rejects wrong owner, festival, and observed payment"; PostgreSQL "expired attached restart refuses" cases for unexpired/running/unknown/needs_review/order/decision, plus stale-source rejection. Route test "accepts deployed CCR and legacy UUID references and the returned replacement UUID at checkout" exercises actual reference formats; unauthenticated/cross-origin/malformed restart tests retain request guards. |
| G5 | Payment on a superseded source is recorded for review without another grant or capacity allocation. PostgreSQL payment tests: "late source payment before replacement handoff remains reviewable and blocks the replacement"; "a paid replacement keeps its single allocation when the expired source is paid and deliveries replay"; "restart and source payment serialize so a replaced checkout cannot also receive a grant". Service tests cover edited replacements, payment during status/replay Shopify lookup, and "fences late ancestor payment across repeated expired replacements" before/during handoff. |
| G6 | Expiry copy offers saved-item review/restart while uncertain or paid outcomes retain staff-review guidance and the reference. `checkoutRecoveryPresentation.test.ts` covers both messages. Hook scenarios `expired-reload`/`expired-submitted-reload` exercise new application instances, pagehide/pageshow, saved-item restoration, and explicit subsequent Shopify handoff; `restart-blocked`/`restart-unknown-blocked` preserve staff recovery. `registrationCartState.test.ts` verifies retained replacement identity and current selections through edits/merges. |

Backend tests above are under `packages/backend/tests`; frontend tests are under `packages/frontend/tests` (hook scenarios in `fixtures/class-checkout-hook.ts`).

## Delivery

- Delivered: customer restart for unpaid expired attached checkouts; durable replacement identity and ancestor fencing; canonical saved-selection recovery after edits, partial metadata persistence, navigation, reload, and owner-session renewal; actual CCR/legacy UUID request support; clear expiry/review messaging; PostgreSQL late-payment/replay/race coverage. The customer reviews restored registrations before explicitly submitting the next checkout.
- Bootstrap: `implement-bootstrap.sh` resolved to `/Users/eric/.codex/scripts` because repository-local implementation scripts were unavailable. The initial sandbox attempt failed at `mktemp` for `/Users/eric/.codex/codex-config.yaml.tmp.*` with `Operation not permitted`. The parent then reran the global bootstrap with escalation and reported success: `CODEX_ROOT=/Users/eric/.codex`, `CODEX_SCRIPTS_DIR=/Users/eric/.codex/scripts`.
- Exceptions: none requiring a source change; the non-blocking stale-worktree cleanup warning below remains outside task scope.
- Preflight: global `implement-preflight.sh customer-expired-checkout-restart main` returned `IMPLEMENT PREFLIGHT READY` with five dirty entries, no reported merge conflicts, and matching branch. Its `git worktree prune` emitted an `Operation not permitted` warning for stale `.git/worktrees/festival-pr-273-review`; no cleanup is part of this task.
- Deferred work: deployment and any live checkout correction were not requested for this implementation. No commit or push occurred. Late old payment remains visible for staff review; no automatic refund or Shopify order mutation is performed.
- Dirty-worktree decision: continue; preserve pre-existing `AGENTS.md` and `bun.lock` edits and restrict task ownership to approved checkout paths plus task/goal documentation.

## Quality gate results

- Toolchain: passed Bun 1.4.2 / TypeScript 5.9.3 verification.
- Format and lint: final global Biome check and lint passed for 814 files. SQL static check passed for 505 backend TypeScript files. Backend/frontend no-emit type checks passed; final backend build/type check passed after helper extraction.
- Build: common, backend, frontend, and confirmation production build stages passed. Backend maintenance scripts bundled successfully.
- Tests: backend **1,742 passed, 0 failed, 10,191 assertions across 154 files** against isolated PostgreSQL 17.11 (`/private/tmp/festival-expired-backend-full-final.log`, 19.75 seconds). Common **365 passed across 23 files**; frontend **522 passed across 60 files**; confirmation **20 passed across one file**. Combined: **2,649 passing tests across 238 files**. No live business database was used for tests.
- Code review: completed independently against the final task-owned diff. `code-review.md` records no findings, verdict `patch is correct`, confidence `0.88`; review validation returned ready.
- Local completion check: final `git diff --check` passed; no unresolved conflicts were reported in preflight. The existing user edits in `AGENTS.md` and `bun.lock` remain excluded. No merge, commit, push, deployment, or live-record correction was performed.


## Final landing validation — 2026-11-15

At the user's request to commit, push, and open a PR, the verification subagent reran the pinned quality gates against the final source. No source files changed during this verification. Every command below returned exit code 0. Commands used a clean inherited-variable environment and disabled Bun automatic environment-file loading; the integration URL identifies only the previously provisioned disposable PostgreSQL 17 cluster.

For each command below, the environment prefix was exactly `env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp`. The working directory was the repository root unless listed otherwise. Standard output and standard error were redirected to the indicated log.

| Gate | Exact executable command after the environment prefix | Working directory | Log under `/private/tmp/` |
|---|---|---|---|
| Toolchain | `bun --no-env-file scripts/verify-toolchain.ts` | repository root | `festival-expired-land-toolchain.log` |
| Format | `bun --no-env-file x biome check packages` | repository root | `festival-expired-land-format.log` |
| Lint | `bun --no-env-file x biome lint packages` | repository root | `festival-expired-land-lint.log` |
| Backend types | `bun --no-env-file x tsc -p packages/backend/tsconfig.json --noEmit` | repository root | `festival-expired-land-types-backend.log` |
| Frontend types | `bun --no-env-file x tsc -p packages/frontend/tsconfig.json --noEmit` | repository root | `festival-expired-land-types-frontend.log` |
| SQL static check | `bun --no-env-file scripts/check-sql.ts` | repository root | `festival-expired-land-sql.log` |
| Common build | `bun --no-env-file run build` | `packages/common` | `festival-expired-land-build-common.log` |
| Backend build | `bun --no-env-file run build` | `packages/backend` | `festival-expired-land-build-backend.log` |
| Frontend build | `bun --no-env-file run build` | `packages/frontend` | `festival-expired-land-build-frontend.log` |
| Confirmation build | `bun --no-env-file run build` | `packages/shopify-confirmation` | `festival-expired-land-build-confirmation.log` |
| Common tests | `bun --no-env-file test` | `packages/common` | `festival-expired-land-test-common.log` |
| Frontend tests | `bun --no-env-file test` | `packages/frontend` | `festival-expired-land-test-frontend.log` |
| Confirmation tests | `bun --no-env-file test` | `packages/shopify-confirmation` | `festival-expired-land-test-shopify-confirmation.log` |

The exact backend test command, with working directory `packages/backend`, was:

```bash
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp DATABASE_URL='postgresql://festival_test@127.0.0.1:59640/festival_test?sslmode=disable' POSTGRES_INTEGRATION_URL='postgresql://festival_test@127.0.0.1:59640/festival_test?sslmode=disable' bun --no-env-file test > /private/tmp/festival-expired-land-test-backend.log 2>&1
```

Final results:

- Toolchain matched Bun 1.4.2 and TypeScript 5.9.3.
- Global format and lint passed for 814 files; SQL check passed for 505 backend TypeScript files. Both no-emit type checks passed. All four production builds passed; backend and confirmation bundles completed.
- Backend: **1,742 passed, 0 failed, 10,190 assertions, 154 files** (20.40 seconds), including PostgreSQL integration tests.
- Common: **365 passed, 0 failed, 1,328 assertions, 23 files**.
- Frontend: **522 passed, 0 failed, 2,978 assertions, 60 files**.
- Confirmation: **20 passed, 0 failed, 29 assertions, one file**.
- Combined: **2,649 passing tests across 238 files**. No suite was skipped as a gate and no live business database was used.
- The verifier restarted only `/private/tmp/festival-checkout-test-pg.SsJP92/data` on port 59640 using PostgreSQL 17 `pg_ctl`. After tests completed successfully, `pg_ctl -D /private/tmp/festival-checkout-test-pg.SsJP92/data -m fast -w stop` returned `server stopped`. Disposable integration fixture schemas were cleaned up by their test hooks. No live-record changes, git mutations, or deployment occurred during verification.
