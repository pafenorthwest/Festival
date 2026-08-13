# Phase 9 — Acceptance Audit and Canonical Verification

## Objective

Audit the final implementation against every locked goal/non-goal and obtain fresh canonical lint, build, and test evidence before `READY TO LAND`.

## Code areas impacted
- All files changed in Phases 1–8
- `goals/tenant-bound-shopify-secret-keyring/goals.v0.md` (read-only lock source)
- Task lifecycle artifacts

## Work items
- [ ] Map each changed source/test/doc artifact to G1–G13 and an approved phase.
- [ ] Confirm `IN SCOPE`/`OUT OF SCOPE` still match `.scope-lock.md` exactly.
- [ ] Confirm no DB schema/migration, legacy read, re-encryption, key retirement, #75 behavior, general encryption, external service/package, or UI expansion entered the diff.
- [ ] Confirm both-absent, partial/invalid, key-ID, envelope, AAD, active/previous-key, service-binding, and redaction criteria have current evidence.
- [ ] Confirm no prohibited material appears in tracked fixtures/docs/output.
- [ ] Run fresh canonical commands and record pass evidence in `final-phase.md`.

## Deliverables
- Requirement-by-requirement completion audit.
- Fresh lint/build/test evidence.
- Implementation-stage verdict based on current evidence.

## Gate (must pass before proceeding)
- [ ] Every locked goal and success criterion is proven.
- [ ] No drift or missing/stale verification remains.
- [ ] Canonical lint, build, and tests pass.

## Verification steps
- [ ] Command: `bun run format:check`
  - Expected: PASS.
- [ ] Command: `bun run build`
  - Expected: PASS.
- [ ] Command: `bun run test`
  - Expected: PASS.
- [ ] Command: `/Users/eric/.codex/scripts/implement-validate.sh tenant-bound-shopify-secret-keyring`
  - Expected: `READY TO LAND` only after all final checklist evidence is populated.

## Risks and mitigations
- Risk: narrow crypto tests are mistaken for full runtime completion.
- Mitigation: require configuration, composition, service, route, redaction, documentation, and all canonical command evidence.
