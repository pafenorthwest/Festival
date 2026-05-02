# Phase 5 — Hardening and Full Verification

## Objective
Run final quality gates, fix only in-scope failures, and record verification evidence for landing.

## Code areas impacted
- `packages/backend/src/**`
- `packages/backend/tests/**`
- `packages/common/src/**` and `packages/common/tests/**` only if touched earlier.
- `tasks/database-auth-foundation/final-phase.md`

## Work items
- [ ] Review changed auth/database code for fail-fast error handling, secrets handling, and SQL safety.
- [ ] Confirm no organization/membership/invite/role/frontend behavior was added.
- [ ] Run pinned lint command and fix in-scope failures.
- [ ] Run pinned build command and fix in-scope failures.
- [ ] Run pinned test command and fix in-scope failures.
- [ ] Record final verification results in `final-phase.md`.

## Deliverables
- Passing pinned verification or documented blocker evidence.
- Updated final-phase closeout evidence.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [ ] `bun run format:check` passes or blocker is documented.
- [ ] `bun run build` passes or blocker is documented.
- [ ] `bun run test` passes or blocker is documented.
- [ ] Final review finds no scope drift from locked goals.

## Verification steps
List exact commands and expected results.
- [ ] Command: `bun run format:check`
  - Expected: PASS.
- [ ] Command: `bun run build`
  - Expected: PASS.
- [ ] Command: `bun run test`
  - Expected: PASS.

## Risks and mitigations
- Risk: Full verification may expose unrelated pre-existing failures.
- Mitigation: Document evidence and only fix failures caused by in-scope changes.
- Risk: Formatting can touch broader files.
- Mitigation: Prefer scoped fixes and inspect diffs before landing.
