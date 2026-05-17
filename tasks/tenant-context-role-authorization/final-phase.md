# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

* [ ] `/doc` audit and updates EVALUATED: not-applicable; this repository has no `/doc` tree and the change does not introduce a new external API contract document.

  * [ ] Enumerate documentation artifacts under `/doc` that are impacted by this change (API behavior, auth, error contracts, examples, migrations, ops notes). EVALUATED: not-applicable; no `/doc` tree exists.
  * [ ] Update affected docs and ensure cross-links remain valid (README ↔ docs ↔ ADRs/runbooks). EVALUATED: not-applicable; no impacted docs exist.

* [ ] YAML documentation contracts (`/doc/**/*.yaml`) EVALUATED: not-applicable; no YAML documentation contracts exist in `/doc`.

  * [ ] Discover all YAML documentation files under `/doc` (recursive) and update any impacted by the change: EVALUATED: not-applicable; no `/doc` tree exists.

    * [ ] endpoint definitions, request/response schemas, auth schemes, error models EVALUATED: not-applicable; no `/doc` contracts exist.
    * [ ] examples (happy path + common failures) EVALUATED: not-applicable; no `/doc` contracts exist.
  * [ ] If a YAML contract/spec is required for this change but no matching file exists yet: EVALUATED: not-applicable; no locked goal requires creating `/doc` YAML contracts.

    * [ ] Create an initial YAML spec in `/doc/` using the repo’s conventions (OpenAPI/AsyncAPI/etc. as applicable) EVALUATED: not-applicable.
    * [ ] Include minimum viable metadata (`info`, `servers`/environment targets, `securitySchemes` where relevant) plus at least one representative operation and shared error schema(s) EVALUATED: not-applicable.

* [ ] README updates EVALUATED: not-applicable; no setup or user-facing README behavior changed.

  * [ ] Add or refresh a single “Documentation” section linking to `/doc/` and any key YAML specs within it. EVALUATED: not-applicable; no `/doc` tree exists.
  * [ ] Include local validation/viewing instructions if the repo has them (lint/validate/render command). EVALUATED: not-applicable.

* [ ] ADRs (if any) EVALUATED: not-applicable; no durable architecture decision beyond the locked Phase 0 implementation pattern was introduced.

  * [ ] Add/update an ADR when the change introduces a durable architectural decision (contract format, versioning policy, auth strategy, error envelope standardization). EVALUATED: not-applicable.

* [ ] Inline docs/comments EVALUATED: not-applicable; code is self-explanatory without new comments.

  * [ ] Update inline comments/docstrings only where they add implementation clarity without duplicating the YAML contracts. EVALUATED: not-applicable.

## Testing closeout
- [x] Missing cases to add: none identified after backend route coverage for unauthenticated, malformed/invalid token, wrong-tenant, valid member, non-admin Admin gate, and context-driven handlers.
- [x] Coverage gaps: none identified for locked goals.

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [x] Lint: `bun run format:check` PASS
- [x] Build: `bun run build` PASS
- [x] Tests: `bun run test` PASS

## Manual QA (if applicable)
- [ ] Steps: EVALUATED: not-applicable; backend authorization behavior is covered by automated route tests.
- [ ] Expected: EVALUATED: not-applicable.

## Code review checklist
- [x] Correctness and edge cases
- [x] Error handling / failure modes
- [x] Security (secrets, injection, authz/authn)
- [x] Performance (DB queries, hot paths, batching)
- [x] Maintainability (structure, naming, boundaries)
- [x] Consistency with repo conventions
- [x] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan: EVALUATED: not-applicable; no schema migration.
- [ ] Feature flags: EVALUATED: not-applicable; no feature flag required.
- [x] Backout plan: revert the backend auth/route/service/test changes for this task.

## Outstanding issues (if any)
For each issue include severity + repro + suggested fix.
- None.
