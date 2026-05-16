# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

* [ ] `/doc` audit and updates EVALUATED: not-applicable - no `/doc` or `/docs` files exist in this repository, and the locked task did not require creating external API documentation.

  * [ ] Enumerate documentation artifacts under `/doc` that are impacted by this change (API behavior, auth, error contracts, examples, migrations, ops notes). EVALUATED: not-applicable - no `/doc` tree exists.
  * [ ] Update affected docs and ensure cross-links remain valid (README ↔ docs ↔ ADRs/runbooks). EVALUATED: not-applicable - no affected docs exist.

* [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable - no `/doc/**/*.yaml` documentation contracts exist, and the task scope did not require introducing OpenAPI/YAML docs.

  * [ ] Discover all YAML documentation files under `/doc` (recursive) and update any impacted by the change: EVALUATED: not-applicable - no `/doc` tree exists.

    * [ ] endpoint definitions, request/response schemas, auth schemes, error models EVALUATED: not-applicable - no YAML contract exists.
    * [ ] examples (happy path + common failures) EVALUATED: not-applicable - no YAML contract exists.
  * [ ] If a YAML contract/spec is required for this change but no matching file exists yet: EVALUATED: not-applicable - no locked goal requires a YAML contract.

    * [ ] Create an initial YAML spec in `/doc/` using the repo’s conventions (OpenAPI/AsyncAPI/etc. as applicable) EVALUATED: not-applicable - no repo convention exists and no locked goal requires it.
    * [ ] Include minimum viable metadata (`info`, `servers`/environment targets, `securitySchemes` where relevant) plus at least one representative operation and shared error schema(s) EVALUATED: not-applicable - no YAML spec was required.

* [ ] README updates EVALUATED: not-applicable - no README change was required for the backend foundation behavior or verification commands.

  * [ ] Add or refresh a single “Documentation” section linking to `/doc/` and any key YAML specs within it. EVALUATED: not-applicable - no `/doc` tree exists.
  * [ ] Include local validation/viewing instructions if the repo has them (lint/validate/render command). EVALUATED: not-applicable - no documentation validation command exists.

* [ ] ADRs (if any) EVALUATED: not-applicable - no durable architectural decision beyond locked issue #20 scope required a new ADR.

  * [ ] Add/update an ADR when the change introduces a durable architectural decision (contract format, versioning policy, auth strategy, error envelope standardization). EVALUATED: not-applicable - no ADR surface exists.

* [ ] Inline docs/comments EVALUATED: not-applicable - implementation remained self-describing and did not need new inline comments.

  * [ ] Update inline comments/docstrings only where they add implementation clarity without duplicating the YAML contracts. EVALUATED: not-applicable - no clarity comment was needed.

## Testing closeout
- [x] Missing cases to add: added focused backend route tests for duplicate org conflict, membership listing, invite lookup status, non-member invite creation rejection, unknown invite token, and duplicate invite acceptance.
- [x] Coverage gaps: no known coverage gaps against locked issue #20 goals.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run format:check` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: not-applicable - backend API behavior is covered by automated route tests; no UI/manual flow is in scope.
- [ ] Expected: EVALUATED: not-applicable - no manual QA required for this backend-only task.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable - repository uses runtime initialization; Postgres initialization now drops the old single-user membership uniqueness constraint if present and creates the user/org uniqueness index.
- [ ] Feature flags: EVALUATED: not-applicable - no feature flag needed.
- [ ] Backout plan: EVALUATED: not-applicable - revert this changeset if rollback is required before release.

## Outstanding issues (if any)
- None.
