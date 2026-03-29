# Goals Extract
- Task name: document-setup-instructions
- Iteration: v1
- State: draft

## Goals (1-20, verifiable)

1. Create `SETUP.md` that documents the full local setup sequence for this repository, including prerequisites, dependency installation, env-file preparation, database setup, Firebase setup, and local run commands.
2. Base the documented env instructions on the actual env/runtime surface present in the repository, and update both `.env` and `develop.env` so they are aligned with each other and with the current setup contract.
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
- [G2] `.env` and `develop.env` are aligned per the approved rule: `develop.env` matches `.env`, entries not present in `.env` are removed from `develop.env`, and both files include the required exception-list variables.
- [G3] `SETUP.md` includes a concrete PostgreSQL example that references `database/init-user-db.sql`, explains schema creation, and states that `DB_SCHEMA` must match the created schema name.
- [G4] `README.md` links to `SETUP.md` and summarizes requirements instead of duplicating the full procedural setup guide.
- [G5] `SETUP.md` includes external links to the relevant official setup docs for the dependencies/configuration areas the developer must visit.
- [G6] If scriptable setup follow-ups remain, `SETUP.md` ends with `//TODO` items and a GitHub issue is created documenting that automation work; if none remain, no TODO/issue requirement is triggered.
- [G7] No unrelated code or behavior changes are introduced outside the documentation/setup-sample scope.

