# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

- [ ] `/doc` audit and updates EVALUATED: not-applicable because this repository does not use a `/doc` tree for the local setup flow covered by this task.
- [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable because no API, auth, or schema contract changes in this task.
- [x] README updates
- [ ] ADRs (if any) EVALUATED: not-applicable because this task documents an existing setup path rather than introducing a new durable architectural decision.
- [ ] Inline docs/comments EVALUATED: not-applicable because the touched markdown and env files are self-explanatory.

## Testing closeout
- [ ] Missing cases to add: EVALUATED: deferred because this task is documentation and env-sample alignment, not runtime behavior expansion.
- [ ] Coverage gaps: EVALUATED: deferred because repo verification relies on existing root lint/build/test commands rather than setup-specific automated checks.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run format:check` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: completed via document review of `README.md`, `SETUP.md`, `.env`, and `develop.env`, plus an attempted `gh issue create` for the remaining scriptable setup work.
- [ ] Expected: EVALUATED: docs and env files now agree on the setup contract, Postgres schema requirements are explicit, and the only remaining gap is GitHub issue creation auth.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable because no runtime migration is introduced.
- [ ] Feature flags: EVALUATED: not-applicable because no feature flag is involved.
- [ ] Backout plan: EVALUATED: revert the documentation and env-file sample edits if they prove inaccurate.

## Outstanding issues (if any)
For each issue include severity + repro + suggested fix.
- Medium: `gh issue create --title "Automate local setup bootstrap for env and Postgres" --body "..."`
  failed with `GraphQL: Resource not accessible by personal access token (createIssue)`.
  Repro: run the command from the repo root with the current `gh` authentication context.
  Suggested fix: authenticate `gh` with a token that can create issues for `pafenorthwest/Festival`, then rerun the command so the documented TODO follow-up is tracked in GitHub.
