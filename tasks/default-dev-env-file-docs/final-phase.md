# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

- [ ] `/doc` audit and updates EVALUATED: not-applicable because this change updated root development docs in `README.md` and the repo does not use a `/doc` tree for this workflow.
- [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable because no API or schema contract changed.
- [x] README updates
- [ ] ADRs (if any) EVALUATED: not-applicable because default env-file wiring for local development is not a durable architecture decision.
- [ ] Inline docs/comments EVALUATED: not-applicable because the shell changes remain clear without added inline comments.

## Testing closeout
- [ ] Missing cases to add: EVALUATED: deferred because the repo has no dedicated shell-script test harness; command-shape validation was done with stubbed `bun`.
- [ ] Coverage gaps: EVALUATED: deferred because automated verification covers repo TypeScript surfaces while shell wrapper behavior is validated manually.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run lint` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: completed with stubbed command-shape checks for `bun run dev:backend`, `./scripts/run-dev.sh`, and `./scripts/run-dev.sh --env-file=/custom/.env`.
- [ ] Expected: EVALUATED: backend dev commands used the repo-root `.env` by default and the explicit override replaced that default path cleanly.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable because this is a backward-compatible local-development default.
- [ ] Feature flags: EVALUATED: not-applicable because no runtime feature flag is introduced.
- [ ] Backout plan: EVALUATED: revert the `package.json`, `scripts/run-dev.sh`, and documentation changes if the default path is undesirable.

## Outstanding issues (if any)
- None.
