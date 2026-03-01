# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates
- [x] `/doc` audit and updates
- [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable; this task documents Shopify references in Markdown and does not define YAML API contracts.
- [x] README updates
- [ ] ADRs (if any) EVALUATED: not-applicable; no durable architecture policy change requiring a new ADR.
- [x] Inline docs/comments

## Testing closeout
- [x] Missing cases to add: covered cart dependency, ensemble participant minimums, and eligibility filtering.
- [x] Coverage gaps: live Shopify/Stripe credential integration is intentionally mocked in automated tests.

## Full verification
> Use the pinned commands in spec + `project-structure.md` + `codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run lint` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: deferred; automated verification covered this change set.
- [ ] Expected: EVALUATED: deferred; no manual QA script defined for this repository yet.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable; no database migration in this iteration.
- [ ] Feature flags: EVALUATED: not-applicable; no feature-flag system is configured.
- [ ] Backout plan: EVALUATED: deferred; rollback is straightforward by reverting this changeset.

## Outstanding issues (if any)
- None.
