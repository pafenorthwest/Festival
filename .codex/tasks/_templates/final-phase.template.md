# Final Phase — Hardening, Verification, and Closeout

> Stage 4 completion source of truth:
> mark items as complete with `[x]`, or leave unchecked with `EVALUATED: <decision + reason>`.

### Documentation updates

* [ ] `/doc` audit and updates

  * [ ] Enumerate documentation artifacts under `/doc` that are impacted by this change (API behavior, auth, error contracts, examples, migrations, ops notes).
  * [ ] Update affected docs and ensure cross-links remain valid (README ↔ docs ↔ ADRs/runbooks).

* [ ] YAML documentation contracts (`/doc/**/*.yaml`)

  * [ ] Discover all YAML documentation files under `/doc` (recursive) and update any impacted by the change:

    * [ ] endpoint definitions, request/response schemas, auth schemes, error models
    * [ ] examples (happy path + common failures)
  * [ ] If a YAML contract/spec is required for this change but no matching file exists yet:

    * [ ] Create an initial YAML spec in `/doc/` using the repo’s conventions (OpenAPI/AsyncAPI/etc. as applicable)
    * [ ] Include minimum viable metadata (`info`, `servers`/environment targets, `securitySchemes` where relevant) plus at least one representative operation and shared error schema(s)

* [ ] README updates

  * [ ] Add or refresh a single “Documentation” section linking to `/doc/` and any key YAML specs within it.
  * [ ] Include local validation/viewing instructions if the repo has them (lint/validate/render command).

* [ ] ADRs (if any)

  * [ ] Add/update an ADR when the change introduces a durable architectural decision (contract format, versioning policy, auth strategy, error envelope standardization).

* [ ] Inline docs/comments

  * [ ] Update inline comments/docstrings only where they add implementation clarity without duplicating the YAML contracts.

## Testing closeout
- [ ] Missing cases to add:
- [ ] Coverage gaps:

## Full verification
> Use the pinned commands in spec + `./codex/project-structure.md` + `./codex/codex-config.yaml`.
> Stage 4 requires explicit pass notation: `PASS`.

- [ ] Lint: `...` PASS
- [ ] Build: `...` PASS
- [ ] Tests: `...` PASS

## Manual QA (if applicable)
- [ ] Steps:
- [ ] Expected:

## Code review checklist
- [ ] Correctness and edge cases
- [ ] Error handling / failure modes
- [ ] Security (secrets, injection, authz/authn)
- [ ] Performance (DB queries, hot paths, batching)
- [ ] Maintainability (structure, naming, boundaries)
- [ ] Consistency with repo conventions
- [ ] Test quality and determinism

## Release / rollout notes (if applicable)
- [ ] Migration plan:
- [ ] Feature flags:
- [ ] Backout plan:

## Outstanding issues (if any)
For each issue include severity + repro + suggested fix.
- None.
- Severity:
- Repro:
- Suggested fix:
