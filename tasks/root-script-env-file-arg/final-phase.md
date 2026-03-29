# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

- [ ] `/doc` audit and updates EVALUATED: not-applicable because this change only adjusts root shell wrappers and the repo has no `/doc` directory to update for this behavior.
- [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable because no API, auth, or schema contract changed.
- [ ] README updates EVALUATED: deferred because the user requested only script behavior and no documentation update was required to satisfy the locked goals.
- [ ] ADRs (if any) EVALUATED: not-applicable because this is not a durable architectural decision.
- [ ] Inline docs/comments EVALUATED: not-applicable because the shell changes are self-explanatory and do not need extra inline comments.

## Testing closeout
- [ ] Missing cases to add: EVALUATED: deferred because the behavior is shell-wrapper wiring and was covered by targeted stubbed command-shape checks plus full repo verification.
- [ ] Coverage gaps: EVALUATED: deferred because there is no automated shell-test harness in this repo for the root wrapper scripts.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run lint` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: completed via stubbed wrapper checks for `./scripts/run-dev.sh --env-file=/Users/eric/pafenorthwest/Festival/.env` and `./scripts/run-prod.sh --env-file=/Users/eric/pafenorthwest/Festival/.env`.
- [ ] Expected: EVALUATED: backend Bun invocations included the supplied `--env-file` argument while frontend/nginx invocations remained separate.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable because this is a backward-compatible local script enhancement.
- [ ] Feature flags: EVALUATED: not-applicable because no runtime feature flag is involved.
- [ ] Backout plan: EVALUATED: revert the two shell-script edits if the new arg parsing causes issues.

## Outstanding issues (if any)
- None.
