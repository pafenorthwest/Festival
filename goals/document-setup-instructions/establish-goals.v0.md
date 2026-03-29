# establish-goals

## Status

- Iteration: v0
- State: ready-for-confirmation
- Task name (proposed, kebab-case): document-setup-instructions

## Request restatement

- Document the repository's full local setup flow in a new `SETUP.md`, then link to it from `README.md` while keeping the two documents aligned.
- Build the setup guide from the actual env/runtime surface, including links to external setup docs for each relevant dependency area, PostgreSQL setup with the checked-in init script, and the non-`public` schema requirement tied to `DB_SCHEMA`.
- Audit `develop.env` and update it so the checked-in sample env reflects the current codebase instead of stale or mismatched variable names.
- If any setup steps are obviously scriptable, record them as `//TODO` items at the bottom of `SETUP.md` and create a GitHub issue with `gh issue create`.

## Context considered

- Repo/rules/skills consulted:
  - `AGENTS.md`
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `.codex/codex-config.yaml`
  - `.codex/project-structure.md`
- Relevant files (if any):
  - `README.md`
  - `develop.env`
  - `database/init-user-db.sql`
  - `packages/backend/src/config/env.ts`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/auth/firebase-auth-verifier.ts`
  - `packages/frontend/src/lib/firebase-auth.ts`
  - `packages/frontend/src/lib/api.ts`
  - `scripts/run-dev.sh`
  - `package.json`
- Constraints (sandbox, commands, policy):
  - No planning or implementation may proceed until goals are approved and locked.
  - Establish-goals artifacts must be managed through the approved repo scripts.
  - Verification commands are pinned by repo metadata to `bun run format:check`, `bun run build`, and `bun run test`.
  - Network access is restricted in the shell, so external documentation links will need to be gathered with the browsing tool during implementation.

## Ambiguities

### Blocking (must resolve)

1. None identified beyond the mandatory user review/approval gate for goals.

### Non-blocking (can proceed with explicit assumptions)

1. `develop.env` is intended to be the checked-in example/template for the repo-root runtime `.env`, so it should be brought into line with the variables the current code actually reads.
2. Stale placeholders that are not referenced by the current app may be removed from `develop.env` unless you explicitly want them retained as future-facing examples.
3. The GitHub issue, if needed, should be opened against this repository (`pafenorthwest/Festival`), using the current branch context and configured `gh` authentication.

## Questions for user

1. Should `develop.env` be reduced to the current active env surface only, or should it keep unused placeholders for future integrations if they are clearly labeled?
2. Do you want `SETUP.md` to focus on the current recommended path of using a real Firebase project plus local Postgres, with emulator/alternate paths treated as optional notes only if they are already supported?

## Assumptions (explicit; remove when confirmed)

1. `README.md` should stay concise and requirement-oriented, and `SETUP.md` should hold the step-by-step instructions.
2. PostgreSQL setup should show both the database role/database bootstrap using `database/init-user-db.sql` and the separate schema creation step required before the app can create its tables.
3. The schema name used in SQL examples must match the `DB_SCHEMA` value documented in the env file example because the runtime writes tables into `${DB_SCHEMA}.*` and does not create the schema itself.
4. External links should point to official vendor/documentation sites where possible.

## Goals (1-20, verifiable)

1. Create `SETUP.md` that documents the full local setup sequence for this repository, including prerequisites, dependency installation, env-file preparation, database setup, Firebase setup, and local run commands.
2. Base the documented env instructions on the actual env variables consumed by the current codebase, and update `develop.env` so its variable names, examples, and optional/required distinctions align with that runtime surface.
3. Document PostgreSQL setup in `SETUP.md` using the checked-in `database/init-user-db.sql` file, including an example invocation, explicit schema creation guidance, and the requirement that `DB_SCHEMA` exactly match the created non-`public` schema.
4. Update `README.md` so it presents the high-level setup requirements and links to `SETUP.md` for the detailed procedures, without duplicating the full step-by-step instructions.
5. Include external setup links in `SETUP.md` for each external dependency area implicated by the setup flow and env vars, using official documentation where available.
6. If the repo still has setup steps that are obviously scriptable after the documentation pass, add `//TODO` entries for them at the bottom of `SETUP.md` and create a corresponding GitHub issue with `gh issue create`.
7. Keep the change set limited to documentation and checked-in setup sample/config surfaces required for the above goals; do not change application behavior unless a documentation/sample mismatch cannot be resolved otherwise.

## Non-goals (explicit exclusions)

- Reworking backend, frontend, Firebase, or PostgreSQL runtime behavior beyond documentation/sample-env alignment.
- Adding deployment, hosting, CI, or production-operations documentation beyond what is necessary for local development setup.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] `SETUP.md` exists and gives a complete local setup path from prerequisites through first successful local run, with separate sections for env configuration, PostgreSQL, Firebase, and running the app.
- [G2] `develop.env` matches the current env names used by the repo's code and docs, with stale naming mismatches corrected or intentionally removed.
- [G3] `SETUP.md` includes a concrete PostgreSQL example that references `database/init-user-db.sql`, explains schema creation, and states that `DB_SCHEMA` must match the created schema name.
- [G4] `README.md` links to `SETUP.md` and summarizes requirements instead of duplicating the full procedural setup guide.
- [G5] `SETUP.md` includes external links to the relevant official setup docs for the dependencies/configuration areas the developer must visit.
- [G6] If scriptable setup follow-ups remain, `SETUP.md` ends with `//TODO` items and a GitHub issue is created documenting that automation work; if none remain, no TODO/issue requirement is triggered.
- [G7] No unrelated code or behavior changes are introduced outside the documentation/setup-sample scope.

## Risks / tradeoffs

- `develop.env` currently appears to contain stale and unused variables (`FIREBASE_ADMIN_*`, Shopify/Stripe, JWT, emulator, and other placeholders) that may have been kept for future plans. Pruning them improves accuracy but could remove placeholders someone still expected to see.
- The repo does not currently create the Postgres schema automatically, so the setup guide must be explicit about the manual schema step to avoid misleading developers into thinking the init SQL is sufficient on its own.
- External setup links can drift over time even when sourced from official docs, so the document should prefer stable entry-point pages rather than brittle deep links when possible.

## Next action

- Await user review of goals and answers to the preference questions, then lock goals if approved.
