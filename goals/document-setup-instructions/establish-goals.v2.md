# establish-goals

## Status

- Iteration: v2
- State: locked
- Task name (proposed, kebab-case): document-setup-instructions

## Request restatement

- Document the repository's full local setup flow in a new `SETUP.md`, then link to it from `README.md` while keeping the two documents aligned.
- Build the setup guide from the actual env/runtime surface, including links to external setup docs for each relevant dependency area, PostgreSQL setup with the checked-in init script, and the non-`public` schema requirement tied to `DB_SCHEMA`.
- Audit the existing repo-root `.env` and `develop.env`, trim `develop.env` so it matches `.env` except for the explicitly required additions, and add the required exception-list variables to both env files.
- Use the main setup path of a real Firebase project plus local PostgreSQL, while mentioning emulator or alternate paths only as optional notes when they are already supported.
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
  - `.env`
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

1. None.

### Non-blocking (can proceed with explicit assumptions)

1. `develop.env` should be updated to follow the local `.env` variable surface, and entries that exist only in `develop.env` should be removed unless they are part of the user-specified exception list.
2. The exception list that must exist in both `.env` and `develop.env` is: `APP_URL`, `API_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_USE_EMULATOR`, `AUTH_PROVIDER`, `AUTH_MODE`, and `AUTH_REQUIRE_EMAIL_VERIFIED`.
3. The env examples should preserve the existing frontend URL variables (`FRONT_APP_URL`, `FRONT_API_URL`) while also documenting the backend URL variables (`APP_URL`, `API_URL`) called out by the user.
4. The GitHub issue, if needed, should be opened against this repository (`pafenorthwest/Festival`), using the current branch context and configured `gh` authentication.

## Questions for user

1. None.

## Assumptions (explicit; remove when confirmed)

1. `README.md` should stay concise and requirement-oriented, and `SETUP.md` should hold the step-by-step instructions.
2. PostgreSQL setup should show both the database role/database bootstrap using `database/init-user-db.sql` and the separate schema creation step required before the app can create its tables.
3. The schema name used in SQL examples must match the `DB_SCHEMA` value documented in the env file example because the runtime writes tables into `${DB_SCHEMA}.*` and does not create the schema itself.
4. External links should point to official vendor/documentation sites where possible.
5. The incomplete `For example` snippet in the user message does not add a separate blocking requirement unless the user sends a specific formatting example later.

## Goals (1-20, verifiable)

1. Create `SETUP.md` that documents the full local setup sequence for this repository, including prerequisites, dependency installation, env-file preparation, database setup, Firebase setup, and local run commands.
2. Base the documented env instructions on the actual env/runtime surface present in the repository, and update both `.env` and `develop.env` so they are aligned with each other and with the current setup contract.
3. Document PostgreSQL setup in `SETUP.md` using the checked-in `database/init-user-db.sql` file, including an example invocation, explicit schema creation guidance, and the requirement that `DB_SCHEMA` exactly match the created non-`public` schema.
4. Update `README.md` so it presents the high-level setup requirements and links to `SETUP.md` for the detailed procedures, without duplicating the full step-by-step instructions.
5. Include external setup links in `SETUP.md` for each external dependency area implicated by the setup flow and env vars, using official documentation where available.
6. If the repo still has setup steps that are obviously scriptable after the documentation pass, add `//TODO` entries for them at the bottom of `SETUP.md` and create a corresponding GitHub issue with `gh issue create`.
7. Reflect the approved setup posture in the documentation: the primary flow uses a real Firebase project plus local PostgreSQL, and emulator or alternate flows are optional notes only.
8. Keep the change set limited to documentation and checked-in setup sample/config surfaces required for the above goals; do not change application behavior unless a documentation/sample mismatch cannot be resolved otherwise.

## Non-goals (explicit exclusions)

- Reworking backend, frontend, Firebase, or PostgreSQL runtime behavior beyond documentation/sample-env alignment.
- Adding deployment, hosting, CI, or production-operations documentation beyond what is necessary for local development setup.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] `SETUP.md` exists and gives a complete local setup path from prerequisites through first successful local run, with separate sections for env configuration, PostgreSQL, Firebase, and running the app.
- [G2] `.env` and `develop.env` are aligned per the approved rule: `develop.env` matches `.env`, entries not present in `.env` are removed from `develop.env`, and both files include the required exception-list variables.
- [G3] `SETUP.md` includes a concrete PostgreSQL example that references `database/init-user-db.sql`, explains schema creation, and states that `DB_SCHEMA` must match the created schema name.
- [G4] `README.md` links to `SETUP.md` and summarizes requirements instead of duplicating the full procedural setup guide.
- [G5] `SETUP.md` includes external links to the relevant official setup docs for the dependencies/configuration areas the developer must visit.
- [G6] If scriptable setup follow-ups remain, `SETUP.md` ends with `//TODO` items and a GitHub issue is created documenting that automation work; if none remain, no TODO/issue requirement is triggered.
- [G7] `SETUP.md` clearly treats the real Firebase plus local Postgres path as the primary setup flow, and relegates emulator or alternate flows to optional notes only.
- [G8] No unrelated code or behavior changes are introduced outside the documentation/setup-sample scope.

## Risks / tradeoffs

- The existing `.env` and `develop.env` use different naming conventions today, so aligning them may require updating local sample/config files without changing runtime behavior in this task.
- The repo does not currently create the Postgres schema automatically, so the setup guide must be explicit about the manual schema step to avoid misleading developers into thinking the init SQL is sufficient on its own.
- External setup links can drift over time even when sourced from official docs, so the document should prefer stable entry-point pages rather than brittle deep links when possible.

## Next action

- Goals locked. `prepare-takeoff` owns task scaffolding and `spec.md` readiness content.
