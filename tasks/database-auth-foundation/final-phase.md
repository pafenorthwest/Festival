# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

* [x] `/doc` audit and updates

  * [x] Enumerate documentation artifacts under `/doc` that are impacted by this change (API behavior, auth, error contracts, examples, migrations, ops notes). Result: no `/doc` or `/docs` files exist in this repository.
  * [ ] Update affected docs and ensure cross-links remain valid (README ↔ docs ↔ ADRs/runbooks). EVALUATED: not-applicable because no documentation artifacts exist under `/doc` or `/docs`.

* [x] YAML documentation contracts (`/doc/**/*.yaml`)

  * [x] Discover all YAML documentation files under `/doc` (recursive) and update any impacted by the change. Result: no `/doc/**/*.yaml` files exist.
  * [ ] If a YAML contract/spec is required for this change but no matching file exists yet: EVALUATED: not-applicable because issue #16 acceptance criteria do not require creating OpenAPI/YAML documentation.

* [ ] README updates EVALUATED: not-applicable because the locked goals do not include README/API documentation updates and no existing documentation index exists to refresh.

  * [ ] Add or refresh a single “Documentation” section linking to `/doc/` and any key YAML specs within it. EVALUATED: not-applicable because no `/doc/` artifacts exist.
  * [ ] Include local validation/viewing instructions if the repo has them (lint/validate/render command). EVALUATED: not-applicable because no docs validation command exists.

* [ ] ADRs (if any) EVALUATED: not-applicable because no ADR directory/files exist and the change follows issue-specified architecture.

  * [ ] Add/update an ADR when the change introduces a durable architectural decision (contract format, versioning policy, auth strategy, error envelope standardization). EVALUATED: not-applicable; no ADR convention exists in-repo.

* [x] Inline docs/comments

  * [x] Update inline comments/docstrings only where they add implementation clarity without duplicating the YAML contracts. Result: no new inline comments were needed.

## Testing closeout
- [x] Missing cases to add: none identified for locked goals.
- [x] Coverage gaps: no live Firebase/Postgres integration test is present in the canonical test setup; repository fakes and schema assertions cover the issue requirements without live external services.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run format:check` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: not-applicable because this backend-only issue has no frontend/manual UI flow in scope.
- [ ] Expected: EVALUATED: not-applicable because automated route tests cover the new backend API behavior.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [x] Migration plan: app-user and login-event schema changes are applied by the Postgres app-user repository readiness path before `/api/v1/auth/*` endpoints use the tables.
- [ ] Feature flags: EVALUATED: not-applicable because the locked goals did not require feature flags.
- [x] Backout plan: stop routing `/api/v1/auth/*` and preserve or manually migrate `app_user` / `user_login_event` data according to operational retention needs before dropping tables.

## Outstanding issues (if any)
- None.
