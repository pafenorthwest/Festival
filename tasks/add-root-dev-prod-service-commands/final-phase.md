# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

- [ ] `/doc` audit and updates EVALUATED: not-applicable; the repository has no `/doc` directory and this change only affects root startup commands plus README guidance.
- [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable; no YAML documentation contracts exist for this scripting/configuration change.
- [x] README updates
- [ ] ADRs (if any) EVALUATED: not-applicable; the change adds repo-local command wiring and nginx serving config without introducing a broader architectural decision record.
- [ ] Inline docs/comments EVALUATED: not-applicable; the added helper scripts and nginx config are self-contained without needing extra inline commentary.

## Testing closeout
- [ ] Missing cases to add: EVALUATED: deferred; full long-running startup smoke coverage would require a host environment with backend runtime variables and installed nginx.
- [ ] Coverage gaps: EVALUATED: accepted; repository verification covers static correctness, while socket-binding and nginx-backed runtime smoke tests remain environment-bound.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run lint` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: partially blocked; `bun run prod` was executed and confirmed fail-fast when `nginx` is missing, and `bun run dev:frontend` reached the frontend workspace Vite startup path before sandbox port binding was denied.
- [ ] Expected: EVALUATED: full serve checks require host port binding and a local `nginx` binary outside this sandbox.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [ ] Performance (DB queries, hot paths, batching) EVALUATED: not-applicable; the change only touches command wiring, documentation, and static frontend serving config.
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable; no data or API migration is involved.
- [ ] Feature flags: EVALUATED: not-applicable; command surface changes are always-on.
- [ ] Backout plan: EVALUATED: defined; remove the added root scripts, helper scripts, nginx config, and README updates.

## Outstanding issues (if any)
For each issue include severity + repro + suggested fix.
- None.
